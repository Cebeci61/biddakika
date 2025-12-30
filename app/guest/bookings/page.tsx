// app/guest/bookings/page.tsx
"use client";

import React, { useEffect, useMemo, useState, FormEvent } from "react";
import { Protected } from "@/components/Protected";
import { useAuth } from "@/context/AuthContext";
import { getFirestoreDb } from "@/lib/firebase/client";
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
  onSnapshot,
  documentId,
  limit
} from "firebase/firestore";

/* =======================
   TYPES
======================= */

type PaymentMethod = "card3d" | "payAtHotel" | "transfer" | "payAtDoor" | string;
type CancellationPolicyType = "non_refundable" | "flexible" | "until_days_before";

type PriceHistoryItem = {
  actor: "hotel" | "guest" | "agency";
  kind?: string; // "initial" | "counter" | "update" | "accepted" ...
  status?: string;
  price: number;
  note?: string | null;
  createdAt?: any; // Timestamp
  createdAtMs?: number;
};

interface RoomBreakdownItem {
  roomTypeId?: string;
  roomTypeName?: string;
  roomName?: string;
  nights?: number;
  nightlyPrice?: number;
  totalPrice?: number;
}

interface Booking {
  id: string;

  offerId?: string | null;
  requestId?: string | null;

  hotelId?: string | null;
  hotelName?: string | null;

  guestId?: string | null;
  guestName?: string | null;

  city?: string | null;
  district?: string | null;

  // PACKAGE
  type?: string | null; // "package"
  title?: string | null;
  packageRequestId?: string | null;
  packageOfferId?: string | null;

  agencySnapshot?: any;
  requestSnapshot?: any;
  offerSnapshot?: any;

  packageDetails?: any;
  packageBreakdown?: any;
  offerNote?: string | null;

  // hotel profile
  hotelCity?: string | null;
  hotelDistrict?: string | null;
  hotelLocationUrl?: string | null;
  hotelAddress?: string | null;
  hotelImageUrls?: string[] | null;

  // hotel contact
  hotelPhone?: string | null;
  hotelWhatsapp?: string | null;
  hotelEmail?: string | null;
  hotelWebsite?: string | null;
  hotelContactName?: string | null;

  // request
  requestCity?: string | null;
  requestDistrict?: string | null;

  checkIn: string;
  checkOut: string;
  nights?: number;
    // ✅ saat / erken-geç / aynı gün
  checkInTime?: string | null;
  checkOutTime?: string | null;

  sameDayStay?: boolean | null;

  earlyCheckInWanted?: boolean | null;
  earlyCheckInTime?: string | null;

  lateCheckOutWanted?: boolean | null;
  lateCheckOutFrom?: string | null;
  lateCheckOutTo?: string | null;


  adults?: number | null;
  childrenCount?: number | null;
  childrenAges?: number[] | null;
  roomsCount?: number | null;

  totalPrice?: number; // eski alan
  currency?: string;
  paymentMethod?: PaymentMethod;
  paymentStatus?: string;

  status?: string;

  roomBreakdown?: RoomBreakdownItem[];
  commissionRate?: number | null;

  cancellationPolicyType?: CancellationPolicyType | null;
  cancellationPolicyDays?: number | null;
  cancellationPolicyLabel?: string | null;

  hasReview?: boolean;
  createdAt?: Timestamp;

  offerPriceHistory?: PriceHistoryItem[] | null;

  // raw snapshots
  bookingRaw?: any;
  requestRaw?: any;
  offerRaw?: any;
  hotelRaw?: any;

  // ✅ computed (final paid)
  finalAmount?: number;
  finalCurrency?: string;
  finalSource?: "payment_snapshot" | "price_history" | "fallback";
}

interface RequestDoc {
  id: string;
  city?: string;
  district?: string | null;
  checkIn?: string;
  checkOut?: string;
    // ✅ saat / erken-geç / aynı gün
  checkInTime?: string | null;
  checkOutTime?: string | null;

  sameDayStay?: boolean | null;

  earlyCheckInWanted?: boolean | null;
  earlyCheckInTime?: string | null;

  lateCheckOutWanted?: boolean | null;
  lateCheckOutFrom?: string | null;
  lateCheckOutTo?: string | null;

  adults?: number;
  childrenCount?: number;
  childrenAges?: number[];
  roomsCount?: number;
  roomTypes?: string[];
  raw?: any;
}

interface OfferDoc {
  id: string;
  cancellationPolicyType?: CancellationPolicyType;
  cancellationPolicyDays?: number | null;
  commissionRate?: number | null;
  roomBreakdown?: RoomBreakdownItem[];
  priceHistory?: PriceHistoryItem[];
  totalPrice?: number | null;
  currency?: string | null;
  raw?: any;
}

type HotelRoomType = {
  id?: string;
  key?: string;
  typeKey?: string;
  name?: string;
  title?: string;
  roomTypeName?: string;
  description?: string;
  desc?: string;
  details?: string;
  capacity?: number;
  maxGuests?: number;
  size?: string;
  sqm?: string;
  beds?: string;
  bedType?: string;
  images?: string[];
  gallery?: string[];
  photos?: string[];
  imageUrls?: string[];
};

interface HotelDoc {
  id: string;
  city?: string;
  district?: string | null;
  locationUrl?: string | null;
  address?: string | null;
  imageUrls?: string[];
  roomTypes?: HotelRoomType[];

  hotelPhone?: string | null;
  hotelWhatsapp?: string | null;
  hotelEmail?: string | null;
  hotelWebsite?: string | null;
  hotelContactName?: string | null;

  raw?: any;
}

interface BookingMessage {
  id: string;
  bookingId: string;
  hotelId?: string | null;
  agencyId?: string | null;
  guestId?: string | null;
  senderRole: "guest" | "hotel" | "agency";
  text: string;
  createdAt?: Timestamp;
  read?: boolean;
}

/* =======================
   HELPERS (TEKİL)
======================= */

const SHOW_RAW_DEBUG = false;

