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
  onSnapshot
} from "firebase/firestore";

type OfferMode = "simple" | "refreshable" | "negotiable";
type OfferStatus = "sent" | "accepted" | "rejected" | "countered";
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
  roomsCount?: number;

  title?: string;
  nearMe?: boolean;
  nearMeKm?: number | null;

  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;

  roomTypeRows?: any[];
  roomTypeCounts?: AnyObj;
  roomTypes?: any[];
  boardTypes?: any[];
  desiredStarRatings?: any[];
  featureKeys?: any[];
  notes?: string;

  // full fetch için serbest
  [k: string]: any;
    // ✅ yeni saat alanları
  checkInTime?: string | null;         // "23:58"
  checkOutTime?: string | null;        // "12:00"
  sameDayStay?: boolean;               // true/false

  earlyCheckInWanted?: boolean;        // true/false
  earlyCheckInTime?: string | null;    // "03:00"

  lateCheckOutWanted?: boolean;        // true/false
  lateCheckOutFrom?: string | null;    // "12:00"
  lateCheckOutTo?: string | null;      // "16:00"

  // (opsiyonel) date-time alanların varsa
  checkInDateTime?: any;               // "2025-12-29T20:58:00.000Z" veya Timestamp
  checkOutDateTime?: any;              // "2025-12-30T09:00:00.000Z" veya Timestamp

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
      return "Reddedildi";
    case "countered":
      return "Karşı teklif var";
    case "sent":
    default:
      return "Beklemede";
  }
}

// deterministic id
function offerDocId(requestId: string, hotelId: string) {
  return `${requestId}__${hotelId}`;
}

