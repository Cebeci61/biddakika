// app/hotel/requests/inbox/page.tsx
"use client";

import React, { useEffect, useMemo, useState, FormEvent } from "react";
import { Protected } from "@/components/Protected";
import { useAuth } from "@/context/AuthContext";
import { getFirestoreDb } from "@/lib/firebase/client";
import {useRef,} from "react";

import {
  collection,
  getDocs,
  query,
  where,
  Timestamp,
  addDoc,
  serverTimestamp,
  doc,
  updateDoc,
  getDoc,
  onSnapshot,
  arrayUnion,
  setDoc,
  deleteDoc,
  
} from "firebase/firestore";

type OfferMode = "simple" | "refreshable" | "negotiable";
type CommissionRate = 8 | 10 | 15;
type CancellationPolicyType = "non_refundable" | "flexible" | "until_days_before";
type AnyObj = Record<string, any>;

interface RequestItem {
  id: string;
  city: string;
  district?: string | null;
  checkIn: string;
  checkOut: string;

  adults: number;
  childrenCount?: number;
  childrenAges?: number[];
  roomsCount?: number;
  roomTypes?: string[];

  createdAt?: Timestamp;
  responseDeadlineMinutes?: number;
    restartAt?: Timestamp | null; // ✅ misafir yeniden başlattıysa burası dolu


  guestId?: string | null;

  // tür
  type?: string; // hotel | group | package vb.
  isGroup?: boolean;

  // oda detayları
  roomTypeCounts?: Record<string, number>;
  roomTypeRows?: { typeKey: string; count: number }[];

  // plan/tesis
  accommodationType?: string | null;
  boardType?: string | null;
  boardTypes?: string[];
  desiredStarRatings?: number[] | null;
  starRating?: number | null;

  // features & öncelikler
  featureKeys?: string[];
  hotelFeaturePrefs?: string[];
  featurePriorities?: Record<string, "must" | "nice" | string>;
  hotelFeatureNote?: string | null;
  extraFeaturesText?: string | null;

  // iletişim (KVKK)
  guestName?: string | null;
  guestDisplayName?: string | null;
  guestEmail?: string | null;
  guestPhone?: string | null;

  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  contactPhone2?: string | null;
  contactPhoneCountryCode?: string | null;
  contactPhoneLocal?: string | null;
  contactCompany?: string | null;
  contactNote?: string | null;

  // saatler
  checkInTime?: string | null;
  checkOutTime?: string | null;
  sameDayStay?: boolean;

  earlyCheckInWanted?: boolean;
  earlyCheckInFrom?: string | null;
  earlyCheckInTo?: string | null;

  lateCheckOutWanted?: boolean;
  lateCheckOutFrom?: string | null;
  lateCheckOutTo?: string | null;

  // legacy
  earlyWanted?: boolean;
  earlyText?: string | null;
  lateWanted?: boolean;
  lateText?: string | null;

  // must/nice
  must?: string[];
  nice?: string[];

  // konum
  geo?: { lat?: number; lng?: number; accuracy?: number } | null;
  nearMe?: boolean;
  nearMeKm?: number | null;

  // notlar
  note?: string | null;
  notes?: string | null;
  locationNote?: string | null;
  boardTypeNote?: string | null;

  [k: string]: any;
}

interface ExistingOffer {
  id: string;
  requestId: string;
  hotelId: string;
  totalPrice: number;
  currency: string;
  mode: OfferMode;
  commissionRate: CommissionRate;
  status: string; // sent | accepted | rejected | countered | booked | paid ...
  
  note?: string | null;

  roomBreakdown?: {
    roomTypeId?: string;
    roomTypeName?: string;
    nights?: number;
    nightlyPrice?: number;
    totalPrice?: number;
    qty?: number;
  }[];

  cancellationPolicyType?: CancellationPolicyType;
  cancellationPolicyDays?: number | null;

  createdAt?: Timestamp;
  updatedAt?: Timestamp;
    createdAtMs?: number | null;
  updatedAtMs?: number | null;


  priceHistory?: Array<{
    actor: "hotel" | "guest" | "system";
    kind: "initial" | "update" | "counter" | "final" | "current" | "info";
    price: number;
    note?: string | null;
    createdAt?: any;
  }>;
}

interface HotelRoomType {
  id: string;
  name: string;
  shortDescription?: string | null;
  description?: string | null;
  maxAdults?: number | null;
  maxChildren?: number | null;
  imageUrls?: string[];
}


interface HotelProfile {
  city?: string;
  district?: string;
  name?: string;
  roomTypes?: HotelRoomType[];
}

interface RoomQuoteState {
  roomTypeId: string;
  nightlyPrice: string;
}

/* ---------------- UID / ROLE SAFE ---------------- */
function getUid(profile: any) {
  return String(profile?.uid || profile?.id || profile?.userId || "").trim();
}
function getRole(profile: any) {
  return String(profile?.role || "").toLowerCase();
}
function getDisplayName(profile: any) {
  return String(profile?.displayName || profile?.name || "").trim();
}