function safeStr(v: any, fallback = "—") {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s ? s : fallback;
}
function safeNum(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function fmtMoney(amount: any, currency: any) {
  const a = safeNum(amount, 0);
  const c = safeStr(currency, "TRY");
  return `${a.toLocaleString("tr-TR")} ${c}`;
}
function escapeHtml(s: string) {
  return (s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function parseDate(value?: string | null): Date | null {
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
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}
function calcNights(checkIn?: string | null, checkOut?: string | null) {
  const ci = parseDate(checkIn);
  const co = parseDate(checkOut);
  if (!ci || !co) return 1;
  const d = diffInDays(co, ci);
  return d > 0 ? d : 1;
}
function bookingIsPast(booking: Booking): boolean {
  const out = parseDate(booking.checkOut);
  if (!out) return false;
  return diffInDays(out, new Date()) < 0;
}

function isPackageBooking(b: Booking) {
  const t = String(b.type || "").toLowerCase();
  return t === "package" || !!b.packageRequestId || !!b.packageOfferId || !!b.agencySnapshot || !!b.requestSnapshot || !!b.offerSnapshot;
}
function pkgTitle(b: Booking) {
  const rawReq = b.requestSnapshot || b.bookingRaw?.requestSnapshot || {};
  return safeStr(b.title || rawReq.title || rawReq.packageTitle || rawReq.name || "Paket");
}

function derivedStatus(b: Booking): "active" | "cancelled" | "completed" {
  const st = String(b.status || "").toLowerCase();
  if (st === "cancelled") return "cancelled";
  if (bookingIsPast(b)) return "completed";
  return "active";
}
function statusText(b: Booking) {
  const st = derivedStatus(b);
  if (st === "cancelled") return "İptal edildi";
  if (st === "completed") return "Tamamlandı";
  return "Aktif";
}
function statusClass(b: Booking) {
  const st = derivedStatus(b);
  if (st === "cancelled") return "bg-red-500/10 text-red-200 border-red-500/40";
  if (st === "completed") return "bg-slate-500/10 text-slate-200 border-slate-500/40";
  return "bg-emerald-500/10 text-emerald-200 border-emerald-500/40";
}

function paymentMethodText(method: any) {
  const m = String(method || "").toLowerCase();
  if (m.includes("card3d") || m.includes("3d")) return "Kredi Kartı / 3D Secure";
  if (m.includes("payathotel") || m.includes("hotel")) return "Otelde Ödeme";
  if (m.includes("transfer") || m.includes("havale") || m.includes("eft")) return "Havale / EFT";
  if (m.includes("door") || m.includes("kapı") || m.includes("cash")) return "Kapıda Ödeme";
  return safeStr(method, "—");
}
function isPaidText(paymentStatus?: any) {
  const s = String(paymentStatus ?? "").trim().toLowerCase();
  if (!s) return false;
  const paidKeywords = ["paid", "ödendi", "odendi", "success", "succeeded", "completed", "confirmed", "captured", "approved", "ok", "done"];
  return paidKeywords.some((k) => s.includes(k));
}

function cancellationPolicyTextFromBooking(b: Booking): string {
  if (b.cancellationPolicyLabel) return b.cancellationPolicyLabel;
  const type: CancellationPolicyType = (b.cancellationPolicyType as CancellationPolicyType) ?? "non_refundable";
  if (type === "non_refundable") return "Bu rezervasyon iptal edilemez, ücret iadesi yapılmaz.";
  if (type === "flexible") return "Giriş tarihine kadar ücretsiz iptal hakkın vardır.";
  if (type === "until_days_before") {
    const d = b.cancellationPolicyDays ?? 3;
    return `Giriş tarihinden ${d} gün öncesine kadar ücretsiz iptal hakkın vardır. Sonrasında iptal edilemez.`;
  }
  return "";
}
function deepMerge<T extends Record<string, any>>(a: any, b: any): T {
  // b, a'nın üstüne yazar (daha güncel)
  const out: any = { ...(a || {}) };
  Object.keys(b || {}).forEach((k) => {
    const av = out[k];
    const bv = b[k];
    if (Array.isArray(av) && Array.isArray(bv)) out[k] = bv.length ? bv : av; // boş array ezmesin
    else if (av && typeof av === "object" && bv && typeof bv === "object" && !Array.isArray(bv)) out[k] = deepMerge(av, bv);
    else out[k] = bv ?? av;
  });
  return out as T;
}

function prettyJSON(obj: any) {
  try {
    return JSON.stringify(
      obj ?? {},
      (_k, v) => {
        if (v && typeof v === "object" && typeof (v as any).toDate === "function") return (v as any).toDate().toISOString();
        return v;
      },
      2
    );
  } catch {
    return "{}";
  }
}


/** Misafirin talebini tek obje yapar: requestRaw > requestSnapshot > requestDoc */
function buildFullRequestObject(booking: Booking, requestDoc?: any) {
  const raw = booking.requestRaw || {};
  const snap = booking.requestSnapshot || booking.bookingRaw?.requestSnapshot || {};
  const docx = requestDoc || {};
  // öncelik: docx (en güncel) en üste, sonra snapshot, sonra raw
  // ama raw bazı alanları içeriyorsa kaybolmasın diye ters merge yapıyoruz:
  const merged = deepMerge(deepMerge(raw, snap), docx);

  // standart bazı isimleri normalize edelim (otel/grup/paket karışmasın)
  const normalized = {
    ...merged,
    city: merged.city ?? booking.requestCity ?? booking.city ?? "",
    district: merged.district ?? booking.requestDistrict ?? booking.district ?? "",
    checkIn: merged.checkIn ?? merged.dateFrom ?? booking.checkIn ?? "",
    checkOut: merged.checkOut ?? merged.dateTo ?? booking.checkOut ?? "",
    adults: merged.adults ?? merged.paxAdults ?? booking.adults ?? 0,
    childrenCount: merged.childrenCount ?? merged.paxChildren ?? booking.childrenCount ?? 0,
    roomsCount: merged.roomsCount ?? booking.roomsCount ?? 1,
    notes: merged.notes ?? merged.note ?? merged.specialRequests ?? merged.guestNote ?? "",
  };

  return normalized;
}


function canCancelBooking(b: Booking): boolean {
  if (String(b.status || "").toLowerCase() !== "active") return false;
  const checkInDate = parseDate(b.checkIn);
  if (!checkInDate) return false;
  const daysBefore = diffInDays(checkInDate, new Date());
  if (daysBefore < 0) return false;

  const type: CancellationPolicyType = (b.cancellationPolicyType as CancellationPolicyType) ?? "non_refundable";
  if (type === "non_refundable") return false;
  if (type === "flexible") return true;
  if (type === "until_days_before") {
    const d = b.cancellationPolicyDays ?? 0;
    return daysBefore >= d;
  }
  return false;
}

function canMessageBooking(b: Booking): boolean {
  if (String(b.status || "").toLowerCase() !== "active") return false;
  const out = parseDate(b.checkOut);
  if (!out) return true;
  return diffInDays(out, new Date()) >= 0;
}

function canReviewBooking(b: Booking): boolean {
  if (b.hasReview) return false;
  if (String(b.status || "").toLowerCase() === "cancelled") return false;
  return bookingIsPast(b);
}

function checkInCountdown(checkInISO: string) {
  const ci = parseDate(checkInISO);
  if (!ci) return { label: "—", tone: "slate" as const };
  const now = new Date();
  const ms = ci.getTime() - now.getTime();
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);

  if (ms <= 0) return { label: "Giriş zamanı", tone: "emerald" as const };
  if (days === 0) return { label: `${hours} saat kaldı`, tone: "amber" as const };
  if (days <= 2) return { label: `${days} gün kaldı`, tone: "amber" as const };
  return { label: `${days} gün kaldı`, tone: "slate" as const };
}
function pillTone(tone: "emerald" | "amber" | "red" | "slate") {
  if (tone === "emerald") return "border-emerald-500/35 bg-emerald-500/10 text-emerald-200";
  if (tone === "amber") return "border-amber-500/35 bg-amber-500/10 text-amber-200";
  if (tone === "red") return "border-red-500/35 bg-red-500/10 text-red-200";
  return "border-slate-500/30 bg-slate-500/10 text-slate-200";
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildMapsUrl(b: Booking, hotel?: HotelDoc | null) {
  const url = b.hotelLocationUrl || hotel?.locationUrl || null;
  if (url) return url;
  const q = `${b.hotelName ?? ""} ${b.hotelCity ?? b.city ?? ""} ${b.hotelDistrict ?? b.district ?? ""}`.trim();
  if (!q.trim()) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

function waLink(phoneRaw?: string, text?: string) {
  const phone = String(phoneRaw || "").replace(/[^\d]/g, "");
  if (!phone) return "";
  const msg = encodeURIComponent(text || "");
  return `https://wa.me/${phone}${msg ? `?text=${msg}` : ""}`;
}
function mailLink(email?: string, subject?: string, body?: string) {
  const e = String(email || "").trim();
  if (!e) return "";
  const qs = new URLSearchParams();
  if (subject) qs.set("subject", subject);
  if (body) qs.set("body", body);
  return `mailto:${e}${qs.toString() ? `?${qs.toString()}` : ""}`;
}

function findRoomTypeByName(hotel: HotelDoc | undefined, name: string) {
  if (!hotel?.roomTypes?.length) return null;
  const needle = (name || "").toLowerCase();
  return (
    hotel.roomTypes.find((r) => String(r.name ?? r.title ?? r.roomTypeName ?? r.key ?? r.typeKey ?? "").toLowerCase() === needle) ||
    hotel.roomTypes.find((r) => String(r.name ?? r.title ?? r.roomTypeName ?? "").toLowerCase().includes(needle)) ||
    null
  );
}

function isMineBooking(b: Booking, profile: any) {
  const uid = profile?.uid || "";
  const email = (profile?.email || "").toLowerCase();
  const name = (profile?.displayName || "").toLowerCase();

  const v: any = b.bookingRaw || b;
  const guestId = String(b.guestId || v.guestId || v.guestUid || v.guestUID || v.userId || v.userUID || v.uid || "").toLowerCase();
  const guestEmail = String(v.guestEmail || v.email || v.contact?.email || "").toLowerCase();
  const guestName = String(b.guestName || v.guestName || v.guestDisplayName || v.name || v.contact?.name || "").toLowerCase();

  if (uid && guestId === uid) return true;
  if (email && guestEmail && guestEmail === email) return true;
  if (name && guestName && guestName === name) return true;
  return false;
}

/**
 * ✅ FINAL FİYAT MOTORU (tüm sayfayla entegre)
 * Öncelik:
 * 1) gerçek ödeme snapshot (paid/charged/amount)
 * 2) bookingRaw.paymentSnapshot / paymentIntent / providerPayment
 * 3) offerPriceHistory içindeki final/accepted/paid kayıt
 * 4) booking.finalPrice/agreedPrice/totalPrice, offerRaw.totalPrice, requestRaw.totalPrice
 */
function getFinalPaidPrice(booking: Booking) {
  const currency = safeStr(
    booking.finalCurrency ||
      booking.currency ||
      booking.offerRaw?.currency ||
      booking.bookingRaw?.currency ||
      booking.offerSnapshot?.currency ||
      booking.requestSnapshot?.currency ||
      "TRY"
  );

  const directCandidates = [
    booking.bookingRaw?.paidTotal,
    booking.bookingRaw?.paidAmount,
    booking.bookingRaw?.chargedAmount,
    booking.bookingRaw?.paymentTotal,
    booking.bookingRaw?.payment?.total,
    booking.bookingRaw?.payment?.amount,
    booking.bookingRaw?.paymentSnapshot?.amount,
    booking.bookingRaw?.paymentSnapshot?.paidAmount,
    booking.bookingRaw?.paymentIntent?.amount,
    booking.bookingRaw?.providerPayment?.amount,
    booking.bookingRaw?.transaction?.amount,
    booking.bookingRaw?.charge?.amount
  ].map((x) => safeNum(x, NaN));

  const direct = directCandidates.find((n) => Number.isFinite(n) && n > 0);
  if (direct && Number.isFinite(direct)) return { amount: direct, currency, source: "payment_snapshot" as const };

  const ph = Array.isArray(booking.offerPriceHistory) ? booking.offerPriceHistory : [];
  if (ph.length) {
    const sorted = [...ph].sort((a, b) => {
      const at = a?.createdAt?.toMillis?.() ?? a?.createdAtMs ?? a?.createdAt ?? 0;
      const bt = b?.createdAt?.toMillis?.() ?? b?.createdAtMs ?? b?.createdAt ?? 0;
      return Number(at) - Number(bt);
    });

    for (let i = sorted.length - 1; i >= 0; i--) {
      const x = sorted[i] || {};
      const kind = String(x.kind || x.status || "").toLowerCase();
      const actor = String(x.actor || "").toLowerCase();
      const price = safeNum(x.price, 0);
      const looksFinal =
        kind.includes("accept") ||
        kind.includes("accepted") ||
        kind.includes("final") ||
        kind.includes("paid") ||
        kind.includes("confirm") ||
        kind.includes("onay");

      if (price > 0 && (looksFinal || actor.includes("guest"))) {
        return { amount: price, currency, source: "price_history" as const };
      }
    }
  }

  const fallbackCandidates = [
    booking.bookingRaw?.finalTotalPrice,
    booking.bookingRaw?.finalPrice,
    booking.bookingRaw?.agreedPrice,
    booking.finalAmount,
    booking.totalPrice,
    booking.offerRaw?.totalPrice,
    booking.bookingRaw?.totalPrice,
    booking.requestRaw?.totalPrice,
    booking.offerSnapshot?.totalPrice,
    booking.requestSnapshot?.totalPrice
  ].map((x) => safeNum(x, NaN));

  const fb = fallbackCandidates.find((n) => Number.isFinite(n) && n > 0) || 0;
  return { amount: fb, currency, source: "fallback" as const };
}

/* =======================
   UI ATOMS (TEKİL)
======================= */

function StatCard({ title, value, strong }: { title: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2">
      <p className="text-[0.65rem] text-slate-400">{title}</p>
      <p className={`text-sm font-semibold ${strong ? "text-emerald-300" : "text-slate-100"}`}>{value}</p>
    </div>
  );
}

function InfoCard({
  title,
  lines,
  extra
}: {
  title: string;
  lines: string[];
  extra?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
      <p className="text-[0.75rem] text-slate-400">{title}</p>
      <div className="mt-2 space-y-1">
        {lines.filter(Boolean).map((x, i) => (
          <div key={i} className={i === 0 ? "text-slate-100 font-semibold text-sm" : "text-slate-300 text-sm"}>
            {x}
          </div>
        ))}
      </div>
      {extra ? <div className="mt-2">{extra}</div> : null}
    </div>
  );
}

function MiniField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
      <div className="text-[0.7rem] text-slate-400">{label}</div>
      <div className="text-[0.85rem] text-slate-100 font-semibold break-words">{value}</div>
    </div>
  );
}
/* =======================
   MAIN PAGE
======================= */
// ✅ mesajlara otomatik talep özeti eklemek için
function buildAutoTimeNote(b: any) {
  if (!b) return "";

  const safeStrLocal = (v: any, fallback = "—") => {
    if (v === null || v === undefined) return fallback;
    const s = String(v).trim();
    return s.length ? s : fallback;
  };

  const parts: string[] = [];

  const checkInTime = safeStrLocal(b?.checkInTime, "");
  const checkOutTime = safeStrLocal(b?.checkOutTime, "");

  if (checkInTime) parts.push(`Check-in saati: ${checkInTime}`);
  if (checkOutTime) parts.push(`Check-out saati: ${checkOutTime}`);

  if (b?.sameDayStay) parts.push("Aynı gün konaklama");

  if (b?.earlyCheckInWanted) {
    parts.push(`Erken giriş istiyoruz: ${safeStrLocal(b?.earlyCheckInTime, "—")}`);
  }

  if (b?.lateCheckOutWanted) {
    parts.push(`Geç çıkış istiyoruz: ${safeStrLocal(b?.lateCheckOutFrom, "—")} - ${safeStrLocal(b?.lateCheckOutTo, "—")}`);
  }

  // hiçbir şey yoksa boş dön
  if (!parts.length) return "";

  return `⏱️ Talep özeti:\n- ${parts.join("\n- ")}`;
}

export default function GuestBookingsPage() {
  const { profile, loading: authLoading } = useAuth();
  const db = getFirestoreDb();

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [hotelMap, setHotelMap] = useState<Record<string, HotelDoc>>({});
  const [loading, setLoading] = useState(true);

  const [pageMessage, setPageMessage] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // voucher modal
  const [voucherOpen, setVoucherOpen] = useState(false);
  const [voucherBooking, setVoucherBooking] = useState<Booking | null>(null);

  // room modal
  const [roomOpen, setRoomOpen] = useState(false);
  const [roomBooking, setRoomBooking] = useState<Booking | null>(null);
  const [roomTypeName, setRoomTypeName] = useState<string>("");

  // message modal
  const [messageOpen, setMessageOpen] = useState(false);
  const [messageBooking, setMessageBooking] = useState<Booking | null>(null);
  const [messageText, setMessageText] = useState("");
  const [messageSending, setMessageSending] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [messageSuccess, setMessageSuccess] = useState<string | null>(null);

  // review modal
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewBooking, setReviewBooking] = useState<Booking | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewText, setReviewText] = useState("");
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewSuccess, setReviewSuccess] = useState<string | null>(null);

  // filters
  const [qText, setQText] = useState("");
  const [statusF, setStatusF] = useState<"all" | "active" | "completed" | "cancelled">("all");
  const [payF, setPayF] = useState<"all" | "paid" | "unpaid">("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [sortKey, setSortKey] = useState<"created_desc" | "checkin_asc" | "checkout_asc" | "price_desc">("created_desc");

  // promo ticker
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => (t + 1) % 999999), 3200);
    return () => window.clearInterval(id);
  }, []);
  const promoLine = useMemo(() => {
    const lines = [
      "Voucher + mesaj + yorum = tek ekran 📄",
      "Otel + Paket rezervasyonları burada ✅",
      "Talep + teklif + ödeme = kanıtlı 🧾",
      "Final fiyat her yerde aynı 💳",
      "Biddakika premium akış ⭐"
    ];
    return lines[tick % lines.length];
  }, [tick]);

  useEffect(() => {
    async function load() {
      if (authLoading) return;
      if (!profile) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setPageError(null);

      try {
        // ✅ 1) 3 ayrı query ile olası alanları yakala (guestId / guestUid / userId)
        const q1 = await getDocs(query(collection(db, "bookings"), where("guestId", "==", profile.uid), limit(300)));
        const q2 = await getDocs(query(collection(db, "bookings"), where("guestUid", "==", profile.uid), limit(300)));
        const q3 = await getDocs(query(collection(db, "bookings"), where("userId", "==", profile.uid), limit(300)));

        const mergedMap = new Map<string, any>();
        [q1, q2, q3].forEach((snap) => {
          snap.docs.forEach((d) => mergedMap.set(d.id, d.data()));
        });

        // ✅ 2) Eğer yine boşsa: sadece limitli “genel tarama” (field isimleri çok değişkense kurtarıcı)
        if (mergedMap.size === 0) {
          const all = await getDocs(query(collection(db, "bookings"), limit(400)));
          all.docs.forEach((d) => mergedMap.set(d.id, d.data()));
        }

        const rawAll: Booking[] = Array.from(mergedMap.entries())
          .map(([id, v]) => {
            const bookingRaw = { id, ...v };

            const b: Booking = {
              id,
              offerId: v.offerId ?? v.offerID ?? null,
              requestId: v.requestId ?? v.requestID ?? null,

              hotelId: v.hotelId ?? v.hotelID ?? null,
              hotelName: v.hotelName ?? null,

              guestId: v.guestId ?? v.guestUid ?? v.guestUID ?? v.userId ?? v.userUID ?? v.uid ?? null,
              guestName: v.guestName ?? v.guestDisplayName ?? v.name ?? null,

              city: v.city ?? null,
              district: v.district ?? null,

              type: v.type ?? null,
              title: v.title ?? v.packageTitle ?? v.requestSnapshot?.title ?? null,
              packageRequestId: v.packageRequestId ?? v.packageReqId ?? v.requestSnapshot?.id ?? null,
              packageOfferId: v.packageOfferId ?? v.packageOffId ?? null,

              agencySnapshot: v.agencySnapshot ?? null,
              requestSnapshot: v.requestSnapshot ?? null,
              offerSnapshot: v.offerSnapshot ?? null,
              packageDetails: v.packageDetails ?? v.offerSnapshot?.packageDetails ?? null,
              packageBreakdown: v.packageBreakdown ?? v.offerSnapshot?.breakdown ?? null,
              offerNote: v.offerNote ?? v.offerSnapshot?.note ?? null,

              checkIn: v.checkIn ?? v.dateFrom ?? "",
              checkOut: v.checkOut ?? v.dateTo ?? "",
                // ✅ saat / erken-geç / aynı gün (booking içinde varsa)
  checkInTime: v.checkInTime ?? null,
  checkOutTime: v.checkOutTime ?? null,

  sameDayStay: v.sameDayStay ?? false,

  earlyCheckInWanted: v.earlyCheckInWanted ?? false,
  earlyCheckInTime: v.earlyCheckInTime ?? null,

  lateCheckOutWanted: v.lateCheckOutWanted ?? false,
  lateCheckOutFrom: v.lateCheckOutFrom ?? null,
  lateCheckOutTo: v.lateCheckOutTo ?? null,


              adults: v.adults ?? v.paxAdults ?? null,
              childrenCount: v.childrenCount ?? v.paxChildren ?? null,
              childrenAges: v.childrenAges ?? null,
              roomsCount: v.roomsCount ?? null,

              totalPrice: safeNum(v.totalPrice ?? v.amount ?? 0, 0),
              currency: v.currency ?? "TRY",
              paymentMethod: v.paymentMethod ?? "payAtHotel",
              paymentStatus: v.paymentStatus ?? "—",

              status: v.status ?? "active",
              roomBreakdown: Array.isArray(v.roomBreakdown) ? v.roomBreakdown : [],
              commissionRate: v.commissionRate ?? null,

              cancellationPolicyType: v.cancellationPolicyType ?? null,
              cancellationPolicyDays: v.cancellationPolicyDays ?? null,
              cancellationPolicyLabel: v.cancellationPolicyLabel ?? null,

              hasReview: v.hasReview ?? false,
              createdAt: v.createdAt,

              bookingRaw
            };

            return b;
          })
          .filter((b) => String(b.status || "").toLowerCase() !== "deleted");

        // ✅ 3) Kesin kullanıcı filtre
        const myBookings = rawAll.filter((b) => isMineBooking(b, profile));

        // collect ids
        const offerIds = Array.from(new Set(myBookings.map((b) => b.offerId).filter(Boolean))) as string[];
        const requestIds = Array.from(new Set(myBookings.map((b) => b.requestId).filter(Boolean))) as string[];
        const hotelIds = Array.from(new Set(myBookings.map((b) => b.hotelId).filter(Boolean))) as string[];

        // OFFERS
        const offerMap: Record<string, OfferDoc> = {};
        for (const part of chunk(offerIds, 10)) {
          const qOff = query(collection(db, "offers"), where(documentId(), "in", part));
          const snapOff = await getDocs(qOff);
          snapOff.docs.forEach((od) => {
            const ov = od.data() as any;
            offerMap[od.id] = {
              id: od.id,
              cancellationPolicyType: ov.cancellationPolicyType,
              cancellationPolicyDays: ov.cancellationPolicyDays ?? null,
              commissionRate: ov.commissionRate ?? null,
              roomBreakdown: Array.isArray(ov.roomBreakdown) ? ov.roomBreakdown : [],
              priceHistory: Array.isArray(ov.priceHistory) ? ov.priceHistory : [],
              totalPrice: ov.totalPrice ?? null,
              currency: ov.currency ?? null,
              raw: { id: od.id, ...ov }
            };
          });
        }

        // REQUESTS
        const reqMap: Record<string, RequestDoc> = {};
        for (const part of chunk(requestIds, 10)) {
          const qReq = query(collection(db, "requests"), where(documentId(), "in", part));
          const snapReq = await getDocs(qReq);
          snapReq.docs.forEach((rd) => {
            const rv = rd.data() as any;
            reqMap[rd.id] = {
              id: rd.id,
              city: rv.city,
              district: rv.district ?? null,
              checkIn: rv.checkIn ?? rv.dateFrom ?? null,
              checkOut: rv.checkOut ?? rv.dateTo ?? null,
                // ✅ saat / erken-geç / aynı gün (request içinde)
  checkInTime: rv.checkInTime ?? null,
  checkOutTime: rv.checkOutTime ?? null,

  sameDayStay: rv.sameDayStay ?? false,

  earlyCheckInWanted: rv.earlyCheckInWanted ?? false,
  earlyCheckInTime: rv.earlyCheckInTime ?? null,

  lateCheckOutWanted: rv.lateCheckOutWanted ?? false,
  lateCheckOutFrom: rv.lateCheckOutFrom ?? null,
  lateCheckOutTo: rv.lateCheckOutTo ?? null,

              adults: rv.adults ?? rv.paxAdults ?? null,
              childrenCount: rv.childrenCount ?? rv.paxChildren ?? 0,
              childrenAges: rv.childrenAges ?? [],
              roomsCount: rv.roomsCount ?? 1,
              roomTypes: rv.roomTypes ?? [],
              raw: { id: rd.id, ...rv }
            };
          });
        }

        // HOTELS (users/{hotelId})
        const hMap: Record<string, HotelDoc> = {};
        for (const part of chunk(hotelIds, 10)) {
          const qH = query(collection(db, "users"), where(documentId(), "in", part));
          const snapH = await getDocs(qH);
          snapH.docs.forEach((hd) => {
            const hv = hd.data() as any;
            const hp = hv.hotelProfile || {};

            const roomTypes: HotelRoomType[] = hp.roomTypes || hp.rooms || hp.roomCatalog || hp.roomTypeCatalog || [];
            const imageUrls: string[] = hp.imageUrls || hp.images || hp.gallery || [];

            hMap[hd.id] = {
              id: hd.id,
              city: hp.city || hv.city,
              district: hp.district ?? hv.district ?? null,
              locationUrl: hp.locationUrl || hv.locationUrl || null,
              address: hp.address || hv.address || null,
              imageUrls: Array.isArray(imageUrls) ? imageUrls : [],
              roomTypes: Array.isArray(roomTypes) ? roomTypes : [],

              hotelEmail: hp.email || hp.hotelEmail || hv.email || hv.hotelEmail || null,
              hotelPhone: hp.phone || hp.hotelPhone || hv.phone || hv.hotelPhone || null,
              hotelWhatsapp: hp.whatsapp || hp.hotelWhatsapp || hv.whatsapp || hv.hotelWhatsapp || null,
              hotelWebsite: hp.website || hp.hotelWebsite || hv.website || hv.hotelWebsite || null,
              hotelContactName: hp.contactName || hp.hotelContactName || hv.contactName || hv.hotelContactName || null,

              raw: { id: hd.id, ...hv }
            };
          });
        }
        setHotelMap(hMap);

        // ENRICH + FINAL PRICE
        const enriched: Booking[] = myBookings.map((b) => {
          const off = b.offerId ? offerMap[b.offerId] : undefined;
          const req = b.requestId ? reqMap[b.requestId] : undefined;
          const hotel = b.hotelId ? hMap[b.hotelId] : undefined;

          const checkIn = b.checkIn || req?.checkIn || b.requestSnapshot?.dateFrom || b.requestSnapshot?.checkIn || "";
          const checkOut = b.checkOut || req?.checkOut || b.requestSnapshot?.dateTo || b.requestSnapshot?.checkOut || "";
          const nights = b.nights ?? calcNights(checkIn, checkOut);

          const roomBreakdown =
            (Array.isArray(b.roomBreakdown) && b.roomBreakdown.length > 0 ? b.roomBreakdown : off?.roomBreakdown) ?? [];

          const merged: Booking = {
            ...b,

            checkIn,
            checkOut,
              // ✅ saat / erken-geç / aynı gün: booking yoksa requestSnapshot/requestDoc’tan
  checkInTime:
    b.checkInTime ??
    (req as any)?.checkInTime ??
    (b.requestSnapshot as any)?.checkInTime ??
    null,

  checkOutTime:
    b.checkOutTime ??
    (req as any)?.checkOutTime ??
    (b.requestSnapshot as any)?.checkOutTime ??
    null,

  sameDayStay:
    b.sameDayStay ??
    (req as any)?.sameDayStay ??
    (b.requestSnapshot as any)?.sameDayStay ??
    false,

  earlyCheckInWanted:
    b.earlyCheckInWanted ??
    (req as any)?.earlyCheckInWanted ??
    (b.requestSnapshot as any)?.earlyCheckInWanted ??
    false,

  earlyCheckInTime:
    b.earlyCheckInTime ??
    (req as any)?.earlyCheckInTime ??
    (b.requestSnapshot as any)?.earlyCheckInTime ??
    null,

  lateCheckOutWanted:
    b.lateCheckOutWanted ??
    (req as any)?.lateCheckOutWanted ??
    (b.requestSnapshot as any)?.lateCheckOutWanted ??
    false,

  lateCheckOutFrom:
    b.lateCheckOutFrom ??
    (req as any)?.lateCheckOutFrom ??
    (b.requestSnapshot as any)?.lateCheckOutFrom ??
    null,

  lateCheckOutTo:
    b.lateCheckOutTo ??
    (req as any)?.lateCheckOutTo ??
    (b.requestSnapshot as any)?.lateCheckOutTo ??
    null,

            nights,
            roomBreakdown,

            city: req?.city ?? b.city,
            district: (req?.district as any) ?? b.district,

            requestCity: req?.city ?? null,
            requestDistrict: (req?.district as any) ?? null,

            hotelCity: hotel?.city ?? b.hotelCity ?? null,
            hotelDistrict: hotel?.district ?? b.hotelDistrict ?? null,
            hotelLocationUrl: hotel?.locationUrl ?? b.hotelLocationUrl ?? null,
            hotelAddress: hotel?.address ?? b.hotelAddress ?? null,
            hotelImageUrls: hotel?.imageUrls ?? b.hotelImageUrls ?? null,

            hotelEmail: hotel?.hotelEmail ?? b.hotelEmail ?? null,
            hotelPhone: hotel?.hotelPhone ?? b.hotelPhone ?? null,
            hotelWhatsapp: hotel?.hotelWhatsapp ?? b.hotelWhatsapp ?? null,
            hotelWebsite: hotel?.hotelWebsite ?? b.hotelWebsite ?? null,
            hotelContactName: hotel?.hotelContactName ?? b.hotelContactName ?? null,

            adults: b.adults ?? req?.adults ?? (b.requestSnapshot?.adults ?? b.requestSnapshot?.paxAdults ?? null),
            childrenCount: b.childrenCount ?? req?.childrenCount ?? (b.requestSnapshot?.childrenCount ?? b.requestSnapshot?.paxChildren ?? null),
            childrenAges: b.childrenAges ?? req?.childrenAges ?? (b.requestSnapshot?.childrenAges ?? null),
            roomsCount: b.roomsCount ?? req?.roomsCount ?? (b.requestSnapshot?.roomsCount ?? null),

            cancellationPolicyType: (b.cancellationPolicyType as any) ?? off?.cancellationPolicyType ?? null,
            cancellationPolicyDays: b.cancellationPolicyDays ?? off?.cancellationPolicyDays ?? null,
            commissionRate: b.commissionRate ?? off?.commissionRate ?? null,

            offerPriceHistory: off?.priceHistory ?? b.offerPriceHistory ?? null,

            requestRaw: req?.raw ?? b.requestRaw ?? null,
            offerRaw: off?.raw ?? b.offerRaw ?? null,
            hotelRaw: hotel?.raw ?? b.hotelRaw ?? null
          };

          const fp = getFinalPaidPrice(merged);
          merged.finalAmount = fp.amount;
          merged.finalCurrency = fp.currency;
          merged.finalSource = fp.source;

          return merged;
        });

        enriched.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
        setBookings(enriched);
      } catch (err: any) {
        console.error("Rezervasyonlar yüklenirken hata:", err);
        setPageError(err?.message || "Rezervasyonlar yüklenirken bir hata oluştu.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [authLoading, profile, db]);

  // summary (FINAL PRICE ile)
  const summary = useMemo(() => {
    const valid = bookings.filter((b) => String(b.status || "").toLowerCase() !== "deleted");
    const totalSpend = valid.reduce((s, b) => s + safeNum(b.finalAmount ?? b.totalPrice, 0), 0);
    const totalNights = valid.reduce((s, b) => s + safeNum(b.nights ?? calcNights(b.checkIn, b.checkOut), 0), 0);

    const cityCount: Record<string, number> = {};
    valid.forEach((b) => {
      const pkg = isPackageBooking(b);
      const c = (pkg ? (b.requestSnapshot?.city || b.city) : (b.hotelCity || b.city) || "—").toString();
      cityCount[c] = (cityCount[c] || 0) + 1;
    });

    let topCity = "—";
    let topCityN = 0;
    Object.entries(cityCount).forEach(([c, n]) => {
      if (n > topCityN) {
        topCityN = n;
        topCity = c;
      }
    });

    return { totalSpend, totalNights, topCity, count: valid.length };
  }, [bookings]);

  // filtered (FINAL PRICE ile)
  const filteredBookings = useMemo(() => {
    let list = [...bookings];

    const q = qText.trim().toLowerCase();
    if (q) {
      list = list.filter((b) => {
        const pkg = isPackageBooking(b);
        const hay = [
          b.id,
          pkg ? pkgTitle(b) : b.hotelName,
          pkg ? b.requestSnapshot?.city : b.hotelCity,
          pkg ? b.requestSnapshot?.district : b.hotelDistrict,
          b.city,
          b.district,
          b.checkIn,
          b.checkOut,
          b.paymentStatus,
          b.paymentMethod,
          b.hotelPhone,
          b.hotelEmail,
          b.agencySnapshot?.businessName,
          b.agencySnapshot?.displayName
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }

    if (statusF !== "all") list = list.filter((b) => derivedStatus(b) === statusF);

    if (payF !== "all") {
      list = list.filter((b) => {
        const paid = isPaidText(b.paymentStatus) || b.bookingRaw?.paidAt != null;
        return payF === "paid" ? paid : !paid;
      });
    }

    const f = parseDate(fromDate);
    if (f) {
      list = list.filter((b) => {
        const ci = parseDate(b.checkIn);
        if (!ci) return false;
        return normalized(ci).getTime() >= normalized(f).getTime();
      });
    }

    const t = parseDate(toDate);
    if (t) {
      list = list.filter((b) => {
        const co = parseDate(b.checkOut);
        if (!co) return false;
        return normalized(co).getTime() <= normalized(t).getTime();
      });
    }

    const minP = minPrice.trim() ? Number(minPrice) : null;
    const maxP = maxPrice.trim() ? Number(maxPrice) : null;

    if (minP != null && !Number.isNaN(minP)) list = list.filter((b) => safeNum(b.finalAmount ?? b.totalPrice, 0) >= minP);
    if (maxP != null && !Number.isNaN(maxP)) list = list.filter((b) => safeNum(b.finalAmount ?? b.totalPrice, 0) <= maxP);

    list.sort((a, b) => {
      if (sortKey === "created_desc") return (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0);
      if (sortKey === "checkin_asc") return (parseDate(a.checkIn)?.getTime() ?? Infinity) - (parseDate(b.checkIn)?.getTime() ?? Infinity);
      if (sortKey === "checkout_asc") return (parseDate(a.checkOut)?.getTime() ?? Infinity) - (parseDate(b.checkOut)?.getTime() ?? Infinity);
      if (sortKey === "price_desc") return safeNum(b.finalAmount ?? b.totalPrice, 0) - safeNum(a.finalAmount ?? a.totalPrice, 0);
      return 0;
    });

    return list;
  }, [bookings, qText, statusF, payF, fromDate, toDate, minPrice, maxPrice, sortKey]);

  // ui handlers
  function openVoucher(b: Booking) {
    setVoucherBooking(b);
    setVoucherOpen(true);
  }
  function closeVoucher() {
    setVoucherOpen(false);
    setVoucherBooking(null);
  }

  function openRoomDetail(b: Booking, roomName: string) {
    setRoomBooking(b);
    setRoomTypeName(roomName);
    setRoomOpen(true);
  }
  function closeRoomDetail() {
    setRoomOpen(false);
    setRoomBooking(null);
    setRoomTypeName("");
  }

  function openMessageModal(b: Booking) {
    setMessageBooking(b);
    setMessageText("");
    setMessageError(null);
    setMessageSuccess(null);
    setMessageOpen(true);
  }
  function closeMessageModal() {
    setMessageOpen(false);
    setMessageBooking(null);
    setMessageText("");
    setMessageError(null);
    setMessageSuccess(null);
  }

  async function handleSendMessage(e: FormEvent) {
    e.preventDefault();
    if (!profile || !messageBooking) return;

    const text = messageText.trim();
    
    if (!text) {
      setMessageError("Lütfen bir mesaj yaz.");
      return;
    }
// ✅ otomatik talep özeti (aynı gün / saat / erken / geç)
const autoNote = buildAutoTimeNote(messageBooking as any);

// Misafir aynı şeyi tekrar tekrar göndermesin diye:
// Eğer kullanıcı mesajında zaten "check-in" / "erken" / "geç çıkış" geçiyorsa eklemiyoruz.
const lower = text.toLowerCase();
const alreadyMentions =
  lower.includes("check-in") ||
  lower.includes("check in") ||
  lower.includes("check-out") ||
  lower.includes("check out") ||
  lower.includes("erken") ||
  lower.includes("geç") ||
  lower.includes("ayni gun") ||
  lower.includes("aynı gün");

const finalText =
  autoNote && !alreadyMentions
    ? `${autoNote}\n\n💬 Mesajım:\n${text}`
    : text;


    try {
      setMessageSending(true);
      setMessageError(null);
      setMessageSuccess(null);

      const pkg = isPackageBooking(messageBooking);

      await addDoc(collection(db, "bookingMessages"), {
        bookingId: messageBooking.id,
        hotelId: pkg ? null : (messageBooking.hotelId ?? null),
        agencyId: pkg ? (messageBooking.bookingRaw?.agencyId ?? messageBooking.offerSnapshot?.agencyId ?? messageBooking.agencySnapshot?.id ?? null) : null,
        guestId: profile.uid,
        senderRole: "guest",
       text: finalText,

        createdAt: serverTimestamp(),
        read: false
      });
<p className="text-[0.7rem] text-slate-500">
  Not: Mesajın içinde saat/erken/geç bilgisi yoksa sistem otomatik olarak “Talep özeti” ekler.
</p>

      setMessageSuccess("Mesajın gönderildi.");
      setMessageText("");
      setTimeout(() => setMessageSuccess(null), 900);
    } catch (err) {
      console.error("Mesaj gönderirken hata:", err);
      setMessageError("Mesaj gönderilirken bir hata oluştu.");
    } finally {
      setMessageSending(false);
    }
  }

  function openReviewModal(b: Booking) {
    setReviewBooking(b);
    setReviewRating(5);
    setReviewText("");
    setReviewError(null);
    setReviewSuccess(null);
    setReviewOpen(true);
  }
  function closeReviewModal() {
    setReviewOpen(false);
    setReviewBooking(null);
    setReviewText("");
    setReviewError(null);
    setReviewSuccess(null);
  }

  async function handleSendReview(e: FormEvent) {
    e.preventDefault();
    if (!profile || !reviewBooking) return;

    const text = reviewText.trim();
    if (!text) {
      setReviewError("Lütfen bir yorum yaz.");
      return;
    }

    try {
      setReviewSaving(true);
      setReviewError(null);
      setReviewSuccess(null);

      await addDoc(collection(db, "reviews"), {
        bookingId: reviewBooking.id,
        hotelId: reviewBooking.hotelId ?? null,
        guestId: profile.uid,
        rating: reviewRating,
        text,
        createdAt: serverTimestamp()
      });

      await updateDoc(doc(db, "bookings", reviewBooking.id), { hasReview: true });

      setBookings((prev) => prev.map((b) => (b.id === reviewBooking.id ? { ...b, hasReview: true } : b)));
      setReviewSuccess("Yorumun gönderildi, teşekkürler!");
      setTimeout(() => closeReviewModal(), 900);
    } catch (err) {
      console.error("Yorum kaydedilirken hata:", err);
      setReviewError("Yorum kaydedilirken bir hata oluştu.");
    } finally {
      setReviewSaving(false);
    }
  }

  async function handleCancelBooking(b: Booking) {
    if (!canCancelBooking(b)) return;

    const ok = window.confirm("Bu rezervasyonu iptal etmek istediğine emin misin?");
    if (!ok) return;

    try {
      setBusyId(b.id);
      setPageError(null);
      setPageMessage(null);

      await updateDoc(doc(db, "bookings", b.id), {
        status: "cancelled",
        cancelledAt: serverTimestamp()
      });

      setBookings((prev) => prev.map((x) => (x.id === b.id ? { ...x, status: "cancelled" } : x)));
      setPageMessage("Rezervasyon iptal edildi.");
    } catch (err) {
      console.error("İptal hatası:", err);
      setPageError("Rezervasyon iptal edilirken hata oluştu.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteCompletedBooking(b: Booking) {
    if (derivedStatus(b) !== "completed") return;

    const ok1 = window.confirm("Bu tamamlanan rezervasyonu silmek istiyor musun?");
    if (!ok1) return;
    const ok2 = window.confirm("Emin misin? Bu işlem geri alınamaz.");
    if (!ok2) return;

    try {
      setBusyId(b.id);
      setPageError(null);
      setPageMessage(null);

      await updateDoc(doc(db, "bookings", b.id), {
        status: "deleted",
        deletedAt: serverTimestamp()
      });

      setBookings((prev) => prev.filter((x) => x.id !== b.id));
      setPageMessage("Tamamlanan rezervasyon listenden kaldırıldı.");
    } catch (err) {
      console.error("Silme hatası:", err);
      setPageError("Rezervasyon silinirken hata oluştu.");
    } finally {
      setBusyId(null);
    }
  }
  return (
    <Protected allowedRoles={["guest"]}>
      <div className="container-page space-y-6">
        {/* Promo */}
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-slate-200">
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-semibold text-white">Biddakika</span>
            <span className="text-slate-300">{promoLine}</span>
          </div>
        </div>

        {/* Header + Summary */}
        <section className="space-y-3">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold text-slate-100">Rezervasyonlarım</h1>
              <p className="text-sm text-slate-300 max-w-3xl">
                Burada <b>otel + paket</b> rezervasyonların görünür. Detay içinde <b>talep + teklif + final ödeme</b>, iletişim, mesajlaşma ve premium voucher bulunur.
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 w-full md:w-auto">
              <StatCard title="Rezervasyon" value={`${summary.count}`} />
              <StatCard title="Toplam gece" value={`${summary.totalNights}`} />
              <StatCard title="Toplam (final)" value={`${summary.totalSpend.toLocaleString("tr-TR")} ₺`} strong />
              <StatCard title="En sık şehir" value={summary.topCity} />
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            ✅ Bu sayfa “kanıt dosyası” mantığında: Talep + teklif + final ödeme + iletişim + mesaj her şey tek ekranda.
          </div>

          {/* Filters */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3 shadow shadow-slate-950/40">
            <div className="grid gap-3 md:grid-cols-12 items-end">
              <div className="md:col-span-4 space-y-1">
                <label className="text-[0.7rem] text-slate-300">Ara</label>
                <input
                  value={qText}
                  onChange={(e) => setQText(e.target.value)}
                  placeholder="Paket adı / otel / şehir / rezervasyon no / ödeme / tel..."
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
                />
              </div>

              <div className="md:col-span-2 space-y-1">
                <label className="text-[0.7rem] text-slate-300">Durum</label>
                <select
                  value={statusF}
                  onChange={(e) => setStatusF(e.target.value as any)}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
                >
                  <option value="all">Tümü</option>
                  <option value="active">Aktif</option>
                  <option value="completed">Tamamlandı</option>
                  <option value="cancelled">İptal</option>
                </select>
              </div>

              <div className="md:col-span-2 space-y-1">
                <label className="text-[0.7rem] text-slate-300">Ödeme</label>
                <select
                  value={payF}
                  onChange={(e) => setPayF(e.target.value as any)}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
                >
                  <option value="all">Tümü</option>
                  <option value="paid">Ödendi</option>
                  <option value="unpaid">Bekliyor</option>
                </select>
              </div>

              <div className="md:col-span-2 space-y-1">
                <label className="text-[0.7rem] text-slate-300">Check-in (min)</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
                />
              </div>

              <div className="md:col-span-2 space-y-1">
                <label className="text-[0.7rem] text-slate-300">Check-out (max)</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
                />
              </div>

              <div className="md:col-span-3 space-y-1">
                <label className="text-[0.7rem] text-slate-300">Min fiyat (final)</label>
                <input
                  value={minPrice}
                  onChange={(e) => setMinPrice(e.target.value)}
                  placeholder="Örn: 5000"
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
                />
              </div>

              <div className="md:col-span-3 space-y-1">
                <label className="text-[0.7rem] text-slate-300">Max fiyat (final)</label>
                <input
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                  placeholder="Örn: 25000"
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
                />
              </div>

              <div className="md:col-span-6 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <div className="text-[0.75rem] text-slate-400">
                  Sonuç: <span className="text-slate-100 font-semibold">{filteredBookings.length}</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[0.75rem] text-slate-400">Sırala</span>
                  <select
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as any)}
                    className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
                  >
                    <option value="created_desc">Oluşturma (yeni→eski)</option>
                    <option value="checkin_asc">Check-in (en yakın)</option>
                    <option value="checkout_asc">Check-out (en yakın)</option>
                    <option value="price_desc">Tutar (yüksek→düşük)</option>
                  </select>

                  <button
                    type="button"
                    onClick={() => {
                      setQText("");
                      setStatusF("all");
                      setPayF("all");
                      setFromDate("");
                      setToDate("");
                      setMinPrice("");
                      setMaxPrice("");
                      setSortKey("created_desc");
                    }}
                    className="rounded-md border border-slate-700 px-3 py-2 text-[0.8rem] text-slate-200 hover:border-slate-500"
                  >
                    Temizle
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {(pageError || pageMessage) && (
          <section className="space-y-1 text-xs">
            {pageError && <p className="text-red-200 bg-red-500/10 border border-red-500/40 rounded-md px-3 py-2">{pageError}</p>}
            {pageMessage && <p className="text-emerald-200 bg-emerald-500/10 border border-emerald-500/40 rounded-md px-3 py-2">{pageMessage}</p>}
          </section>
        )}

        {loading && <p className="text-sm text-slate-400">Rezervasyonlar yükleniyor...</p>}
        {!loading && filteredBookings.length === 0 && <p className="text-sm text-slate-400">Rezervasyon bulunamadı.</p>}

        {filteredBookings.length > 0 && (
          <section className="rounded-2xl border border-slate-800 bg-slate-950/80 shadow shadow-slate-950/40 text-xs overflow-hidden">
            <div className="hidden md:grid grid-cols-[2fr_1.6fr_1.4fr_1.2fr_auto] bg-slate-900 text-[0.75rem] font-semibold text-slate-100 px-4 py-2">
              <div>Tesis / Paket</div>
              <div>Tarih / kişi</div>
              <div>Ödeme & iptal</div>
              <div>Kalan süre</div>
              <div className="text-right">İşlemler</div>
            </div>

            {filteredBookings.map((b) => {
              const createdStr = b.createdAt?.toDate ? b.createdAt.toDate().toLocaleString("tr-TR") : "—";
              const nights = b.nights ?? calcNights(b.checkIn, b.checkOut);
              const st = derivedStatus(b);
              const cd = checkInCountdown(b.checkIn);

              const pkg = isPackageBooking(b);
              const title = pkgTitle(b);

              const mapsUrl = pkg ? null : buildMapsUrl(b, b.hotelId ? hotelMap[b.hotelId] : null);

              const city = pkg ? (b.requestSnapshot?.city || b.city) : (b.hotelCity || b.city);
              const district = pkg ? (b.requestSnapshot?.district || b.district) : (b.hotelDistrict || b.district);

              const finalAmount = safeNum(b.finalAmount ?? b.totalPrice, 0);
              const finalCurrency = safeStr(b.finalCurrency ?? b.currency, "TRY");

              const cancelText = cancellationPolicyTextFromBooking(b);

              return (
                <div key={b.id} className="border-t border-slate-800">
                  <div className="grid md:grid-cols-[2fr_1.6fr_1.4fr_1.2fr_auto] gap-2 px-4 py-3 items-start">
                    {/* Tesis / Paket */}
                    <div className="space-y-1">
                      <div className="text-slate-100 text-sm font-semibold flex items-center gap-2 flex-wrap">
                        {pkg ? (
                          <>
                            <span className="inline-flex items-center rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[0.7rem] text-indigo-200">
                              🧳 Paket
                            </span>
                            <span className="text-slate-100 font-semibold">{title}</span>
                          </>
                        ) : (
                          <span className="text-slate-100 font-semibold">{safeStr(b.hotelName, "Tesis")}</span>
                        )}

                        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[0.7rem] ${statusClass(b)}`}>
                          {statusText(b)}
                        </span>

                        <span className="inline-flex items-center rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 text-[0.7rem] text-slate-200">
                          Final kaynak: <b className="ml-1 text-white">{safeStr(b.finalSource, "—")}</b>
                        </span>
                      </div>

                      <div className="text-[0.75rem] text-slate-300">
                        {safeStr(city)}
                        {district ? ` / ${safeStr(district)}` : ""}
                      </div>

                      {!pkg && b.hotelAddress && <div className="text-[0.72rem] text-slate-500">Adres: {b.hotelAddress}</div>}

                      {!pkg && mapsUrl && (
                        <a className="text-[0.72rem] text-sky-300 hover:underline" href={mapsUrl} target="_blank" rel="noreferrer">
                          Konumu aç (Maps)
                        </a>
                      )}

                      <div className="text-[0.7rem] text-slate-500">
                        Rezervasyon No: <span className="text-slate-200">{b.id}</span> • Oluşturma: {createdStr}
                      </div>

                      {!pkg && (b.hotelPhone || b.hotelEmail) && (
                        <div className="text-[0.72rem] text-slate-400">
                          İletişim: <span className="text-slate-200">{safeStr(b.hotelPhone, "")}</span>
                          {b.hotelEmail ? <span className="text-slate-300"> • {b.hotelEmail}</span> : null}
                        </div>
                      )}

                      {pkg && (b.agencySnapshot?.phone || b.agencySnapshot?.businessName || b.agencySnapshot?.displayName) ? (
                        <div className="text-[0.72rem] text-slate-400">
                          Acenta: <span className="text-slate-200">{safeStr(b.agencySnapshot?.businessName || b.agencySnapshot?.displayName)}</span>
                          {b.agencySnapshot?.phone ? <span className="text-slate-300"> • {safeStr(b.agencySnapshot?.phone)}</span> : null}
                        </div>
                      ) : null}

                      {cancelText ? <div className="text-[0.72rem] text-slate-400">İptal: {cancelText}</div> : null}
                    </div>

                    {/* Tarih */}
                    <div className="space-y-1 text-slate-100">
                      <p className="text-[0.9rem] font-semibold">
                        {b.checkIn} – {b.checkOut} <span className="text-slate-400 text-[0.75rem]">• {nights} gece</span>
                      </p>
                      <div className="flex flex-wrap gap-2 mt-1">
  <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-950/60 px-2 py-0.5 text-[0.65rem] text-slate-200">
    Check-in: {safeStr(b.checkInTime, "—")}
  </span>

  <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-950/60 px-2 py-0.5 text-[0.65rem] text-slate-200">
    Check-out: {safeStr(b.checkOutTime, "12:00")}
  </span>

  {b.sameDayStay && (
    <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[0.65rem] text-amber-200">
      Aynı gün
    </span>
  )}

  {b.earlyCheckInWanted && (
    <span className="inline-flex items-center rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[0.65rem] text-sky-200">
      Erken giriş: {safeStr(b.earlyCheckInTime, "—")}
    </span>
  )}

  {b.lateCheckOutWanted && (
    <span className="inline-flex items-center rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[0.65rem] text-sky-200">
      Geç çıkış: {safeStr(b.lateCheckOutFrom, "—")} - {safeStr(b.lateCheckOutTo, "—")}
    </span>
  )}
</div>

                      <p className="text-[0.75rem] text-slate-300">
                        {safeNum(b.adults, 0) + safeNum(b.childrenCount, 0)} kişi • {safeStr(b.roomsCount || 1)} oda
                      </p>
                      {Array.isArray(b.childrenAges) && b.childrenAges.length > 0 && (
                        <p className="text-[0.72rem] text-slate-500">Çocuk yaşları: {b.childrenAges.join(", ")}</p>
                      )}
                    </div>

                    {/* Ödeme (FINAL) */}
                    <div className="space-y-1 text-slate-100">
                      <p className="text-[0.95rem] font-extrabold text-emerald-300">
                        {fmtMoney(finalAmount, finalCurrency)}
                      </p>
                      <p className="text-[0.75rem] text-slate-400">Ödeme: {paymentMethodText(b.paymentMethod)}</p>
                      <p className="text-[0.75rem] text-slate-400">Durum: {safeStr(b.paymentStatus)}</p>
                      <p className="text-[0.7rem] text-slate-500">
                        {isPaidText(b.paymentStatus) ? "✅ Ödendi" : "⏳ Bekliyor"}
                      </p>
                    </div>

                    {/* Kalan süre */}
                    <div className="space-y-1">
                      <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[0.75rem] ${pillTone(cd.tone as any)}`}>
                        ⏱️ {cd.label}
                      </span>
                      {st === "completed" && <div className="text-[0.72rem] text-slate-400">Konaklama bitti ✅</div>}
                      {st === "cancelled" && <div className="text-[0.72rem] text-red-200">İptal edildi</div>}
                    </div>

                    {/* Actions */}
                    <div className="flex md:flex-col flex-col gap-2 items-end">
                      <button
                        type="button"
                        onClick={() => openVoucher(b)}
                        className="w-full md:w-auto rounded-md bg-sky-500 text-white px-3 py-2 text-[0.75rem] font-semibold hover:bg-sky-400"
                      >
                        Voucher / Detay
                      </button>

                      {canMessageBooking(b) ? (
                        <button
                          type="button"
                          onClick={() => openMessageModal(b)}
                          className="w-full md:w-auto inline-flex items-center justify-center rounded-md border border-emerald-500/70 px-3 py-2 text-[0.75rem] text-emerald-300 hover:bg-emerald-500/10"
                        >
                          Mesajlar
                        </button>
                      ) : (
                        <span className="text-[0.7rem] text-slate-500">Mesajlaşma kapalı</span>
                      )}

                      {!pkg && canCancelBooking(b) && (
                        <button
                          type="button"
                          onClick={() => handleCancelBooking(b)}
                          disabled={busyId === b.id}
                          className="w-full md:w-auto rounded-md bg-amber-500 text-slate-950 px-3 py-2 text-[0.75rem] font-semibold hover:bg-amber-400 disabled:opacity-60"
                        >
                          {busyId === b.id ? "İptal ediliyor..." : "İptal et"}
                        </button>
                      )}

                      {!pkg && canReviewBooking(b) && (
                        <button
                          type="button"
                          onClick={() => openReviewModal(b)}
                          className="w-full md:w-auto rounded-md border border-emerald-500/70 px-3 py-2 text-[0.75rem] text-emerald-300 hover:bg-emerald-500/10"
                        >
                          Yorum yap
                        </button>
                      )}

                      {derivedStatus(b) === "completed" && (
                        <button
                          type="button"
                          onClick={() => handleDeleteCompletedBooking(b)}
                          disabled={busyId === b.id}
                          className="w-full md:w-auto rounded-md border border-red-500/50 px-3 py-2 text-[0.75rem] text-red-200 hover:bg-red-500/10 disabled:opacity-60"
                        >
                          {busyId === b.id ? "Siliniyor..." : "Sil (tamamlandı)"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {/* MESSAGE MODAL */}
        {messageOpen && messageBooking && profile && (
          <BookingMessageModalGuest
            booking={messageBooking}
            currentUserId={profile.uid}
            messageText={messageText}
            setMessageText={setMessageText}
            sending={messageSending}
            error={messageError}
            success={messageSuccess}
            onSubmit={handleSendMessage}
            onClose={closeMessageModal}
          />
        )}

        {/* VOUCHER: otel + paket */}
        {voucherOpen && voucherBooking && profile && (
          isPackageBooking(voucherBooking) ? (
            <PackageVoucherModal booking={voucherBooking} guestProfile={profile} onClose={closeVoucher} />
          ) : (
            <HotelVoucherModal
              booking={voucherBooking}
              guestProfile={profile}
              hotel={voucherBooking.hotelId ? hotelMap[voucherBooking.hotelId] : undefined}
              onOpenRoom={(roomName) => openRoomDetail(voucherBooking, roomName)}
              onClose={closeVoucher}
            />
          )
        )}

        {/* ROOM DETAIL */}
        {roomOpen && roomBooking && roomTypeName && (
          <RoomTypeModal
            booking={roomBooking}
            hotel={roomBooking.hotelId ? hotelMap[roomBooking.hotelId] : undefined}
            roomName={roomTypeName}
            onClose={closeRoomDetail}
          />
        )}

        {/* REVIEW */}
        {reviewOpen && reviewBooking && (
          <BookingReviewModal
            booking={reviewBooking}
            rating={reviewRating}
            setReviewRating={setReviewRating}
            reviewText={reviewText}
            setReviewText={setReviewText}
            saving={reviewSaving}
            error={reviewError}
            success={reviewSuccess}
            onClose={closeReviewModal}
            onSubmit={handleSendReview}
          />
        )}
      </div>
    </Protected>
  );
}
/* =======================
   MESSAGE MODAL (GUEST)
======================= */
function BookingMessageModalGuest({
  booking,
  currentUserId,
  messageText,
  setMessageText,
  sending,
  error,
  success,
  onSubmit,
  onClose
}: {
  booking: Booking;
  currentUserId: string;
  messageText: string;
  setMessageText: (v: string) => void;
  sending: boolean;
  error: string | null;
  success: string | null;
  onSubmit: (e: FormEvent) => void;
  onClose: () => void;
}) {
  const db = getFirestoreDb();
  const [messages, setMessages] = useState<BookingMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(true);

  useEffect(() => {
    const qRef = query(collection(db, "bookingMessages"), where("bookingId", "==", booking.id));

    const unsub = onSnapshot(
      qRef,
      async (snap) => {
        const msgs: BookingMessage[] = snap.docs.map((d) => {
          const v = d.data() as any;
          return {
            id: d.id,
            bookingId: v.bookingId,
            hotelId: v.hotelId ?? null,
            agencyId: v.agencyId ?? null,
            guestId: v.guestId ?? null,
            senderRole: v.senderRole,
            text: v.text,
            createdAt: v.createdAt,
            read: v.read
          };
        });

        msgs.sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
        setMessages(msgs);
        setLoadingMessages(false);

        // karşı tarafın unread mesajlarını okundu yap
        const unreadOtherMsgs = snap.docs.filter((d) => {
          const v = d.data() as any;
          return v.senderRole !== "guest" && v.read === false;
        });

        for (const dSnap of unreadOtherMsgs) {
          try {
            await updateDoc(dSnap.ref, { read: true });
          } catch {}
        }
      },
      () => setLoadingMessages(false)
    );

    return () => unsub();
  }, [db, booking.id]);
function buildAutoTimeNote(b: any) {
  const parts: string[] = [];

  const checkInTime = safeStr(b?.checkInTime, "");
  const checkOutTime = safeStr(b?.checkOutTime, "");

  if (checkInTime) parts.push(`Check-in saati: ${checkInTime}`);
  if (checkOutTime) parts.push(`Check-out saati: ${checkOutTime}`);

  if (b?.sameDayStay) parts.push("Aynı gün konaklama");

  if (b?.earlyCheckInWanted) {
    parts.push(`Erken giriş istiyoruz: ${safeStr(b?.earlyCheckInTime, "—")}`);
  }

  if (b?.lateCheckOutWanted) {
    parts.push(`Geç çıkış istiyoruz: ${safeStr(b?.lateCheckOutFrom, "—")} - ${safeStr(b?.lateCheckOutTo, "—")}`);
  }

  // hiçbir şey yoksa boş dön
  if (!parts.length) return "";

  return `⏱️ Talep özeti:\n- ${parts.join("\n- ")}`;
}

  const messagingClosed = !canMessageBooking(booking);
  const pkg = isPackageBooking(booking);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative mt-16 w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-xl shadow-slate-950/60 text-sm space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-100">{pkg ? "Acentayla mesajlaş" : "Otelle mesajlaş"}</h2>
            <p className="text-[0.78rem] text-slate-400">
              {pkg ? `Paket: ${pkgTitle(booking)}` : safeStr(booking.hotelName)} • {booking.checkIn} – {booking.checkOut}
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
  <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-950/60 px-2 py-0.5 text-[0.65rem] text-slate-200">
    Check-in: {safeStr((booking as any).checkInTime, "—")}
  </span>

  <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-950/60 px-2 py-0.5 text-[0.65rem] text-slate-200">
    Check-out: {safeStr((booking as any).checkOutTime, "12:00")}
  </span>

  {!!(booking as any).sameDayStay && (
    <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[0.65rem] text-amber-200">
      Aynı gün
    </span>
  )}

  {!!(booking as any).earlyCheckInWanted && (
    <span className="inline-flex items-center rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[0.65rem] text-sky-200">
      Erken giriş: {safeStr((booking as any).earlyCheckInTime, "—")}
    </span>
  )}

  {!!(booking as any).lateCheckOutWanted && (
    <span className="inline-flex items-center rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[0.65rem] text-sky-200">
      Geç çıkış: {safeStr((booking as any).lateCheckOutFrom, "—")} - {safeStr((booking as any).lateCheckOutTo, "—")}
    </span>
  )}
</div>

          </div>
          <button onClick={onClose} className="text-[0.85rem] text-slate-400 hover:text-slate-200">
            ✕ Kapat
          </button>
        </div>

        {messagingClosed && (
          <div className="text-[0.8rem] text-amber-200 bg-amber-500/10 border border-amber-500/40 rounded-md px-3 py-2">
            Bu rezervasyon aktif olmadığı için mesajlaşma kapalı.
          </div>
        )}

        <div className="rounded-xl border border-slate-800 bg-slate-900/40 h-64 overflow-y-auto px-3 py-3 space-y-2">
          {loadingMessages && <p className="text-[0.8rem] text-slate-400">Mesajlar yükleniyor...</p>}
          {!loadingMessages && messages.length === 0 && <p className="text-[0.8rem] text-slate-400">Henüz mesaj yok.</p>}

          {messages.map((m) => {
            const isGuest = m.senderRole === "guest";
            const timeStr = m.createdAt?.toDate ? m.createdAt.toDate().toLocaleString("tr-TR") : "";
            return (
              <div key={m.id} className={`flex ${isGuest ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[82%] rounded-2xl px-3 py-2 text-[0.85rem] shadow ${isGuest ? "bg-emerald-500 text-slate-950 rounded-br-none" : "bg-slate-800 text-slate-100 rounded-bl-none"}`}>
                  <p className="whitespace-pre-wrap">{m.text}</p>
                  <p className="mt-1 text-[0.65rem] opacity-70">{timeStr}</p>
                </div>
              </div>
            );
          })}
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1">
            <label className="text-[0.75rem] text-slate-200">Yeni mesaj</label>
            <textarea
              rows={3}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              disabled={messagingClosed}
              className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm resize-none disabled:opacity-60 outline-none focus:border-emerald-400"
placeholder={
  pkg
    ? "Örn: Programda değişiklik mümkün mü?"
    : ((booking as any).lateCheckOutWanted || (booking as any).earlyCheckInWanted)
      ? "Örn: Erken giriş / geç çıkış talebimizi teyit edebilir misiniz?"
      : "Örn: Geç giriş yapacağız, mümkün mü?"
}
            />
          </div>

          {error && <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[0.8rem] text-red-200">{error}</div>}
          {success && <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[0.8rem] text-emerald-200">{success}</div>}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md border border-slate-700 px-3 py-2 text-[0.8rem] text-slate-200 hover:border-slate-500">
              Kapat
            </button>
            <button type="submit" disabled={sending || messagingClosed} className="rounded-md bg-emerald-500 text-slate-950 px-4 py-2 text-[0.8rem] font-semibold hover:bg-emerald-400 disabled:opacity-60">
              {sending ? "Gönderiliyor..." : "Gönder"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* =======================
   REVIEW MODAL
======================= */
function BookingReviewModal({
  booking,
  rating,
  setReviewRating,
  reviewText,
  setReviewText,
  saving,
  error,
  success,
  onClose,
  onSubmit
}: {
  booking: Booking;
  rating: number;
  setReviewRating: (v: number) => void;
  reviewText: string;
  setReviewText: (v: string) => void;
  saving: boolean;
  error: string | null;
  success: string | null;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative mt-16 w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-xl shadow-slate-950/60 text-sm space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-100">Yorum yap</h2>
            <p className="text-[0.78rem] text-slate-400">
              {safeStr(booking.hotelName)} • {booking.checkIn} – {booking.checkOut}
            </p>
          </div>
          <button onClick={onClose} className="text-[0.85rem] text-slate-400 hover:text-slate-200">
            ✕ Kapat
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1">
            <label className="text-[0.75rem] text-slate-200">Puan</label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setReviewRating(star)}
                  className={`w-9 h-9 rounded-full text-sm font-semibold ${rating >= star ? "bg-amber-400 text-slate-950" : "bg-slate-800 text-slate-300"}`}
                >
                  {star}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[0.75rem] text-slate-200">Yorum</label>
            <textarea
              rows={4}
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
              className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm resize-none outline-none focus:border-emerald-400"
              placeholder="Konaklama deneyimini yaz..."
            />
          </div>

          {error && <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[0.8rem] text-red-200">{error}</div>}
          {success && <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[0.8rem] text-emerald-200">{success}</div>}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md border border-slate-700 px-3 py-2 text-[0.8rem] text-slate-200 hover:border-slate-500">
              İptal
            </button>
            <button type="submit" disabled={saving} className="rounded-md bg-emerald-500 text-slate-950 px-4 py-2 text-[0.8rem] font-semibold hover:bg-emerald-400 disabled:opacity-60">
              {saving ? "Gönderiliyor..." : "Gönder"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* =======================
   ROOM TYPE MODAL
======================= */
function RoomTypeModal({
  booking,
  hotel,
  roomName,
  onClose
}: {
  booking: Booking;
  hotel?: HotelDoc;
  roomName: string;
  onClose: () => void;
}) {
  const room = findRoomTypeByName(hotel, roomName);
  const title = safeStr(room?.name ?? room?.title ?? room?.roomTypeName ?? roomName, "Oda");

  const images: string[] =
    ((room?.images as string[]) ||
      (room?.gallery as string[]) ||
      (room?.photos as string[]) ||
      (room?.imageUrls as string[]) ||
      []) ?? [];

  const desc = safeStr(room?.description ?? room?.desc ?? room?.details, "Açıklama bulunamadı.");
  const capacity = safeStr(room?.capacity ?? room?.maxGuests, "—");
  const size = safeStr(room?.size ?? room?.sqm, "—");
  const bed = safeStr(room?.bedType ?? room?.beds, "—");

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/70">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative mt-10 w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-2xl max-h-[85vh] overflow-y-auto space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-100">{title}</h3>
            <p className="text-[0.75rem] text-slate-400">
              Tesis: <span className="text-slate-200">{safeStr(booking.hotelName)}</span>
            </p>
          </div>
          <button onClick={onClose} className="rounded-full border border-slate-700 bg-slate-900 px-3 py-2 text-[0.75rem] text-slate-300 hover:border-emerald-400">
            Kapat ✕
          </button>
        </div>

        {images.length > 0 ? (
          <div className="grid gap-2 md:grid-cols-3">
            {images.slice(0, 6).map((src, i) => (
              <div key={i} className="rounded-xl overflow-hidden border border-slate-800 bg-slate-900/40">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`${title} ${i + 1}`} className="w-full h-32 object-cover" />
              </div>
            ))}
          </div>
        ) : (
          
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-slate-400 text-sm">Bu oda için görsel bulunamadı.</div>
        )}

        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-2">
          <p className="text-[0.75rem] text-slate-400">Oda bilgileri</p>
          <div className="grid gap-2 md:grid-cols-3">
            <MiniField label="Kapasite" value={String(capacity)} />
            <MiniField label="Boyut" value={String(size)} />
            <MiniField label="Yatak" value={String(bed)} />
          </div>
{((booking as any).earlyCheckInWanted || (booking as any).lateCheckOutWanted || (booking as any).sameDayStay) && (
  <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-[0.75rem] text-slate-300">
    ⏱️ Talep notu:{" "}
    {(booking as any).sameDayStay ? "Aynı gün • " : ""}
    {(booking as any).earlyCheckInWanted ? `Erken giriş: ${safeStr((booking as any).earlyCheckInTime, "—")} • ` : ""}
    {(booking as any).lateCheckOutWanted ? `Geç çıkış: ${safeStr((booking as any).lateCheckOutFrom, "—")} - ${safeStr((booking as any).lateCheckOutTo, "—")}` : ""}
  </div>
)}

          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
            <p className="text-[0.72rem] text-slate-400">Açıklama</p>
            <p className="text-slate-100 text-sm whitespace-pre-wrap mt-1">{desc}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
/* =======================
   VOUCHER TEXT BUILDERS
======================= */

function buildGuestShareText(booking: Booking, guestProfile: any, mapsUrl?: string | null) {
  const nights = booking.nights ?? calcNights(booking.checkIn, booking.checkOut);
  const totalGuests = safeNum(booking.adults, 0) + safeNum(booking.childrenCount, 0);
  const finalAmount = safeNum(booking.finalAmount ?? booking.totalPrice, 0);
  const currency = safeStr(booking.finalCurrency ?? booking.currency, "TRY");

  const lines: string[] = [];
  lines.push("✅ Biddakika — Rezervasyon Bilgilerim");
  lines.push(`📌 Rezervasyon No: ${booking.id}`);
  lines.push("");
  lines.push(`🏨 ${isPackageBooking(booking) ? "Paket" : "Tesis"}: ${isPackageBooking(booking) ? pkgTitle(booking) : safeStr(booking.hotelName)}`);
  lines.push(`📍 Konum: ${safeStr(booking.hotelCity || booking.city)}${booking.hotelDistrict ? " / " + booking.hotelDistrict : ""}`);
  if (booking.hotelAddress) lines.push(`🧭 Adres: ${booking.hotelAddress}`);
  if (mapsUrl) lines.push(`🗺️ Harita: ${mapsUrl}`);
  lines.push("");
  lines.push(`🗓️ Tarih: ${safeStr(booking.checkIn)} → ${safeStr(booking.checkOut)} (${nights} gece)`);
  lines.push(`🕒 Check-in saati: ${safeStr(booking.checkInTime, "—")}`);
lines.push(`🕛 Check-out saati: ${safeStr(booking.checkOutTime, "12:00")}`);

if (booking.sameDayStay) lines.push("⚡ Aynı gün konaklama");
if (booking.earlyCheckInWanted) lines.push(`🌅 Erken giriş: ${safeStr(booking.earlyCheckInTime, "—")}`);
if (booking.lateCheckOutWanted) lines.push(`🌙 Geç çıkış: ${safeStr(booking.lateCheckOutFrom, "—")} - ${safeStr(booking.lateCheckOutTo, "—")}`);
lines.push("");

  lines.push(`👥 Kişi: ${totalGuests} • Oda: ${safeStr(booking.roomsCount || 1)}`);
  if (Array.isArray(booking.childrenAges) && booking.childrenAges.length) lines.push(`🧒 Çocuk yaşları: ${booking.childrenAges.join(", ")}`);
  lines.push("");
  lines.push(`💳 Ödeme (SON): ${fmtMoney(finalAmount, currency)}`);
  lines.push(`🔐 Yöntem: ${paymentMethodText(booking.paymentMethod)}`);
  lines.push(`📎 Durum: ${safeStr(booking.paymentStatus)}`);
  lines.push("");
  lines.push(`👤 Misafir: ${safeStr(guestProfile?.displayName || booking.guestName)}`);
  if (guestProfile?.email) lines.push(`✉️ ${guestProfile.email}`);
  return lines.join("\n");
}

function buildVoucherText(booking: Booking, guestProfile: any, mapsUrl?: string | null) {
  const nights = booking.nights ?? calcNights(booking.checkIn, booking.checkOut);
  const finalAmount = safeNum(booking.finalAmount ?? booking.totalPrice, 0);
  const currency = safeStr(booking.finalCurrency ?? booking.currency, "TRY");
  const cancelText = cancellationPolicyTextFromBooking(booking);

  const lines: string[] = [];
  lines.push("Biddakika — Voucher / Rezervasyon Bilgi Dosyası");
  lines.push(`Rezervasyon No: ${booking.id}`);
  lines.push(`Tür: ${isPackageBooking(booking) ? "Paket" : "Otel"}`);
  lines.push("");

  if (isPackageBooking(booking)) {
    lines.push(`Paket: ${pkgTitle(booking)}`);
    const city = booking.requestSnapshot?.city || booking.city;
    const district = booking.requestSnapshot?.district || booking.district;
    lines.push(`Lokasyon: ${safeStr(city)}${district ? " / " + safeStr(district) : ""}`);
  } else {
    lines.push(`Tesis: ${safeStr(booking.hotelName)}`);
    lines.push(`Konum: ${safeStr(booking.hotelCity || booking.city)}${booking.hotelDistrict ? " / " + booking.hotelDistrict : ""}`);
    if (booking.hotelAddress) lines.push(`Adres: ${booking.hotelAddress}`);
    if (mapsUrl) lines.push(`Harita: ${mapsUrl}`);
  }

  lines.push("");
  lines.push(`Tarih: ${safeStr(booking.checkIn)} – ${safeStr(booking.checkOut)} (${nights} gece)`);
  lines.push(`Check-in saati: ${safeStr(booking.checkInTime, "—")}`);
lines.push(`Check-out saati: ${safeStr(booking.checkOutTime, "12:00")}`);
if (booking.sameDayStay) lines.push("Aynı gün konaklama: Evet");
if (booking.earlyCheckInWanted) lines.push(`Erken giriş: ${safeStr(booking.earlyCheckInTime, "—")}`);
if (booking.lateCheckOutWanted) lines.push(`Geç çıkış: ${safeStr(booking.lateCheckOutFrom, "—")} - ${safeStr(booking.lateCheckOutTo, "—")}`);
lines.push("");

  lines.push(`Kişi/Oda: ${safeStr(booking.adults, "0")} yetişkin • ${safeStr(booking.childrenCount, "0")} çocuk • ${safeStr(booking.roomsCount, "1")} oda`);
  if (Array.isArray(booking.childrenAges) && booking.childrenAges.length) lines.push(`Çocuk yaşları: ${booking.childrenAges.join(", ")}`);

  lines.push("");
  lines.push(`Ödeme (SON / GEÇERLİ): ${fmtMoney(finalAmount, currency)}`);
  lines.push(`Ödeme yöntemi: ${paymentMethodText(booking.paymentMethod)}`);
  lines.push(`Ödeme durumu: ${safeStr(booking.paymentStatus)}`);
  if (cancelText) lines.push(`İptal: ${cancelText}`);

  if (!isPackageBooking(booking)) {
    lines.push("");
    lines.push("Otel iletişim:");
    if (booking.hotelContactName) lines.push(`Yetkili: ${booking.hotelContactName}`);
    if (booking.hotelPhone) lines.push(`Telefon: ${booking.hotelPhone}`);
    if (booking.hotelWhatsapp) lines.push(`WhatsApp: ${booking.hotelWhatsapp}`);
    if (booking.hotelEmail) lines.push(`E-posta: ${booking.hotelEmail}`);
    if (booking.hotelWebsite) lines.push(`Web: ${booking.hotelWebsite}`);
  } else {
    lines.push("");
    lines.push("Acenta:");
    lines.push(safeStr(booking.agencySnapshot?.businessName || booking.agencySnapshot?.displayName, "—"));
    if (booking.agencySnapshot?.phone) lines.push(`Telefon: ${booking.agencySnapshot.phone}`);
    if (booking.offerNote) lines.push(`Teklif notu: ${booking.offerNote}`);
  }

  if (Array.isArray(booking.roomBreakdown) && booking.roomBreakdown.length) {
    lines.push("");
    lines.push("Oda / Kırılım:");
    booking.roomBreakdown.forEach((rb) => {
      const n = rb.nights ?? nights;
      const nightly = safeNum(rb.nightlyPrice, 0);
      const total = safeNum(rb.totalPrice, nightly * n);
      const rn = safeStr(rb.roomTypeName || rb.roomName || "Oda");
      lines.push(`• ${rn} — ${n} gece x ${fmtMoney(nightly, currency)} = ${fmtMoney(total, currency)}`);
    });
  }

  lines.push("");
  lines.push("Misafir:");
  lines.push(`Ad Soyad: ${safeStr(guestProfile?.displayName || booking.guestName)}`);
  if (guestProfile?.email) lines.push(`E-posta: ${guestProfile.email}`);

  // KVKK: misafir ekranında ham raw yok.
  return lines.join("\n");
}

function handlePrintVoucher(booking: Booking, guestProfile: any, mapsUrl?: string | null) {
  const nights = booking.nights ?? calcNights(booking.checkIn, booking.checkOut);
  const finalAmount = safeNum(booking.finalAmount ?? booking.totalPrice, 0);
  const currency = safeStr(booking.finalCurrency ?? booking.currency, "TRY");
  const paidOk = isPaidText(booking.paymentStatus);

  const base =
    (process.env.NEXT_PUBLIC_APP_URL as string) ||
    (typeof window !== "undefined" ? window.location.origin : "");

  const verifyUrl = `${base}/verify?voucher=1&bookingId=${encodeURIComponent(booking.id)}`;
  const qrImg = `https://chart.googleapis.com/chart?cht=qr&chs=180x180&chl=${encodeURIComponent(verifyUrl)}&chld=L|1`;

  const title = isPackageBooking(booking) ? `Paket Voucher — ${pkgTitle(booking)}` : `Otel Voucher — ${safeStr(booking.hotelName)}`;
  const sub = isPackageBooking(booking)
    ? `${safeStr(booking.requestSnapshot?.city || booking.city)}`
    : `${safeStr(booking.hotelCity || booking.city)}${booking.hotelDistrict ? " / " + booking.hotelDistrict : ""}`;

  const guestName = safeStr(guestProfile?.displayName || booking.guestName);
  const guestEmail = safeStr(guestProfile?.email || "", "—");

  const breakdownRows = (Array.isArray(booking.roomBreakdown) ? booking.roomBreakdown : [])
    .map((rb) => {
      const n = rb.nights ?? nights;
      const nightly = safeNum(rb.nightlyPrice, 0);
      const total = safeNum(rb.totalPrice, nightly * n);
      return `<tr>
        <td><b>${escapeHtml(safeStr(rb.roomTypeName || rb.roomName || "Oda"))}</b></td>
        <td>${n}</td>
        <td>${escapeHtml(fmtMoney(nightly, currency))}</td>
        <td><b>${escapeHtml(fmtMoney(total, currency))}</b></td>
      </tr>`;
    })
    .join("");

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)} - ${escapeHtml(booking.id)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box}
  body{font-family:Inter,Arial,sans-serif;margin:0;background:#f4f6fb;color:#0b1220}
  .page{max-width:980px;margin:24px auto;padding:0 18px}
  .paper{background:#fff;border:1px solid #e6e8f0;border-radius:18px;box-shadow:0 12px 30px rgba(14,23,55,.10);overflow:hidden;position:relative}
  .topbar{padding:16px 18px;background:linear-gradient(90deg,#0ea5e9,#22c55e);color:#fff;display:flex;align-items:center;justify-content:space-between;gap:14px}
  .brand h1{margin:0;font-size:16px;font-weight:800}
  .brand p{margin:2px 0 0;font-size:12px;opacity:.95}
  .badgeRow{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}
  .badge{padding:7px 10px;border-radius:12px;font-size:12px;font-weight:800;border:1px solid rgba(255,255,255,.30);background:rgba(0,0,0,.18)}
  .body{padding:16px 18px 18px}
  .grid{display:grid;grid-template-columns:1.6fr .9fr;gap:12px}
  .card{border:1px solid #e6e8f0;border-radius:16px;padding:12px}
  .label{font-size:11px;color:#64748b;margin:0 0 6px}
  .val{margin:0;font-size:13px;font-weight:700;line-height:1.35}
  .muted{color:#64748b;font-size:12px}
  .qrbox{display:flex;gap:12px;align-items:center}
  .qrbox img{width:150px;height:150px;border:1px solid #e6e8f0;border-radius:14px;padding:8px}
  .line{height:1px;background:#e6e8f0;margin:14px 0}
  .table{width:100%;border-collapse:separate;border-spacing:0}
  .table th{font-size:11px;color:#64748b;text-align:left;padding:10px;border-bottom:1px solid #e6e8f0}
  .table td{padding:10px;border-bottom:1px solid #f0f2f7;font-size:12px;color:#0b1220;vertical-align:top}
  .pillOk{display:inline-block;padding:6px 10px;border-radius:999px;font-size:11px;font-weight:800;border:1px solid #bbf7d0;background:#ecfdf5;color:#065f46}
  .pillWait{display:inline-block;padding:6px 10px;border-radius:999px;font-size:11px;font-weight:800;border:1px solid #fed7aa;background:#fff7ed;color:#92400e}
  .foot{padding:12px 18px;background:#0b1220;color:#e5e7eb;font-size:11px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}
  .mono{font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace}
</style>
</head>
<body>
  <div class="page">
    <div class="paper">
      <div class="topbar">
        <div class="brand">
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(sub)}</p>
        </div>
        <div class="badgeRow">
          <div class="badge">Belge No: <span class="mono">${escapeHtml(booking.id)}</span></div>
          <div class="badge">Tarih: ${escapeHtml(new Date().toLocaleString("tr-TR"))}</div>
        </div>
      </div>

      <div class="body">
        <div class="grid">
          <div class="card">
            <p class="label">Misafir</p>
            <p class="val">${escapeHtml(guestName)}</p>
            <p class="muted">Check-in: ${escapeHtml(safeStr(booking.checkInTime,"—"))} • Check-out: ${escapeHtml(safeStr(booking.checkOutTime,"12:00"))}</p>
${
  booking.sameDayStay || booking.earlyCheckInWanted || booking.lateCheckOutWanted
    ? `<p class="muted">
        ${booking.sameDayStay ? "Aynı gün • " : ""}
        ${booking.earlyCheckInWanted ? `Erken giriş: ${escapeHtml(safeStr(booking.earlyCheckInTime,"—"))} • ` : ""}
        ${booking.lateCheckOutWanted ? `Geç çıkış: ${escapeHtml(safeStr(booking.lateCheckOutFrom,"—"))} - ${escapeHtml(safeStr(booking.lateCheckOutTo,"—"))}` : ""}
      </p>`
    : ""
}

            <p class="muted">${escapeHtml(guestEmail)}</p>
            <div class="line"></div>
            <p class="label">Tarih</p>
            <p class="val">${escapeHtml(safeStr(booking.checkIn))} – ${escapeHtml(safeStr(booking.checkOut))} (${nights} gece)</p>
            <p class="muted">Kişi: ${safeNum(booking.adults,0) + safeNum(booking.childrenCount,0)} • Oda: ${escapeHtml(safeStr(booking.roomsCount || 1))}</p>
          </div>

          <div class="card">
            <p class="label">Doğrulama / QR</p>
            <div class="qrbox">
              <img src="${qrImg}" alt="qr" />
              <div class="muted" style="word-break:break-all">
                <div><b>Link</b></div>
                <div class="mono">${escapeHtml(verifyUrl)}</div>
                <div style="margin-top:8px">Belge doğrulaması için.</div>
              </div>
            </div>
          </div>
        </div>

        <div class="line"></div>

        <div class="card">
          <p class="label">Ödeme (SON / GEÇERLİ)</p>
          <p class="val">${escapeHtml(fmtMoney(finalAmount, currency))}</p>
          <p class="muted">Yöntem: ${escapeHtml(paymentMethodText(booking.paymentMethod))}</p>
          <p class="muted">Durum: ${escapeHtml(safeStr(booking.paymentStatus))}</p>
          <div style="margin-top:8px">
            <span class="${paidOk ? "pillOk" : "pillWait"}">${paidOk ? "ÖDEME ONAYLI" : "ÖDEME BEKLENİYOR"}</span>
          </div>
        </div>

        ${
          mapsUrl
            ? `<div class="card" style="margin-top:12px">
                <p class="label">Harita</p>
                <div class="mono">${escapeHtml(mapsUrl)}</div>
              </div>`
            : ""
        }

        ${
          breakdownRows
            ? `<div class="card" style="margin-top:12px">
                <p class="label">Oda / Fiyat Kırılımı</p>
                <table class="table">
                  <tr><th>Oda</th><th>Gece</th><th>Birim</th><th>Toplam</th></tr>
                  ${breakdownRows}
                </table>
              </div>`
            : ""
        }

      </div>

      <div class="foot">
        <div>Bu belge Biddakika tarafından üretilmiştir.</div>
        <div class="mono">Belge No: ${escapeHtml(booking.id)}</div>
      </div>
    </div>
  </div>

  <script>window.print();</script>
</body>
</html>`;

  const w = window.open("", "_blank", "width=1100,height=900");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}

/* =======================
   HOTEL VOUCHER MODAL
======================= */
function HotelVoucherModal({
  booking,
  guestProfile,
  hotel,
  onOpenRoom,
  onClose
}: {
  booking: Booking;
  guestProfile: any;
  hotel?: HotelDoc;
  onOpenRoom: (roomName: string) => void;
  onClose: () => void;
}) {
  const nights = booking.nights ?? calcNights(booking.checkIn, booking.checkOut);
  const mapsUrl = buildMapsUrl(booking, hotel || null);
  const shareText = useMemo(() => buildGuestShareText(booking, guestProfile, mapsUrl), [booking, guestProfile, mapsUrl]);
  const voucherText = useMemo(() => buildVoucherText(booking, guestProfile, mapsUrl), [booking, guestProfile, mapsUrl]);

  const hotelImages = (booking.hotelImageUrls || hotel?.imageUrls || []).filter(Boolean);
  const [activeImg, setActiveImg] = useState(0);

  const finalAmount = safeNum(booking.finalAmount ?? booking.totalPrice, 0);
  const currency = safeStr(booking.finalCurrency ?? booking.currency, "TRY");
  const db = getFirestoreDb();

const [reqLoading, setReqLoading] = useState(false);
const [fullRequestDoc, setFullRequestDoc] = useState<any | null>(null);

useEffect(() => {
  let alive = true;

  async function loadReq() {
    try {
      setReqLoading(true);

      if (!booking?.requestId) {
        if (!alive) return;
        setFullRequestDoc(null);
        return;
      }

      // ✅ en temiz: doc + getDoc (hata olasılığı düşük)
      const { getDoc } = await import("firebase/firestore");
      const snap = await getDoc(doc(db, "requests", booking.requestId));

      if (!alive) return;
      setFullRequestDoc(snap.exists() ? snap.data() : null);
    } catch (e) {
      if (!alive) return;
      setFullRequestDoc(null);
    } finally {
      if (!alive) return;
      setReqLoading(false);
    }
  }

  loadReq();
  return () => {
    alive = false;
  };
}, [db, booking?.requestId]);


  async function handleCopy(mode: "share" | "voucher") {
    try {
      await navigator.clipboard.writeText(mode === "share" ? shareText : voucherText);
      alert(mode === "share" ? "Paylaşım metni kopyalandı." : "Voucher metni kopyalandı.");
    } catch {
      alert("Kopyalama sırasında hata oluştu.");
    }
  }
  function KeyValueGrid({ obj }: { obj: Record<string, any> }) {
  const entries = Object.entries(obj || {}).filter(([_, v]) => v !== undefined && v !== null && String(v).trim() !== "");
  if (entries.length === 0) return <div className="text-slate-400 text-sm">Talep detayı bulunamadı.</div>;

  return (
    <div className="grid gap-2 md:grid-cols-2">
      {entries.map(([k, v]) => (
        <div key={k} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <div className="text-[0.7rem] text-slate-400">{k}</div>
          <div className="text-[0.85rem] text-slate-100 font-semibold whitespace-pre-wrap break-words">
            {Array.isArray(v) ? v.join(", ") : typeof v === "object" ? prettyJSON(v) : String(v)}
          </div>
        </div>
      ))}
    </div>
  );
}
{reqLoading ? (
  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-slate-400 text-sm">
    Talep detayları yükleniyor...
  </div>
) : (
  <RequestDetailsBlock booking={booking} requestDoc={fullRequestDoc || undefined} />
)}


type FullRequest = Record<string, any>;

function RequestDetailsBlock({
  booking,
  requestDoc
}: {
  booking: Booking;
  requestDoc?: any;
}) {
  const full = useMemo<FullRequest>(() => buildFullRequestObject(booking, requestDoc), [booking, requestDoc]);

const summary: Record<string, any> = {
  "Talep türü": safeStr(full.type || full.requestType || (isPackageBooking(booking) ? "package" : "hotel")),
  "Şehir / ilçe": `${safeStr(full.city)}${full.district ? " / " + safeStr(full.district) : ""}`,
  "Tarih": `${safeStr(full.checkIn)} → ${safeStr(full.checkOut)}`,
  "Yetişkin": String(safeNum(full.adults, 0)),
  "Çocuk": String(safeNum(full.childrenCount, 0)),
  "Çocuk yaşları": Array.isArray(full.childrenAges) ? full.childrenAges.join(", ") : safeStr(full.childrenAges, ""),
  "Oda sayısı": String(safeNum(full.roomsCount, 1)),
  "Oda tipleri": Array.isArray(full.roomTypes) ? full.roomTypes.join(", ") : safeStr(full.roomTypes, ""),
  "Bütçe / fiyat beklentisi": safeStr(full.budget || full.budgetMin || full.maxPrice || full.priceRange, ""),
  "Not / istekler": safeStr(full.notes, ""),
  "İletişim notu": safeStr(full.contactNote || full.phoneNote, "")
};


  // “her şey” (ham) alanı: misafir kendi datasını görüyor (KVKK sıkıntısı yok)
  // Ama istersen burada maskeleme de yaparız.
  const rawAll = full;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[0.75rem] text-slate-400">Misafir Talebi (tam)</p>
          <p className="text-sm text-slate-200 font-semibold">
            Misafir ne istediyse burada var: seçimler + notlar + detaylar.
          </p>
        </div>
      </div>

<KeyValueGrid obj={full} />

      <details className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
        <summary className="cursor-pointer text-[0.8rem] text-slate-200 font-semibold">
          Tüm alanlar (Ham talep verisi)
        </summary>
        <pre className="mt-3 text-xs text-slate-100 whitespace-pre-wrap">{prettyJSON(rawAll)}</pre>
      </details>
    </div>
  );
}


  const msgSubject = `Rezervasyon Bilgisi — ${booking.id}`;
  const msgBody = shareText;

  const hotelWA = booking.hotelWhatsapp || booking.hotelPhone || "";
  const hotelMail = booking.hotelEmail || "";
  const hotelTel = booking.hotelPhone || "";

  const whatsappHref = hotelWA ? waLink(hotelWA, msgBody) : "";
  const mailHref = hotelMail ? mailLink(hotelMail, msgSubject, msgBody) : "";
  const telHref = hotelTel ? `tel:${String(hotelTel).replace(/\s/g, "")}` : "";

  const cancelText = cancellationPolicyTextFromBooking(booking);
  const roomBreakdown = Array.isArray(booking.roomBreakdown) ? booking.roomBreakdown : [];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative mt-8 w-full max-w-6xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-2xl max-h-[90vh] overflow-y-auto space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-100">Rezervasyon Detayı / Voucher</h2>
            <p className="text-[0.78rem] text-slate-400">
              Rezervasyon No: <span className="text-slate-200 font-semibold">{booking.id}</span>
              <span className="ml-2 text-slate-500">•</span>
              <span className="ml-2 text-slate-300">Final kaynak: <b className="text-white">{safeStr(booking.finalSource, "—")}</b></span>
            </p>
            <p className="text-[0.8rem] text-emerald-200">
              ✅ SON / GEÇERLİ ÖDEME: <b className="text-white">{fmtMoney(finalAmount, currency)}</b>
            </p>
          </div>

          <div className="flex flex-wrap gap-2 justify-end">
            <button
              onClick={() => handlePrintVoucher(booking, guestProfile, mapsUrl)}
              className="rounded-md bg-slate-100 text-slate-900 px-3 py-2 text-[0.75rem] font-semibold hover:bg-white"
            >
              Yazdır / PDF
            </button>
            <button
              onClick={() => handleCopy("share")}
              className="rounded-md border border-slate-600 px-3 py-2 text-[0.75rem] text-slate-100 hover:bg-slate-800"
            >
              Paylaşım metni
            </button>
            <button
              onClick={() => handleCopy("voucher")}
              className="rounded-md border border-slate-600 px-3 py-2 text-[0.75rem] text-slate-100 hover:bg-slate-800"
            >
              Voucher metni
            </button>
            <button
              onClick={onClose}
              className="rounded-full border border-slate-700 bg-slate-900 px-3 py-2 text-[0.75rem] text-slate-300 hover:border-emerald-400"
            >
              Kapat ✕
            </button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 overflow-hidden">
            {hotelImages.length ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={hotelImages[activeImg]} className="w-full h-56 object-cover" alt="hotel" />
                {hotelImages.length > 1 && (
                  <div className="flex gap-2 p-3 overflow-x-auto border-t border-slate-800 bg-slate-950/60">
                    {hotelImages.slice(0, 10).map((src, idx) => (
                      <button
                        key={idx}
                        className={`w-16 h-12 rounded-lg overflow-hidden border ${idx === activeImg ? "border-emerald-400" : "border-slate-700"}`}
                        onClick={() => setActiveImg(idx)}
                        type="button"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} className="w-full h-full object-cover" alt={`thumb-${idx}`} />
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="h-56 flex items-center justify-center text-slate-500">Tesis görseli yok</div>
            )}
          </div>

          <div className="grid gap-3">
            <InfoCard
              title="Tesis & Konum"
              lines={[
                safeStr(booking.hotelName, "Tesis"),
                `${safeStr(booking.hotelCity || booking.city)}${booking.hotelDistrict ? ` / ${booking.hotelDistrict}` : ""}`,
                booking.hotelAddress ? `Adres: ${booking.hotelAddress}` : ""
              ].filter(Boolean)}
              extra={
                mapsUrl ? (
                  <a href={mapsUrl} target="_blank" rel="noreferrer" className="text-[0.72rem] text-sky-300 hover:underline">
                    Haritada konumu gör
                  </a>
                ) : null
              }
            />

            <InfoCard
              title="Otel iletişim & Mesaj"
              lines={[
                booking.hotelContactName ? `Yetkili: ${booking.hotelContactName}` : "",
                booking.hotelPhone ? `Telefon: ${booking.hotelPhone}` : "",
                booking.hotelWhatsapp ? `WhatsApp: ${booking.hotelWhatsapp}` : "",
                booking.hotelEmail ? `E-posta: ${booking.hotelEmail}` : "",
                booking.hotelWebsite ? `Web: ${booking.hotelWebsite}` : ""
              ].filter(Boolean)}
              extra={
                <div className="flex flex-wrap gap-2">
                  {whatsappHref ? (
                    <a href={whatsappHref} target="_blank" rel="noreferrer" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[0.75rem] text-emerald-200 hover:bg-emerald-500/20">
                      WhatsApp’tan yaz
                    </a>
                  ) : null}
                  {mailHref ? (
                    <a href={mailHref} className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-[0.75rem] text-sky-200 hover:bg-sky-500/20">
                      E-posta gönder
                    </a>
                  ) : null}
                  {telHref ? (
                    <a href={telHref} className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-[0.75rem] text-slate-200 hover:bg-slate-800">
                      Ara
                    </a>
                  ) : (
                    <span className="text-[0.72rem] text-slate-500">İletişim bilgisi yoksa otel profilinden eklenmeli.</span>
                  )}
                </div>
              }
            />

            <InfoCard
              title="Ödeme"
              lines={[
                `SON / GEÇERLİ: ${fmtMoney(finalAmount, currency)}`,
                `Yöntem: ${paymentMethodText(booking.paymentMethod)}`,
                `Durum: ${safeStr(booking.paymentStatus)}`
              ]}
            />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
<InfoCard
  title="Konaklama"
  lines={[
    `${safeStr(booking.checkIn)} (${safeStr(booking.checkInTime,"—")}) → ${safeStr(booking.checkOut)} (${safeStr(booking.checkOutTime,"12:00")})`,
    `${nights} gece`,
    booking.sameDayStay ? "⚡ Aynı gün" : "",
    booking.earlyCheckInWanted ? `🌅 Erken giriş: ${safeStr(booking.earlyCheckInTime,"—")}` : "",
    booking.lateCheckOutWanted ? `🌙 Geç çıkış: ${safeStr(booking.lateCheckOutFrom,"—")} - ${safeStr(booking.lateCheckOutTo,"—")}` : ""
  ].filter(Boolean)}
/>
          <InfoCard title="Kişi / Oda" lines={[`${safeStr(booking.adults, "0")} yetişkin • ${safeStr(booking.childrenCount, "0")} çocuk`, `Oda: ${safeStr(booking.roomsCount || 1)}`]} />
          <InfoCard title="Misafir" lines={[safeStr(guestProfile?.displayName || booking.guestName), guestProfile?.email ? `E-posta: ${guestProfile.email}` : ""].filter(Boolean)} />
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-2">
          <p className="text-[0.75rem] text-slate-400">Oda / fiyat kırılımı</p>
          {roomBreakdown.length === 0 ? (
            <p className="text-[0.85rem] text-slate-300">Oda kırılımı yok. Toplam tutar tek kalem.</p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {roomBreakdown.map((rb, idx) => {
                const n = rb.nights ?? nights;
                const nightly = safeNum(rb.nightlyPrice, 0);
                const total = safeNum(rb.totalPrice, nightly * n);
                const rn = safeStr(rb.roomTypeName || rb.roomName || `Oda ${idx + 1}`);
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => onOpenRoom(rn)}
                    className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 hover:bg-white/[0.03] text-left"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-slate-100 font-semibold">{rn}</p>
                        <p className="text-[0.75rem] text-slate-400">{n} gece • {fmtMoney(nightly, currency)} / gece</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[0.7rem] text-slate-400">Toplam</p>
                        <p className="text-emerald-300 font-extrabold">{fmtMoney(total, currency)}</p>
                        <p className="text-[0.7rem] text-slate-500">Detay ▶</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {cancelText ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <p className="text-[0.75rem] text-slate-400">İptal / değişiklik koşulları</p>
            <p className="text-[0.9rem] text-slate-100 mt-1 whitespace-pre-wrap">{cancelText}</p>
          </div>
        ) : null}

        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <p className="text-[0.75rem] text-slate-400 mb-2">Paylaşım metni (önizleme)</p>
          <pre className="text-slate-100 text-sm whitespace-pre-wrap">{shareText}</pre>
        </div>

        {SHOW_RAW_DEBUG && (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <p className="text-[0.75rem] text-slate-400 mb-2">RAW DEBUG</p>
            <pre className="text-slate-100 text-xs whitespace-pre-wrap">{JSON.stringify(booking.bookingRaw || {}, null, 2)}</pre>
          </div>
        )}

        <p className="text-[0.7rem] text-slate-500">
          KVKK: Misafir ekranında ham kayıtlar gösterilmez. (Admin için ayrı kanıt ekranı yapılabilir.)
        </p>
      </div>
    </div>
  );
}


/* =======================
   PACKAGE VOUCHER MODAL
======================= */
function PackageVoucherModal({ booking, guestProfile, onClose }: { booking: Booking; guestProfile: any; onClose: () => void }) {
  const title = pkgTitle(booking);
  const city = safeStr(booking.requestSnapshot?.city || booking.city);
  const district = safeStr(booking.requestSnapshot?.district || booking.district, "");
  const nights = booking.nights ?? calcNights(booking.checkIn, booking.checkOut);

  const finalAmount = safeNum(booking.finalAmount ?? booking.totalPrice, 0);
  const currency = safeStr(booking.finalCurrency ?? booking.currency, "TRY");

  const agencyName = safeStr(booking.agencySnapshot?.businessName || booking.agencySnapshot?.displayName, "Acenta");
  const agencyPhone = safeStr(booking.agencySnapshot?.phone || booking.agencySnapshot?.whatsapp || "", "");

  const shareText = useMemo(() => buildGuestShareText(booking, guestProfile, null), [booking, guestProfile]);
  const voucherText = useMemo(() => buildVoucherText(booking, guestProfile, null), [booking, guestProfile]);

  async function handleCopy(mode: "share" | "voucher") {
    try {
      await navigator.clipboard.writeText(mode === "share" ? shareText : voucherText);
      alert(mode === "share" ? "Paylaşım metni kopyalandı." : "Voucher metni kopyalandı.");
    } catch {
      alert("Kopyalama sırasında hata oluştu.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative mt-8 w-full max-w-6xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-2xl max-h-[90vh] overflow-y-auto space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-100">🧳 Paket Voucher / Detay</h2>
            <p className="text-[0.78rem] text-slate-400">
              Rezervasyon No: <span className="text-slate-200 font-semibold">{booking.id}</span>
            </p>
            <p className="text-[0.8rem] text-indigo-200">
              Paket: <b className="text-white">{title}</b>
            </p>
            <p className="text-[0.8rem] text-emerald-200">
              ✅ SON / GEÇERLİ ÖDEME: <b className="text-white">{fmtMoney(finalAmount, currency)}</b>
            </p>
          </div>

          <div className="flex flex-wrap gap-2 justify-end">
            <button
              onClick={() => handlePrintVoucher(booking, guestProfile, null)}
              className="rounded-md bg-slate-100 text-slate-900 px-3 py-2 text-[0.75rem] font-semibold hover:bg-white"
            >
              Yazdır / PDF
            </button>
            <button onClick={() => handleCopy("share")} className="rounded-md border border-slate-600 px-3 py-2 text-[0.75rem] text-slate-100 hover:bg-slate-800">
              Paylaşım metni
            </button>
            <button onClick={() => handleCopy("voucher")} className="rounded-md border border-slate-600 px-3 py-2 text-[0.75rem] text-slate-100 hover:bg-slate-800">
              Voucher metni
            </button>
            <button onClick={onClose} className="rounded-full border border-slate-700 bg-slate-900 px-3 py-2 text-[0.75rem] text-slate-300 hover:border-indigo-400">
              Kapat ✕
            </button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <InfoCard title="Paket" lines={[title, `${city}${district ? ` / ${district}` : ""}`]} />
          <InfoCard title="Tarih / Gece" lines={[`${safeStr(booking.checkIn)} – ${safeStr(booking.checkOut)}`, `${nights} gece`]} />
          <InfoCard title="Ödeme" lines={[fmtMoney(finalAmount, currency), `Yöntem: ${paymentMethodText(booking.paymentMethod)}`, `Durum: ${safeStr(booking.paymentStatus)}`]} />
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-1">
          <p className="text-[0.75rem] text-slate-400">Acenta</p>
          <p className="text-slate-100 font-semibold">{agencyName}</p>
          <p className="text-[0.8rem] text-slate-300">{agencyPhone ? `Tel: ${agencyPhone}` : "Tel: —"}</p>
          {booking.offerNote ? <p className="text-[0.8rem] text-slate-300">Not: {booking.offerNote}</p> : null}
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <p className="text-[0.75rem] text-slate-400 mb-2">Paylaşım metni (önizleme)</p>
          <pre className="text-slate-100 text-sm whitespace-pre-wrap">{shareText}</pre>
        </div>

        {SHOW_RAW_DEBUG && (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <p className="text-[0.75rem] text-slate-400 mb-2">RAW DEBUG</p>
            <pre className="text-slate-100 text-xs whitespace-pre-wrap">{JSON.stringify(booking.bookingRaw || {}, null, 2)}</pre>
          </div>
        )}

        <p className="text-[0.7rem] text-slate-500">KVKK: Misafir ekranında ham kayıtlar gösterilmez.</p>
      </div>
    </div>
  );
}
