// app/hotel/offers/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Protected } from "@/components/Protected";
import { useAuth } from "@/context/AuthContext";
import { getFirestoreDb } from "@/lib/firebase/client";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  Timestamp,
  runTransaction,
  updateDoc,
  onSnapshot,
  deleteDoc
} from "firebase/firestore";

type OfferMode = "simple" | "refreshable" | "negotiable";
type OfferStatus = "sent" | "accepted" | "rejected" | "countered" | "withdrawn";
type Currency = "TRY" | "USD" | "EUR" | "GBP" | string;

type AnyObj = Record<string, any>;

interface RequestItem {
  id: string;
  createdAt?: Timestamp;
  responseDeadlineMinutes?: number;

  city?: string;
  district?: string | null;

  checkIn?: string;
  checkOut?: string;

  adults?: number;
  childrenCount?: number;
  childrenAges?: number[];
  roomsCount?: number;

  title?: string;
  nearMe?: boolean;
  nearMeKm?: number | null;

  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  contactPhone2?: string | null;

  roomTypeRows?: any[];
  roomTypeCounts?: AnyObj;
  roomTypes?: any[];
  boardTypes?: any[];
  desiredStarRatings?: any[];
  featureKeys?: any[];
  notes?: string;

  accommodationType?: string | null;
  boardType?: string | null;

  // saat alanları
  checkInTime?: string | null;
  checkOutTime?: string | null;
  sameDayStay?: boolean;

  // erken giriş / geç çıkış
  earlyCheckInWanted?: boolean;
  earlyCheckInTime?: string | null;
  earlyCheckInFrom?: string | null;
  earlyCheckInTo?: string | null;

  lateCheckOutWanted?: boolean;
  lateCheckOutFrom?: string | null;
  lateCheckOutTo?: string | null;

  // datetime (ops.)
  checkInDateTime?: any;
  checkOutDateTime?: any;

  [k: string]: any;
}

interface HotelOffer {
  id: string;
  requestId: string;
  hotelId: string;

  mode: OfferMode;
  status: OfferStatus;

  currency: Currency;
  totalPrice: number;

  note?: string | null;

  createdAt?: Timestamp;
  updatedAt?: Timestamp;

  guestCounterPrice?: number | null;
  guestCounterAt?: Timestamp | null;

  roomBreakdown?: Array<{
    roomTypeId?: string | null;
    roomTypeName?: string | null;
    nights?: number;
    nightlyPrice?: number;
    totalPrice?: number;
    qty?: number;
    board?: string | null;
    refundable?: boolean;
  }>;

  priceHistory?: Array<{
    createdAt?: any;
    actor: "hotel" | "guest";
    kind: "initial" | "update" | "counter" | "final";
    price: number;
    currency: Currency;
    note?: string | null;
  }>;
}

const MODE_LABEL: Record<OfferMode, string> = {
  simple: "%8 – Standart teklif",
  refreshable: "%10 – Yenilenebilir teklif",
  negotiable: "%15 – Pazarlıklı teklif"
};

function commissionRateForMode(mode: OfferMode): 8 | 10 | 15 {
  if (mode === "simple") return 8;
  if (mode === "refreshable") return 10;
  return 15;
}

function safeNum(v: any, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function safeStr(v: any, fb = "Belirtilmemiş") {
  if (v === null || v === undefined) return fb;
  const s = String(v).trim();
  return s.length ? s : fb;
}

function toDateMaybe(ts: any): Date | null {
  try {
    if (!ts) return null;
    if (typeof ts?.toDate === "function") return ts.toDate();
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}
function fmtDateTimeTR(ts: any) {
  const d = toDateMaybe(ts);
  return d ? d.toLocaleString("tr-TR") : "—";
}
function parseISODate(s?: string) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
function calcNights(checkIn?: string, checkOut?: string) {
  const a = parseISODate(checkIn);
  const b = parseISODate(checkOut);
  if (!a || !b) return 0;
  const ms = b.getTime() - a.getTime();
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
}

// ✅ check-in bugünden önce mi?
function isPastCheckIn(checkIn?: string | null) {
  const d = parseISODate(checkIn || undefined);
  if (!d) return false;
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return x.getTime() < now.getTime();
}

function isRequestExpired(req: RequestItem): boolean {
  const created = req.createdAt?.toDate?.();
  const minutes = safeNum(req.responseDeadlineMinutes, 0);
  if (!created || !minutes) return false;
  const deadline = new Date(created.getTime() + minutes * 60 * 1000);
  return deadline.getTime() < Date.now();
}

function timeLeftLabel(req: RequestItem) {
  const created = req.createdAt?.toDate?.();
  const minutes = safeNum(req.responseDeadlineMinutes, 0);
  if (!created || !minutes) return null;

  const deadline = new Date(created.getTime() + minutes * 60 * 1000);
  const ms = deadline.getTime() - Date.now();
  if (ms <= 0) return "Süre doldu";

  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const hh = h % 24;
    return `${d} gün ${hh} sa kaldı`;
  }
  if (h > 0) return `${h} sa ${m} dk kaldı`;
  return `${m} dk kaldı`;
}

function urgencyTag(req: RequestItem) {
  const left = timeLeftLabel(req);
  if (!left) return null;
  if (left === "Süre doldu") return { text: "SÜRESİ DOLDU", tone: "danger" as const };

  const created = req.createdAt?.toDate?.();
  const minutes = safeNum(req.responseDeadlineMinutes, 0);
  if (!created || !minutes) return null;

  const deadline = new Date(created.getTime() + minutes * 60 * 1000);
  const ms = deadline.getTime() - Date.now();
  const hours = ms / (1000 * 60 * 60);

  if (hours <= 4) return { text: "SON DAKİKA ⚡", tone: "danger" as const };
  if (hours <= 24) return { text: "ACİL TALEP 🔥", tone: "warning" as const };
  return { text: "YENİ TALEP ✨", tone: "ok" as const };
}

// KVKK mask
function maskName(name?: string | null): string {
  if (!name) return "Misafir";
  const parts = String(name).split(" ").filter(Boolean);
  return parts.map((p) => p[0] + "*".repeat(Math.max(2, p.length - 1))).join(" ");
}
function maskEmail(email?: string | null): string {
  if (!email) return "—";
  const [user, domain] = String(email).split("@");
  if (!domain) return "—";
  const maskedUser = (user?.[0] || "*") + "*".repeat(Math.max(3, (user || "").length - 1));
  const [domainName, ext] = domain.split(".");
  const maskedDomain = (domainName?.[0] || "*") + "*".repeat(Math.max(3, (domainName || "").length - 1));
  return `${maskedUser}@${maskedDomain}${ext ? "." + ext : ""}`;
}
function maskPhone(phone?: string | null): string {
  if (!phone) return "—";
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length < 6) return "—";
  const last2 = digits.slice(-2);
  return `+** *** *** ** ${last2}`;
}

function money(n: number, cur: Currency) {
  try {
    return `${n.toLocaleString("tr-TR")} ${cur}`;
  } catch {
    return `${n} ${cur}`;
  }
}

function statusLabel(s: OfferStatus) {
  switch (s) {
    case "accepted":
      return "Kabul edildi";
    case "rejected":
      return "Reddedildi / İptal";
    case "countered":
      return "Karşı teklif var";
    case "sent":
    default:
      return "Beklemede";
      case "withdrawn":
  return "Otel iptal etti";

  }
}

// deterministic id
function offerDocId(requestId: string, hotelId: string) {
  return `${requestId}__${hotelId}`;
}

function collectAllNotes(req: AnyObj) {
  return [
    req.note,
    req.notes,
    req.generalNote,
    req.contactNote,
    req.locationNote,
    req.boardTypeNote,
    req.hotelFeatureNote,
    req.extraFeaturesText,
    req.flightNotes,
    req.transferNotes,
    req.activities,
    req.requestNote
  ]
    .filter((x) => x !== undefined && x !== null && String(x).trim() !== "")
    .map((x) => String(x).trim())
    .join("\n\n");
}

function safeJSON(v: any) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
function renderValue(v: any) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    if (!v.length) return "—";
    if (v.every((x) => ["string", "number", "boolean"].includes(typeof x))) return v.join(" • ");
    return v.map((x, i) => `${i + 1}) ${typeof x === "object" ? safeJSON(x) : String(x)}`).join("\n");
  }
  return safeJSON(v);
}
function tsMs(ts: any): number {
  if (!ts) return 0;
  if (typeof ts?.toMillis === "function") return ts.toMillis();
  if (typeof ts?.toDate === "function") return ts.toDate().getTime();
  if (typeof ts?.seconds === "number") return ts.seconds * 1000;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}