/* ------------ tarih & süre helper’ları ------------ */
function parseDate(value?: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
function normalized(d: Date) {
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return n;
}
function diffInDays(a: Date, b: Date) {
  const ms = normalized(a).getTime() - normalized(b).getTime();
  return Math.floor(ms / 86400000);
}
function calculateNights(req: RequestItem): number {
  const ci = parseDate(req.checkIn);
  const co = parseDate(req.checkOut);
  if (!ci || !co) return 1;
  const diff = diffInDays(co, ci);
  return diff > 0 ? diff : 1;
}
function toastLabelForRequest(req?: RequestItem | null) {
  if (!req) return "🔥 Misafir karşı teklif verdi! (Detay için tıkla)";
  const loc = `${req.city || "—"}${req.district ? " / " + req.district : ""}`.trim();
  const dates = `${req.checkIn || "—"} → ${req.checkOut || "—"}`;
  const rooms = req.roomsCount ?? 1;
  const guests = (req.adults ?? 0) + (req.childrenCount ?? 0);
  return `🔥 Misafir karşı teklif verdi! ${loc} • ${dates} • ${guests} kişi / ${rooms} oda (tıkla)`;
}


function getDeadlineDates(req: RequestItem) {
  const created = req.createdAt?.toDate?.();
  const minutes = req.responseDeadlineMinutes ?? 0;
  if (!created || !minutes) return { created: null, deadline: null, remainingMs: null };
  const deadline = new Date(created.getTime() + minutes * 60 * 1000);
  const remainingMs = deadline.getTime() - Date.now();
  return { created, deadline, remainingMs };
}
function isRequestExpired(req: any): boolean {
  const created = req?.createdAt?.toDate?.();
  const minutes = Number(req?.responseDeadlineMinutes ?? 0);
  if (!created || !minutes) return false;
  const deadline = new Date(created.getTime() + minutes * 60 * 1000);
  return deadline.getTime() < Date.now();
}

function computeDeadlineInfo(req: RequestItem) {
  const { created, deadline, remainingMs } = getDeadlineDates(req);
  const minutes = req.responseDeadlineMinutes ?? 0;

  if (!created || !deadline || !minutes || remainingMs === null) {
    return { label: "Süre bilgisi yok", color: "text-slate-300", ratio: 1, remainingHours: null } as const;
  }

  const totalMs = minutes * 60 * 1000;
  const ratio = Math.min(1, Math.max(0, remainingMs / totalMs));

  if (remainingMs <= 0) {
    return { label: "Süresi doldu", color: "text-red-400", ratio: 0, remainingHours: 0 } as const;
  }

  const sec = Math.floor(remainingMs / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;

  let color = "text-emerald-300";
  if (ratio <= 0.15) color = "text-red-300";
  else if (ratio <= 0.35) color = "text-red-400";
  else if (ratio <= 0.55) color = "text-amber-300";

  const remainingHours = remainingMs / 3600000;
  return { label: `${h} sa ${m} dk ${s} sn`, color, ratio, remainingHours } as const;
}

/** Süresi dolduktan sonra 1 saat göster, sonra kaldır */
const EXPIRED_GRACE_MS = 60 * 60 * 1000;
function isRequestExpiredWithGrace(req: RequestItem): boolean {
  const { deadline } = getDeadlineDates(req);
  if (!deadline) return false;
  return Date.now() > deadline.getTime() + EXPIRED_GRACE_MS;
}

/** Dün ve öncesi check-in görünmesin */
function isCheckInTodayOrFuture(req: RequestItem) {
  const ci = parseDate(req.checkIn);
  if (!ci) return true;
  return normalized(ci).getTime() >= normalized(new Date()).getTime();
}

/* --------------- KVKK MASKELEME --------------- */
function maskName(name?: string | null): string {
  if (!name) return "Misafir";
  const parts = String(name).split(" ").filter(Boolean);
  return parts.map((p) => p[0] + "*".repeat(Math.max(2, p.length - 1))).join(" ");
}
function maskEmail(email?: string | null): string {
  if (!email) return "—";
  const [user, domain] = String(email).split("@");
  if (!domain) return "—";
  const maskedUser = (user?.[0] || "*") + "*".repeat(Math.max(3, user.length - 1));
  const [domainName, ext] = domain.split(".");
  const maskedDomain = (domainName?.[0] || "*") + "*".repeat(Math.max(3, domainName.length - 1));
  return `${maskedUser}@${maskedDomain}${ext ? "." + ext : ""}`;
}
function maskPhone(phone?: string | null): string {
  if (!phone) return "—";
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length < 6) return "***";
  return digits.slice(0, 3) + "****" + digits.slice(-2);
}
function maskCompany(text?: string | null): string {
  if (!text) return "—";
  return maskName(text);
}
// 🔒 Deterministic offer id (aynı otel + aynı talep = tek teklif)
function offerDocId(requestId: string, hotelId: string) {
  return `${requestId}__${hotelId}`;
}


function toTR(ts: any) {
  try {
    if (!ts) return "—";
    if (typeof ts?.toDate === "function") return ts.toDate().toLocaleString("tr-TR");
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("tr-TR");
  } catch {
    return "—";
  }
}

function moneyTR(n: any, currency = "TRY") {
  const v = Number(n);
  const safe = Number.isFinite(v) ? v : 0;
  return `${safe.toLocaleString("tr-TR")} ${currency || "TRY"}`;
}
function tsMs(ts: any): number {
  if (!ts) return 0;

  // Firestore Timestamp
  if (typeof ts?.toMillis === "function") return ts.toMillis();
  if (typeof ts?.toDate === "function") return ts.toDate().getTime();

  // plain object {seconds, nanoseconds}
  if (typeof ts?.seconds === "number") return ts.seconds * 1000;

  // Date or string
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function roomTypeLabel(key?: string) {
  switch (key) {
    case "standard":
      return "Standart oda";
    case "family":
      return "Aile odası";
    case "suite":
      return "Suit oda";
    case "deluxe":
      return "Deluxe oda";
    default:
      return key || "Belirtilmemiş";
  }
}

/* --------------- NOT TOPLAYICI --------------- */
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

/* --------------- NOTIFICATION HELPER --------------- */
async function createNotification(
  db: ReturnType<typeof getFirestoreDb>,
  toUserId: string | null | undefined,
  type: string,
  payload: any
) {
  if (!toUserId) return;
  try {
    await addDoc(collection(db, "notifications"), {
      to: toUserId,
      type,
      payload,
      createdAt: serverTimestamp(),
      read: false
    });
  } catch (err) {
    console.error("Notification create error:", err);
  }
}

/* -------------------- ETİKET -------------------- */
type TagItem = { text: string; tone: "ok" | "warn" | "danger" | "info" };
function tagClass(tone: TagItem["tone"]) {
  if (tone === "danger") return "border-red-500/40 bg-red-500/10 text-red-200";
  if (tone === "warn") return "border-amber-500/40 bg-amber-500/10 text-amber-200";
  if (tone === "ok") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  return "border-sky-500/40 bg-sky-500/10 text-sky-200";
}
function hashStr(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
function buildTags(req: RequestItem): TagItem[] {
  const tags: TagItem[] = [];
  const d = computeDeadlineInfo(req);
  const nights = calculateNights(req);
  const guests = (req.adults || 0) + (req.childrenCount || 0);
  const rooms = req.roomsCount ?? 1;
  const isGroup = !!(req.isGroup || req.type === "group");

  if (d.remainingHours != null && d.remainingHours <= 1) tags.push({ text: "ACİL (1 SAAT) 🔥", tone: "danger" });
  else if (d.remainingHours != null && d.remainingHours <= 3) tags.push({ text: "ACİL (3 SAAT) ⚡", tone: "danger" });
  else if (d.ratio <= 0.55) tags.push({ text: "ZAMAN AZ ⏳", tone: "warn" });
  else tags.push({ text: "YENİ AÇILDI ✨", tone: "ok" });

  if (guests >= 4) tags.push({ text: "KALABALIK 💎", tone: "ok" });
  if (rooms >= 2) tags.push({ text: "ÇOKLU ODA 👨‍👩‍👧‍👦", tone: "ok" });
  if (nights >= 3) tags.push({ text: "UZUN KONAKLAMA 🛏️", tone: "ok" });
  if (nights === 1) tags.push({ text: "1 GECE / HIZLI 🏃‍♂️", tone: "info" });

  tags.push({ text: isGroup ? "GRUP 🚌" : "OTEL 🏨", tone: isGroup ? "warn" : "info" });

  if ((req as any).nearMe) tags.push({ text: "YAKININDA 📍", tone: "ok" });
  if (collectAllNotes(req).trim().length > 0) tags.push({ text: "NOT VAR 📝", tone: "warn" });

  const uniq = new Map<string, TagItem>();
  for (const t of tags) uniq.set(t.text, t);
  return Array.from(uniq.values());
}
function pickOneTag(tags: TagItem[], reqId: string, tick: number) {
  if (!tags.length) return null;
  const idx = (hashStr(reqId) + tick) % tags.length;
  return tags[idx];
}

function commissionExplain(rate: CommissionRate) {
  if (rate === 8) return "Bu komisyon seçildiğinde tek teklif hakkı olur; gönderim sonrası fiyat düzenleme kapalıdır.";
  if (rate === 10) return "Bu komisyonla, talep süresi boyunca sadece fiyatı güncelleyebilirsiniz (para birimi/komisyon/iptal/not kilitli).";
  return "Bu komisyonla, talep süresi boyunca sadece fiyatı güncelleyebilirsiniz + pazarlık (karşı teklif) geçmişi tutulur.";
}
export default function HotelRequestsInboxPage() {
  const { profile, loading: authLoading } = useAuth();
  const db = getFirestoreDb();

  const myUid = useMemo(() => getUid(profile), [profile]);
  const myRole = useMemo(() => getRole(profile), [profile]);
  const myName = useMemo(() => getDisplayName(profile), [profile]);

  const [hotelProfile, setHotelProfile] = useState<HotelProfile | null>(null);
  const [requests, setRequests] = useState<RequestItem[]>([]);
  // ✅ requests ref (toast tıklayınca doğru request bulmak için)
const requestsRef = React.useRef<RequestItem[]>([]);
useEffect(() => {
  requestsRef.current = requests;
}, [requests]);
function toastLabelForRequest(req?: RequestItem | null) {
  if (!req) return "🔥 Misafir karşı teklif verdi! (Detay için tıkla)";

  const loc = `${req.city || "—"}${req.district ? " / " + req.district : ""}`.trim();
  const dates = `${req.checkIn || "—"} → ${req.checkOut || "—"}`;
  const rooms = req.roomsCount ?? 1;
  const guests = (req.adults ?? 0) + (req.childrenCount ?? 0);

  return `🔥 Misafir karşı teklif verdi! ${loc} • ${dates} • ${guests} kişi / ${rooms} oda (tıkla)`;
}

function onToastClick(t: ToastItem) {
  const reqId = t.reqId;
  if (!reqId) return;

  const req = requestsRef.current.find((r) => r.id === reqId);
  if (!req) return;

  // ✅ okunmuş say (badge/unread temizlensin)
  try { markCounterSeen(reqId); } catch {}

  // ✅ detay aç
  openRequestDetail(req);

  // ✅ toast kapat
  setToasts((prev) => prev.filter((x) => x.id !== t.id));
}


  const [offers, setOffers] = useState<ExistingOffer[]>([]);
  const [acceptedRequestIds, setAcceptedRequestIds] = useState<Set<string>>(() => new Set());

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // filtreler
  const [districtFilter, setDistrictFilter] = useState<string>("all");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [minGuests, setMinGuests] = useState<string>("");
  const [minRooms, setMinRooms] = useState<string>("");
  const [urgentHours, setUrgentHours] = useState<string>("all"); // all|6|5|4|3|2|1

  // teklif form state
  const [openRequestId, setOpenRequestId] = useState<string | null>(null);
  const [commissionRate, setCommissionRate] = useState<CommissionRate>(10);
  const [currency, setCurrency] = useState<"TRY" | "USD" | "EUR">("TRY");
  const [note, setNote] = useState<string>("");
  const [roomBreakdown, setRoomBreakdown] = useState<RoomQuoteState[]>([]);
  const [offerCancelType, setOfferCancelType] = useState<CancellationPolicyType>("non_refundable");
  const [offerCancelDays, setOfferCancelDays] = useState<number | null>(3);

  const [savingOffer, setSavingOffer] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // talep detayı modal
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRequest, setDetailRequest] = useState<RequestItem | null>(null);

  // etiket rotasyonu
  const [tagTick, setTagTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTagTick((x) => x + 1), 2500);
    return () => window.clearInterval(t);
  }, []);
  // 🔥 Counter teklif bildirimleri
const [unreadCounterReqIds, setUnreadCounterReqIds] = useState<Set<string>>(() => new Set());

// basit toast sistemi (5sn)
type ToastItem = { id: string; text: string; reqId?: string };
const [toasts, setToasts] = useState<ToastItem[]>([]);


function pushToast(text: string, reqId?: string) {
  const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  setToasts((prev) => [...prev, { id, text, reqId }]);
  window.setTimeout(() => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, 5000);
}


// localStorage: son görülen counter zamanı
const counterSeenKey = useMemo(() => (myUid ? `biddakika_counter_seen_${myUid}` : "biddakika_counter_seen_guest"), [myUid]);

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
// localStorage: counter toast 1 kez gösterilsin (kalıcı)
const counterToastKey = useMemo(
  () => (myUid ? `biddakika_counter_toast_shown_${myUid}` : "biddakika_counter_toast_shown_guest"),
  [myUid]
);

function getToastShownMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(counterToastKey);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function setToastShown(reqId: string, ms: number) {
  const map = getToastShownMap();
  map[reqId] = ms;
  try { localStorage.setItem(counterToastKey, JSON.stringify(map)); } catch {}
}



function getLatestGuestCounterMs(offer: ExistingOffer | any): number {
  const hist = Array.isArray(offer?.priceHistory) ? offer.priceHistory : [];
  const guestCounters = hist.filter((h: any) => String(h?.actor) === "guest" && String(h?.kind) === "counter");
  if (!guestCounters.length) return 0;
  const last = guestCounters
    .map((h: any) => {
      const ts = h?.createdAt;
      if (!ts) return 0;
      if (typeof ts?.toMillis === "function") return ts.toMillis();
      if (typeof ts?.toDate === "function") return ts.toDate().getTime();
      if (typeof ts?.seconds === "number") return ts.seconds * 1000;
      const d = new Date(ts);
      return Number.isNaN(d.getTime()) ? 0 : d.getTime();
    })
    .sort((a: number, b: number) => a - b)
    .pop();
  return last || 0;
}

// kullanıcı detay açınca / form açınca "okundu" yap
function markCounterSeen(reqId: string) {
  const off = findOfferForRequest(reqId);
  const latest = off ? getLatestGuestCounterMs(off) : 0;
  if (latest > 0) setSeen(reqId, latest);
  setUnreadCounterReqIds((prev) => {
    const n = new Set(prev);
    n.delete(reqId);
    return n;
  });
}


  // sayaç tick
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setNowTick((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  // ✅ PIN (sabitle) - localStorage
  const pinKey = useMemo(() => (myUid ? `biddakika_pins_${myUid}` : "biddakika_pins_guest"), [myUid]);
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
// ✅ offers realtime: misafir counter gelince anında badge + toast
useEffect(() => {
  if (!myUid) return;

  const q = query(collection(db, "offers"), where("hotelId", "==", myUid));
  const unsub = onSnapshot(q, (snap) => {
    const newOffers: ExistingOffer[] = snap.docs.map((d) => {
      const v = d.data() as any;
      return {
        id: d.id,
        requestId: v.requestId,
        hotelId: v.hotelId,
        totalPrice: Number(v.totalPrice ?? 0),
        currency: v.currency ?? "TRY",
        mode: (v.mode as OfferMode) ?? "simple",
        commissionRate: (v.commissionRate as CommissionRate) ?? 10,
        status: v.status ?? "sent",
        note: v.note ?? null,
        roomBreakdown: Array.isArray(v.roomBreakdown) ? v.roomBreakdown : [],
        cancellationPolicyType: v.cancellationPolicyType,
        cancellationPolicyDays: v.cancellationPolicyDays ?? null,
        createdAt: v.createdAt,
        updatedAt: v.updatedAt,
        
        priceHistory: Array.isArray(v.priceHistory) ? v.priceHistory : []
      };
    });

    setOffers(newOffers);

    // unread counter hesapla
    const seenMap = getSeenMap();
    const unread = new Set<string>();

    for (const o of newOffers) {
      const latestCounterMs = getLatestGuestCounterMs(o);
      const seenMs = Number(seenMap[o.requestId] ?? 0);

      if (latestCounterMs > 0 && latestCounterMs > seenMs) {
        unread.add(o.requestId);
      }
    }

// unread set'i state'e yaz (badge için)
setUnreadCounterReqIds(unread);

// toast sadece 1 kez (reqId bazlı kalıcı)
const shownMap = getToastShownMap();

for (const reqId of unread) {
  if (shownMap[reqId]) continue;

  const req = requestsRef.current.find((r) => r.id === reqId) || null;
  pushToast(toastLabelForRequest(req), reqId);

  setToastShown(reqId, Date.now());
}


  });

  return () => { try { unsub(); } catch {} };
}, [db, myUid]);

  // load
  useEffect(() => {
    let alive = true;

    async function load() {
      if (authLoading) return;

      if (!myUid || (myRole !== "hotel" && myRole !== "otel")) {
        if (alive) setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        // 1) hotel profile
        const userSnap = await getDoc(doc(db, "users", myUid));
        let hp: HotelProfile | null = null;

        if (userSnap.exists()) {
          const v = userSnap.data() as any;
          const hpData = (v.hotelProfile || {}) as any;

          hp = {
            city: hpData.city || v.city || "",
            district: hpData.district || v.district || "",
            name: hpData.name || v.displayName || myName || "",
            roomTypes: Array.isArray(hpData.roomTypes)
              ? hpData.roomTypes.map((rt: any) => ({
                  id: rt.id || rt.key || "",
                  name: rt.name || roomTypeLabel(rt.key),
                  shortDescription: rt.shortDescription ?? null,
                  description: rt.description ?? rt.details ?? null,
                  maxAdults: rt.maxAdults ?? rt.capacity ?? null,
                  maxChildren: rt.maxChildren ?? null,
                  imageUrls: Array.isArray(rt.imageUrls)
                    ? rt.imageUrls
                    : Array.isArray(rt.images)
                    ? rt.images
                    : Array.isArray(rt.gallery)
                    ? rt.gallery
                    : []
                }))
              : []
          };
        }
        if (!alive) return;
        setHotelProfile(hp);

        // 2) requests
        const snapReq = await getDocs(collection(db, "requests"));
        const reqData: RequestItem[] = snapReq.docs
          .map((d) => {
            const v = d.data() as any;
            const mapped: RequestItem = {
              id: d.id,
              city: v.city,
              district: v.district ?? null,
              checkIn: v.checkIn ?? v.checkInDate ?? v.dateFrom,
              checkOut: v.checkOut ?? v.checkOutDate ?? v.dateTo,

              adults: Number(v.adults ?? 0),
              childrenCount: Number(v.childrenCount ?? 0),
              childrenAges: Array.isArray(v.childrenAges) ? v.childrenAges : [],
              roomsCount: Number(v.roomsCount ?? 1),
              roomTypes: Array.isArray(v.roomTypes) ? v.roomTypes : [],

              guestName: v.guestDisplayName || v.contactName || v.guestName || "Misafir",
              guestDisplayName: v.guestDisplayName ?? null,
              guestEmail: v.guestEmail ?? null,
              guestPhone: v.guestPhone ?? null,

              guestId: v.guestId ?? v.createdById ?? v.createdBy?.id ?? null,

              restartAt: v.restartAt ?? null,
              createdAt: v.createdAt,
              responseDeadlineMinutes: v.responseDeadlineMinutes ?? 60,

              type: v.type,
              isGroup: v.isGroup ?? false,

              roomTypeCounts: v.roomTypeCounts ?? undefined,
              roomTypeRows: v.roomTypeRows ?? undefined,

              accommodationType: v.accommodationType ?? v.hotelType ?? null,
              boardType: v.boardType ?? null,
              boardTypes: v.boardTypes ?? undefined,
              desiredStarRatings: v.desiredStarRatings ?? null,
              starRating: v.starRating ?? null,

              featureKeys: v.featureKeys ?? undefined,
              hotelFeaturePrefs: v.hotelFeaturePrefs ?? undefined,
              featurePriorities: v.featurePriorities ?? undefined,
              hotelFeatureNote: v.hotelFeatureNote ?? null,
              extraFeaturesText: v.extraFeaturesText ?? null,

              contactName: v.contactName ?? null,
              contactEmail: v.contactEmail ?? v.guestEmail ?? null,
              contactPhone: v.contactPhone ?? v.guestPhone ?? null,
              contactPhone2: v.contactPhone2 ?? v.guestPhone2 ?? null,
              contactPhoneCountryCode: v.contactPhoneCountryCode ?? null,
              contactPhoneLocal: v.contactPhoneLocal ?? null,
              contactCompany: v.contactCompany ?? null,
              contactNote: v.contactNote ?? null,

              checkInTime: v.checkInTime ?? v.arrivalTime ?? null,
              checkOutTime: v.checkOutTime ?? v.departureTime ?? null,
              sameDayStay: !!(v.sameDayStay ?? false),

              earlyCheckInWanted: !!(v.earlyCheckInWanted ?? false),
              earlyCheckInFrom: v.earlyCheckInFrom ?? null,
              earlyCheckInTo: v.earlyCheckInTo ?? null,
              lateCheckOutWanted: !!(v.lateCheckOutWanted ?? false),
              lateCheckOutFrom: v.lateCheckOutFrom ?? null,
              lateCheckOutTo: v.lateCheckOutTo ?? null,

              // legacy
              earlyWanted: !!(v.earlyWanted ?? v.earlyCheckIn ?? false),
              earlyText: v.earlyText ?? v.earlyCheckInTime ?? null,
              lateWanted: !!(v.lateWanted ?? v.lateCheckIn ?? false),
              lateText: v.lateText ?? v.lateArrivalTime ?? null,

              must: Array.isArray(v.must) ? v.must : Array.isArray(v.mustHave) ? v.mustHave : [],
              nice: Array.isArray(v.nice) ? v.nice : Array.isArray(v.niceToHave) ? v.niceToHave : [],

              geo: v.geo ?? v.locationGeo ?? null,
              nearMe: !!(v.nearMe ?? false),
              nearMeKm: v.nearMeKm ?? null,

              note: v.note ?? null,
              notes: v.notes ?? null,
              locationNote: v.locationNote ?? null,
              boardTypeNote: v.boardTypeNote ?? null,

              ...v
            };
            return mapped;
          })
          .filter((r) => {
            // hotel city/district filtre
            if (!hp?.city) return true;

            const cityMatches =
              String(r.city || "").toLocaleLowerCase("tr-TR") === String(hp.city).toLocaleLowerCase("tr-TR");
            if (!cityMatches) return false;

            if (!hp.district) return true;
            const distMatches =
              String(r.district || "").toLocaleLowerCase("tr-TR") === String(hp.district).toLocaleLowerCase("tr-TR");
            return distMatches;
          });

        // 3) offers
        const snapOffers = await getDocs(query(collection(db, "offers"), where("hotelId", "==", myUid)));
        const offerData: ExistingOffer[] = snapOffers.docs.map((d) => {
          const v = d.data() as any;
          return {
            id: d.id,
            requestId: v.requestId,
            hotelId: v.hotelId,
            totalPrice: Number(v.totalPrice ?? 0),
            currency: v.currency ?? "TRY",
            mode: (v.mode as OfferMode) ?? "simple",
            commissionRate: (v.commissionRate as CommissionRate) ?? 10,
            status: v.status ?? "sent",
            note: v.note ?? null,
            roomBreakdown: Array.isArray(v.roomBreakdown) ? v.roomBreakdown : [],
            cancellationPolicyType: v.cancellationPolicyType,
            cancellationPolicyDays: v.cancellationPolicyDays ?? null,
            createdAt: v.createdAt,
            updatedAt: v.updatedAt,
                createdAtMs: v.createdAtMs ?? null,
    updatedAtMs: v.updatedAtMs ?? null,

            priceHistory: Array.isArray(v.priceHistory) ? v.priceHistory : []
          };
        });

        // 4) bookings -> KVKK unlock
        const snapBookings = await getDocs(collection(db, "bookings"));
        const accSet = new Set<string>();
        snapBookings.docs.forEach((d) => {
          const v = d.data() as any;
          if (v.requestId) accSet.add(String(v.requestId));
        });

        if (!alive) return;

        // sort (pinned + acil)
        reqData.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));

        setRequests(reqData);
        setOffers(offerData);
        setAcceptedRequestIds(accSet);

        if (hp?.district) setDistrictFilter(hp.district);
      } catch (err) {
        console.error("Gelen talepler yüklenirken hata:", err);
        if (alive) setError("Gelen misafir talepleri yüklenirken bir hata oluştu.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [authLoading, db, myUid, myRole, myName]);

  // helpers
function findOfferForRequest(reqId: string): ExistingOffer | undefined {
  // ilgili request’i bul
  const req = requests.find((r) => r.id === reqId);
  const restartMs = req?.restartAt ? tsMs(req.restartAt) : 0;

  // o request'e ait tüm offer'ları al
 const list = offers
  .filter((o) => o.requestId === reqId)
  .filter((o) => String(o.status || "").toLowerCase() !== "withdrawn") // ✅ İPTAL EDİLEN AKTİF SAYILMAZ
  .slice()
  .sort((a, b) => tsMs(b.createdAtMs ?? b.createdAt) - tsMs(a.createdAtMs ?? a.createdAt));


  if (!list.length) return undefined;

  // restart varsa: sadece restart sonrasındaki teklif "aktif" sayılır
  if (restartMs > 0) {
    const active = list.find((o) => tsMs(o.createdAt) >= restartMs);
    return active; // yoksa undefined döner => otel tekrar teklif verebilir
  }

  // restart yoksa en güncel offer
  return list[0];
}


  function canEditPrice(offer?: ExistingOffer): boolean {
    if (!offer) return true;
    const st = String(offer.status || "").toLowerCase();
    if (["accepted", "rejected", "paid", "booked", "confirmed", "completed"].includes(st)) return false;
    return offer.commissionRate === 10 || offer.commissionRate === 15;
  }

  function initRoomBreakdownForRequest(req: RequestItem, existing?: ExistingOffer): RoomQuoteState[] {
    const roomsCount = req.roomsCount ?? 1;
    const nights = calculateNights(req);

    if (existing?.roomBreakdown?.length) {
      return existing.roomBreakdown.map((rb) => ({
        roomTypeId: rb.roomTypeId || "",
        nightlyPrice:
          rb.nightlyPrice != null
            ? String(rb.nightlyPrice)
            : rb.totalPrice && nights
            ? String(Math.round((rb.totalPrice as number) / nights))
            : ""
      }));
    }

    return Array.from({ length: roomsCount }, () => ({ roomTypeId: "", nightlyPrice: "" }));
  }

  function handleRoomTypeChange(index: number, roomTypeId: string) {
    setRoomBreakdown((prev) => {
      const copy = [...prev];
      if (!copy[index]) return prev;
      copy[index] = { ...copy[index], roomTypeId };
      return copy;
    });
  }

  function handleNightlyChange(index: number, value: string) {
    setRoomBreakdown((prev) => {
      const copy = [...prev];
      if (!copy[index]) return prev;
      copy[index] = { ...copy[index], nightlyPrice: value };
      return copy;
    });
  }

  function computeTotalPriceForOpenForm(req: RequestItem): number {
    const nights = calculateNights(req);
    return roomBreakdown.reduce((sum, rb) => {
      const nightly = Number(rb.nightlyPrice);
      if (!nightly || nightly <= 0) return sum;
      return sum + nightly * nights;
    }, 0);
  }

 function openFormForRequest(req: RequestItem) {
  markCounterSeen(req.id); // ✅ okundu
    setOpenRequestId(req.id);
    setActionError(null);
    setActionMessage(null);
  const existing = findOfferForRequest(req.id);
  setOpenRequestId(req.id);
  setActionError(null);
  setActionMessage(null);
    if (existing) {
      setCurrency((existing.currency as any) || "TRY");
      setCommissionRate(existing.commissionRate);
      setNote(existing.note ?? "");
      setRoomBreakdown(initRoomBreakdownForRequest(req, existing));
      setOfferCancelType(existing.cancellationPolicyType ?? "non_refundable");
      setOfferCancelDays(existing.cancellationPolicyDays ?? 3);
    } else {
      setCurrency("TRY");
      setCommissionRate(10);
      setNote("");
      setRoomBreakdown(initRoomBreakdownForRequest(req));
      setOfferCancelType("non_refundable");
      setOfferCancelDays(3);
    }
    
  }

  function resetForm() {
    setOpenRequestId(null);
    setRoomBreakdown([]);
    setNote("");
  }

 function openRequestDetail(req: RequestItem) {
  markCounterSeen(req.id); // ✅ okundu
  setDetailRequest(req);
  setDetailOpen(true);
}
  function closeRequestDetail() {
    setDetailOpen(false);
    setDetailRequest(null);
  }

  // filtrelenmiş talepler
  const filteredRequests = useMemo(() => {
    
    const list = requests.filter((r) => {
      if (isRequestExpired(r)) return false;

      // süre+grace
      if (isRequestExpiredWithGrace(r)) return false;
      // checkin bugün+ileri
      if (!isCheckInTodayOrFuture(r)) return false;
      // rezervasyona dönmüşse kaldır
      if (acceptedRequestIds.has(r.id)) return false;

      if (districtFilter !== "all" && r.district !== districtFilter) return false;

      if (fromDate) {
        const ci = parseDate(r.checkIn);
        if (!ci || ci.toISOString().slice(0, 10) < fromDate) return false;
      }
      if (toDate) {
        const co = parseDate(r.checkOut);
        if (!co || co.toISOString().slice(0, 10) > toDate) return false;
      }

      const totalGuests = (r.adults ?? 0) + (r.childrenCount ?? 0);
      const roomsCount = r.roomsCount ?? 1;

      if (minGuests && totalGuests < Number(minGuests)) return false;
      if (minRooms && roomsCount < Number(minRooms)) return false;

      if (urgentHours !== "all") {
        const info = computeDeadlineInfo(r);
        const limit = Number(urgentHours);
        if (info.remainingHours == null) return false;
        if (info.remainingHours > limit) return false;
      }

      return true;
    });

    // pinned önce, sonra acil
    list.sort((a, b) => {
      const pa = pinnedIds.has(a.id) ? 0 : 1;
      const pb = pinnedIds.has(b.id) ? 0 : 1;
      if (pa !== pb) return pa - pb;

      const ra = computeDeadlineInfo(a).remainingHours ?? 9999;
      const rb = computeDeadlineInfo(b).remainingHours ?? 9999;
      return ra - rb;
    });

    return list;
  }, [
    requests,
    acceptedRequestIds,
    districtFilter,
    fromDate,
    toDate,
    minGuests,
    minRooms,
    urgentHours,
    pinnedIds,
    nowTick
  ]);

  const distinctDistricts = useMemo(() => {
    const set = new Set<string>();
    requests.forEach((r) => r.district && set.add(r.district));
    return Array.from(set);
  }, [requests]);

  // ✅ TEKLİF KAYDET (create + update) — TAM ÇALIŞIR
  async function handleSubmitOffer(e: FormEvent, req: RequestItem) {
    e.preventDefault();
if (isRequestExpired(req)) {
  setActionError("Bu talebin teklif süresi doldu. Teklif gönderilemez.");
  return;
}

    if (!myUid || (myRole !== "hotel" && myRole !== "otel")) return;

    const nights = calculateNights(req);
    if (nights <= 0) {
      setActionError("Giriş ve çıkış tarihleri hatalı görünüyor.");
      return;
    }

    if (!roomBreakdown.length) {
      setActionError("En az bir oda için fiyat girmen gerekiyor.");
      return;
    }

    // mevcut offer
    let existing = findOfferForRequest(req.id);

    // stale/duplicate kontrol
    if (!existing) {
      const dupSnap = await getDocs(
        query(collection(db, "offers"), where("hotelId", "==", myUid), where("requestId", "==", req.id))
      );
      if (!dupSnap.empty) {
        const d = dupSnap.docs[0];
        const v = d.data() as any;
        existing = {
          id: d.id,
          requestId: v.requestId,
          hotelId: v.hotelId,
          totalPrice: Number(v.totalPrice ?? 0),
          currency: v.currency ?? "TRY",
          mode: (v.mode as OfferMode) ?? "simple",
          commissionRate: (v.commissionRate as CommissionRate) ?? 10,
          status: v.status ?? "sent",
          note: v.note ?? null,
          roomBreakdown: Array.isArray(v.roomBreakdown) ? v.roomBreakdown : [],
          cancellationPolicyType: v.cancellationPolicyType,
          cancellationPolicyDays: v.cancellationPolicyDays ?? null,
          createdAt: v.createdAt,
          updatedAt: v.updatedAt,
          priceHistory: Array.isArray(v.priceHistory) ? v.priceHistory : []
        };
      }
    }
    
// ✅ RESTART RESET: restartAt sonrası eski teklif artık geçersiz sayılır
const restartMs = req.restartAt ? tsMs(req.restartAt) : 0;

if (existing && restartMs > 0) {
  const offerMs = tsMs((existing as any).createdAtMs ?? existing.createdAt);
  if (offerMs > 0 && offerMs < restartMs) {
    existing = undefined; // 🔥 eski teklif yok sayılır → CREATE/RESET çalışır
  }
}

const isUpdate = !!existing;



    // ✅ güncellemede kilit alanlar (currency + commission + cancel + note + oda tipi)
    const lockedCurrency = isUpdate ? (existing!.currency || "TRY") : currency;
    const lockedCommission = isUpdate ? (existing!.commissionRate as CommissionRate) : commissionRate;
    const lockedCancelType = isUpdate ? (existing!.cancellationPolicyType ?? "non_refundable") : offerCancelType;
    const lockedCancelDays = isUpdate ? (existing!.cancellationPolicyDays ?? 3) : offerCancelDays;
    const lockedNote = isUpdate ? (existing!.note ?? null) : (note?.trim?.() ? note.trim() : null);

    // mode (create’de anlamlı)
    const mode: OfferMode =
      lockedCommission === 15 ? "negotiable" : lockedCommission === 8 ? "simple" : "refreshable";

    // sadece fiyatlar toplanır
    const breakdownToSave: {
      roomTypeId: string;
      roomTypeName: string;
      nights: number;
      nightlyPrice: number;
      totalPrice: number;
    }[] = [];

    for (let i = 0; i < roomBreakdown.length; i++) {
      const rb = roomBreakdown[i];
      const nightly = Number(rb.nightlyPrice);

      if (!rb.roomTypeId) {
        setActionError(`Oda ${i + 1} için oda tipini seçmelisin.`);
        return;
      }
      if (!nightly || nightly <= 0) {
        setActionError(`Oda ${i + 1} için geçerli bir gecelik fiyat gir.`);
        return;
      }

      const total = nightly * nights;
      const roomTypeName =
        hotelProfile?.roomTypes?.find((rt) => rt.id === rb.roomTypeId)?.name ||
        (existing?.roomBreakdown?.[i]?.roomTypeName ?? "Oda");

      breakdownToSave.push({
        roomTypeId: rb.roomTypeId,
        roomTypeName,
        nights,
        nightlyPrice: nightly,
        totalPrice: total
      });
    }

    const totalPrice = breakdownToSave.reduce((sum, rb) => sum + rb.totalPrice, 0);
    if (!totalPrice || totalPrice <= 0) {
      setActionError("Toplam fiyat 0 olamaz.");
      return;
    }

    setSavingOffer(true);
    setActionError(null);
    setActionMessage(null);

    try {
      const hotelName = hotelProfile?.name || myName || null;

    if (!existing) {
  // ✅ CREATE/RESET: deterministic doc id ile tek kayıt
  const ref = doc(db, "offers", offerDocId(req.id, myUid));

  await setDoc(ref, {
    requestId: req.id,
    hotelId: myUid,
    hotelName,
    totalPrice,
    currency: lockedCurrency,
    mode,
    commissionRate: lockedCommission,
    note: lockedNote,
    roomBreakdown: breakdownToSave,
    cancellationPolicyType: lockedCancelType,
    cancellationPolicyDays: lockedCancelDays,
    status: "sent",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),

    priceHistory: [
      {
        actor: "hotel",
        kind: "initial",
        price: Number(totalPrice),
        note: lockedNote || "İlk teklif",
        createdAt: Timestamp.now()
      }
    ]
  }, { merge: false }); // ✅ eskiyi tamamen sıfırlar


        await createNotification(db, req.guestId, "offer_created", {
          requestId: req.id,
          hotelId: myUid,
          hotelName,
          totalPrice,
          currency: lockedCurrency,
          commissionRate: lockedCommission,
          mode
        });

        setActionMessage("Teklifin misafire gönderildi.");
      } else {
        // UPDATE — sadece fiyat (eğer izin varsa)
        if (!canEditPrice(existing)) {
          setActionError("Bu talep için fiyat artık düzenlenemez. (%8 tek teklif veya durum kilitli)");
          return;
        }

      const ref = doc(db, "offers", existing.id);

await updateDoc(ref, {
  totalPrice,
  currency: lockedCurrency,
  mode: existing.mode ?? mode,
  commissionRate: lockedCommission,
  note: lockedNote,
  roomBreakdown: breakdownToSave,
  cancellationPolicyType: lockedCancelType,
  cancellationPolicyDays: lockedCancelDays,

  // ✅ iptal edilmiş teklif yeniden veriliyorsa tekrar aktif et
  ...(String(existing.status || "").toLowerCase() === "withdrawn" ? { status: "sent" } : {}),

  updatedAt: serverTimestamp(),
  updatedAtMs: Date.now(),

  priceHistory: arrayUnion({
    actor: "hotel",
    kind: "update",
    price: Number(totalPrice),
    note: "Fiyat güncellendi",
    createdAt: Timestamp.now()
  })
});

        await createNotification(db, req.guestId, "offer_updated", {
          requestId: req.id,
          hotelId: myUid,
          hotelName,
          newTotalPrice: totalPrice,
          currency: lockedCurrency
        });

        setActionMessage("Bu talep için verdiğin teklif güncellendi.");
      }

      // refresh offers (local)
      const snapOffers = await getDocs(query(collection(db, "offers"), where("hotelId", "==", myUid)));
      const offerData: ExistingOffer[] = snapOffers.docs.map((d) => {
        const v = d.data() as any;
        return {
          id: d.id,
          requestId: v.requestId,
          hotelId: v.hotelId,
          totalPrice: Number(v.totalPrice ?? 0),
          currency: v.currency ?? "TRY",
          mode: (v.mode as OfferMode) ?? "simple",
          commissionRate: (v.commissionRate as CommissionRate) ?? 10,
          status: v.status ?? "sent",
          note: v.note ?? null,
          roomBreakdown: Array.isArray(v.roomBreakdown) ? v.roomBreakdown : [],
          cancellationPolicyType: v.cancellationPolicyType,
          cancellationPolicyDays: v.cancellationPolicyDays ?? null,
          createdAt: v.createdAt,
          updatedAt: v.updatedAt,
          priceHistory: Array.isArray(v.priceHistory) ? v.priceHistory : []
        };
      });
      setOffers(offerData);

      resetForm();
    } catch (err) {
      console.error("Teklif kaydedilirken hata:", err);
      setActionError("Teklif kaydedilirken bir hata oluştu. Lütfen tekrar dene.");
    } finally {
      setSavingOffer(false);
    }
  }
  return (
    <Protected allowedRoles={["hotel", "otel"] as any}>
      <div className="container-page space-y-6">
        {/* TOASTS */}
<div className="fixed top-4 right-4 z-[9999] space-y-2">
  {toasts.map((t) => (
    <button
      key={t.id}
      type="button"
      onClick={() => onToastClick(t)}
      className="w-full max-w-sm text-left rounded-xl border border-red-500/40 bg-slate-950/95 px-4 py-3 text-[0.8rem] text-slate-100 shadow-xl hover:bg-white/[0.03] cursor-pointer"
      title={t.reqId ? "Detayı aç" : ""}
    >
      {t.text}
    </button>
  ))}
</div>



        {/* Başlık */}
        <section className="space-y-2">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-2xl font-semibold">Gelen misafir talepleri</h1>
              <p className="text-sm text-slate-300 max-w-3xl">
                Filtrele → İncele → teklif ver. Güncellemede sadece <span className="font-semibold">fiyat</span> değişir (diğerleri kilitli).
              </p>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3 text-xs">
              <p className="text-slate-300">Acil filtre</p>
              <select
                value={urgentHours}
                onChange={(e) => setUrgentHours(e.target.value)}
                className="mt-1 w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
              >
                <option value="all">Tümü</option>
                <option value="6">6 saatten az</option>
                <option value="5">5 saatten az</option>
                <option value="4">4 saatten az</option>
                <option value="3">3 saatten az</option>
                <option value="2">2 saatten az</option>
                <option value="1">1 saatten az</option>
              </select>
            </div>
          </div>

          {hotelProfile?.city && (
            <p className="text-[0.75rem] text-slate-400">
              Şu an sadece{" "}
              <span className="font-semibold">
                {hotelProfile.city}
                {hotelProfile.district ? ` / ${hotelProfile.district}` : ""}
              </span>{" "}
              için açılmış talepleri görüyorsun.
            </p>
          )}
        </section>

        {/* Filtre paneli */}
        <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 text-xs shadow shadow-slate-950/40 space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-200">İlçe</label>
              <select
                value={districtFilter}
                onChange={(e) => setDistrictFilter(e.target.value)}
                className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
              >
                <option value="all">Tümü</option>
                {distinctDistricts.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-200">Giriş tarihi (ilk)</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-200">Çıkış tarihi (son)</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-200">Min. kişi / Min. oda</label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  min={0}
                  value={minGuests}
                  onChange={(e) => setMinGuests(e.target.value)}
                  placeholder="Kişi"
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                />
                <input
                  type="number"
                  min={0}
                  value={minRooms}
                  onChange={(e) => setMinRooms(e.target.value)}
                  placeholder="Oda"
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                />
              </div>
            </div>
          </div>
        </section>

        {loading && <p className="text-sm text-slate-400">Talepler yükleniyor...</p>}

        {error && (
          <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/40 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        {!loading && filteredRequests.length === 0 && (
          <p className="text-sm text-slate-400">Filtrelerine uyan aktif misafir talebi bulunamadı.</p>
        )}

        {/* Talepler listesi */}
        {filteredRequests.map((req) => {
          const totalGuests = req.adults + (req.childrenCount ?? 0);
          const roomsCount = req.roomsCount ?? 1;
          const nights = calculateNights(req);
          const deadlineInfo = computeDeadlineInfo(req);
          const existingOffer = findOfferForRequest(req.id);
          const expired = isRequestExpired(req);

          const offerEditable = existingOffer ? canEditPrice(existingOffer) : true;

          const created = req.createdAt?.toDate();
          const totalMs = (req.responseDeadlineMinutes ?? 0) * 60 * 1000 || 1;
          const now = new Date();
          const elapsed = created ? Math.min(totalMs, Math.max(0, now.getTime() - created.getTime())) : 0;
          const progressRatio = totalMs ? elapsed / totalMs : 0;
          const progressPercent = Math.round(progressRatio * 100);

          let progressColor = "bg-emerald-500";
          if (progressRatio >= 0.85) progressColor = "bg-red-500";
          else if (progressRatio >= 0.6) progressColor = "bg-amber-400";

          const isGroup = req.isGroup || req.type === "group";
          const rotatingTag = pickOneTag(buildTags(req), req.id, tagTick);

          const pinned = pinnedIds.has(req.id);

          return (
            <section
              key={req.id}
              className="rounded-2xl border border-slate-800 bg-slate-950/80 text-xs shadow shadow-slate-950/40 overflow-hidden"
            >
              {/* Üst satır */}
              <div className="grid md:grid-cols-[1.6fr_1.1fr_1.2fr_1.2fr_auto] gap-2 px-4 py-3 bg-slate-900/90 items-center">
                <div className="space-y-1">
                  <p className="text-slate-100 text-sm flex items-center gap-2">
                    {req.city}
                    {req.district ? ` / ${req.district}` : ""}

                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.65rem] ${tagClass(isGroup ? "warn" : "info")}`}>
                      {isGroup ? "Grup" : "Otel"}
                    </span>

                    {pinned ? (
                      <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[0.65rem] text-amber-200">
                        Sabit ⭐
                      </span>
                    ) : null}
                  </p>

                  <p className="text-[0.75rem] text-slate-300">Misafir: {maskName(req.guestName || req.guestDisplayName || "Misafir")}</p>
{(() => {
  const shown = getToastShownMap();
  return unreadCounterReqIds.has(req.id) && !shown[req.id];
})() && (
  <span className="ml-2 inline-flex items-center rounded-full border border-red-500/50 bg-red-500/10 px-2 py-0.5 text-[0.65rem] text-red-200">
    Karşı teklif 🔥
  </span>
)}



                  {rotatingTag ? (
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.65rem] ${tagClass(rotatingTag.tone)}`}>
                      {rotatingTag.text}
                    </span>
                  ) : null}
                </div>

                <div className="space-y-1 text-slate-100">
                  <p className="text-[0.8rem]">
                    Giriş: {req.checkIn} – Çıkış: {req.checkOut}{" "}
                    <span className="text-[0.7rem] text-slate-400">({nights} gece)</span>
                  </p>
                  <p className="text-[0.7rem] text-slate-400">
                    {totalGuests} kişi • {roomsCount} oda
                  </p>
                </div>

                <div className="space-y-1">
                  <p className="text-[0.75rem] text-slate-400">Oda tipleri</p>
                  <p className="text-[0.7rem] text-slate-200">
                    {req.roomTypes && req.roomTypes.length > 0
                      ? req.roomTypes.map(roomTypeLabel).join(", ")
                      : req.roomTypeRows?.length
                      ? req.roomTypeRows.map((x) => `${roomTypeLabel(x.typeKey)}×${x.count}`).join(", ")
                      : "Belirtilmemiş"}
                  </p>
                </div>

                <div className="space-y-1">
                  <p className={`text-[0.75rem] font-semibold ${deadlineInfo.color}`}>{deadlineInfo.label}</p>
                  <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div className={`h-full ${progressColor}`} style={{ width: `${progressPercent}%` }} />
                  </div>
                  {deadlineInfo.remainingHours != null && deadlineInfo.remainingHours <= 6 ? (
                    <p className="text-[0.65rem] text-red-200">Acil: {Math.ceil(deadlineInfo.remainingHours)} saatten az</p>
                  ) : null}
                </div>

                <div className="flex flex-col items-end gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => togglePin(req.id)}
                      className={`rounded-md border px-2.5 py-1 text-[0.7rem] ${
                        pinned
                          ? "border-amber-500/60 bg-amber-500/10 text-amber-200"
                          : "border-slate-700 bg-slate-950/40 text-slate-200 hover:border-amber-400"
                      }`}
                      title={pinned ? "Sabiti kaldır" : "Sabitle"}
                    >
                      {pinned ? "Sabit ✓" : "Sabitle"}
                    </button>

                    {existingOffer ? (
                      <span className="inline-flex items-center rounded-md border border-emerald-500/60 bg-emerald-500/10 px-3 py-1 text-[0.7rem] text-emerald-300">
                        Teklif: {moneyTR(existingOffer.totalPrice, existingOffer.currency)} • %{existingOffer.commissionRate}
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-md border border-slate-600 bg-slate-800/60 px-3 py-1 text-[0.7rem] text-slate-200">
                        Henüz teklif yok
                      </span>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => openRequestDetail(req)}
                      className="rounded-md border border-sky-500/70 px-3 py-1 text-[0.7rem] text-sky-300 hover:bg-sky-500/10"
                    >
                      Talep detayı
                    </button>

                 <button
  type="button"
  disabled={expired}
  onClick={() => (openRequestId === req.id ? resetForm() : openFormForRequest(req))}
  className={`rounded-md px-3 py-1 text-[0.7rem] font-semibold ${
    expired
      ? "bg-slate-700 text-slate-300 cursor-not-allowed"
      : "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
  }`}
>
  {expired
    ? "Süresi doldu"
    : openRequestId === req.id
    ? "Formu gizle"
    : existingOffer
    ? offerEditable
      ? "Fiyatı güncelle"
      : "Teklif detayı"
    : "Teklif ver"}
</button>


                  </div>
                </div>
              </div>

              {/* Teklif formu */}
              {openRequestId === req.id && (() => {
                const existingOffer2 = findOfferForRequest(req.id);
                const isUpdate = !!existingOffer2;
                const allowPriceEdit = isUpdate ? canEditPrice(existingOffer2) : true;

                const lockAllExceptPrice = isUpdate; // update’de sadece fiyat açık
                const nightsLocal = nights;

                const totalPriceForForm = computeTotalPriceForOpenForm(req);
                const currencyToShow = isUpdate ? (existingOffer2!.currency || currency) : currency;

                // UPDATE’de oda tipi değişmesin ama görünsün
                const roomTypeLocked = lockAllExceptPrice;

                // eski fiyatlar (history)
                const hist = Array.isArray(existingOffer2?.priceHistory) ? existingOffer2!.priceHistory! : [];
              const histSorted = hist
  .slice()
  .sort((a: any, b: any) => tsMs(a?.createdAt) - tsMs(b?.createdAt));


                const last3 = histSorted.slice(-3);

                return (
                  <div className="border-t border-slate-800 bg-slate-950 px-4 py-4 text-[0.75rem]">
                    <form
                      onSubmit={(e) => handleSubmitOffer(e, req)}
                      className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/95 p-4"
                    >
                      {isUpdate ? (
                        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                          <p className="text-slate-200">
                            Bu talep için daha önce{" "}
                            <span className="font-semibold text-emerald-200">
                              {moneyTR(existingOffer2!.totalPrice, existingOffer2!.currency)}
                            </span>{" "}
                            tutarında <span className="font-semibold">%{existingOffer2!.commissionRate}</span> komisyonlu teklif verdin.
                            Güncellemede sadece <span className="font-semibold text-emerald-200">fiyat</span> değişir.
                          </p>

                          {last3.length ? (
                            <div className="mt-2 grid gap-2 md:grid-cols-3">
                              {last3.map((h: any, idx: number) => (
                                <div key={idx} className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
                                  <p className="text-[0.65rem] text-slate-400">{String(h.kind || "update")}</p>
                                  <p className="text-[0.8rem] text-slate-100 font-semibold">{moneyTR(h.price, existingOffer2!.currency)}</p>
                                  <p className="text-[0.65rem] text-slate-500">{toTR(h.createdAt)}</p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[0.7rem] text-slate-500 mt-2">Fiyat geçmişi yok (ilk teklif tek kayıt olabilir).</p>
                          )}
                        </div>
                      ) : (
                        <p className="text-slate-300">
                          Bu talep için <span className="font-semibold text-slate-100">{roomsCount} oda / {nightsLocal} gece</span> oda bazlı fiyat gir.
                          Seçtiğin komisyon ve iptal politikası teklifinle kilitlenir.
                        </p>
                      )}

                      {!allowPriceEdit ? (
                        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-red-200">
                          Bu teklif artık düzenlenemez. (%8 tek teklif veya durum kilitli.)
                        </div>
                      ) : null}

                      {/* Oda satırları */}
                      <div className="space-y-2">
                        {roomBreakdown.map((rb, index) => {
                          const nightly = Number(rb.nightlyPrice) || 0;
                          const rowTotal = nightly * nightsLocal;

                          const selectedName =
                            hotelProfile?.roomTypes?.find((x) => x.id === rb.roomTypeId)?.name ||
                            existingOffer2?.roomBreakdown?.[index]?.roomTypeName ||
                            "Oda";

                          return (
                            <div
                              key={index}
                              className="grid md:grid-cols-[1.5fr_1fr_1.4fr] gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-3"
                            >
                              <div className="space-y-1">
                                <label className="text-slate-200">Oda {index + 1} – oda tipi</label>
                                <select
                                  value={rb.roomTypeId}
                                  onChange={(e) => handleRoomTypeChange(index, e.target.value)}
                                  disabled={roomTypeLocked}
                                  className="w-full rounded-md bg-slate-950 border border-slate-700 px-3 py-2 text-xs disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                  <option value="">{isUpdate ? selectedName : "Oda tipi seç"}</option>
                                  {hotelProfile?.roomTypes?.map((rt) => (
                                    <option key={rt.id} value={rt.id}>{rt.name}</option>
                                  ))}
                                </select>
                                {isUpdate ? (
                                  <p className="text-[0.65rem] text-slate-500">Oda tipi kilitli: {selectedName}</p>
                                ) : null}
                              </div>

                              <div className="space-y-1">
                                <label className="text-slate-200">Gecelik fiyat ({currencyToShow})</label>
                                <input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={rb.nightlyPrice}
                                  onChange={(e) => handleNightlyChange(index, e.target.value)}
                                  placeholder="Örn: 1000"
                                  disabled={!allowPriceEdit}
                                  className="w-full rounded-md bg-slate-950 border border-slate-700 px-3 py-2 text-xs disabled:opacity-60 disabled:cursor-not-allowed"
                                />
                              </div>

                              <div className="space-y-1">
                                <label className="text-slate-200">Bu oda için toplam</label>
                                <div className="text-[0.75rem] text-slate-100">
                                  {nightsLocal} gece × {nightly.toLocaleString("tr-TR")} {currencyToShow} ={" "}
                                  <span className="font-semibold text-emerald-300">
                                    {rowTotal.toLocaleString("tr-TR")} {currencyToShow}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Para birimi + komisyon + iptal */}
                      <div className="grid md:grid-cols-3 gap-3 mt-2">
                        <div className="space-y-1">
                          <label className="text-slate-200">Para birimi</label>
                          <select
                            value={currencyToShow}
                            onChange={(e) => {
                              if (lockAllExceptPrice) return;
                              setCurrency(e.target.value as any);
                            }}
                            disabled={lockAllExceptPrice}
                            className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs disabled:opacity-60 disabled:cursor-not-allowed"
                            title={lockAllExceptPrice ? "Teklif verildikten sonra para birimi değiştirilemez." : ""}
                          >
                            <option value="TRY">TRY</option>
                            <option value="USD">USD</option>
                            <option value="EUR">EUR</option>
                          </select>
                        </div>

                        <div className="space-y-1">
                          <label className="text-slate-200">Komisyon oranı</label>
                          <div className="flex gap-2">
                            {[8, 10, 15].map((rate) => {
                              const disabled = lockAllExceptPrice;
                              return (
                                <button
                                  key={rate}
                                  type="button"
                                  disabled={disabled}
                                  onClick={() => setCommissionRate(rate as CommissionRate)}
                                  className={`flex-1 rounded-md border px-2 py-1 text-[0.7rem] ${
                                    commissionRate === rate
                                      ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                                      : "border-slate-600 text-slate-200 hover:border-emerald-400"
                                  } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
                                >
                                  %{rate}
                                </button>
                              );
                            })}
                          </div>
                          <p className="text-[0.65rem] text-slate-400 mt-1">
                            {commissionExplain(commissionRate)}
                          </p>
                        </div>

                        <div className="space-y-1">
                          <label className="text-slate-200">İptal politikası</label>
                          <div className="space-y-1">
                            <label className="flex items-center gap-2 text-[0.7rem] text-slate-200">
                              <input
                                type="radio"
                                name={`cancel-${req.id}`}
                                disabled={lockAllExceptPrice}
                                checked={offerCancelType === "non_refundable"}
                                onChange={() => setOfferCancelType("non_refundable")}
                              />
                              İptal edilemez
                            </label>

                            <label className="flex items-center gap-2 text-[0.7rem] text-slate-200">
                              <input
                                type="radio"
                                name={`cancel-${req.id}`}
                                disabled={lockAllExceptPrice}
                                checked={offerCancelType === "flexible"}
                                onChange={() => setOfferCancelType("flexible")}
                              />
                              Her zaman ücretsiz iptal
                            </label>

                            <label className="flex items-center gap-2 text-[0.7rem] text-slate-200">
                              <input
                                type="radio"
                                name={`cancel-${req.id}`}
                                disabled={lockAllExceptPrice}
                                checked={offerCancelType === "until_days_before"}
                                onChange={() => setOfferCancelType("until_days_before")}
                              />
                              Girişten{" "}
                              <input
                                type="number"
                                min={1}
                                max={30}
                                disabled={lockAllExceptPrice || offerCancelType !== "until_days_before"}
                                value={offerCancelDays ?? 3}
                                onChange={(e) => setOfferCancelDays(Number(e.target.value) || 1)}
                                className="w-12 rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-[0.7rem] disabled:opacity-60 disabled:cursor-not-allowed"
                              />{" "}
                              gün önceye kadar ücretsiz iptal
                            </label>
                          </div>
                        </div>
                      </div>

                      {/* Not (update’de kilit) */}
                      <div className="space-y-1">
                        <label className="text-slate-200">Misafire not</label>
                        <textarea
                          rows={2}
                          value={note}
                          onChange={(e) => {
                            if (lockAllExceptPrice) return;
                            setNote(e.target.value);
                          }}
                          disabled={lockAllExceptPrice}
                          placeholder="Örn: Kahvaltı dahil, otopark ücretsiz, erken giriş mümkün..."
                          className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs resize-none disabled:opacity-60 disabled:cursor-not-allowed"
                        />
                        {lockAllExceptPrice ? (
                          <p className="text-[0.65rem] text-slate-500">Teklif güncellemede not kilitli.</p>
                        ) : null}
                      </div>

                      {/* Toplam + butonlar */}
                      <div className="flex flex-wrap items-center justify-between gap-2 mt-1">
                        <div className="space-y-1">
                          <p className="text-[0.75rem] text-slate-200">
                            Hesaplanan toplam:{" "}
                            <span className="font-semibold text-emerald-300">
                              {totalPriceForForm.toLocaleString("tr-TR")} {currencyToShow}
                            </span>
                          </p>
                          <p className="text-[0.7rem] text-slate-500">
                            Misafir önce toplamı görür; detayda oda kırılımı görünür. Güncellemede sadece fiyat değişir.
                          </p>
                        </div>

                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={resetForm}
                            className="rounded-md border border-slate-700 px-3 py-1 text-[0.7rem] text-slate-200 hover:border-slate-500"
                          >
                            İptal
                          </button>

                          <button
                            type="submit"
                            disabled={savingOffer || !allowPriceEdit}
                            className="rounded-md bg-emerald-500 text-slate-950 px-3 py-1 text-[0.7rem] font-semibold hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {savingOffer ? "Kaydediliyor..." : isUpdate ? "Teklifi güncelle" : "Teklif gönder"}
                          </button>
                        </div>
                      </div>
                    </form>
                  </div>
                );
              })()}
            </section>
          );
        })}

        {(actionMessage || actionError) && (
          <div className="text-[0.75rem] space-y-1">
            {actionMessage && (
              <p className="text-emerald-300 bg-emerald-500/10 border border-emerald-500/40 rounded-md px-3 py-2">
                {actionMessage}
              </p>
            )}
            {actionError && (
              <p className="text-red-300 bg-red-500/10 border border-red-500/40 rounded-md px-3 py-2">
                {actionError}
              </p>
            )}
          </div>
        )}
{detailOpen && detailRequest && (
<RequestDetailModal
  req={detailRequest}
  offer={findOfferForRequest(detailRequest.id)}
  acceptedRequestIds={acceptedRequestIds}
  hotelRoomTypes={hotelProfile?.roomTypes || []}
  onClose={closeRequestDetail}
/>


)}

      </div>
    </Protected>
  );
}
function RequestDetailModal({
  req,
  offer,
  acceptedRequestIds,
  hotelRoomTypes,
  onClose
}: {
  req: RequestItem;
  offer?: ExistingOffer;
  acceptedRequestIds: Set<string>;
  hotelRoomTypes: HotelRoomType[];
  onClose: () => void;
}) {


  const db = getFirestoreDb();

  const [liveReq, setLiveReq] = useState<any>(req);
  const [liveOffer, setLiveOffer] = useState<any | null>(offer ?? null);

  const [reqLoading, setReqLoading] = useState(true);
  const [offerLoading, setOfferLoading] = useState(false);

  const [roomModalOpen, setRoomModalOpen] = useState(false);
  const [activeRoomProfile, setActiveRoomProfile] = useState<any | null>(null);

  const safeStr = (v: any, fb = "—") => {
    if (v === null || v === undefined) return fb;
    const s = String(v).trim();
    return s.length ? s : fb;
  };
  const safeNum = (v: any, d = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const pick = (obj: any, keys: string[], fallback: any = null) => {
    for (const k of keys) {
      const parts = k.split(".").filter(Boolean);
      let cur = obj;
      for (const p of parts) cur = cur?.[p];
      if (cur !== undefined && cur !== null && String(cur).trim() !== "") return cur;
    }
    return fallback;
  };

  // live request
  useEffect(() => {
    const reqId = req?.id || null;
    if (!reqId) {
      setReqLoading(false);
      return;
    }

    setReqLoading(true);
    const unsub = onSnapshot(
      doc(db, "requests", reqId),
      (snap) => {
        if (snap.exists()) setLiveReq({ id: snap.id, ...(snap.data() as any) });
        else setLiveReq(req);
        setReqLoading(false);
      },
      () => setReqLoading(false)
    );

    return () => { try { unsub(); } catch {} };
  }, [db, req?.id]);

  // live offer
  useEffect(() => {
    const offerId = offer?.id || null;
    if (!offerId) return;

    setOfferLoading(true);
    const unsub = onSnapshot(
      doc(db, "offers", offerId),
      (snap) => {
        if (snap.exists()) setLiveOffer({ id: snap.id, ...(snap.data() as any) });
        setOfferLoading(false);
      },
      () => setOfferLoading(false)
    );

    return () => { try { unsub(); } catch {} };
  }, [db, offer?.id]);

  const reqAny: any = liveReq || {};
  const offerAny: any = liveOffer || offer || null;

  const offerStatus = String(offerAny?.status || "").toLowerCase();
  const UNLOCK = new Set(["accepted", "booked", "paid", "confirmed", "completed"]);
  const isUnlocked = UNLOCK.has(offerStatus) || acceptedRequestIds.has(String(reqAny?.id || req?.id || ""));

  // request fields
  const city = safeStr(reqAny.city);
  const district = safeStr(reqAny.district, "");
  const checkIn = safeStr(reqAny.checkIn);
  const checkOut = safeStr(reqAny.checkOut);

  const checkInTime = safeStr(reqAny.checkInTime, "14:00");
  const checkOutTime = safeStr(reqAny.checkOutTime, "12:00");

  const nights = safeNum(reqAny.nights, calculateNights(reqAny));
  const adults = safeNum(reqAny.adults, 0);
  const childrenCount = safeNum(reqAny.childrenCount, 0);
  const childrenAges: number[] = Array.isArray(reqAny.childrenAges) ? reqAny.childrenAges : [];
  const totalGuests = safeNum(reqAny.totalGuests, adults + childrenCount);

  const roomsCount = safeNum(reqAny.roomsCount, 1);
  const roomTypes: string[] = Array.isArray(reqAny.roomTypes) ? reqAny.roomTypes : [];

  const isGroup = !!(reqAny.isGroup || reqAny.type === "group");
  const typeText = safeStr(reqAny.type || (isGroup ? "group" : "hotel"));

  const accommodationType = safeStr(reqAny.accommodationType, "—");
  const boardType = safeStr(reqAny.boardType, "—");
  const boardTypes = Array.isArray(reqAny.boardTypes) ? reqAny.boardTypes : [];
  const starsText =
    Array.isArray(reqAny.desiredStarRatings) && reqAny.desiredStarRatings.length
      ? reqAny.desiredStarRatings.map((s: any) => `${s}★`).join(", ")
      : (reqAny.starRating ? `${reqAny.starRating}★` : "—");

  // early/late (net)
  const earlyWanted = Boolean(reqAny.earlyCheckInWanted ?? reqAny.earlyWanted ?? false);
  const earlyFrom = safeStr(reqAny.earlyCheckInFrom ?? null, "—");
  const earlyTo = safeStr(reqAny.earlyCheckInTo ?? null, "—");
  const earlyText = earlyWanted ? `${earlyFrom} → ${earlyTo}` : "İstenmiyor";

  const lateWanted = Boolean(reqAny.lateCheckOutWanted ?? reqAny.lateWanted ?? false);
  const lateFrom = safeStr(reqAny.lateCheckOutFrom ?? null, "—");
  const lateTo = safeStr(reqAny.lateCheckOutTo ?? null, "—");
  const lateText = lateWanted ? `${lateFrom} → ${lateTo}` : "İstenmiyor";

  const sameDayStay =
    Boolean(reqAny.sameDayStay) ||
    (reqAny.checkIn && reqAny.checkOut && reqAny.checkIn === reqAny.checkOut);

  // must/nice
  const mustArr: string[] = Array.isArray(reqAny.must) ? reqAny.must : Array.isArray(reqAny.mustHave) ? reqAny.mustHave : [];
  const niceArr: string[] = Array.isArray(reqAny.nice) ? reqAny.nice : Array.isArray(reqAny.niceToHave) ? reqAny.niceToHave : [];

  // features
  const featureKeys: string[] = Array.isArray(reqAny.featureKeys)
    ? reqAny.featureKeys
    : Array.isArray(reqAny.hotelFeaturePrefs)
    ? reqAny.hotelFeaturePrefs
    : [];
  const priorities = (reqAny.featurePriorities && typeof reqAny.featurePriorities === "object") ? reqAny.featurePriorities : {};

  // notes
  const notesAll = collectAllNotes(reqAny);

  // contact (KVKK)
  const contactName = pick(reqAny, ["contactName", "guestName", "guestDisplayName"], null);
  const contactEmail = pick(reqAny, ["contactEmail", "guestEmail"], null);
  const contactPhone = pick(reqAny, ["contactPhone", "guestPhone"], null);
  const contactPhone2 = pick(reqAny, ["contactPhone2", "guestPhone2"], null);
  const contactCompany = pick(reqAny, ["contactCompany", "company"], null);

  const nameToShow = isUnlocked ? safeStr(contactName, "Misafir") : maskName(contactName);
  const emailToShow = isUnlocked ? safeStr(contactEmail) : maskEmail(contactEmail);
  const phoneToShow = isUnlocked ? safeStr(contactPhone) : maskPhone(contactPhone);
  const phone2ToShow = isUnlocked ? safeStr(contactPhone2) : maskPhone(contactPhone2);
  const companyToShow = isUnlocked ? safeStr(contactCompany) : maskCompany(contactCompany);

  // offer fields
  const offerCurrency = offerAny?.currency ?? "TRY";
  const offerTotalPrice = safeNum(offerAny?.totalPrice, 0);
  const offerCommission = safeNum(offerAny?.commissionRate, 0);
  const offerNote = offerAny?.note ?? null;
  const offerRoomBreakdown = Array.isArray(offerAny?.roomBreakdown) ? offerAny.roomBreakdown : [];

  // timeline / price history / pazarlık
  function toMillis(ts: any) {
    try {
      if (!ts) return 0;
      if (typeof ts?.toMillis === "function") return ts.toMillis();
      if (typeof ts?.toDate === "function") return ts.toDate().getTime();
      if (typeof ts?.seconds === "number") return ts.seconds * 1000;
      const d = new Date(ts);
      return Number.isNaN(d.getTime()) ? 0 : d.getTime();
    } catch {
      return 0;
    }
  }

  type TimelineItem = {
    actor: "hotel" | "guest" | "system";
    kind: "initial" | "update" | "counter" | "current" | "accepted" | "rejected" | "info";
    price: number | null;
    note: string;
    createdAt: any | null;
  };

  const timeline = useMemo<TimelineItem[]>(() => {
    if (!offerAny) return [];
    const rawHist = Array.isArray(offerAny.priceHistory) ? offerAny.priceHistory : [];

    const sorted = rawHist
      .slice()
      .map((h: any) => ({
        actor: (h?.actor === "guest" ? "guest" : h?.actor === "system" ? "system" : "hotel") as any,
        kind: (h?.kind || (h?.actor === "guest" ? "counter" : "update")) as any,
        price: Number.isFinite(Number(h?.price)) ? Number(h.price) : null,
        note: String(h?.note ?? ""),
        createdAt: h?.createdAt ?? null
      }))
      .sort((a: any, b: any) => toMillis(a?.createdAt) - toMillis(b?.createdAt));

    const out: TimelineItem[] = [];
    const nowPrice = Number.isFinite(Number(offerAny.totalPrice)) ? Number(offerAny.totalPrice) : null;
    const st = String(offerAny.status || "").toLowerCase();
    const hasAccepted = st === "accepted" || st === "booked" || st === "paid" || st === "confirmed" || st === "completed";
    const hasRejected = st === "rejected";

    if (sorted.length > 0) {
      for (const h of sorted) {
        out.push({
          actor: h.actor,
          kind: h.kind === "initial" ? "initial" : h.kind === "counter" ? "counter" : "update",
          price: h.price,
          note: h.note || (h.kind === "initial" ? "İlk teklif" : h.kind === "counter" ? "Misafir karşı teklif" : "Fiyat güncellendi"),
          createdAt: h.createdAt
        });
      }

      // current price marker
      const lastHistPrice =
        [...out].reverse().find((x) => typeof x.price === "number" && (x.price as number) > 0)?.price ?? null;

      if (nowPrice && (!lastHistPrice || lastHistPrice !== nowPrice)) {
        out.push({ actor: "system", kind: "current", price: nowPrice, note: "Güncel fiyat", createdAt: offerAny.updatedAt ?? null });
      }

      if (hasAccepted) out.push({ actor: "system", kind: "accepted", price: nowPrice ?? lastHistPrice, note: "Kabul/Rezervasyon", createdAt: offerAny.acceptedAt ?? null });
      if (hasRejected) out.push({ actor: "system", kind: "rejected", price: nowPrice ?? lastHistPrice, note: "Reddedildi", createdAt: offerAny.rejectedAt ?? null });

      return out;
    }

    // no history
    if (nowPrice && nowPrice > 0) {
      out.push({ actor: "hotel", kind: "initial", price: nowPrice, note: "Tek fiyat (priceHistory yok)", createdAt: offerAny.createdAt ?? null });
      return out;
    }

    out.push({ actor: "system", kind: "info", price: null, note: "Fiyat bilgisi bulunamadı.", createdAt: offerAny.createdAt ?? null });
    return out;
  }, [offerAny]);

  const initialPrice = useMemo(() => {
    if (!offerAny) return null;
    const rawHist = Array.isArray(offerAny.priceHistory) ? offerAny.priceHistory : [];
    const sorted = rawHist.slice().sort((a: any, b: any) => toMillis(a?.createdAt) - toMillis(b?.createdAt));
    const init = sorted.find((h: any) => h?.actor === "hotel" && h?.kind === "initial" && Number(h?.price) > 0);
    return init ? Number(init.price) : null;
  }, [offerAny]);

  const currentPrice = offerAny ? safeNum(offerAny.totalPrice, 0) : 0;
  const overallDelta = initialPrice != null ? currentPrice - initialPrice : null;

  function deltaTone(delta: number) {
    if (delta > 0) return "border-red-500/35 bg-red-500/10 text-red-200";
    if (delta < 0) return "border-emerald-500/35 bg-emerald-500/10 text-emerald-200";
    return "border-slate-700 bg-slate-950/60 text-slate-200";
  }

  // Room detail modal profile (from hotelProfile in reqAny is not guaranteed, so derive minimal)
function openRoomModalFromOffer(rb: any) {
  const roomTypeId = rb?.roomTypeId ?? null;
  const roomTypeName = rb?.roomTypeName ?? "Oda";

  const byId = roomTypeId ? hotelRoomTypes.find((r) => r.id === roomTypeId) : null;
  const byName = !byId
    ? hotelRoomTypes.find(
        (r) => String(r.name || "").toLowerCase().trim() === String(roomTypeName).toLowerCase().trim()
      )
    : null;

  const prof =
    byId ||
    byName || {
      id: roomTypeId,
      name: roomTypeName,
      imageUrls: [],
      maxAdults: null,
      maxChildren: null,
      shortDescription: "",
      description: ""
    };

  setActiveRoomProfile(prof);
  setRoomModalOpen(true);
}


  // KVKK-safe JSON
  const maskedReqJson = useMemo(() => {
    const o: any = { ...(reqAny || {}) };
    const fields = ["contactName","contactEmail","contactPhone","contactPhone2","guestName","guestEmail","guestPhone","guestPhone2"];
    for (const f of fields) {
      if (o[f]) {
        if (String(f).toLowerCase().includes("email")) o[f] = maskEmail(o[f]);
        else if (String(f).toLowerCase().includes("phone")) o[f] = maskPhone(o[f]);
        else if (String(f).toLowerCase().includes("name")) o[f] = maskName(o[f]);
      }
    }
    try {
      return JSON.stringify(
        o,
        (_k, v) => (v && typeof v === "object" && typeof v.toDate === "function" ? v.toDate().toISOString() : v),
        2
      );
    } catch {
      return String(o);
    }
  }, [reqAny]);

  const Chip = ({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "emerald" | "amber" | "sky" | "red" }) => {
    const map: Record<string, string> = {
      slate: "border-slate-700 bg-slate-900 text-slate-200",
      emerald: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
      amber: "border-amber-500/40 bg-amber-500/10 text-amber-200",
      sky: "border-sky-500/40 bg-sky-500/10 text-sky-200",
      red: "border-red-500/40 bg-red-500/10 text-red-200"
    };
    return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[0.7rem] ${map[tone]}`}>{children}</span>;
  };

  const Field = ({ label, value }: { label: string; value: any }) => (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
      <p className="text-[0.7rem] text-slate-400">{label}</p>
      <p className="mt-1 text-[0.85rem] text-slate-100 font-semibold whitespace-pre-wrap break-words">
        {value === null || value === undefined || String(value).trim() === "" ? "—" : String(value)}
      </p>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />

      <div className="relative mt-8 w-full max-w-6xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-2xl max-h-[88vh] overflow-y-auto space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-extrabold text-slate-100">Talep Detayı</h2>

              <Chip tone="slate">ID: {safeStr(reqAny.id || req.id)}</Chip>
              <Chip tone={isGroup ? "amber" : "sky"}>{isGroup ? "Grup talebi" : "Otel talebi"}</Chip>
              <Chip tone="slate">Tip: {typeText}</Chip>

              <Chip tone={isUnlocked ? "emerald" : "amber"}>KVKK: {isUnlocked ? "Açık" : "Maskeli"}</Chip>
              {sameDayStay ? <Chip tone="amber">Aynı gün</Chip> : null}

              {reqLoading ? <Chip tone="sky">Talep okunuyor…</Chip> : null}
              {offerLoading ? <Chip tone="sky">Teklif güncelleniyor…</Chip> : null}
            </div>

            <p className="text-[0.78rem] text-slate-400">
              {city}{district ? ` / ${district}` : ""} • {checkIn} ({checkInTime}) → {checkOut} ({checkOutTime}) •{" "}
              <span className="text-slate-200 font-semibold">{nights}</span> gece •{" "}
              <span className="text-slate-200 font-semibold">{totalGuests}</span> kişi •{" "}
              <span className="text-slate-200 font-semibold">{roomsCount}</span> oda
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-700 bg-slate-900 px-4 py-2 text-[0.75rem] text-slate-200 hover:border-emerald-400 transition"
          >
            Kapat ✕
          </button>
        </div>

        {/* Üst Özet Kartları (Eski geniş style) */}
        <div className="grid md:grid-cols-3 gap-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
            <p className="text-[0.72rem] text-slate-400">Konaklama</p>
            <Field label="Şehir / İlçe" value={`${city}${district ? " / " + district : ""}`} />
            <Field label="Tarih" value={`${checkIn} (${checkInTime}) → ${checkOut} (${checkOutTime})`} />
            <Field label="Gece" value={nights} />
            <Field label="Yıldız" value={starsText} />
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
            <p className="text-[0.72rem] text-slate-400">Kişi & Oda</p>
            <Field label="Yetişkin" value={adults} />
            <Field label="Çocuk" value={childrenCount} />
            <Field label="Çocuk yaşları" value={childrenAges.length ? childrenAges.join(", ") : "—"} />
            <Field label="Toplam kişi" value={totalGuests} />
            <Field label="Oda sayısı" value={roomsCount} />
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
            <p className="text-[0.72rem] text-slate-400">Plan & Saatler</p>
            <Field label="Tesis tipi" value={accommodationType} />
            <Field label="Pansiyon" value={boardType !== "—" ? boardType : (boardTypes.length ? boardTypes.join(", ") : "—")} />
            <Field label="Erken giriş" value={earlyText} />
            <Field label="Geç çıkış" value={lateText} />
          </div>
        </div>

        {/* Oda tipleri */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
          <p className="text-[0.8rem] text-slate-100 font-semibold">Oda tipleri</p>
          {Array.isArray(reqAny.roomTypeRows) && reqAny.roomTypeRows.length > 0 ? (
            <div className="grid md:grid-cols-2 gap-2">
              {reqAny.roomTypeRows.map((row: any, idx: number) => (
                <div key={idx} className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                  <p className="text-slate-100 font-semibold">{roomTypeLabel(row.typeKey)}</p>
                  <p className="text-[0.75rem] text-slate-300">Adet: <span className="font-semibold">{row.count}</span></p>
                </div>
              ))}
            </div>
          ) : roomTypes.length ? (
            <div className="flex flex-wrap gap-2">
              {roomTypes.map((t: any, idx: number) => (
                <span key={idx} className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-[0.75rem] text-slate-200">
                  {roomTypeLabel(String(t))}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[0.75rem] text-slate-400">Oda tipi belirtilmemiş.</p>
          )}
        </div>

        {/* Must / Nice */}
        <div className="grid md:grid-cols-2 gap-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
            <p className="text-[0.8rem] text-slate-100 font-semibold">Olmazsa olmaz (Must)</p>
            <p className="mt-2 text-[0.85rem] text-slate-200 whitespace-pre-wrap">
              {mustArr.length ? mustArr.join(" • ") : "—"}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
            <p className="text-[0.8rem] text-slate-100 font-semibold">Olmasa da olur (Nice)</p>
            <p className="mt-2 text-[0.85rem] text-slate-200 whitespace-pre-wrap">
              {niceArr.length ? niceArr.join(" • ") : "—"}
            </p>
          </div>
        </div>

        {/* Features */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
          <p className="text-[0.8rem] text-slate-100 font-semibold">Özellikler / Öncelikler</p>
          {featureKeys.length ? (
            <div className="flex flex-wrap gap-2">
              {featureKeys.map((k: any, i: number) => (
                <span key={i} className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[0.75rem] text-emerald-200">
                  {String(k)}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[0.75rem] text-slate-400">Özellik seçilmemiş.</p>
          )}

          {Object.keys(priorities).length ? (
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {Object.entries(priorities).map(([k, v]: any) => (
                <Field key={k} label={`Öncelik: ${k}`} value={String(v)} />
              ))}
            </div>
          ) : null}

          {reqAny.hotelFeatureNote || reqAny.extraFeaturesText ? (
            <div className="mt-2 rounded-xl border border-slate-800 bg-slate-900/40 p-3">
              <p className="text-[0.7rem] text-slate-400">Ek not</p>
              <p className="text-[0.85rem] text-slate-200 whitespace-pre-wrap">
                {String(reqAny.extraFeaturesText || reqAny.hotelFeatureNote)}
              </p>
            </div>
          ) : null}
        </div>

        {/* Notlar */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
          <p className="text-[0.8rem] text-slate-100 font-semibold">Misafir notları</p>
          {notesAll ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
              <p className="text-[0.85rem] text-slate-200 whitespace-pre-wrap">{notesAll}</p>
            </div>
          ) : (
            <p className="text-[0.75rem] text-slate-400">Not yok.</p>
          )}
        </div>

        {/* KVKK iletişim */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[0.8rem] text-slate-100 font-semibold">İletişim bilgileri</p>
            <span className="text-[0.7rem] text-slate-400">{isUnlocked ? "Açık" : "Maskeli"}</span>
          </div>

          <div className="grid md:grid-cols-2 gap-2">
            <Field label="Ad Soyad" value={nameToShow} />
            <Field label="Firma" value={companyToShow} />
            <Field label="E-posta" value={emailToShow} />
            <Field label="Telefon" value={phoneToShow} />
            <Field label="Telefon 2" value={phone2ToShow} />
          </div>

          <p className="text-[0.7rem] text-slate-500">
            KVKK gereği: rezervasyon/kabul sonrası tam bilgiler açılır.
          </p>
        </div>

        {/* Teklif + oda kırılımı + pazarlık */}
        {offerAny ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[0.9rem] text-slate-100 font-extrabold">Bu talep için teklifin</p>
                <p className="text-[0.75rem] text-slate-400">
                  Durum: <span className="text-slate-200 font-semibold">{safeStr(offerAny.status, "sent")}</span>{" "}
                  • Komisyon: <span className="text-slate-200 font-semibold">%{offerCommission}</span>{" "}
                  • Para birimi: <span className="text-slate-200 font-semibold">{offerCurrency}</span>
                </p>
              </div>

              <div className="text-right">
                <p className="text-[0.7rem] text-slate-400">Toplam</p>
                <p className="text-emerald-300 font-extrabold text-lg">{moneyTR(offerTotalPrice, offerCurrency)}</p>

                {initialPrice != null ? (
                  <p className="text-[0.72rem] text-slate-400 mt-1">
                    İlk fiyat: <span className="text-slate-200 font-semibold">{moneyTR(initialPrice, offerCurrency)}</span>
                  </p>
                ) : (
                  <p className="text-[0.72rem] text-amber-200 mt-1">İlk fiyat: yok</p>
                )}

                {overallDelta != null ? (
                  <p className={`text-[0.72rem] mt-1`}>
                    <span className={`inline-flex items-center rounded-md border px-2 py-1 text-[0.72rem] ${deltaTone(overallDelta)}`}>
                      {overallDelta > 0 ? "Artış" : overallDelta < 0 ? "İndirim" : "Değişmedi"}:{" "}
                      <span className="font-semibold">
                        {overallDelta > 0 ? "+" : ""}
                        {Math.round(overallDelta).toLocaleString("tr-TR")} {offerCurrency}
                      </span>
                    </span>
                  </p>
                ) : null}
              </div>
            </div>

            {offerNote ? (
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                <p className="text-[0.7rem] text-slate-400">Misafire not</p>
                <p className="text-[0.85rem] text-slate-200 whitespace-pre-wrap">{String(offerNote)}</p>
              </div>
            ) : null}

            {/* Oda kırılımı */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
              <p className="text-[0.7rem] text-slate-400">Oda kırılımı (teklif)</p>
              {offerRoomBreakdown.length ? (
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  {offerRoomBreakdown.map((rb: any, idx: number) => (
                    <button
                      key={idx}
                      type="button"
onClick={() => openRoomModalFromOffer(rb)}
                      className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 hover:bg-white/[0.03] text-left"
                      title="Oda detayını aç"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-slate-100 font-semibold flex items-center gap-2">
                            {safeStr(rb?.roomTypeName || "Oda")}
                            <span className="text-slate-400 text-[0.75rem]">↗</span>
                          </p>
                          <p className="text-[0.75rem] text-slate-400">
                            {safeNum(rb?.nights, nights)} gece × {safeNum(rb?.nightlyPrice, 0).toLocaleString("tr-TR")} {offerCurrency}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[0.7rem] text-slate-400">Toplam</p>
                          <p className="text-emerald-300 font-extrabold">{moneyTR(safeNum(rb?.totalPrice, 0), offerCurrency)}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-[0.75rem] text-slate-400 mt-2">Oda kırılımı yok.</p>
              )}
            </div>

            {/* Fiyat geçmişi / Pazarlık */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[0.8rem] text-slate-100 font-semibold">Fiyat geçmişi / Pazarlık</p>
                <span className="text-[0.7rem] text-slate-400">Adım: {timeline.length}</span>
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {timeline.map((h: TimelineItem, i: number) => {
                  const actorLabel = h.actor === "hotel" ? "Otel" : h.actor === "guest" ? "Misafir" : "Sistem";
                  const actorTone =
                    h.actor === "guest"
                      ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                      : h.actor === "hotel"
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                      : "border-slate-700 bg-slate-950/60 text-slate-200";

                  return (
                    <div key={i} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.65rem] ${actorTone}`}>
                              {actorLabel}
                            </span>
                            <span className="text-slate-100 font-semibold">{String(h.kind)}</span>
                          </div>
                          <div className="text-[0.7rem] text-slate-500">{toTR(h.createdAt)}</div>
                          <div className="text-[0.75rem] text-slate-300 whitespace-pre-wrap">{h.note || "—"}</div>
                        </div>

                        <div className="text-right">
                          <span className="inline-flex items-center rounded-md border border-sky-500/35 bg-sky-500/10 px-2 py-1 text-[0.72rem] text-sky-200">
                            {h.price != null ? moneyTR(h.price, offerCurrency) : "—"}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
            <p className="text-slate-300">Bu talep için henüz teklifin yok.</p>
          </div>
        )}

        {/* Diğer alanlar (KVKK-safe) */}
        <details className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
          <summary className="cursor-pointer text-[0.85rem] text-slate-200 font-semibold">Diğer tüm alanlar (KVKK-safe JSON)</summary>
          <pre className="mt-3 whitespace-pre-wrap break-words text-[0.72rem] text-slate-300 overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/70 p-3">
            {maskedReqJson}
          </pre>
        </details>

        {/* ROOM MODAL */}
        {roomModalOpen && activeRoomProfile ? (
<RoomProfileModal
  room={activeRoomProfile}
  onClose={() => {
    setRoomModalOpen(false);
    setActiveRoomProfile(null);
  }}
/>
        ) : null}
      </div>
    </div>
  );
}
function RoomProfileModal({
  room,
  onClose
}: {
  room: any;
  onClose: () => void;
}) {
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

  /* eslint-disable @next/next/no-img-element */
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/70">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />

      <div className="relative mt-10 w-full max-w-4xl rounded-2xl border border-slate-800 bg-slate-950/95 p-6 shadow-2xl max-h-[86vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-extrabold text-slate-100">{name}</h3>
            <p className="text-[0.8rem] text-slate-400 mt-1">
              Kapasite: <span className="text-slate-200 font-semibold">{String(maxAdults)}</span> yetişkin •{" "}
              Çocuk: <span className="text-slate-200 font-semibold">{String(maxChildren)}</span>
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

        <div className="mt-4">
          {images.length ? (
            <div className="grid gap-2 md:grid-cols-3">
              {images.slice(0, 9).map((src, i) => (
                <div key={i} className="rounded-xl overflow-hidden border border-slate-800 bg-slate-900/40">
                  <img src={src} alt={`room-${i}`} className="w-full h-32 object-cover" />
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-slate-400 text-sm">
              Bu oda için görsel yok.
            </div>
          )}
        </div>

        {shortDesc ? (
          <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <p className="text-[0.75rem] text-slate-400 mb-1">Kısa açıklama</p>
            <p className="text-slate-100 text-sm whitespace-pre-wrap">{shortDesc}</p>
          </div>
        ) : null}

        <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <p className="text-[0.75rem] text-slate-400 mb-1">Detay</p>
          <p className="text-slate-100 text-sm whitespace-pre-wrap">{desc || "Açıklama yok."}</p>
        </div>

        <div className="flex justify-end pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-700 px-4 py-2 text-[0.75rem] text-slate-200 hover:border-emerald-400 transition"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}