// full notes collector (request)
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
export default function HotelOffersPage() {
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

  const [toast, setToast] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  function showToast(type: "ok" | "err", msg: string) {
    setToast({ type, msg });
    window.clearTimeout((showToast as any)._t);
    (showToast as any)._t = window.setTimeout(() => setToast(null), 4000);
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

        const map: Record<string, HotelOffer> = {};
        for (const o of offersData) map[o.requestId] = o;

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
            roomsCount: safeNum(v.roomsCount, 1),
            title: v.title ?? v.requestTitle ?? null,
            nearMe: !!v.nearMe,
            nearMeKm: v.nearMeKm ?? null,
            contactName: v.contactName ?? v.guestName ?? null,
            contactEmail: v.contactEmail ?? v.guestEmail ?? null,
            contactPhone: v.contactPhone ?? v.guestPhone ?? null,
            roomTypeRows: Array.isArray(v.roomTypeRows) ? v.roomTypeRows : [],
            roomTypeCounts: v.roomTypeCounts && typeof v.roomTypeCounts === "object" ? v.roomTypeCounts : undefined,
            roomTypes: Array.isArray(v.roomTypes) ? v.roomTypes : [],
            boardTypes: Array.isArray(v.boardTypes) ? v.boardTypes : [],
            desiredStarRatings: Array.isArray(v.desiredStarRatings) ? v.desiredStarRatings : [],
            featureKeys: Array.isArray(v.featureKeys) ? v.featureKeys : [],
                        // ✅ saat & aynı gün
            checkInTime: v.checkInTime ?? null,
            checkOutTime: v.checkOutTime ?? "12:00",
            sameDayStay: !!v.sameDayStay,

            // ✅ erken giriş / geç çıkış
            earlyCheckInWanted: !!v.earlyCheckInWanted,
            earlyCheckInTime: v.earlyCheckInTime ?? null,

            lateCheckOutWanted: !!v.lateCheckOutWanted,
            lateCheckOutFrom: v.lateCheckOutFrom ?? null,
            lateCheckOutTo: v.lateCheckOutTo ?? null,

            // ✅ (opsiyonel) datetime varsa
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

  const filteredRequests = useMemo(() => {
    const t = qText.trim().toLowerCase();
    return requests.filter((r) => {
      const expired = isRequestExpired(r);
      if (hideExpired && expired) return false;

      const offer = offerByRequest[r.id];
      if (modeFilter !== "all") {
        if (!offer) return false;
        if (offer.mode !== modeFilter) return false;
      }

      if (onlyUrgent) {
        const u = urgencyTag(r);
        if (!u) return false;
        if (!(u.tone === "danger" || u.tone === "warning")) return false;
      }

      if (t) {
        const blob = [
          r.title,
          r.city,
          r.district,
          r.checkIn,
          r.checkOut,
          r.notes,
          r.nearMe ? "yakınımda" : "",
          offer ? "teklif verildi" : "teklif yok"
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!blob.includes(t)) return false;
      }

      // sadece teklif verilenleri de göstereceğiz (otel offers sayfası)
      return true;
    });
  }, [requests, qText, hideExpired, onlyUrgent, modeFilter, offerByRequest]);

  function openCreate(req: RequestItem) {
    setActiveReq(req);
    setCreateOpen(true);
  }
  function closeCreate() {
    setCreateOpen(false);
    setActiveReq(null);
  }

  function openDetails(req: RequestItem, offer: HotelOffer) {
    setDetailsReq(req);
    setDetailsOffer(offer);
    setDetailsOpen(true);
  }
  function closeDetails() {
    setDetailsReq(null);
    setDetailsOffer(null);
    setDetailsOpen(false);
  }

  // ✅ price update: transaction + history append (Timestamp.now in array)
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

      // local refresh
      setOffers((prev) => prev.map((o) => (o.id === offer.id ? { ...o, totalPrice: newPrice, note: note ?? o.note ?? null } : o)));
      setOfferByRequest((prev) => ({ ...prev, [offer.requestId]: { ...offer, totalPrice: newPrice, note: note ?? offer.note ?? null } }));

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
            Bu sayfada otelci, **misafirin tam talebini** ve **verdiği teklifin tüm fiyat geçmişini** (ilk → güncellemeler → karşı teklif → güncel) eksiksiz görür.
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
              const offer = offerByRequest[r.id];
              const nights = calcNights(r.checkIn, r.checkOut);
              const u = urgencyTag(r);
              const left = timeLeftLabel(r);

              const tagTone =
                u?.tone === "danger"
                  ? "border-red-500/40 bg-red-500/10 text-red-300"
                  : u?.tone === "warning"
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                  : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";

              return (
                <div key={r.id} className="border-t border-slate-800">
                  <div className="grid md:grid-cols-[1.4fr_1.2fr_1fr_1.2fr_auto] gap-2 px-4 py-3 items-center text-xs">
                    <div className="text-slate-100">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">{safeStr(r.city)}{r.district ? ` / ${r.district}` : ""}</p>
                        {u?.text && (
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.65rem] ${tagTone}`}>{u.text}</span>
                        )}
                      </div>

                      <p className="text-[0.75rem] text-slate-400">
                        {safeNum(r.adults, 0)} yetişkin
                        {safeNum(r.childrenCount, 0) ? ` • ${safeNum(r.childrenCount, 0)} çocuk` : ""} • {safeNum(r.roomsCount, 1)} oda
                        {nights > 0 ? ` • ${nights} gece` : ""}
                      </p>

<div className="flex flex-wrap gap-2 mt-1">
  {r.earlyCheckInWanted && (
    <span className="inline-flex items-center rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[0.65rem] text-sky-200">
      Erken giriş: {safeStr(r.earlyCheckInTime, "—")}
    </span>
  )}

  {r.lateCheckOutWanted && (
    <span className="inline-flex items-center rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[0.65rem] text-sky-200">
      Geç çıkış: {safeStr(r.lateCheckOutFrom, "—")} - {safeStr(r.lateCheckOutTo, "—")}
    </span>
  )}

  {r.sameDayStay && (
    <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[0.65rem] text-amber-200">
      Aynı gün
    </span>
  )}
</div>

                      {r.notes ? <p className="text-[0.7rem] text-slate-400 mt-1 line-clamp-2">“{String(r.notes)}”</p> : null}
                    </div>

                    <div className="text-slate-100">
<p className="font-semibold">
  {safeStr(r.checkIn)}
  <span className="text-slate-400 font-normal"> ({safeStr(r.checkInTime, "—")})</span>
  {" "}→{" "}
  {safeStr(r.checkOut)}
  <span className="text-slate-400 font-normal"> ({safeStr(r.checkOutTime, "12:00")})</span>
</p>

<p className="text-[0.7rem] text-slate-400">
  {r.sameDayStay ? (
    <span className="text-amber-200 font-semibold">Aynı gün konaklama</span>
  ) : (
    <span>{nights > 0 ? `${nights} gece` : "—"}</span>
  )}
  {" "}• Oluşturma: {fmtDateTimeTR(r.createdAt)}
</p>
                      <p className="text-[0.7rem] text-slate-400">Oluşturma: {fmtDateTimeTR(r.createdAt)}</p>
                    </div>

                    <div className="text-slate-100">
                      <p className={`font-semibold ${left === "Süre doldu" ? "text-red-300" : "text-emerald-300"}`}>{left || "—"}</p>
                      <p className="text-[0.7rem] text-slate-400">{r.nearMe ? "Yakın lokasyon" : "Genel arama"}</p>
                    </div>

                    <div className="text-slate-100">
                      {!offer ? (
                        <p className="text-slate-300">Henüz teklif yok</p>
                      ) : (
                        <>
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
                        </>
                      )}
                    </div>

                    <div className="flex justify-end gap-2">
                      {!offer ? (
                        <button
                          type="button"
                          onClick={() => openCreate(r)}
                          disabled={hideExpired && isRequestExpired(r)}
                          className="rounded-md bg-emerald-500 text-slate-950 px-3 py-1 text-[0.75rem] font-semibold hover:bg-emerald-400 disabled:opacity-50"
                        >
                          Teklif ver
                        </button>
                      ) : (
                        <>
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
                                onClick={() => {
                                  const val = prompt("Yeni toplam fiyat?", String(offer.totalPrice));
                                  if (!val) return;
                                  const np = Number(val);
                                  if (!Number.isFinite(np) || np <= 0) return;
                                  updateOfferPrice(offer, np, offer.note ?? null);
                                }}
                                className="rounded-md border border-emerald-500/70 px-3 py-1 text-[0.75rem] text-emerald-300 hover:bg-emerald-500/10"
                              >
                                Fiyat güncelle
                              </button>
                            )}
                        </>
                      )}
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

        {createOpen && activeReq && (
          <CreateOfferModal
            req={activeReq}
            hotelRoomTypes={hotelRoomTypes}
            existingOffer={offerByRequest[activeReq.id] ?? null}
            onClose={closeCreate}
            onCreated={(newOffer) => {
              setOffers((p) => [newOffer, ...p]);
              setOfferByRequest((m) => ({ ...m, [newOffer.requestId]: newOffer }));
              showToast("ok", "Teklif gönderildi ✅");
              closeCreate();
            }}
            onError={(msg) => showToast("err", msg)}
          />
        )}

        {detailsOpen && detailsOffer && detailsReq && (
          <OfferDetailsModal
            offer={detailsOffer}
            req={detailsReq}
            hotelRoomTypes={hotelRoomTypes}
            onClose={closeDetails}
            onPriceUpdate={async (np, note) => updateOfferPrice(detailsOffer, np, note)}
          />
        )}
      </div>
    </Protected>
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
  const { profile } = useAuth();
  const db = getFirestoreDb();

  const nights = calcNights(req.checkIn, req.checkOut) || 1;

  const [mode, setMode] = useState<OfferMode>("refreshable");
  const [currency, setCurrency] = useState<Currency>("TRY");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const initialRows = useMemo(() => {
    const rows: any[] = [];

    if (Array.isArray(req.roomTypeRows) && req.roomTypeRows.length) {
      for (const r of req.roomTypeRows) {
        rows.push({
          roomTypeId: null,
          roomTypeName: safeStr(r?.typeKey ?? r?.name ?? "Oda"),
          qty: safeNum(r?.count, 1),
          nights,
          nightlyPrice: "",
          board: "",
          refundable: true
        });
      }
      return rows;
    }

    if (req.roomTypeCounts && typeof req.roomTypeCounts === "object") {
      for (const [k, v] of Object.entries(req.roomTypeCounts)) {
        rows.push({
          roomTypeId: null,
          roomTypeName: safeStr(k),
          qty: safeNum(v, 1),
          nights,
          nightlyPrice: "",
          board: "",
          refundable: true
        });
      }
      return rows;
    }

    const c = safeNum(req.roomsCount, 1);
    for (let i = 0; i < c; i++) {
      rows.push({
        roomTypeId: null,
        roomTypeName: "Standart Oda",
        qty: 1,
        nights,
        nightlyPrice: "",
        board: "",
        refundable: true
      });
    }
    return rows;
  }, [req, nights]);

  const [rows, setRows] = useState<any[]>(initialRows);

  const computedTotal = useMemo(() => {
    let sum = 0;
    for (const r of rows) {
      const qty = safeNum(r.qty, 1);
      const n = safeNum(r.nights, nights);
      const nightly = safeNum(r.nightlyPrice, 0);
      sum += qty * n * nightly;
    }
    return sum;
  }, [rows, nights]);

  function changeRow(i: number, patch: AnyObj) {
    setRows((prev) => prev.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }
  function addRow() {
    setRows((p) => [...p, { roomTypeId: null, roomTypeName: "Oda", qty: 1, nights, nightlyPrice: "", board: "", refundable: true }]);
  }
  function removeRow(i: number) {
    setRows((p) => p.filter((_, idx) => idx !== i));
  }

  function findRoomProfile(roomTypeId?: string | null, roomTypeName?: string | null) {
    if (roomTypeId) {
      const hit = hotelRoomTypes.find((r) => r?.id === roomTypeId);
      if (hit) return hit;
    }
    if (roomTypeName) {
      const hit = hotelRoomTypes.find((r) => String(r?.name || "").toLowerCase() === String(roomTypeName || "").toLowerCase());
      if (hit) return hit;
    }
    return null;
  }

  async function createOfferTransaction() {
    if (!profile?.uid) return onError("Oturum bulunamadı.");
    if (existingOffer) return onError("Bu talebe zaten teklif vermişsin.");
    if (isRequestExpired(req)) return onError("Bu talebin teklif süresi dolmuş.");
    if (!rows.length) return onError("En az 1 oda satırı eklemelisin.");

    for (const r of rows) {
      const qty = safeNum(r.qty, 0);
      const nightly = safeNum(r.nightlyPrice, 0);
      if (qty <= 0) return onError("Oda adedi 0 olamaz.");
      if (nightly <= 0) return onError("Gecelik fiyat 0 olamaz.");
    }

    const total = safeNum(computedTotal, 0);
    if (total <= 0) return onError("Toplam fiyat 0 olamaz.");

    setSaving(true);
    try {
      const offerId = offerDocId(req.id, profile.uid);
      const ref = doc(db, "offers", offerId);

      const newOffer = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists()) throw new Error("DUPLICATE_OFFER");

        const roomBreakdown = rows.map((r) => {
          const prof = findRoomProfile(r.roomTypeId ?? null, r.roomTypeName ?? null);
          return {
            roomTypeId: r.roomTypeId ?? prof?.id ?? null,
            roomTypeName: safeStr(r.roomTypeName ?? prof?.name ?? "Oda"),
            qty: safeNum(r.qty, 1),
            nights: safeNum(r.nights, nights),
            nightlyPrice: safeNum(r.nightlyPrice, 0),
            totalPrice: safeNum(r.qty, 1) * safeNum(r.nights, nights) * safeNum(r.nightlyPrice, 0),
            board: r.board ? String(r.board) : null,
            refundable: !!r.refundable
          };
        });

        const payload: AnyObj = {
          hotelId: profile.uid,
          requestId: req.id,
          mode,
          status: "sent",
          currency,
          totalPrice: total,
          note: note?.trim?.() ? note.trim() : null,
          roomBreakdown,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          guestCounterPrice: null,
          guestCounterAt: null,

          // ✅ array inside => Timestamp.now()
          priceHistory: [
            {
              createdAt: Timestamp.now(),
              actor: "hotel",
              kind: "initial",
              price: total,
              currency,
              note: note?.trim?.() ? note.trim() : null
            }
          ]
        };

        tx.set(ref, payload);

        return {
          id: ref.id,
          requestId: req.id,
          hotelId: profile.uid,
          mode,
          status: "sent" as OfferStatus,
          currency,
          totalPrice: total,
          note: payload.note,
          roomBreakdown,
          priceHistory: payload.priceHistory
        } as HotelOffer;
      });

      onCreated(newOffer);
    } catch (e: any) {
      console.error(e);
      if (String(e?.message || "").includes("DUPLICATE_OFFER")) onError("Bu talebe zaten teklif verilmiş.");
      else onError("Teklif gönderilemedi.");
    } finally {
      setSaving(false);
    }
  }

  const u = urgencyTag(req);

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/60">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />

      <div className="relative mt-10 w-full max-w-5xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-xl shadow-slate-950/60 max-h-[88vh] overflow-y-auto space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-100">Teklif Ver</h2>
              {u?.text && (
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.65rem] ${
                    u.tone === "danger"
                      ? "border-red-500/40 bg-red-500/10 text-red-300"
                      : u.tone === "warning"
                      ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                      : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                  }`}
                >
                  {u.text}
                </span>
              )}
              {req.nearMe && (
                <span className="inline-flex items-center rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[0.65rem] text-sky-200">
                  📍 Yakınında istiyor {req.nearMeKm ? `(${req.nearMeKm} km)` : ""}
                </span>
              )}
            </div>

            <p className="text-[0.75rem] text-slate-400 mt-1">
              {safeStr(req.city)}{req.district ? ` / ${req.district}` : ""} • {safeStr(req.checkIn)} → {safeStr(req.checkOut)} •{" "}
              {safeNum(req.adults, 0)} yetişkin{safeNum(req.childrenCount, 0) ? ` • ${safeNum(req.childrenCount, 0)} çocuk` : ""} •{" "}
              {safeNum(req.roomsCount, 1)} oda
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-[0.75rem] text-slate-300 hover:border-emerald-400"
          >
            Kapat ✕
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-1">
            <p className="text-[0.7rem] text-slate-400">Teklif modeli</p>
            <select value={mode} onChange={(e) => setMode(e.target.value as OfferMode)} className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs">
              <option value="simple">%8 – Standart (sabit)</option>
              <option value="refreshable">%10 – Yenilenebilir</option>
              <option value="negotiable">%15 – Pazarlıklı</option>
            </select>
            <p className="text-[0.65rem] text-slate-500">Komisyon: %{commissionRateForMode(mode)}</p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-1">
            <p className="text-[0.7rem] text-slate-400">Para birimi</p>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs">
              <option value="TRY">TRY</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </select>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
            <p className="text-[0.7rem] text-slate-400">Hesaplanan toplam</p>
            <p className="text-slate-100 text-lg font-extrabold">{money(computedTotal, currency)}</p>
            <p className="text-[0.65rem] text-slate-500">Oda kırılımına göre otomatik.</p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[0.8rem] font-semibold text-slate-100">Oda kırılımı</p>
              <p className="text-[0.7rem] text-slate-400">Misafirin ihtiyacını netleştirir.</p>
            </div>
            <button type="button" onClick={addRow} className="rounded-md border border-slate-700 px-3 py-1 text-[0.75rem] text-slate-200 hover:border-emerald-400">
              + Oda satırı ekle
            </button>
          </div>

          <div className="space-y-2">
            {rows.map((r, idx) => {
              const prof = findRoomProfile(r.roomTypeId ?? null, r.roomTypeName ?? null);
              const img = Array.isArray(prof?.imageUrls) && prof.imageUrls.length ? prof.imageUrls[0] : null;
              const rowTotal = safeNum(r.qty, 1) * safeNum(r.nights, nights) * safeNum(r.nightlyPrice, 0);

              return (
                <div key={idx} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                  <div className="grid gap-2 md:grid-cols-[120px_1.4fr_0.8fr_0.8fr_0.8fr_auto] items-center">
                    <div className="aspect-video rounded-lg border border-slate-800 overflow-hidden bg-slate-900">
                      {img ? <img src={img} alt="room" className="w-full h-full object-cover" /> : null}
                    </div>

                    <div className="space-y-1">
                      <p className="text-[0.7rem] text-slate-400">Oda tipi</p>
                      <select
                        value={r.roomTypeId || ""}
                        onChange={(e) => {
                          const id = e.target.value || null;
                          const hit = hotelRoomTypes.find((x) => x?.id === id);
                          changeRow(idx, { roomTypeId: id, roomTypeName: hit?.name ?? r.roomTypeName });
                        }}
                        className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-2 text-xs"
                      >
                        <option value="">(Seç) — İsimle devam</option>
                        {hotelRoomTypes.map((x: any) => (
                          <option key={x.id} value={x.id}>
                            {safeStr(x.name)}
                          </option>
                        ))}
                      </select>

                      <input
                        value={safeStr(r.roomTypeName, "")}
                        onChange={(e) => changeRow(idx, { roomTypeName: e.target.value })}
                        placeholder="Oda adı"
                        className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-2 text-xs"
                      />

                      {prof?.description || prof?.shortDescription ? (
                        <p className="text-[0.7rem] text-slate-300 line-clamp-2">{safeStr(prof?.shortDescription || prof?.description || "", "")}</p>
                      ) : (
                        <p className="text-[0.7rem] text-slate-500">Bu oda için açıklama yok.</p>
                      )}
                    </div>

                    <div>
                      <p className="text-[0.7rem] text-slate-400">Adet</p>
                      <input type="number" min={1} value={r.qty} onChange={(e) => changeRow(idx, { qty: e.target.value })} className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-2 text-xs" />
                    </div>

                    <div>
                      <p className="text-[0.7rem] text-slate-400">Gece</p>
                      <input type="number" min={1} value={r.nights} onChange={(e) => changeRow(idx, { nights: e.target.value })} className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-2 text-xs" />
                    </div>

                    <div>
                      <p className="text-[0.7rem] text-slate-400">Gecelik</p>
                      <input type="number" min={0} step="0.01" value={r.nightlyPrice} onChange={(e) => changeRow(idx, { nightlyPrice: e.target.value })} className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-2 text-xs" />
                      <p className="text-[0.65rem] text-slate-500 mt-1">{money(rowTotal, currency)}</p>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <button type="button" onClick={() => removeRow(idx)} className="rounded-md border border-red-500/50 px-3 py-1 text-[0.75rem] text-red-200 hover:bg-red-500/10">
                        Sil
                      </button>

                      <label className="inline-flex items-center gap-2 text-[0.75rem] text-slate-300">
                        <input type="checkbox" checked={!!r.refundable} onChange={(e) => changeRow(idx, { refundable: e.target.checked })} className="accent-emerald-500" />
                        İade var
                      </label>

                      <input value={safeStr(r.board, "")} onChange={(e) => changeRow(idx, { board: e.target.value })} placeholder="Board (örn: Oda+Kahvaltı)" className="w-44 rounded-md bg-slate-900 border border-slate-700 px-2 py-2 text-xs" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-2">
          <p className="text-[0.8rem] font-semibold text-slate-100">Misafire not</p>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Örn: Ücretsiz otopark, erken giriş..." className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs" />
          <p className="text-[0.65rem] text-slate-500">Not, fiyat geçmişine de kaydolur.</p>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-700 px-4 py-2 text-[0.8rem] text-slate-200 hover:border-slate-500">
            Vazgeç
          </button>
          <button type="button" disabled={saving} onClick={createOfferTransaction} className="rounded-md bg-emerald-500 text-slate-950 px-4 py-2 text-[0.8rem] font-extrabold hover:bg-emerald-400 disabled:opacity-60">
            {saving ? "Gönderiliyor..." : "Teklifi Gönder 🚀"}
          </button>
        </div>
      </div>
    </div>
  );
}
function OfferDetailsModal({
  offer,
  req,
  hotelRoomTypes,
  onClose,
  onPriceUpdate
}: {
  offer: HotelOffer;
  req: RequestItem;
  hotelRoomTypes: any[];
  onClose: () => void;
  onPriceUpdate: (newPrice: number, note?: string | null) => Promise<void> | void;
}) {
  const db = getFirestoreDb();

  // ✅ canlı: request + offer (tam alanlar)
  const [liveReq, setLiveReq] = useState<any>(req);
  const [liveOffer, setLiveOffer] = useState<any>(offer);

  const [roomModalOpen, setRoomModalOpen] = useState(false);
  const [activeRoomProfile, setActiveRoomProfile] = useState<any | null>(null);

  useEffect(() => {
    const reqId = req?.id;
    if (!reqId) return;
    const unsub = onSnapshot(doc(db, "requests", reqId), (snap) => {
      if (snap.exists()) setLiveReq({ id: snap.id, ...(snap.data() as any) });
    });
    return () => {
      try { unsub(); } catch {}
    };
  }, [db, req?.id]);

  useEffect(() => {
    const offerId = offer?.id;
    if (!offerId) return;
    const unsub = onSnapshot(doc(db, "offers", offerId), (snap) => {
      if (snap.exists()) setLiveOffer({ id: snap.id, ...(snap.data() as any) });
    });
    return () => {
      try { unsub(); } catch {}
    };
  }, [db, offer?.id]);

  const reqAny: any = liveReq || {};
  const offerAny: any = liveOffer || offer || {};

  const isUnlocked = String(offerAny?.status || "") === "accepted";

  const nights = calcNights(reqAny.checkIn, reqAny.checkOut) || 1;
  const left = timeLeftLabel(reqAny);

  function findRoomProfile(roomTypeId?: string | null, roomTypeName?: string | null) {
    if (roomTypeId) {
      const hit = hotelRoomTypes.find((r) => r?.id === roomTypeId);
      if (hit) return hit;
    }
    if (roomTypeName) {
      const hit = hotelRoomTypes.find((r) => String(r?.name || "").toLowerCase() === String(roomTypeName || "").toLowerCase());
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

  const roomsMatch =
    guestWantsRoomsText === hotelOffersRoomsText ? "Eşleşiyor" : "Farklı olabilir";

  // KVKK
  const guestName = isUnlocked ? safeStr(reqAny.contactName, "Misafir") : maskName(reqAny.contactName);
  const guestEmail = isUnlocked ? safeStr(reqAny.contactEmail, "—") : maskEmail(reqAny.contactEmail);
  const guestPhone = isUnlocked ? safeStr(reqAny.contactPhone, "—") : maskPhone(reqAny.contactPhone);

  // ---- Price history (ilk + güncellemeler + counter) ----
  const history = useMemo(() => {
    const arr = Array.isArray(offerAny.priceHistory) ? [...offerAny.priceHistory] : [];
    arr.sort((a: any, b: any) => (a?.createdAt?.toMillis?.() ?? toDateMaybe(a?.createdAt)?.getTime?.() ?? 0) - (b?.createdAt?.toMillis?.() ?? toDateMaybe(b?.createdAt)?.getTime?.() ?? 0));

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
    return Math.round(pct * 10) / 10; // 1 ondalık
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
      return JSON.stringify(reqAny, (_k, v) => {
        if (v && typeof v === "object" && typeof (v as any).toDate === "function") return (v as any).toDate().toISOString();
        return v;
      }, 2);
    } catch {
      return safeJSON(reqAny);
    }
  }, [reqAny]);

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

                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.65rem] ${
                    offerAny.status === "accepted"
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                      : offerAny.status === "rejected"
                      ? "border-red-500/40 bg-red-500/10 text-red-300"
                      : offerAny.status === "countered"
                      ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                      : "border-slate-700 bg-slate-900 text-slate-300"
                  }`}
                >
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
                {nights} gece • Süre: <span className={left === "Süre doldu" ? "text-red-300" : "text-emerald-300"}>{left || "—"}</span>
              </p>
<p className="text-[0.7rem] text-slate-500">
  Check-in saati: <span className="text-slate-200 font-semibold">{safeStr(reqAny.checkInTime, "—")}</span>{" "}
  • Check-out saati: <span className="text-slate-200 font-semibold">{safeStr(reqAny.checkOutTime, "12:00")}</span>{" "}
  {reqAny.sameDayStay ? <span className="text-amber-200 font-semibold">• Aynı gün</span> : null}
</p>

{reqAny.earlyCheckInWanted ? (
  <p className="text-[0.7rem] text-slate-500">
    Erken giriş isteği: <span className="text-sky-200 font-semibold">{safeStr(reqAny.earlyCheckInTime, "—")}</span>
  </p>
) : null}

{reqAny.lateCheckOutWanted ? (
  <p className="text-[0.7rem] text-slate-500">
    Geç çıkış isteği:{" "}
    <span className="text-sky-200 font-semibold">{safeStr(reqAny.lateCheckOutFrom, "—")} - {safeStr(reqAny.lateCheckOutTo, "—")}</span>
  </p>
) : null}

              <p className="text-[0.7rem] text-slate-500">
                Gönderim: <span className="text-slate-200">{fmtDateTimeTR(offerAny.createdAt)}</span>
                {offerAny.updatedAt ? <> • Güncelleme: <span className="text-slate-200">{fmtDateTimeTR(offerAny.updatedAt)}</span></> : null}
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-[0.75rem] text-slate-300 hover:border-emerald-400"
            >
              Kapat ✕
            </button>
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

            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <p className="text-[0.7rem] text-slate-400">Hızlı işlem</p>
              <button
                type="button"
                onClick={() => {
                  const val = prompt("Yeni toplam fiyat?", String(offerAny.totalPrice ?? offer.totalPrice));
                  if (!val) return;
                  const np = Number(val);
                  const nn = prompt("Not (opsiyonel)", offerAny.note ?? offer.note ?? "") ?? (offerAny.note ?? offer.note ?? null);
                  onPriceUpdate(np, nn);
                }}
                disabled={!(offerAny.status === "sent" || offerAny.status === "countered") || !((offerAny.mode === "refreshable") || (offerAny.mode === "negotiable"))}
                className="mt-1 w-full rounded-md bg-emerald-500 text-slate-950 px-3 py-2 text-[0.8rem] font-extrabold hover:bg-emerald-400 disabled:opacity-40"
              >
                Fiyat güncelle
              </button>
              <p className="text-[0.65rem] text-slate-500 mt-2">%8 modelde güncelleme kapalı olabilir.</p>
            </div>
          </div>

          {/* Misafir isteği ↔ Otel teklifi eşleşme */}
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

          {/* Oda kırılımı + oda profili */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
            <p className="text-[0.85rem] text-slate-100 font-semibold">Oda kırılımı & oda özellikleri</p>

            {breakdown.length ? (
<div className="grid gap-4 md:grid-cols-2">
                {breakdown.map((rb: any, idx: number) => {
                  const prof = findRoomProfile(rb.roomTypeId ?? null, rb.roomTypeName ?? null);
                  const imgs = Array.isArray(prof?.imageUrls) ? prof.imageUrls : [];

                  const totalRow = safeNum(rb.totalPrice, safeNum(rb.qty, 1) * safeNum(rb.nights, nights) * safeNum(rb.nightlyPrice, 0));

                  return (
                  <button
  key={idx}
  type="button"
  onClick={() => openRoomModal(rb)}
  className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 hover:bg-white/[0.03] text-left"
  title="Oda profilini aç"
>
  {/* ÜST BAR */}
  <div className="flex items-start justify-between gap-3">
    <div className="min-w-0">
      <p className="text-slate-100 font-extrabold text-base leading-tight truncate">
        {safeStr(rb.roomTypeName || prof?.name || "Oda")}
        <span className="text-slate-400 text-[0.75rem] ml-2">↗</span>
      </p>
      <p className="text-[0.75rem] text-slate-400 mt-1">
        {safeNum(rb.qty, 1)} adet • {safeNum(rb.nights, nights)} gece •{" "}
        {money(safeNum(rb.nightlyPrice, 0), offerAny.currency ?? "TRY")} / gece
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

  {/* ORTA: 2 SÜTUN SABİT GRID */}
  <div className="mt-4 grid gap-4 md:grid-cols-[1fr_1.2fr]">
    {/* SOL: Özet kart */}
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

    {/* SAĞ: Görseller */}
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 h-full">
      {imgs.length ? (
        <div className="grid grid-cols-2 gap-2">
          {imgs.slice(0, 4).map((u: string, i: number) => (
            <div
              key={i}
              className="aspect-video rounded-lg border border-slate-800 overflow-hidden bg-slate-900"
            >
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
            <button type="button" onClick={onClose} className="rounded-md border border-slate-700 px-4 py-2 text-[0.75rem] text-slate-200 hover:border-emerald-400 transition">
              Kapat
            </button>
          </div>
        </div>
      </div>

      {roomModalOpen && activeRoomProfile ? (
        <RoomProfileModal room={activeRoomProfile} onClose={closeRoomModal} />
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