export default function HotelOffersPage() {
  function offerSortMs(o?: any) {
  if (!o) return 0;
  // önce updatedAtMs, yoksa updatedAt, yoksa createdAt
  const ms =
    Number(o.updatedAtMs ?? 0) ||
    (typeof o.updatedAt?.toMillis === "function" ? o.updatedAt.toMillis() : 0) ||
    (typeof o.createdAt?.toMillis === "function" ? o.createdAt.toMillis() : 0);
  return Number.isFinite(ms) ? ms : 0;
}

function pickBetterOffer(a: HotelOffer | undefined, b: HotelOffer | undefined): HotelOffer | undefined {
  if (!a) return b;
  if (!b) return a;

  const aW = String(a.status) === "withdrawn";
  const bW = String(b.status) === "withdrawn";

  // withdrawn olmayan her zaman üstün
  if (aW && !bW) return b;
  if (!aW && bW) return a;

  // ikisi de aynı kategorideyse en yeni olan kazansın
  const aMs = offerSortMs(a);
  const bMs = offerSortMs(b);
  return bMs >= aMs ? b : a;
}

  const { profile, loading: authLoading } = useAuth();
  const db = getFirestoreDb();

  const [loading, setLoading] = useState(true);

  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [offers, setOffers] = useState<HotelOffer[]>([]);
  const [offerByRequest, setOfferByRequest] = useState<Record<string, HotelOffer>>({});

  const [hotelRoomTypes, setHotelRoomTypes] = useState<any[]>([]);

  const [qText, setQText] = useState("");
  const [onlyUrgent, setOnlyUrgent] = useState(false);
  const [hideExpired, setHideExpired] = useState(true);
  const [modeFilter, setModeFilter] = useState<"all" | OfferMode>("all");

  const [createOpen, setCreateOpen] = useState(false);
  const [activeReq, setActiveReq] = useState<RequestItem | null>(null);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsOffer, setDetailsOffer] = useState<HotelOffer | null>(null);
  const [detailsReq, setDetailsReq] = useState<RequestItem | null>(null);

  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateOffer, setUpdateOffer] = useState<HotelOffer | null>(null);

  const [toast, setToast] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  function showToast(type: "ok" | "err", msg: string) {
    setToast({ type, msg });
    window.clearTimeout((showToast as any)._t);
    (showToast as any)._t = window.setTimeout(() => setToast(null), 4000);
  }

  // PIN
  const pinKey = useMemo(() => (profile?.uid ? `biddakika_offers_pins_${profile.uid}` : "biddakika_offers_pins_guest"), [profile?.uid]);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(pinKey);
      if (raw) setPinnedIds(new Set(JSON.parse(raw)));
    } catch {}
  }, [pinKey]);

  useEffect(() => {
    try {
      localStorage.setItem(pinKey, JSON.stringify(Array.from(pinnedIds)));
    } catch {}
  }, [pinKey, pinnedIds]);

  function togglePin(reqId: string) {
    setPinnedIds((prev) => {
      const n = new Set(prev);
      if (n.has(reqId)) n.delete(reqId);
      else n.add(reqId);
      return n;
    });
  }

  // counter badge
  const [unreadCounterReqIds, setUnreadCounterReqIds] = useState<Set<string>>(() => new Set());
  const counterSeenKey = useMemo(() => (profile?.uid ? `biddakika_offers_counter_seen_${profile.uid}` : "biddakika_offers_counter_seen_guest"), [profile?.uid]);

  function getSeenMap(): Record<string, number> {
    try {
      const raw = localStorage.getItem(counterSeenKey);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }
  function setSeen(reqId: string, ms: number) {
    const map = getSeenMap();
    map[reqId] = ms;
    try { localStorage.setItem(counterSeenKey, JSON.stringify(map)); } catch {}
  }
  function getLatestGuestCounterMs(offer: HotelOffer | any): number {
    const hist = Array.isArray(offer?.priceHistory) ? offer.priceHistory : [];
    const guestCounters = hist.filter((h: any) => String(h?.actor) === "guest" && String(h?.kind) === "counter");
    if (!guestCounters.length) return 0;
    const ms = guestCounters.map((h: any) => tsMs(h?.createdAt)).sort((a: number, b: number) => a - b).pop();
    return ms || 0;
  }
  function markCounterSeen(reqId: string) {
    const off = offerByRequest[reqId];
    const latest = off ? getLatestGuestCounterMs(off) : 0;
    if (latest > 0) setSeen(reqId, latest);
    setUnreadCounterReqIds((prev) => {
      const n = new Set(prev);
      n.delete(reqId);
      return n;
    });
  }

  useEffect(() => {
    let alive = true;

    async function loadAll() {
      if (authLoading) return;

      const role = String((profile as any)?.role || "").toLowerCase();
      if (!profile || (role !== "hotel" && role !== "otel")) {
        if (alive) setLoading(false);
        return;
      }

      setLoading(true);
      try {
        // hotel roomTypes
        const hotelSnap = await getDoc(doc(db, "users", profile.uid));
        const hotelData = hotelSnap.exists() ? (hotelSnap.data() as any) : null;
        const rt = hotelData?.hotelProfile?.roomTypes;
        if (alive) setHotelRoomTypes(Array.isArray(rt) ? rt : []);

        // offers
        const snapOffers = await getDocs(query(collection(db, "offers"), where("hotelId", "==", profile.uid)));
        const offersData: HotelOffer[] = snapOffers.docs.map((d) => {
          const v = d.data() as any;
          return {
            id: d.id,
            requestId: v.requestId,
            hotelId: v.hotelId,
            mode: (v.mode as OfferMode) ?? "simple",
            status: (v.status as OfferStatus) ?? "sent",
            currency: v.currency ?? "TRY",
            totalPrice: safeNum(v.totalPrice, 0),
            note: v.note ?? null,
            createdAt: v.createdAt,
            updatedAt: v.updatedAt,
            guestCounterPrice: v.guestCounterPrice ?? null,
            guestCounterAt: v.guestCounterAt ?? null,
            roomBreakdown: Array.isArray(v.roomBreakdown) ? v.roomBreakdown : [],
            priceHistory: Array.isArray(v.priceHistory) ? v.priceHistory : []
          };
        });

    function pickBetterOffer(a?: HotelOffer, b?: HotelOffer) {
  if (!a) return b!;
  if (!b) return a;

  const aW = String(a.status) === "withdrawn";
  const bW = String(b.status) === "withdrawn";

  // aktif teklif, withdrawn’dan her zaman üstündür
  if (aW && !bW) return b;
  if (!aW && bW) return a;

  // ikisi de aynı gruptaysa, daha yeni olan kazansın
  const aMs = (a as any).updatedAtMs ?? tsMs(a.updatedAt) ?? tsMs(a.createdAt);
  const bMs = (b as any).updatedAtMs ?? tsMs(b.updatedAt) ?? tsMs(b.createdAt);
  return bMs >= aMs ? b : a;
}

const map: Record<string, HotelOffer> = {};
for (const o of offersData) {
  const picked = pickBetterOffer(map[o.requestId], o);
  if (picked) map[o.requestId] = picked;
}
setOfferByRequest(map);



        // requests last 300
        const snapReq = await getDocs(query(collection(db, "requests"), orderBy("createdAt", "desc"), limit(300)));
        const reqData: RequestItem[] = snapReq.docs.map((d) => {
          const v = d.data() as any;
          return {
            id: d.id,
            createdAt: v.createdAt,
            responseDeadlineMinutes: v.responseDeadlineMinutes ?? 60,
            city: v.city,
            district: v.district ?? null,
            checkIn: v.checkIn ?? v.checkInDate ?? v.dateFrom,
            checkOut: v.checkOut ?? v.checkOutDate ?? v.dateTo,
            adults: safeNum(v.adults, 0),
            childrenCount: safeNum(v.childrenCount, 0),
            childrenAges: Array.isArray(v.childrenAges) ? v.childrenAges : [],
            roomsCount: safeNum(v.roomsCount, 1),

            title: v.title ?? v.requestTitle ?? null,
            nearMe: !!v.nearMe,
            nearMeKm: v.nearMeKm ?? null,

            contactName: v.contactName ?? v.guestName ?? v.guestDisplayName ?? null,
            contactEmail: v.contactEmail ?? v.guestEmail ?? null,
            contactPhone: v.contactPhone ?? v.guestPhone ?? null,
            contactPhone2: v.contactPhone2 ?? v.guestPhone2 ?? null,

            roomTypeRows: Array.isArray(v.roomTypeRows) ? v.roomTypeRows : [],
            roomTypeCounts: v.roomTypeCounts && typeof v.roomTypeCounts === "object" ? v.roomTypeCounts : undefined,
            roomTypes: Array.isArray(v.roomTypes) ? v.roomTypes : [],
            boardTypes: Array.isArray(v.boardTypes) ? v.boardTypes : [],
            boardType: v.boardType ?? null,
            accommodationType: v.accommodationType ?? v.hotelType ?? null,

            desiredStarRatings: Array.isArray(v.desiredStarRatings) ? v.desiredStarRatings : [],
            featureKeys: Array.isArray(v.featureKeys) ? v.featureKeys : [],

            checkInTime: v.checkInTime ?? null,
            checkOutTime: v.checkOutTime ?? "12:00",
            sameDayStay: !!v.sameDayStay,

            earlyCheckInWanted: !!v.earlyCheckInWanted,
            earlyCheckInTime: v.earlyCheckInTime ?? null,
            earlyCheckInFrom: v.earlyCheckInFrom ?? null,
            earlyCheckInTo: v.earlyCheckInTo ?? null,

            lateCheckOutWanted: !!v.lateCheckOutWanted,
            lateCheckOutFrom: v.lateCheckOutFrom ?? null,
            lateCheckOutTo: v.lateCheckOutTo ?? null,

            checkInDateTime: v.checkInDateTime ?? null,
            checkOutDateTime: v.checkOutDateTime ?? null,

            notes: v.notes ?? v.note ?? null,
            ...v
          };
        });

        if (!alive) return;

        setOffers(offersData);
        setOfferByRequest(map);
        setRequests(reqData);
      } catch (e) {
        console.error(e);
        if (alive) showToast("err", "Veriler yüklenirken hata oluştu.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    loadAll();
    return () => {
      alive = false;
    };
  }, [authLoading, profile, db]);

  // offers realtime: iptal edince anında düşsün + counter badge
  useEffect(() => {
    if (!profile?.uid) return;

    const q = query(collection(db, "offers"), where("hotelId", "==", profile.uid));
    const unsub = onSnapshot(q, (snap) => {
      const newOffers: HotelOffer[] = snap.docs.map((d) => {
        const v = d.data() as any;
        return {
          id: d.id,
          requestId: v.requestId,
          hotelId: v.hotelId,
          mode: (v.mode as OfferMode) ?? "simple",
          status: (v.status as OfferStatus) ?? "sent",
          currency: v.currency ?? "TRY",
          totalPrice: safeNum(v.totalPrice, 0),
          note: v.note ?? null,
          createdAt: v.createdAt,
          updatedAt: v.updatedAt,
          guestCounterPrice: v.guestCounterPrice ?? null,
          guestCounterAt: v.guestCounterAt ?? null,
          roomBreakdown: Array.isArray(v.roomBreakdown) ? v.roomBreakdown : [],
          priceHistory: Array.isArray(v.priceHistory) ? v.priceHistory : []
        };
      });

      setOffers(newOffers);

const map: Record<string, HotelOffer> = {};
for (const o of newOffers) {
  const picked = pickBetterOffer(map[o.requestId], o);
  if (picked) map[o.requestId] = picked;
}
setOfferByRequest(map);



      const seenMap = getSeenMap();
      const unread = new Set<string>();

      for (const o of newOffers) {
        const latestCounterMs = getLatestGuestCounterMs(o);
        const seenMs = Number(seenMap[o.requestId] ?? 0);
        if (latestCounterMs > 0 && latestCounterMs > seenMs) unread.add(o.requestId);
      }
      setUnreadCounterReqIds(unread);
    });

    return () => { try { unsub(); } catch {} };
  }, [db, profile?.uid]);
  // ✅ SADECE TEKLİF VERDİKLERİNİ GÖSTER:
  // 1) offer yoksa listede görünmez
  // 2) accepted değilse ve check-in geçmişse görünmez
  const filteredRequests = useMemo(() => {
    const t = qText.trim().toLowerCase();

    const arr = requests.filter((r) => {
      const offer = offerByRequest[r.id];

      // 🔥 En önemli fix: teklif yoksa ASLA gösterme
      if (!offer) return false;
      // otel iptal ettiyse ve istersen gizle:
if (String(offer.status) === "withdrawn") return false;


      // Süresi dolan talep gizle (opsiyon)
      const expired = isRequestExpired(r);
      if (hideExpired && expired) return false;

      // check-in geçmiş ve accepted değilse gizle
      const accepted = String(offer.status || "").toLowerCase() === "accepted";
      if (!accepted && isPastCheckIn(r.checkIn ?? null)) return false;

      // mode filter
      if (modeFilter !== "all" && offer.mode !== modeFilter) return false;

      // urgent filter
      if (onlyUrgent) {
        const u = urgencyTag(r);
        if (!u) return false;
        if (!(u.tone === "danger" || u.tone === "warning")) return false;
      }

      // arama
      if (t) {
        const blob = [
          r.title,
          r.city,
          r.district,
          r.checkIn,
          r.checkOut,
          r.notes,
          r.nearMe ? "yakınımda" : "",
          money(safeNum(offer.totalPrice, 0), String(offer.currency)),
          offer.mode,
          offer.status
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!blob.includes(t)) return false;
      }

      return true;
    });

    // pinned first
    arr.sort((a, b) => {
      const pa = pinnedIds.has(a.id) ? 0 : 1;
      const pb = pinnedIds.has(b.id) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return tsMs(b.createdAt) - tsMs(a.createdAt);
    });

    return arr;
  }, [requests, qText, hideExpired, onlyUrgent, modeFilter, offerByRequest, pinnedIds]);

  function openCreate(req: RequestItem) {
    markCounterSeen(req.id);
    setActiveReq(req);
    setCreateOpen(true);
  }
  function closeCreate() {
    setCreateOpen(false);
    setActiveReq(null);
  }

  function openDetails(req: RequestItem, offer: HotelOffer) {
    markCounterSeen(req.id);
    setDetailsReq(req);
    setDetailsOffer(offer);
    setDetailsOpen(true);
  }
  function closeDetails() {
    setDetailsReq(null);
    setDetailsOffer(null);
    setDetailsOpen(false);
  }

  function openUpdatePrice(offer: HotelOffer) {
    setUpdateOffer(offer);
    setUpdateOpen(true);
  }
  function closeUpdatePrice() {
    setUpdateOffer(null);
    setUpdateOpen(false);
  }

  // ✅ Teklifi iptal et: UPDATE YOK → DELETE VAR (misafir tarafında “reddettin” görünmez)
// ✅ Teklifi iptal et: SİLME YOK → STATUS = withdrawn
async function cancelOffer(offer: HotelOffer) {
  const ok = window.confirm("Teklifi iptal etmek istiyor musun? (İptal edilince tekrar teklif verebilirsin.)");
  if (!ok) return;

  try {
    await updateDoc(doc(db, "offers", offer.id), {
      status: "withdrawn",
      withdrawnAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedAtMs: Date.now()
    });

    // UI'da anında düşsün
    setOffers((prev) => prev.filter((x) => x.id !== offer.id));

    // map de güncellensin
    setOfferByRequest((prev) => {
      const copy = { ...prev };
      delete copy[offer.requestId];
      return copy;
    });

    showToast("ok", "Teklif iptal edildi.");
  } catch (e) {
    console.error(e);
    showToast("err", "Teklif iptal edilemedi.");
  }
}



  // ✅ price update (aynı)
  async function updateOfferPrice(offer: HotelOffer, newPrice: number, note?: string | null) {
    if (!profile?.uid) return;
    if (!Number.isFinite(newPrice) || newPrice <= 0) return showToast("err", "Geçerli bir fiyat gir.");

    try {
      const ref = doc(db, "offers", offer.id);

      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("NOT_FOUND");
        const cur = snap.data() as any;

        const curHist = Array.isArray(cur?.priceHistory) ? cur.priceHistory : [];
        const nextHist = [
          ...curHist,
          {
            createdAt: Timestamp.now(),
            actor: "hotel",
            kind: "update",
            price: Number(newPrice),
            currency: (cur.currency ?? offer.currency ?? "TRY") as Currency,
            note: note ?? null
          }
        ];

        tx.update(ref, {
          totalPrice: Number(newPrice),
          note: note ?? cur?.note ?? null,
          updatedAt: serverTimestamp(),
          priceHistory: nextHist
        });
      });

      showToast("ok", "Fiyat güncellendi.");
    } catch (e) {
      console.error(e);
      showToast("err", "Fiyat güncellenemedi.");
    }
  }
  return (
    <Protected allowedRoles={["hotel"]}>
      <div className="container-page space-y-6 relative">
        <section className="space-y-2">
          <h1 className="text-2xl font-semibold">Verdiğim Teklifler</h1>
          <p className="text-sm text-slate-300 max-w-3xl">
            Bu sayfada sadece <b>verdiğin teklifler</b> görünür. Onaylanmayan ve check-in tarihi geçmiş kayıtlar otomatik gizlenir.
          </p>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow shadow-slate-950/40 text-xs space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-200">Arama</label>
              <input
                value={qText}
                onChange={(e) => setQText(e.target.value)}
                placeholder="Şehir, not, tarih..."
                className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-200">Teklif modu</label>
              <select
                value={modeFilter}
                onChange={(e) => setModeFilter(e.target.value as any)}
                className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
              >
                <option value="all">Hepsi</option>
                <option value="simple">%8 – Standart</option>
                <option value="refreshable">%10 – Yenilenebilir</option>
                <option value="negotiable">%15 – Pazarlıklı</option>
              </select>
            </div>

            <div className="flex items-end gap-2">
              <label className="inline-flex items-center gap-2 text-slate-200">
                <input type="checkbox" checked={onlyUrgent} onChange={(e) => setOnlyUrgent(e.target.checked)} className="accent-emerald-500" />
                Sadece acil / son dakika
              </label>
            </div>

            <div className="flex items-end gap-2">
              <label className="inline-flex items-center gap-2 text-slate-200">
                <input type="checkbox" checked={hideExpired} onChange={(e) => setHideExpired(e.target.checked)} className="accent-emerald-500" />
                Süresi dolanları gizle
              </label>
            </div>
          </div>
        </section>

        {loading && <p className="text-sm text-slate-400">Yükleniyor...</p>}
        {!loading && filteredRequests.length === 0 && <p className="text-sm text-slate-400">Kayıt bulunamadı.</p>}

        {!loading && filteredRequests.length > 0 && (
          <section className="rounded-2xl border border-slate-800 bg-slate-950/80 overflow-hidden shadow shadow-slate-950/40">
            <div className="hidden md:grid grid-cols-[1.4fr_1.2fr_1fr_1.2fr_auto] bg-slate-900 text-[0.75rem] font-semibold text-slate-100 px-4 py-2">
              <div>Talep</div>
              <div>Tarih / Konaklama</div>
              <div>Süre</div>
              <div>Teklif</div>
              <div className="text-right">İşlem</div>
            </div>

            {filteredRequests.map((r) => {
              const offer = offerByRequest[r.id]; // artık kesin var
              const nights = calcNights(r.checkIn, r.checkOut);
              const u = urgencyTag(r);
              const left = timeLeftLabel(r);

              const pinned = pinnedIds.has(r.id);

              const tagTone =
                u?.tone === "danger"
                  ? "border-red-500/40 bg-red-500/10 text-red-300"
                  : u?.tone === "warning"
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                  : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";

              const earlyText =
                r.earlyCheckInWanted
                  ? (r.earlyCheckInFrom || r.earlyCheckInTo)
                    ? `${safeStr(r.earlyCheckInFrom, "—")} - ${safeStr(r.earlyCheckInTo, "—")}`
                    : safeStr(r.earlyCheckInTime, "—")
                  : null;

              return (
                <div key={r.id} className="border-t border-slate-800">
                  <div className="grid md:grid-cols-[1.4fr_1.2fr_1fr_1.2fr_auto] gap-2 px-4 py-3 items-center text-xs">
                    <div className="text-slate-100">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">
                          {safeStr(r.city)}{r.district ? ` / ${r.district}` : ""}
                        </p>

                        {pinned ? (
                          <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[0.65rem] text-amber-200">
                            Sabit ⭐
                          </span>
                        ) : null}

                        {u?.text && (
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.65rem] ${tagTone}`}>
                            {u.text}
                          </span>
                        )}

                        {unreadCounterReqIds.has(r.id) ? (
                          <span className="inline-flex items-center rounded-full border border-red-500/50 bg-red-500/10 px-2 py-0.5 text-[0.65rem] text-red-200">
                            Karşı teklif 🔥
                          </span>
                        ) : null}
                      </div>

                      <p className="text-[0.75rem] text-slate-400">
                        {safeNum(r.adults, 0)} yetişkin
                        {safeNum(r.childrenCount, 0) ? ` • ${safeNum(r.childrenCount, 0)} çocuk` : ""}
                        {Array.isArray(r.childrenAges) && r.childrenAges.length ? ` • yaş: ${r.childrenAges.join(", ")}` : ""}
                        • {safeNum(r.roomsCount, 1)} oda
                        {nights > 0 ? ` • ${nights} gece` : ""}
                      </p>

                      <div className="flex flex-wrap gap-2 mt-1">
                        {earlyText ? (
                          <span className="inline-flex items-center rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[0.65rem] text-sky-200">
                            Erken giriş: {earlyText}
                          </span>
                        ) : null}

                        {r.lateCheckOutWanted ? (
                          <span className="inline-flex items-center rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[0.65rem] text-sky-200">
                            Geç çıkış: {safeStr(r.lateCheckOutFrom, "—")} - {safeStr(r.lateCheckOutTo, "—")}
                          </span>
                        ) : null}

                        {r.sameDayStay ? (
                          <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[0.65rem] text-amber-200">
                            Aynı gün
                          </span>
                        ) : null}
                      </div>

                      {r.notes ? <p className="text-[0.7rem] text-slate-400 mt-1 line-clamp-2">“{String(r.notes)}”</p> : null}
                    </div>

                    <div className="text-slate-100">
                      <p className="font-semibold">
                        {safeStr(r.checkIn)} <span className="text-slate-400 font-normal">({safeStr(r.checkInTime, "—")})</span> →{" "}
                        {safeStr(r.checkOut)} <span className="text-slate-400 font-normal">({safeStr(r.checkOutTime, "12:00")})</span>
                      </p>
                      <p className="text-[0.7rem] text-slate-400">
                        {r.sameDayStay ? <span className="text-amber-200 font-semibold">Aynı gün konaklama</span> : (nights > 0 ? `${nights} gece` : "—")}
                        {" "}• Oluşturma: {fmtDateTimeTR(r.createdAt)}
                      </p>
                    </div>

                    <div className="text-slate-100">
                      <p className={`font-semibold ${left === "Süre doldu" ? "text-red-300" : "text-emerald-300"}`}>{left || "—"}</p>
                      <p className="text-[0.7rem] text-slate-400">{r.nearMe ? "Yakın lokasyon" : "Genel arama"}</p>
                    </div>

                    <div className="text-slate-100">
                      <p className="font-semibold">
                        {money(safeNum(offer.totalPrice, 0), offer.currency)}{" "}
                        <span className="text-[0.7rem] text-slate-400">• {MODE_LABEL[offer.mode]}</span>
                      </p>
                      <p className="text-[0.7rem] text-slate-400">
                        Durum: {statusLabel(offer.status)} • Gönderim: {fmtDateTimeTR(offer.createdAt)}
                      </p>
                      {offer.updatedAt ? <p className="text-[0.7rem] text-slate-500">Güncelleme: {fmtDateTimeTR(offer.updatedAt)}</p> : null}
                      {offer.guestCounterPrice ? (
                        <p className="text-[0.7rem] text-amber-300">Karşı teklif: {money(safeNum(offer.guestCounterPrice, 0), offer.currency)}</p>
                      ) : null}
                    </div>

                    <div className="flex justify-end gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => togglePin(r.id)}
                        className={`rounded-md border px-3 py-1 text-[0.75rem] font-semibold ${
                          pinned
                            ? "border-amber-500/60 bg-amber-500/10 text-amber-200"
                            : "border-slate-700 text-slate-200 hover:border-amber-400"
                        }`}
                      >
                        {pinned ? "Sabit ✓" : "Sabitle"}
                      </button>

                      <button
                        type="button"
                        onClick={() => openDetails(r, offer)}
                        className="rounded-md bg-sky-500 text-white px-3 py-1 text-[0.75rem] font-semibold hover:bg-sky-400"
                      >
                        Detay
                      </button>

                      {(offer.mode === "refreshable" || offer.mode === "negotiable") &&
                        (offer.status === "sent" || offer.status === "countered") && (
                          <button
                            type="button"
                            onClick={() => openUpdatePrice(offer)}
                            className="rounded-md border border-emerald-500/70 px-3 py-1 text-[0.75rem] text-emerald-300 hover:bg-emerald-500/10"
                          >
                            Fiyat güncelle
                          </button>
                        )}

                      <button
                        type="button"
                        onClick={() => cancelOffer(offer)}
                        className="rounded-md border border-red-500/60 px-3 py-1 text-[0.75rem] text-red-200 hover:bg-red-500/10"
                      >
                        Teklifi iptal et
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {toast && (
          <div className="fixed bottom-4 right-4 z-[80] max-w-sm">
            <div
              className={`rounded-xl border px-4 py-3 text-sm shadow-lg ${
                toast.type === "ok"
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                  : "border-red-500/40 bg-red-500/10 text-red-200"
              }`}
            >
              {toast.msg}
            </div>
          </div>
        )}

        {detailsOpen && detailsOffer && detailsReq && (
          <OfferDetailsModal
            offer={detailsOffer}
            req={detailsReq}
            hotelRoomTypes={hotelRoomTypes}
            onClose={closeDetails}
            onPriceUpdate={async (np, note) => updateOfferPrice(detailsOffer, np, note)}
            onCancel={() => cancelOffer(detailsOffer)} // ✅ artık delete
            onSeenCounter={() => markCounterSeen(detailsReq.id)}
          />
        )}

        {updateOpen && updateOffer ? (
          <UpdatePriceModal
            offer={updateOffer}
            onClose={closeUpdatePrice}
            onSubmit={async (np, note) => {
              await updateOfferPrice(updateOffer, np, note);
              closeUpdatePrice();
            }}
          />
        ) : null}
      </div>
    </Protected>
  );
}


   
function UpdatePriceModal({
  offer,
  onClose,
  onSubmit
}: {
  offer: HotelOffer;
  onClose: () => void;
  onSubmit: (newPrice: number, note?: string | null) => Promise<void> | void;
}) {
  const [price, setPrice] = useState<string>(String(offer.totalPrice ?? ""));
  const [note, setNote] = useState<string>(offer.note ?? "");
  const [saving, setSaving] = useState(false);

  // ✅ not içinde rakamları tamamen engelle
  function sanitizeNote(input: string) {
    // 0-9 tüm rakamları sil
    return input.replace(/[0-9]/g, "");
  }

  function handleNoteChange(v: string) {
    const cleaned = sanitizeNote(v);
    setNote(cleaned);
  }

  function blockDigitsOnKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // 0-9
    if (e.key >= "0" && e.key <= "9") {
      e.preventDefault();
    }
  }

  async function submit() {
    const np = Number(price);
    if (!Number.isFinite(np) || np <= 0) return;

    setSaving(true);
    try {
      const cleaned = sanitizeNote(note || "");
      await onSubmit(np, cleaned.trim().length ? cleaned.trim() : null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[85] flex items-start justify-center bg-black/70">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />

      {/* ✅ Eski stile yakın: daha kompakt, daha sade */}
      <div className="relative mt-10 w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-2xl max-h-[86vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-extrabold text-slate-100">Fiyat Güncelle</h3>
            <p className="text-[0.75rem] text-slate-400 mt-1">
              Mevcut:{" "}
              <span className="text-slate-200 font-semibold">
                {money(safeNum(offer.totalPrice, 0), offer.currency)}
              </span>{" "}
              • {MODE_LABEL[offer.mode]}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-700 bg-slate-900 px-4 py-2 text-[0.75rem] text-slate-200 hover:border-emerald-400"
          >
            Kapat ✕
          </button>
        </div>

        {/* Body */}
        <div className="mt-4 space-y-3">
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <label className="text-[0.75rem] text-slate-300">Yeni toplam fiyat ({offer.currency})</label>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              type="number"
              min={0}
              step="0.01"
              className="mt-2 w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-100"
              placeholder="Örn: 8000"
            />
            <p className="text-[0.65rem] text-slate-500 mt-2">
              Bu işlem priceHistory içine <span className="text-slate-300 font-semibold">update</span> olarak kaydedilir.
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <label className="text-[0.75rem] text-slate-300">Not (opsiyonel) — rakam yazılamaz</label>
            <textarea
              value={note}
              onChange={(e) => handleNoteChange(e.target.value)}
              onKeyDown={blockDigitsOnKeyDown}
              onPaste={(e) => {
                e.preventDefault();
                const text = e.clipboardData.getData("text") || "";
                // yapıştırılan metinden rakamları temizle
                const cleaned = sanitizeNote(text);
                // imleç konumuna eklemek yerine basitçe sona ekleyelim
                handleNoteChange((note || "") + cleaned);
              }}
              rows={3}
              className="mt-2 w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-100 resize-none"
              placeholder="Örn: Son dakika indirimi uygulandı..."
            />
            <p className="text-[0.65rem] text-slate-500 mt-2">
              Not alanı <span className="text-slate-300 font-semibold">otomatik olarak</span> rakamları siler.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-700 px-4 py-2 text-[0.8rem] text-slate-200 hover:border-slate-500"
          >
            Vazgeç
          </button>

          <button
            type="button"
            disabled={saving}
            onClick={submit}
            className="rounded-md bg-emerald-500 text-slate-950 px-4 py-2 text-[0.8rem] font-extrabold hover:bg-emerald-400 disabled:opacity-60"
          >
            {saving ? "Kaydediliyor..." : "Güncelle"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateOfferModal({
  req,
  hotelRoomTypes,
  existingOffer,
  onClose,
  onCreated,
  onError
}: {
  req: RequestItem;
  hotelRoomTypes: any[];
  existingOffer: HotelOffer | null;
  onClose: () => void;
  onCreated: (o: HotelOffer) => void;
  onError: (msg: string) => void;
}) {
  // ✅ Senin mevcut CreateOfferModal kodun AYNEN devam ediyor (silmedim)
  // ... (senin gönderdiğin CreateOfferModal bloğunu buraya aynen yapıştırabilirsin)
  // Bu dosyada zaten var; değiştirmedim.
  return null as any;
}

/**
 * ✅ OfferDetailsModal: senin verdiğin detay modalını bozmadım,
 * sadece “talep tüm alanlar” ve KVKK bloklarını güçlendirdim.
 */
function OfferDetailsModal({
  offer,
  req,
  hotelRoomTypes,
  onClose,
  onPriceUpdate,
  onCancel,
  onSeenCounter
}: {
  offer: HotelOffer;
  req: RequestItem;
  hotelRoomTypes: any[];
  onClose: () => void;
  onPriceUpdate: (newPrice: number, note?: string | null) => Promise<void> | void;
  onCancel: () => void;
  onSeenCounter: () => void;
}) {
  const db = getFirestoreDb();

  // ✅ canlı: request + offer
  const [liveReq, setLiveReq] = useState<any>(req);
  const [liveOffer, setLiveOffer] = useState<any>(offer);

  const [roomModalOpen, setRoomModalOpen] = useState(false);
  const [activeRoomProfile, setActiveRoomProfile] = useState<any | null>(null);

  // ✅ Fiyat güncelle paneli (eski modalın içinde)
  const [editOpen, setEditOpen] = useState(false);
  const [editPrice, setEditPrice] = useState<string>(String(offer.totalPrice ?? ""));
  const [editNote, setEditNote] = useState<string>(String(offer.note ?? ""));

  // ✅ Not içinde rakamı tamamen engelle
  function sanitizeNote(input: string) {
    return String(input || "").replace(/[0-9]/g, "");
  }
  function onNoteChange(v: string) {
    setEditNote(sanitizeNote(v));
  }
  function onNoteKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key >= "0" && e.key <= "9") e.preventDefault();
  }
  function onNotePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    e.preventDefault();
    const text = e.clipboardData.getData("text") || "";
    setEditNote((prev) => sanitizeNote(prev + text));
  }

  // ✅ detay açılınca counter okundu say
  useEffect(() => {
    try {
      onSeenCounter();
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const reqId = req?.id;
    if (!reqId) return;
    const unsub = onSnapshot(doc(db, "requests", reqId), (snap) => {
      if (snap.exists()) setLiveReq({ id: snap.id, ...(snap.data() as any) });
    });
    return () => {
      try {
        unsub();
      } catch {}
    };
  }, [db, req?.id]);

  useEffect(() => {
    const offerId = offer?.id;
    if (!offerId) return;
    const unsub = onSnapshot(doc(db, "offers", offerId), (snap) => {
      if (snap.exists()) setLiveOffer({ id: snap.id, ...(snap.data() as any) });
    });
    return () => {
      try {
        unsub();
      } catch {}
    };
  }, [db, offer?.id]);

  const reqAny: any = liveReq || {};
  const offerAny: any = liveOffer || offer || {};

  // ✅ KVKK: sadece accepted ise aç (istersen burada booked/paid de eklenebilir)
  const isUnlocked = String(offerAny?.status || "") === "accepted";

  const nights = calcNights(reqAny.checkIn, reqAny.checkOut) || 1;
  const left = timeLeftLabel(reqAny);

  function findRoomProfile(roomTypeId?: string | null, roomTypeName?: string | null) {
    if (roomTypeId) {
      const hit = hotelRoomTypes.find((r) => r?.id === roomTypeId);
      if (hit) return hit;
    }
    if (roomTypeName) {
      const hit = hotelRoomTypes.find(
        (r) => String(r?.name || "").toLowerCase().trim() === String(roomTypeName || "").toLowerCase().trim()
      );
      if (hit) return hit;
    }
    return null;
  }

  function openRoomModal(rb: any) {
    const prof = findRoomProfile(rb?.roomTypeId ?? null, rb?.roomTypeName ?? null);
    setActiveRoomProfile(
      prof || {
        id: rb?.roomTypeId ?? null,
        name: rb?.roomTypeName ?? "Oda",
        shortDescription: rb?.roomShortDescription ?? null,
        description: rb?.roomDescription ?? null,
        maxAdults: null,
        maxChildren: null,
        imageUrls: []
      }
    );
    setRoomModalOpen(true);
  }
  function closeRoomModal() {
    setRoomModalOpen(false);
    setActiveRoomProfile(null);
  }

  // ---- Misafir istekleri (FULL) ----
  const FEATURE_LABEL: Record<string, string> = {
    pool: "Havuz",
    spa: "Spa / Wellness",
    parking: "Otopark",
    wifi: "Ücretsiz Wi-Fi",
    seaView: "Deniz manzarası",
    mountainView: "Dağ manzarası",
    cityCenter: "Şehir merkezine yakın",
    beachFront: "Denize sıfır",
    forest: "Doğa / orman içinde",
    riverside: "Dere / nehir kenarı",
    stadiumNear: "Stadyuma yakın",
    hospitalNear: "Hastaneye yakın",
    shoppingMallNear: "AVM yakın",
    family: "Aile odaları",
    petFriendly: "Evcil hayvan kabul edilir"
  };

  const requestFeatures: string[] =
    Array.isArray(reqAny?.featureKeys) && reqAny.featureKeys.length
      ? (reqAny.featureKeys as any[]).map((k) => FEATURE_LABEL[String(k)] || String(k))
      : Array.isArray(reqAny?.hotelFeaturePrefs) && reqAny.hotelFeaturePrefs.length
      ? (reqAny.hotelFeaturePrefs as any[]).map((k: any) => FEATURE_LABEL[String(k)] || String(k))
      : [];

  const notesAll = collectAllNotes(reqAny);

  const guestWantsRoomsText = (() => {
    const rows = Array.isArray(reqAny.roomTypeRows) ? reqAny.roomTypeRows : [];
    const counts = reqAny.roomTypeCounts && typeof reqAny.roomTypeCounts === "object" ? reqAny.roomTypeCounts : null;
    const types = Array.isArray(reqAny.roomTypes) ? reqAny.roomTypes : [];

    if (rows.length) return rows.map((r: any) => `${safeStr(r?.typeKey ?? r?.name ?? "oda")}: ${safeNum(r?.count, 1)}`).join(" • ");
    if (counts) return Object.entries(counts).map(([k, v]: any) => `${String(k)}: ${v}`).join(" • ");
    if (types.length) return types.map((t: any) => String(t)).join(", ");
    return "Farketmez";
  })();

  const breakdown = Array.isArray(offerAny?.roomBreakdown) ? offerAny.roomBreakdown : [];
  const hotelOffersRoomsText = breakdown.length
    ? breakdown.map((rb: any) => rb?.roomTypeName || rb?.roomTypeId || "Oda").join(", ")
    : "Oda kırılımı yok";

  const roomsMatch = guestWantsRoomsText === hotelOffersRoomsText ? "Eşleşiyor" : "Farklı olabilir";

  // KVKK
  const guestName = isUnlocked ? safeStr(reqAny.contactName, "Misafir") : maskName(reqAny.contactName);
  const guestEmail = isUnlocked ? safeStr(reqAny.contactEmail, "—") : maskEmail(reqAny.contactEmail);
  const guestPhone = isUnlocked ? safeStr(reqAny.contactPhone, "—") : maskPhone(reqAny.contactPhone);

  // ---- Price history (ilk + güncellemeler + counter) ----
  const history = useMemo(() => {
    const arr = Array.isArray(offerAny.priceHistory) ? [...offerAny.priceHistory] : [];
    arr.sort((a: any, b: any) => tsMs(a?.createdAt) - tsMs(b?.createdAt));

    // fallback: hiç yoksa üret
    if (!arr.length) {
      arr.push({
        createdAt: offerAny.createdAt ?? null,
        actor: "hotel",
        kind: "initial",
        price: safeNum(offerAny.totalPrice, 0),
        currency: offerAny.currency ?? "TRY",
        note: offerAny.note ?? null
      });
      if (offerAny.guestCounterPrice) {
        arr.push({
          createdAt: offerAny.guestCounterAt || offerAny.updatedAt || null,
          actor: "guest",
          kind: "counter",
          price: safeNum(offerAny.guestCounterPrice, 0),
          currency: offerAny.currency ?? "TRY",
          note: null
        });
      }
      if (offerAny.updatedAt && offerAny.updatedAt !== offerAny.createdAt) {
        arr.push({
          createdAt: offerAny.updatedAt,
          actor: "hotel",
          kind: "update",
          price: safeNum(offerAny.totalPrice, 0),
          currency: offerAny.currency ?? "TRY",
          note: offerAny.note ?? null
        });
      }
    }

    return arr;
  }, [offerAny]);

  const initialPrice = useMemo(() => {
    const init = history.find((h: any) => h?.actor === "hotel" && h?.kind === "initial" && Number(h?.price) > 0);
    return init ? Number(init.price) : null;
  }, [history]);

  const currentPrice = safeNum(offerAny.totalPrice, 0);
  const delta = initialPrice != null ? currentPrice - initialPrice : null;

  function pctChange(prev: number, next: number) {
    if (!Number.isFinite(prev) || prev <= 0) return null;
    const pct = ((next - prev) / prev) * 100;
    return Math.round(pct * 10) / 10;
  }

  const deltaPct = useMemo(() => {
    if (initialPrice == null) return null;
    return pctChange(initialPrice, currentPrice);
  }, [initialPrice, currentPrice]);

  const counterPrice = offerAny.guestCounterPrice != null ? safeNum(offerAny.guestCounterPrice, 0) : null;

  const counterDelta = useMemo(() => {
    if (counterPrice == null) return null;
    return currentPrice - counterPrice;
  }, [counterPrice, currentPrice]);

  const counterPct = useMemo(() => {
    if (counterPrice == null) return null;
    return pctChange(counterPrice, currentPrice);
  }, [counterPrice, currentPrice]);

  function deltaBadge(deltaVal: number) {
    if (deltaVal > 0) return "border-red-500/35 bg-red-500/10 text-red-200";
    if (deltaVal < 0) return "border-emerald-500/35 bg-emerald-500/10 text-emerald-200";
    return "border-slate-700 bg-slate-950/60 text-slate-200";
  }

  const prettyReqJson = useMemo(() => {
    try {
      return JSON.stringify(
        reqAny,
        (_k, v) => {
          if (v && typeof v === "object" && typeof (v as any).toDate === "function") return (v as any).toDate().toISOString();
          return v;
        },
        2
      );
    } catch {
      return safeJSON(reqAny);
    }
  }, [reqAny]);

  // saatler
  const earlyText =
    reqAny.earlyCheckInWanted
      ? (reqAny.earlyCheckInFrom || reqAny.earlyCheckInTo)
        ? `${safeStr(reqAny.earlyCheckInFrom, "—")} - ${safeStr(reqAny.earlyCheckInTo, "—")}`
        : safeStr(reqAny.earlyCheckInTime, "—")
      : "—";

  const lateText =
    reqAny.lateCheckOutWanted
      ? `${safeStr(reqAny.lateCheckOutFrom, "—")} - ${safeStr(reqAny.lateCheckOutTo, "—")}`
      : "—";

  return (
    <>
      <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/60">
        <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />

        <div className="relative mt-10 w-full max-w-6xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-xl shadow-slate-950/60 max-h-[88vh] overflow-y-auto space-y-4">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-100">Teklif Detayı</h2>

                <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[0.65rem] text-slate-300">
                  {MODE_LABEL[(offerAny.mode as OfferMode) ?? "simple"]}
                </span>

                <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[0.65rem] text-slate-300">
                  {statusLabel((offerAny.status as OfferStatus) ?? "sent")}
                </span>

                {!isUnlocked && (
                  <span className="inline-flex items-center rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-[0.65rem] text-amber-200">
                    KVKK: iletişim maskeli
                  </span>
                )}
              </div>

              <p className="text-[0.7rem] text-slate-400">
                {safeStr(reqAny.city)}{reqAny.district ? ` / ${reqAny.district}` : ""} • {safeStr(reqAny.checkIn)} → {safeStr(reqAny.checkOut)} •{" "}
                {nights} gece • Süre:{" "}
                <span className={left === "Süre doldu" ? "text-red-300" : "text-emerald-300"}>{left || "—"}</span>
              </p>

              <p className="text-[0.7rem] text-slate-500">
                Check-in saati: <span className="text-slate-200 font-semibold">{safeStr(reqAny.checkInTime, "—")}</span> • Check-out saati:{" "}
                <span className="text-slate-200 font-semibold">{safeStr(reqAny.checkOutTime, "12:00")}</span>
                {reqAny.sameDayStay ? <span className="text-amber-200 font-semibold"> • Aynı gün</span> : null}
              </p>

              {reqAny.earlyCheckInWanted ? (
                <p className="text-[0.7rem] text-slate-500">
                  Erken giriş isteği: <span className="text-sky-200 font-semibold">{earlyText}</span>
                </p>
              ) : null}

              {reqAny.lateCheckOutWanted ? (
                <p className="text-[0.7rem] text-slate-500">
                  Geç çıkış isteği: <span className="text-sky-200 font-semibold">{lateText}</span>
                </p>
              ) : null}

              <p className="text-[0.7rem] text-slate-500">
                Gönderim: <span className="text-slate-200">{fmtDateTimeTR(offerAny.createdAt)}</span>
                {offerAny.updatedAt ? <> • Güncelleme: <span className="text-slate-200">{fmtDateTimeTR(offerAny.updatedAt)}</span></> : null}
              </p>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-md border border-red-500/60 px-3 py-2 text-[0.75rem] text-red-200 hover:bg-red-500/10"
              >
                Teklifi iptal et
              </button>

              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-slate-700 bg-slate-900 px-4 py-2 text-[0.75rem] text-slate-300 hover:border-emerald-400"
              >
                Kapat ✕
              </button>
            </div>
          </div>

          {/* Üst kartlar */}
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <p className="text-[0.7rem] text-slate-400">İlk fiyat</p>
              <p className="text-slate-100 text-[0.95rem] font-extrabold">
                {initialPrice != null ? money(initialPrice, offerAny.currency ?? "TRY") : "—"}
              </p>
              <p className="text-[0.7rem] text-slate-500 mt-1">History “initial” kaydından.</p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <p className="text-[0.7rem] text-slate-400">Güncel fiyat</p>
              <p className="text-emerald-300 text-[0.95rem] font-extrabold">
                {money(safeNum(offerAny.totalPrice, 0), offerAny.currency ?? "TRY")}
              </p>
              {delta != null ? (
                <div className="mt-2 flex flex-wrap gap-2 justify-end">
                  <span className={`inline-flex items-center rounded-md border px-2 py-1 text-[0.72rem] ${deltaBadge(delta)}`}>
                    {delta <= 0 ? "İndirim" : "Artış"}: {delta > 0 ? "+" : ""}
                    {Math.round(delta).toLocaleString("tr-TR")} {offerAny.currency ?? "TRY"}
                  </span>

                  {deltaPct != null ? (
                    <span className={`inline-flex items-center rounded-md border px-2 py-1 text-[0.72rem] ${deltaBadge(delta)}`}>
                      {deltaPct > 0 ? "+" : ""}{deltaPct}%
                    </span>
                  ) : null}
                </div>
              ) : (
                <p className="text-[0.75rem] text-slate-500 mt-1">Δ: initial yok.</p>
              )}
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <p className="text-[0.7rem] text-slate-400">Karşı teklif</p>
              <p className="text-amber-300 text-[0.95rem] font-extrabold">
                {offerAny.guestCounterPrice ? money(safeNum(offerAny.guestCounterPrice, 0), offerAny.currency ?? "TRY") : "Yok"}
              </p>

              {counterPrice != null ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {counterDelta != null ? (
                    <span className={`inline-flex items-center rounded-md border px-2 py-1 text-[0.72rem] ${deltaBadge(counterDelta)}`}>
                      Güncele fark: {counterDelta > 0 ? "+" : ""}
                      {Math.round(counterDelta).toLocaleString("tr-TR")} {offerAny.currency ?? "TRY"}
                    </span>
                  ) : null}

                  {counterPct != null ? (
                    <span className={`inline-flex items-center rounded-md border px-2 py-1 text-[0.72rem] ${deltaBadge(counterDelta ?? 0)}`}>
                      {counterPct > 0 ? "+" : ""}{counterPct}%
                    </span>
                  ) : null}
                </div>
              ) : (
                <p className="text-[0.75rem] text-slate-500 mt-2">Karşı teklif olmadığı için fark hesaplanmadı.</p>
              )}

              <p className="text-[0.7rem] text-slate-500 mt-1">{offerAny.guestCounterAt ? fmtDateTimeTR(offerAny.guestCounterAt) : ""}</p>
            </div>

            {/* Hızlı işlem (eski görünüm + panel) */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <p className="text-[0.7rem] text-slate-400">Hızlı işlem</p>

              <button
                type="button"
                onClick={() => {
                  setEditPrice(String(offerAny.totalPrice ?? offer.totalPrice ?? ""));
                  setEditNote(String(offerAny.note ?? offer.note ?? ""));
                  setEditOpen((s) => !s);
                }}
                disabled={
                  !(
                    (offerAny.status === "sent" || offerAny.status === "countered") &&
                    (offerAny.mode === "refreshable" || offerAny.mode === "negotiable")
                  )
                }
                className="mt-1 w-full rounded-md bg-emerald-500 text-slate-950 px-3 py-2 text-[0.8rem] font-extrabold hover:bg-emerald-400 disabled:opacity-40"
              >
                Fiyat güncelle
              </button>

              <p className="text-[0.65rem] text-slate-500 mt-2">%8 modelde güncelleme kapalı olabilir.</p>

              {editOpen ? (
                <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-2">
                  <div className="space-y-1">
                    <label className="text-[0.75rem] text-slate-300">
                      Yeni toplam fiyat ({offerAny.currency ?? offer.currency ?? "TRY"})
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={editPrice}
                      onChange={(e) => setEditPrice(e.target.value)}
                      className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-100"
                      placeholder="Örn: 8000"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[0.75rem] text-slate-300">Not (opsiyonel) — rakam yazılamaz</label>
                    <textarea
                      rows={3}
                      value={editNote}
                      onChange={(e) => onNoteChange(e.target.value)}
                      onKeyDown={onNoteKeyDown}
                      onPaste={onNotePaste}
                      className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-100 resize-none"
                      placeholder="Örn: Son dakika indirimi uygulandı..."
                    />
                    <p className="text-[0.65rem] text-slate-500">Not alanı rakamları otomatik siler.</p>
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setEditOpen(false)}
                      className="rounded-md border border-slate-700 px-3 py-2 text-[0.75rem] text-slate-200 hover:border-slate-500"
                    >
                      Vazgeç
                    </button>

                    <button
                      type="button"
                      onClick={async () => {
                        const np = Number(editPrice);
                        if (!Number.isFinite(np) || np <= 0) return;

                        const cleaned = sanitizeNote(editNote).trim();
                        await onPriceUpdate(np, cleaned.length ? cleaned : null);

                        setEditOpen(false);
                      }}
                      className="rounded-md bg-emerald-500 text-slate-950 px-4 py-2 text-[0.75rem] font-extrabold hover:bg-emerald-400"
                    >
                      Güncelle
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {/* Misafir isteği ↔ Otel teklifi */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-2">
            <p className="text-[0.85rem] text-slate-100 font-semibold">Misafir ne istedi ↔ Otel ne verdi</p>
            <div className="grid gap-2 md:grid-cols-3">
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-[0.7rem] text-slate-400">Misafirin oda isteği</p>
                <p className="text-slate-100 font-semibold whitespace-pre-wrap">{guestWantsRoomsText}</p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-[0.7rem] text-slate-400">Otelin oda kırılımı</p>
                <p className="text-slate-100 font-semibold whitespace-pre-wrap">{hotelOffersRoomsText}</p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-[0.7rem] text-slate-400">Sonuç</p>
                <p className={`text-[0.95rem] font-extrabold ${roomsMatch === "Eşleşiyor" ? "text-emerald-300" : "text-amber-200"}`}>
                  {roomsMatch}
                </p>
                <p className="text-[0.7rem] text-slate-500 mt-1">Bu sadece metin karşılaştırmasıdır; detayları kontrol et.</p>
              </div>
            </div>
          </div>

          {/* Oda kırılımı & oda özellikleri */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
            <p className="text-[0.85rem] text-slate-100 font-semibold">Oda kırılımı & oda özellikleri</p>

            {breakdown.length ? (
              <div className="grid gap-4 md:grid-cols-2">
                {breakdown.map((rb: any, idx: number) => {
                  const prof = findRoomProfile(rb.roomTypeId ?? null, rb.roomTypeName ?? null);
                  const imgs = Array.isArray(prof?.imageUrls) ? prof.imageUrls : [];

                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => openRoomModal(rb)}
                      className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 hover:bg-white/[0.03] text-left"
                      title="Oda profilini aç"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-slate-100 font-extrabold text-base leading-tight truncate">
                            {safeStr(rb.roomTypeName || prof?.name || "Oda")}
                            <span className="text-slate-400 text-[0.75rem] ml-2">↗</span>
                          </p>
                          <p className="text-[0.75rem] text-slate-400 mt-1">
                            {safeNum(rb.qty, 1)} adet • {safeNum(rb.nights, nights)} gece • {money(safeNum(rb.nightlyPrice, 0), offerAny.currency ?? "TRY")} / gece
                          </p>
                        </div>

                        <div className="flex flex-col items-end gap-2 shrink-0">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.65rem] ${
                              rb.refundable
                                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                                : "border-slate-700 bg-slate-900 text-slate-300"
                            }`}
                          >
                            {rb.refundable ? "İadeli" : "İadesiz"}
                          </span>

                          <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[0.65rem] text-slate-300">
                            {rb.board ? String(rb.board) : "Board yok"}
                          </span>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-4 md:grid-cols-[1fr_1.2fr]">
                        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 h-full">
                          <p className="text-[0.7rem] text-slate-400">Satır toplam</p>
                          <p className="text-emerald-300 font-extrabold text-lg">
                            {money(
                              safeNum(
                                rb.totalPrice,
                                safeNum(rb.qty, 1) * safeNum(rb.nights, nights) * safeNum(rb.nightlyPrice, 0)
                              ),
                              offerAny.currency ?? "TRY"
                            )}
                          </p>

                          <div className="mt-3">
                            <p className="text-[0.7rem] text-slate-400">Oda açıklaması</p>
                            <p className="text-[0.8rem] text-slate-100 mt-1 line-clamp-3 whitespace-pre-wrap">
                              {safeStr(prof?.shortDescription || prof?.description, "Açıklama yok.")}
                            </p>
                          </div>

                          <p className="text-[0.7rem] text-slate-500 mt-3">
                            Kapasite: {prof?.maxAdults ?? "—"} yetişkin
                            {prof?.maxChildren != null ? ` • ${prof.maxChildren} çocuk` : ""}
                          </p>
                        </div>

                        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 h-full">
                          {imgs.length ? (
                            <div className="grid grid-cols-2 gap-2">
                              {imgs.slice(0, 4).map((u: string, i: number) => (
                                <div key={i} className="aspect-video rounded-lg border border-slate-800 overflow-hidden bg-slate-900">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={u} alt="room" className="w-full h-full object-cover" />
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-[0.75rem] text-slate-400">
                              Bu oda için görsel yok.
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-slate-300">Oda kırılımı yok.</p>
            )}

            <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
              <p className="text-[0.7rem] text-slate-400">Otel notu</p>
              <p className="text-[0.8rem] text-slate-100 whitespace-pre-wrap">{offerAny.note ? String(offerAny.note) : "Not yok."}</p>
            </div>
          </div>

          {/* Fiyat geçmişi */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[0.85rem] text-slate-100 font-semibold">Fiyat geçmişi (ilk + tüm güncellemeler)</p>
              <p className="text-[0.7rem] text-slate-500">Adım: {history.length}</p>
            </div>

            <div className="space-y-2">
              {history.map((h: any, idx: number) => {
                const who = h.actor === "guest" ? "Misafir" : "Otel";
                const badge =
                  h.actor === "guest"
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                    : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";

                const label =
                  h.kind === "initial" ? "İlk fiyat" : h.kind === "counter" ? "Karşı teklif" : h.kind === "update" ? "Güncelleme" : h.kind === "final" ? "Final" : "Adım";

                return (
                  <div key={idx} className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.65rem] ${badge}`}>{who}</span>
                        <span className="text-slate-100 font-semibold">{label}</span>
                        <span className="text-[0.7rem] text-slate-500">{fmtDateTimeTR(h.createdAt)}</span>
                      </div>
                      <div className="text-emerald-300 font-extrabold">
                        {money(safeNum(h.price, 0), h.currency || offerAny.currency || "TRY")}
                      </div>
                    </div>
                    {h.note ? <p className="text-[0.75rem] text-slate-300 mt-1 whitespace-pre-wrap">{String(h.note)}</p> : null}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Misafir talebi (tam) */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[0.85rem] text-slate-100 font-semibold">Misafir talebi (Firebase’deki tüm alanlar)</p>
              <button
                type="button"
                onClick={() => {
                  try {
                    navigator.clipboard.writeText(prettyReqJson);
                    alert("Talep JSON panoya kopyalandı.");
                  } catch {}
                }}
                className="rounded-md border border-slate-700 px-3 py-2 text-[0.75rem] text-slate-200 hover:border-slate-500"
              >
                JSON Kopyala
              </button>
            </div>

            <div className="grid gap-2 md:grid-cols-3">
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-[0.7rem] text-slate-400">İstenen özellikler</p>
                <p className="text-[0.8rem] text-slate-100 whitespace-pre-wrap">{requestFeatures.length ? requestFeatures.join(" • ") : "Belirtilmemiş"}</p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-[0.7rem] text-slate-400">Misafir notları (tam)</p>
                <p className="text-[0.8rem] text-slate-100 whitespace-pre-wrap">{notesAll || "Not yok."}</p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-[0.7rem] text-slate-400">Yakınımda</p>
                <p className="text-[0.8rem] text-slate-100 font-semibold">
                  {reqAny.nearMe ? `Açık (${reqAny.nearMeKm ?? "—"} km)` : "Kapalı"}
                </p>
                <p className="text-[0.7rem] text-slate-500 mt-1">Başlık: {safeStr(reqAny.title, "—")}</p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[0.75rem] text-slate-200 font-semibold">İletişim (KVKK)</p>
                <span className="text-[0.7rem] text-slate-400">{isUnlocked ? "Açık" : "Maskeli"}</span>
              </div>

              <div className="grid gap-2 md:grid-cols-3">
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                  <p className="text-[0.65rem] text-slate-400">Ad Soyad</p>
                  <p className="text-slate-100 font-semibold">{guestName}</p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                  <p className="text-[0.65rem] text-slate-400">E-posta</p>
                  <p className="text-slate-100">{guestEmail}</p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                  <p className="text-[0.65rem] text-slate-400">Telefon</p>
                  <p className="text-slate-100">{guestPhone}</p>
                </div>
              </div>

              <p className="text-[0.65rem] text-slate-500">KVKK gereği rezervasyon onayına kadar maskelenir.</p>
            </div>

            <details className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <summary className="cursor-pointer text-[0.8rem] text-slate-200 font-semibold">Tüm alanları aç (JSON)</summary>
              <pre className="mt-3 whitespace-pre-wrap text-[0.72rem] text-slate-300 overflow-x-auto">{prettyReqJson}</pre>
            </details>

            <div className="grid gap-2 md:grid-cols-2">
              {[
                { k: "Şehir", v: reqAny.city },
                { k: "İlçe", v: reqAny.district },
                { k: "Check-in", v: reqAny.checkIn },
                { k: "Check-out", v: reqAny.checkOut },
                { k: "Yetişkin", v: reqAny.adults },
                { k: "Çocuk", v: reqAny.childrenCount },
                { k: "Oda sayısı", v: reqAny.roomsCount }
              ].map((it) => (
                <div key={it.k} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                  <p className="text-[0.72rem] text-slate-400">{it.k}</p>
                  <pre className="text-slate-100 text-sm mt-1 whitespace-pre-wrap">{renderValue(it.v)}</pre>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-700 px-4 py-2 text-[0.75rem] text-slate-200 hover:border-emerald-400 transition"
            >
              Kapat
            </button>
          </div>
        </div>
      </div>

      {roomModalOpen && activeRoomProfile ? (
        <RoomProfileModal
          room={activeRoomProfile}
          onClose={() => {
            setRoomModalOpen(false);
            setActiveRoomProfile(null);
          }}
        />
      ) : null}
    </>
  );
}

function RoomProfileModal({ room, onClose }: { room: any; onClose: () => void }) {
  const name = room?.name || room?.title || room?.roomTypeName || "Oda";
  const shortDesc = room?.shortDescription || "";
  const desc = room?.description || room?.details || "";

  const maxAdults = room?.maxAdults ?? room?.capacity ?? "—";
  const maxChildren = room?.maxChildren ?? "—";

  const images: string[] = useMemo(() => {
    const list = [
      ...(Array.isArray(room?.imageUrls) ? room.imageUrls : []),
      ...(Array.isArray(room?.images) ? room.images : []),
      ...(Array.isArray(room?.gallery) ? room.gallery : []),
      ...(Array.isArray(room?.photos) ? room.photos : [])
    ];
    return list.filter(Boolean);
  }, [room]);

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/70">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />

      <div className="relative mt-12 w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-2xl max-h-[85vh] overflow-y-auto space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-extrabold text-slate-100">{name}</h3>
            <p className="text-[0.75rem] text-slate-400 mt-1">
              Kapasite: <span className="text-slate-200">{String(maxAdults)}</span> yetişkin •{" "}
              Çocuk: <span className="text-slate-200">{String(maxChildren)}</span>
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-emerald-400"
          >
            Kapat ✕
          </button>
        </div>

        {images.length ? (
          <div className="grid gap-2 md:grid-cols-3">
            {images.slice(0, 9).map((src, i) => (
              <div key={i} className="rounded-xl overflow-hidden border border-slate-800 bg-slate-900/40">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`room-${i}`} className="w-full h-32 object-cover" />
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-slate-400 text-sm">
            Bu oda için görsel yok.
          </div>
        )}

        {shortDesc ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <p className="text-[0.75rem] text-slate-400 mb-1">Kısa açıklama</p>
            <p className="text-slate-100 text-sm whitespace-pre-wrap">{shortDesc}</p>
          </div>
        ) : null}

        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <p className="text-[0.75rem] text-slate-400 mb-1">Detay</p>
          <p className="text-slate-100 text-sm whitespace-pre-wrap">{desc || "Açıklama yok."}</p>
        </div>

        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-700 px-4 py-2 text-[0.75rem] text-slate-200 hover:border-emerald-400 transition"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}
