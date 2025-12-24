// =======================
// (1/5) imports + types + helpers
// =======================

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
  documentId
} from "firebase/firestore";

type PaymentMethod = "card3d" | "payAtHotel";
type CancellationPolicyType = "non_refundable" | "flexible" | "until_days_before";

type PriceHistoryItem = {
  actor: "hotel" | "guest";
  kind: "initial" | "counter" | "update";
  price: number;
  note?: string | null;
  createdAt?: any; // Timestamp
};

interface RoomBreakdownItem {
  roomTypeId?: string;
  roomTypeName?: string;
  nights?: number;
  nightlyPrice?: number;
  totalPrice?: number;
}

/** ✅ Booking: geniş + toleranslı (otel + paket) */
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

  // ✅ PACKAGE
  type?: string | null; // "package" vs
  title?: string | null;

  packageRequestId?: string | null;
  packageOfferId?: string | null;

  // snapshotlar (offers sayfasında booking'e yazmıştık)
  agencySnapshot?: any;
  requestSnapshot?: any;
  offerSnapshot?: any;

  packageDetails?: any;
  packageBreakdown?: any;
  offerNote?: string | null;

  // otel profilinden
  hotelCity?: string | null;
  hotelDistrict?: string | null;
  hotelLocationUrl?: string | null;
  hotelAddress?: string | null;
  hotelImageUrls?: string[] | null;

  // otel iletişim
  hotelPhone?: string | null;
  hotelWhatsapp?: string | null;
  hotelEmail?: string | null;
  hotelWebsite?: string | null;
  hotelContactName?: string | null;

  // request’ten
  requestCity?: string | null;
  requestDistrict?: string | null;

  checkIn: string;
  checkOut: string;
  nights?: number;

  adults?: number | null;
  childrenCount?: number | null;
  childrenAges?: number[] | null;
  roomsCount?: number | null;

  totalPrice: number;
  currency: string;
  paymentMethod: PaymentMethod | string;
  paymentStatus: string;

  status: string;

  roomBreakdown?: RoomBreakdownItem[];
  commissionRate?: number | null;

  cancellationPolicyType?: CancellationPolicyType | null;
  cancellationPolicyDays?: number | null;
  cancellationPolicyLabel?: string | null;

  hasReview?: boolean;
  createdAt?: Timestamp;

  offerPriceHistory?: PriceHistoryItem[] | null;

  // ✅ “tüm bilgileri kaçırmamak” için ham veriler
  bookingRaw?: any;
  requestRaw?: any;
  offerRaw?: any;
  hotelRaw?: any;
}

interface RequestDoc {
  id: string;
  city?: string;
  district?: string | null;
  checkIn?: string;
  checkOut?: string;
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

  // ✅ iletişim
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
  hotelId?: string | null; // package'te null olabilir
  agencyId?: string | null; // package mesaj için opsiyon
  guestId?: string | null;
  senderRole: "guest" | "hotel" | "agency";
  text: string;
  createdAt?: Timestamp;
  read?: boolean;
}

/* ---------------- Helpers ---------------- */

function safeStr(v: any, fallback = "—") {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s.length ? s : fallback;
}
function safeNum(v: any, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function money(n: any, currency: string) {
  const val = safeNum(n, 0);
  return `${val.toLocaleString("tr-TR")} ${currency || "TRY"}`;
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
function derivedStatus(b: Booking): "active" | "cancelled" | "completed" {
  const st = (b.status || "").toLowerCase();
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
  if (st === "cancelled") return "bg-red-500/10 text-red-300 border-red-500/40";
  if (st === "completed") return "bg-slate-500/10 text-slate-300 border-slate-500/40";
  return "bg-emerald-500/10 text-emerald-300 border-emerald-500/40";
}
function paymentMethodText(method: string) {
  const m = (method || "").toLowerCase();
  if (m === "card3d") return "3D Secure kart";
  if (m === "payathotel") return "Otelde ödeme";
  if (m === "transfer") return "Havale / EFT";
  if (m === "payatdoor") return "Kapıda ödeme";
  return method;
}
function isPaidText(paymentStatus?: any) {
  const s = (paymentStatus ?? "").toString().trim().toLowerCase();
  if (!s) return false;
  const paidKeywords = ["paid", "ödendi", "odendi", "success", "succeeded", "completed", "confirmed", "captured", "approved", "ok", "done"];
  return paidKeywords.some((k) => s.includes(k));
}
function paymentBadge(paymentStatus?: string) {
  const paid = isPaidText(paymentStatus);
  return paid
}
function cancellationPolicyTextFromBooking(b: Booking): string | null {
  if (b.cancellationPolicyLabel) return b.cancellationPolicyLabel;
  const type: CancellationPolicyType = (b.cancellationPolicyType as CancellationPolicyType) ?? "non_refundable";
  if (type === "non_refundable") return "Bu rezervasyon iptal edilemez, ücret iadesi yapılmaz.";
  if (type === "flexible") return "Giriş tarihine kadar ücretsiz iptal hakkın vardır.";
  if (type === "until_days_before") {
    const d = b.cancellationPolicyDays ?? 3;
    return `Giriş tarihinden ${d} gün öncesine kadar ücretsiz iptal hakkın vardır. Sonrasında iptal edilemez.`;
  }
  return null;
}
function canCancelBooking(b: Booking): boolean {
  if ((b.status || "").toLowerCase() !== "active") return false;
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
  if ((b.status || "").toLowerCase() !== "active") return false;
  const out = parseDate(b.checkOut);
  if (!out) return true;
  return diffInDays(out, new Date()) >= 0;
}
function canReviewBooking(b: Booking): boolean {
  if (b.hasReview) return false;
  if ((b.status || "").toLowerCase() === "cancelled") return false;
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

  const guestId = (b.guestId || v.guestId || v.guestUid || v.guestUID || v.userId || v.userUID || v.uid || "").toLowerCase();
  const guestEmail = (v.guestEmail || v.email || v.contact?.email || "").toLowerCase();
  const guestName = (b.guestName || v.guestName || v.guestDisplayName || v.name || v.contact?.name || "").toLowerCase();

  if (uid && guestId === uid) return true;
  if (email && guestEmail && guestEmail === email) return true;
  if (name && guestName && guestName === name) return true;
  return false;
}
function safeJSON(obj: any) {
  try {
    return JSON.stringify(obj ?? {}, null, 2);
  } catch {
    return "{}";
  }
}
function isPackageBooking(b: Booking) {
  const t = (b.type || "").toLowerCase();
  return t === "package" || !!b.packageRequestId || !!b.offerSnapshot || !!b.requestSnapshot || !!b.agencySnapshot;
}
function pkgTitle(b: Booking) {
  const rawReq = b.requestSnapshot || {};
  return safeStr(b.title || rawReq.title || rawReq.packageTitle || "Paket");
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
    return safeJSON(obj);
  }
}
// =======================
// (2/5) main component: state + load + filters + handlers
// =======================

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
      "Voucher + mesaj + yorum = tek dosya 📄",
      "Otel + Paket rezervasyonları burada ✅",
      "Acenta planı + misafir talebi tek ekranda 🧳",
      "PDF çıktısı premium tasarım 🧾",
      "Biddakika ile her şey kanıtlı ⭐"
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
        // 1) hızlı: guestId == uid
        let snap = await getDocs(query(collection(db, "bookings"), where("guestId", "==", profile.uid)));

        // 2) boşsa: tüm bookings (field farklı olabilir)
        if (snap.empty) {
          snap = await getDocs(collection(db, "bookings"));
        }

        const rawAll: Booking[] = snap.docs
          .map((d) => {
            const v = d.data() as any;
            const bookingRaw = { id: d.id, ...v };

            return {
              id: d.id,
              offerId: v.offerId ?? null,
              requestId: v.requestId ?? null,

              hotelId: v.hotelId ?? null,
              hotelName: v.hotelName ?? null,

              guestId: v.guestId ?? v.guestUid ?? v.guestUID ?? v.userId ?? v.userUID ?? v.uid ?? null,
              guestName: v.guestName ?? v.guestDisplayName ?? v.name ?? null,

              city: v.city ?? null,
              district: v.district ?? null,

              // ✅ package fields
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

              adults: v.adults ?? v.paxAdults ?? null,
              childrenCount: v.childrenCount ?? v.paxChildren ?? null,
              childrenAges: v.childrenAges ?? null,
              roomsCount: v.roomsCount ?? null,

              totalPrice: Number(v.totalPrice ?? 0),
              currency: v.currency ?? "TRY",
              paymentMethod: v.paymentMethod ?? "payAtHotel",
              paymentStatus: v.paymentStatus ?? "—",

              status: v.status ?? "active",
              roomBreakdown: v.roomBreakdown ?? [],
              commissionRate: v.commissionRate ?? null,

              cancellationPolicyType: v.cancellationPolicyType ?? null,
              cancellationPolicyDays: v.cancellationPolicyDays ?? null,
              cancellationPolicyLabel: v.cancellationPolicyLabel ?? null,

              hasReview: v.hasReview ?? false,
              createdAt: v.createdAt,

              bookingRaw
            } as Booking;
          })
          .filter((b) => (b.status || "").toLowerCase() !== "deleted");

        // ✅ bu kullanıcıya ait kesin ayıkla
        const myBookings = rawAll.filter((b) => isMineBooking(b, profile));

        // ids
        const offerIds = Array.from(new Set(myBookings.map((b) => b.offerId).filter(Boolean))) as string[];
        const requestIds = Array.from(new Set(myBookings.map((b) => b.requestId).filter(Boolean))) as string[];
        const hotelIds = Array.from(new Set(myBookings.map((b) => b.hotelId).filter(Boolean))) as string[];

        // OFFERS
        const offerMap: Record<string, OfferDoc> = {};
        for (const part of chunk(offerIds, 10)) {
          if (!part.length) continue;
          const qOff = query(collection(db, "offers"), where(documentId(), "in", part));
          const snapOff = await getDocs(qOff);
          snapOff.docs.forEach((od) => {
            const ov = od.data() as any;
            offerMap[od.id] = {
              id: od.id,
              cancellationPolicyType: ov.cancellationPolicyType as CancellationPolicyType | undefined,
              cancellationPolicyDays: ov.cancellationPolicyDays ?? null,
              commissionRate: ov.commissionRate ?? null,
              roomBreakdown: ov.roomBreakdown ?? [],
              priceHistory: Array.isArray(ov.priceHistory) ? ov.priceHistory : [],
              raw: { id: od.id, ...ov }
            };
          });
        }

        // REQUESTS
        const reqMap: Record<string, RequestDoc> = {};
        for (const part of chunk(requestIds, 10)) {
          if (!part.length) continue;
          const qReq = query(collection(db, "requests"), where(documentId(), "in", part));
          const snapReq = await getDocs(qReq);
          snapReq.docs.forEach((rd) => {
            const rv = rd.data() as any;
            reqMap[rd.id] = {
              id: rd.id,
              city: rv.city,
              district: rv.district ?? null,
              checkIn: rv.checkIn,
              checkOut: rv.checkOut,
              adults: rv.adults,
              childrenCount: rv.childrenCount ?? 0,
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
          if (!part.length) continue;
          const qH = query(collection(db, "users"), where(documentId(), "in", part));
          const snapH = await getDocs(qH);
          snapH.docs.forEach((hd) => {
            const hv = hd.data() as any;
            const hp = hv.hotelProfile || {};

            const roomTypes: HotelRoomType[] = hp.roomTypes || hp.rooms || hp.roomCatalog || hp.roomTypeCatalog || [];
            const imageUrls: string[] = hp.imageUrls || hp.images || hp.gallery || [];

            const hotelEmail = hp.email || hp.hotelEmail || hv.email || hv.hotelEmail || null;
            const hotelPhone = hp.phone || hp.hotelPhone || hv.phone || hv.hotelPhone || null;
            const hotelWhatsapp = hp.whatsapp || hp.hotelWhatsapp || hv.whatsapp || hv.hotelWhatsapp || null;
            const hotelWebsite = hp.website || hp.hotelWebsite || hv.website || hv.hotelWebsite || null;
            const hotelContactName = hp.contactName || hp.hotelContactName || hv.contactName || hv.hotelContactName || null;

            hMap[hd.id] = {
              id: hd.id,
              city: hp.city || hv.city,
              district: hp.district ?? hv.district ?? null,
              locationUrl: hp.locationUrl || hv.locationUrl || null,
              address: hp.address || hv.address || null,
              imageUrls: Array.isArray(imageUrls) ? imageUrls : [],
              roomTypes: Array.isArray(roomTypes) ? roomTypes : [],

              hotelEmail,
              hotelPhone,
              hotelWhatsapp,
              hotelWebsite,
              hotelContactName,

              raw: { id: hd.id, ...hv }
            };
          });
        }
        setHotelMap(hMap);

        // ENRICH
        const enriched: Booking[] = myBookings.map((b) => {
          const off = b.offerId ? offerMap[b.offerId] : undefined;
          const req = b.requestId ? reqMap[b.requestId] : undefined;
          const hotel = b.hotelId ? hMap[b.hotelId] : undefined;

          // hotel request -> fallback
          const checkIn = b.checkIn || req?.checkIn || b.requestSnapshot?.dateFrom || b.requestSnapshot?.checkIn || "";
          const checkOut = b.checkOut || req?.checkOut || b.requestSnapshot?.dateTo || b.requestSnapshot?.checkOut || "";
          const nights = calcNights(checkIn, checkOut);

          const roomBreakdown = (b.roomBreakdown && b.roomBreakdown.length > 0 ? b.roomBreakdown : off?.roomBreakdown) ?? [];

          const mergedAdults = b.adults ?? req?.adults ?? (b.requestSnapshot?.adults ?? b.requestSnapshot?.paxAdults ?? null);
          const mergedChildrenCount = b.childrenCount ?? req?.childrenCount ?? (b.requestSnapshot?.childrenCount ?? b.requestSnapshot?.paxChildren ?? null);
          const mergedChildrenAges = b.childrenAges ?? req?.childrenAges ?? (b.requestSnapshot?.childrenAges ?? null);
          const mergedRooms = b.roomsCount ?? req?.roomsCount ?? (b.requestSnapshot?.roomsCount ?? null);

          return {
            ...b,

            checkIn,
            checkOut,
            nights,
            roomBreakdown,

            city: req?.city ?? b.city,
            district: (req?.district as string | null) ?? b.district,

            requestCity: req?.city ?? null,
            requestDistrict: (req?.district as string | null) ?? null,

            hotelCity: hotel?.city ?? null,
            hotelDistrict: hotel?.district ?? null,
            hotelLocationUrl: hotel?.locationUrl ?? null,
            hotelAddress: hotel?.address ?? null,
            hotelImageUrls: hotel?.imageUrls ?? null,

            hotelEmail: hotel?.hotelEmail ?? null,
            hotelPhone: hotel?.hotelPhone ?? null,
            hotelWhatsapp: hotel?.hotelWhatsapp ?? null,
            hotelWebsite: hotel?.hotelWebsite ?? null,
            hotelContactName: hotel?.hotelContactName ?? null,

            adults: mergedAdults,
            childrenCount: mergedChildrenCount,
            childrenAges: mergedChildrenAges,
            roomsCount: mergedRooms,

            cancellationPolicyType: (b.cancellationPolicyType as CancellationPolicyType) ?? off?.cancellationPolicyType ?? null,
            cancellationPolicyDays: b.cancellationPolicyDays ?? off?.cancellationPolicyDays ?? null,
            commissionRate: b.commissionRate ?? off?.commissionRate ?? null,

            offerPriceHistory: off?.priceHistory ?? null,

            requestRaw: req?.raw ?? null,
            offerRaw: off?.raw ?? null,
            hotelRaw: hotel?.raw ?? null
          };
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

  // summary
  const summary = useMemo(() => {
    const valid = bookings.filter((b) => (b.status || "").toLowerCase() !== "deleted");
    const totalSpend = valid.reduce((s, b) => s + Number(b.totalPrice || 0), 0);
    const totalNights = valid.reduce((s, b) => s + Number(b.nights ?? calcNights(b.checkIn, b.checkOut)), 0);

    const cityCount: Record<string, number> = {};
    valid.forEach((b) => {
      const c = (isPackageBooking(b) ? (b.requestSnapshot?.city || b.city) : (b.hotelCity || b.city) || "—").toString();
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

  // filtered
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
    if (minP != null && !Number.isNaN(minP)) list = list.filter((b) => Number(b.totalPrice || 0) >= minP);
    if (maxP != null && !Number.isNaN(maxP)) list = list.filter((b) => Number(b.totalPrice || 0) <= maxP);

    list.sort((a, b) => {
      if (sortKey === "created_desc") return (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0);
      if (sortKey === "checkin_asc") return (parseDate(a.checkIn)?.getTime() ?? Infinity) - (parseDate(b.checkIn)?.getTime() ?? Infinity);
      if (sortKey === "checkout_asc") return (parseDate(a.checkOut)?.getTime() ?? Infinity) - (parseDate(b.checkOut)?.getTime() ?? Infinity);
      if (sortKey === "price_desc") return Number(b.totalPrice || 0) - Number(a.totalPrice || 0);
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
        text,
        createdAt: serverTimestamp(),
        read: false
      });

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

  /** ✅ Silme: SADECE tamamlandıktan sonra aktif */
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
                Burada <b>otel + paket</b> rezervasyonlarının tamamı görünür. Voucher/Detay içinde <b>misafir talebi</b>, <b>otel/acentanın teklifi</b>,
                iletişim ve <b>premium PDF</b> bulunur.
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 w-full md:w-auto">
              <StatCard title="Rezervasyon" value={`${summary.count}`} />
              <StatCard title="Toplam gece" value={`${summary.totalNights}`} />
              <StatCard title="Toplam tutar" value={`${summary.totalSpend.toLocaleString("tr-TR")} ₺`} strong />
              <StatCard title="En sık şehir" value={summary.topCity} />
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            ✅ Bu sayfa “kanıt dosyası” mantığında çalışır: Talep + teklif + ödeme + iletişim + program her şey kayıtlıdır.
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

           

              <div className="md:col-span-12 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
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
            {pageError && <p className="text-red-300 bg-red-500/10 border border-red-500/40 rounded-md px-3 py-2">{pageError}</p>}
            {pageMessage && <p className="text-emerald-300 bg-emerald-500/10 border border-emerald-500/40 rounded-md px-3 py-2">{pageMessage}</p>}
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
              const createdStr = b.createdAt ? b.createdAt.toDate().toLocaleString("tr-TR") : "—";
              const nights = b.nights ?? calcNights(b.checkIn, b.checkOut);
              const st = derivedStatus(b);
              const cd = checkInCountdown(b.checkIn);

              const pay = paymentBadge(b.paymentStatus);
              const cancelText = cancellationPolicyTextFromBooking(b);

              const pkg = isPackageBooking(b);
              const title = pkgTitle(b);

              const mapsUrl = pkg ? null : buildMapsUrl(b, b.hotelId ? hotelMap[b.hotelId] : null);

              const city = pkg ? (b.requestSnapshot?.city || b.city) : (b.hotelCity || b.city);
              const district = pkg ? (b.requestSnapshot?.district || b.district) : (b.hotelDistrict || b.district);

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
                          <span className="text-slate-100 font-semibold">{b.hotelName || "Tesis"}</span>
                        )}

                        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[0.7rem] ${statusClass(b)}`}>
                          {statusText(b)}
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

                      {cancelText && <div className="text-[0.72rem] text-slate-400">İptal: {cancelText}</div>}
                    </div>

                    {/* Tarih */}
                    <div className="space-y-1 text-slate-100">
                      <p className="text-[0.9rem] font-semibold">
                        {b.checkIn} – {b.checkOut} <span className="text-slate-400 text-[0.75rem]">• {nights} gece</span>
                      </p>
                      <p className="text-[0.75rem] text-slate-300">
                        {(b.adults ?? 0) + (b.childrenCount ?? 0)} kişi • {b.roomsCount || 1} oda
                      </p>
                      {Array.isArray(b.childrenAges) && b.childrenAges.length > 0 && (
                        <p className="text-[0.72rem] text-slate-500">Çocuk yaşları: {b.childrenAges.join(", ")}</p>
                      )}
                    </div>

                    {/* Ödeme */}
                    <div className="space-y-1 text-slate-100">
                      <p className="text-[0.95rem] font-extrabold text-emerald-300">
                        {Number(b.totalPrice || 0).toLocaleString("tr-TR")} {b.currency}
                      </p>
                      <p className="text-[0.75rem] text-slate-400">Ödeme: {paymentMethodText(String(b.paymentMethod))}</p>
                      <p className="text-[0.75rem] text-slate-400">Durum: {safeStr(b.paymentStatus)}</p>
                    </div>

                    {/* Kalan süre */}
                    <div className="space-y-1">
                      <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[0.75rem] ${pillTone(cd.tone as any)}`}>
                        ⏱️ {cd.label}
                      </span>
                      {st === "completed" && <div className="text-[0.72rem] text-slate-400">Konaklama bitti ✅</div>}
                      {st === "cancelled" && <div className="text-[0.72rem] text-red-300">İptal edildi</div>}
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

                      {/* Yorum sadece otel için (istersen pakete de açarız) */}
                      {!pkg && canReviewBooking(b) && (
                        <button
                          type="button"
                          onClick={() => openReviewModal(b)}
                          className="w-full md:w-auto rounded-md border border-emerald-500/70 px-3 py-2 text-[0.75rem] text-emerald-300 hover:bg-emerald-500/10"
                        >
                          Yorum yap
                        </button>
                      )}

                      {/* ✅ Silme SADECE tamamlandıktan sonra */}
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

        {/* VOUCHER: otel + paket ayrımı */}
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

function StatCard({ title, value, strong }: { title: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2">
      <p className="text-[0.65rem] text-slate-400">{title}</p>
      <p className={`text-sm font-semibold ${strong ? "text-emerald-300" : "text-slate-100"}`}>{value}</p>
    </div>
  );
}
// =======================
// (4/5) Hotel voucher modal (premium PDF) + shared small components
// =======================

function InfoCard({ title, lines, extra }: { title: string; lines: string[]; extra?: any }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
      <p className="text-[0.75rem] text-slate-400">{title}</p>
      <div className="mt-1 space-y-1">
        {lines.map((x, i) => (
          <p key={i} className={`${i === 0 ? "text-slate-100 font-semibold" : "text-slate-300"} text-sm`}>
            {x}
          </p>
        ))}
        {extra}
      </div>
    </div>
  );
}
function MiniField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <p className="text-[0.72rem] text-slate-400">{label}</p>
      <p className="text-slate-100 font-semibold mt-1 whitespace-pre-wrap">{value}</p>
    </div>
  );
}

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
  const roomBreakdown = Array.isArray(booking.roomBreakdown) ? booking.roomBreakdown : [];
  const cancelText = cancellationPolicyTextFromBooking(booking);
  const mapsUrl = buildMapsUrl(booking, hotel || null);
  const pay = paymentBadge(booking.paymentStatus);

  const hotelImages = (booking.hotelImageUrls || hotel?.imageUrls || []).filter(Boolean);
  const [activeImg, setActiveImg] = useState(0);

  const ph = Array.isArray(booking.offerPriceHistory) ? booking.offerPriceHistory : [];
  const phSorted = useMemo(() => {
    const arr = [...ph];
    arr.sort((a, b) => (a?.createdAt?.toMillis?.() ?? 0) - (b?.createdAt?.toMillis?.() ?? 0));
    return arr;
  }, [ph]);

  // voucher text
  const voucherLines: string[] = [];
  voucherLines.push("Biddakika — Otel Rezervasyon Voucherı / Kanıt Dosyası");
  voucherLines.push(`Rezervasyon No: ${booking.id}`);
  voucherLines.push(`Tesis: ${safeStr(booking.hotelName)}`);
  voucherLines.push(`Konum: ${safeStr(booking.hotelCity || booking.city)}${booking.hotelDistrict ? " / " + booking.hotelDistrict : ""}`);
  if (booking.hotelAddress) voucherLines.push(`Adres: ${booking.hotelAddress}`);
  voucherLines.push("");
  voucherLines.push(`Konaklama: ${booking.checkIn} – ${booking.checkOut} (${nights} gece)`);
  voucherLines.push(`Kişi/Oda: ${(booking.adults ?? 0)} yetişkin • ${(booking.childrenCount ?? 0)} çocuk • ${booking.roomsCount || 1} oda`);
  if (Array.isArray(booking.childrenAges) && booking.childrenAges.length) voucherLines.push(`Çocuk yaşları: ${booking.childrenAges.join(", ")}`);
  voucherLines.push("");
  voucherLines.push(`Toplam: ${Number(booking.totalPrice || 0).toLocaleString("tr-TR")} ${safeStr(booking.currency, "TRY")}`);
  if (cancelText) voucherLines.push(`İptal: ${cancelText}`);
  voucherLines.push("");
  voucherLines.push("Otel iletişim:");
  if (booking.hotelContactName) voucherLines.push(`Yetkili: ${booking.hotelContactName}`);
  if (booking.hotelPhone) voucherLines.push(`Telefon: ${booking.hotelPhone}`);
  if (booking.hotelWhatsapp) voucherLines.push(`WhatsApp: ${booking.hotelWhatsapp}`);
  if (booking.hotelEmail) voucherLines.push(`E-posta: ${booking.hotelEmail}`);
  if (booking.hotelWebsite) voucherLines.push(`Web: ${booking.hotelWebsite}`);

  if (roomBreakdown.length) {
    voucherLines.push("");
    voucherLines.push("Oda/Fiyat kırılımı:");
    roomBreakdown.forEach((rb) => {
      const n = rb.nights ?? nights;
      const nightly = Number(rb.nightlyPrice ?? 0);
      const total = Number(rb.totalPrice ?? nightly * n);
      voucherLines.push(`• ${rb.roomTypeName || "Oda"} — ${n} gece x ${nightly} = ${total} ${safeStr(booking.currency, "TRY")}`);
    });
  }

  if (phSorted.length) {
    voucherLines.push("");
    voucherLines.push("Fiyat geçmişi (kanıt):");
    phSorted.forEach((x) => {
      voucherLines.push(`• ${x.actor === "hotel" ? "Otel" : "Misafir"} / ${x.kind}: ${Number(x.price || 0).toLocaleString("tr-TR")} ${safeStr(booking.currency, "TRY")}`);
      if (x.note) voucherLines.push(`  Not: ${x.note}`);
    });
  }

  voucherLines.push("");
  voucherLines.push("Misafir:");
  voucherLines.push(`Ad Soyad: ${safeStr(guestProfile?.displayName || booking.guestName)}`);
  voucherLines.push(`E-posta: ${safeStr(guestProfile?.email)}`);

  // raw snapshots (collapsible)
  voucherLines.push("");
  voucherLines.push("----- HAM VERİ (KANIT) -----");
  voucherLines.push("BOOKING RAW:");
  voucherLines.push(prettyJSON(booking.bookingRaw));
  voucherLines.push("");
  voucherLines.push("REQUEST RAW:");
  voucherLines.push(prettyJSON(booking.requestRaw));
  voucherLines.push("");
  voucherLines.push("OFFER RAW:");
  voucherLines.push(prettyJSON(booking.offerRaw));

  const voucherText = voucherLines.join("\n");

  function handlePrint() {
    const html = `
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Voucher - ${booking.id}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  body{font-family:'Space Grotesk', Arial, sans-serif; padding:28px; color:#0b1220; background:#f6f7fb}
  .top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
  .brand{font-weight:800;color:#059669;font-size:18px}
  .badge{padding:6px 10px;border-radius:10px;font-weight:700;font-size:12px;background:#e8fff3;color:#065f46;border:1px solid #b7f3d3}
  .badge2{padding:6px 10px;border-radius:10px;font-weight:700;font-size:12px;background:#fff7ed;color:#92400e;border:1px solid #fed7aa}
  .wrap{background:#fff;border-radius:16px;border:1px solid #e6e8f0;box-shadow:0 10px 30px rgba(14,23,55,.08);overflow:hidden}
  .hero{padding:16px 18px;background:linear-gradient(90deg,#0ea5e9,#22c55e);color:#fff}
  .hero h1{margin:0;font-size:16px}
  .hero .sub{opacity:.95;font-size:12px;margin-top:4px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:16px 18px}
  .card{border:1px solid #e6e8f0;border-radius:14px;padding:12px}
  .label{font-size:11px;color:#64748b;margin:0 0 6px}
  .val{margin:0;font-size:13px;font-weight:600}
  pre{white-space:pre-wrap;font-size:11px;line-height:1.55;margin:0;padding:16px 18px;background:#0b1220;color:#e5e7eb}
  .foot{padding:12px 18px;font-size:11px;color:#64748b}
</style>
</head>
<body>
  <div class="top">
    <div class="brand">Biddakika</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
      <div class="${isPaidText(booking.paymentStatus) ? "badge" : "badge2"}">${safeStr(booking.paymentStatus)} • ${safeStr(paymentMethodText(String(booking.paymentMethod)))}</div>
      <div class="badge">Voucher / Kanıt</div>
    </div>
  </div>

  <div class="wrap">
    <div class="hero">
      <h1>Otel Rezervasyon Voucherı / Kanıt Dosyası</h1>
      <div class="sub">Rezervasyon No: ${booking.id} • ${safeStr(booking.hotelName)}</div>
    </div>

    <div class="grid">
      <div class="card">
        <p class="label">Konaklama</p>
        <p class="val">${safeStr(booking.checkIn)} – ${safeStr(booking.checkOut)} (${nights} gece)</p>
      </div>
      <div class="card">
        <p class="label">Toplam</p>
        <p class="val">${Number(booking.totalPrice||0).toLocaleString("tr-TR")} ${safeStr(booking.currency,"TRY")}</p>
      </div>
      <div class="card">
        <p class="label">Kişi / Oda</p>
        <p class="val">${(booking.adults ?? 0) + (booking.childrenCount ?? 0)} kişi • ${booking.roomsCount || 1} oda</p>
      </div>
      <div class="card">
        <p class="label">İletişim</p>
        <p class="val">${safeStr(booking.hotelPhone,"")} ${booking.hotelEmail ? " • " + booking.hotelEmail : ""}</p>
      </div>
      <div class="card">
        <p class="label">Adres</p>
        <p class="val">${safeStr(booking.hotelAddress)}</p>
      </div>
      <div class="card">
        <p class="label">İptal</p>
        <p class="val">${safeStr(cancelText)}</p>
      </div>
    </div>

    <pre>${voucherText.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")}</pre>
    <div class="foot">Bu belge Biddakika tarafından oluşturulmuştur. İyi tatiller dileriz.</div>
  </div>

  <script>window.print();</script>
</body>
</html>`;
    const w = window.open("", "_blank", "width=980,height=900");
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(voucherText);
      alert("Voucher metni panoya kopyalandı.");
    } catch {
      alert("Kopyalama sırasında hata oluştu.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative mt-10 w-full max-w-6xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-2xl max-h-[88vh] overflow-y-auto space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-100">Voucher / Detay</h2>
            <p className="text-[0.75rem] text-slate-400">
              Rezervasyon No: <span className="text-slate-200 font-semibold">{booking.id}</span>
            </p>
    
          </div>

          <div className="flex flex-wrap gap-2 justify-end">
            <button onClick={handlePrint} className="rounded-md bg-slate-100 text-slate-900 px-3 py-2 text-[0.75rem] font-semibold hover:bg-white">
              Yazdır / PDF
            </button>
            <button onClick={handleCopy} className="rounded-md border border-slate-600 px-3 py-2 text-[0.75rem] text-slate-100 hover:bg-slate-800">
              Metni kopyala
            </button>
            <button onClick={onClose} className="rounded-full border border-slate-700 bg-slate-900 px-3 py-2 text-[0.75rem] text-slate-300 hover:border-emerald-400">
              Kapat ✕
            </button>
          </div>
        </div>

        {/* Hotel gallery */}
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
              <div className="h-56 flex items-center justify-center text-slate-500">Otel görseli yok</div>
            )}
          </div>

          <div className="grid gap-3">
            <InfoCard
              title="Tesis & konum"
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
              title="Otel iletişim"
              lines={[
                booking.hotelContactName ? `Yetkili: ${booking.hotelContactName}` : "",
                booking.hotelPhone ? `Telefon: ${booking.hotelPhone}` : "",
                booking.hotelWhatsapp ? `WhatsApp: ${booking.hotelWhatsapp}` : "",
                booking.hotelEmail ? `E-posta: ${booking.hotelEmail}` : "",
                booking.hotelWebsite ? `Web: ${booking.hotelWebsite}` : ""
              ].filter(Boolean)}
            />

            <InfoCard
              title="Ödeme"
              lines={[
                `${Number(booking.totalPrice || 0).toLocaleString("tr-TR")} ${safeStr(booking.currency, "TRY")}`,
                `Yöntem: ${paymentMethodText(String(booking.paymentMethod))}`,
                `Durum: ${safeStr(booking.paymentStatus)}`
              ]}
            />
          </div>
        </div>

        <InfoCard
          title="Misafir talebi (tüm detay)"
          lines={[
            `Talep şehir/ilçe: ${safeStr(booking.requestCity || booking.city)}${booking.requestDistrict ? " / " + booking.requestDistrict : ""}`,
            `Konaklama: ${safeStr(booking.checkIn)} – ${safeStr(booking.checkOut)} (${nights} gece)`,
            `Yetişkin: ${safeStr(booking.adults, "0")} • Çocuk: ${safeStr(booking.childrenCount, "0")} • Oda: ${safeStr(booking.roomsCount, "1")}`,
            Array.isArray(booking.childrenAges) && booking.childrenAges.length ? `Çocuk yaşları: ${booking.childrenAges.join(", ")}` : ""
          ].filter(Boolean)}
        />

        {/* Room breakdown */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-2">
          <p className="text-[0.75rem] text-slate-400">Oda / fiyat kırılımı</p>

          {roomBreakdown.length === 0 ? (
            <p className="text-[0.85rem] text-slate-300">Oda kırılımı kaydı yok. Toplam tutar tek kalem.</p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {roomBreakdown.map((rb, idx) => {
                const n = rb.nights ?? nights;
                const nightly = Number(rb.nightlyPrice ?? 0);
                const total = Number(rb.totalPrice ?? nightly * n);

                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => onOpenRoom(String(rb.roomTypeName || ""))}
                    className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 hover:bg-white/[0.03] text-left"
                    title="Oda detayını gör"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-slate-100 font-semibold">{rb.roomTypeName || `Oda ${idx + 1}`}</p>
                        <p className="text-[0.75rem] text-slate-400">
                          {n} gece • {nightly.toLocaleString("tr-TR")} {safeStr(booking.currency, "TRY")} / gece
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[0.7rem] text-slate-400">Toplam</p>
                        <p className="text-emerald-300 font-extrabold">
                          {total.toLocaleString("tr-TR")} {safeStr(booking.currency, "TRY")}
                        </p>
                        <p className="text-[0.7rem] text-slate-500">Detay ▶</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Price history */}
        {phSorted.length > 0 && (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-2">
            <p className="text-[0.75rem] text-slate-400">Fiyat geçmişi (kanıt)</p>
            <div className="grid gap-2 md:grid-cols-2">
              {phSorted.map((x, idx) => (
                <div key={idx} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-slate-100 font-semibold">
                      {x.actor === "hotel" ? "Otel" : "Misafir"} • <span className="text-slate-300">{x.kind}</span>
                    </div>
                    <div className="text-emerald-300 font-extrabold">
                      {Number(x.price || 0).toLocaleString("tr-TR")} {safeStr(booking.currency, "TRY")}
                    </div>
                  </div>
                  {x.createdAt?.toDate && <div className="text-[0.7rem] text-slate-500 mt-1">{x.createdAt.toDate().toLocaleString("tr-TR")}</div>}
                  {x.note ? <div className="text-[0.75rem] text-slate-300 mt-1">Not: {x.note}</div> : null}
                </div>
              ))}
            </div>
          </div>
        )}

        {cancelText && (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <p className="text-[0.75rem] text-slate-400">İptal koşulları</p>
            <p className="text-[0.9rem] text-slate-100 mt-1">{cancelText}</p>
          </div>
        )}

        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <p className="text-[0.75rem] text-slate-400">Misafir</p>
          <div className="grid gap-2 md:grid-cols-2 mt-2">
            <MiniField label="Ad soyad" value={safeStr(guestProfile?.displayName || booking.guestName)} />
            <MiniField label="E-posta" value={safeStr(guestProfile?.email)} />
          </div>
        </div>

        <details className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <summary className="cursor-pointer text-[0.8rem] text-slate-200 font-semibold">Ham veriler (kanıt / debug)</summary>
          <pre className="mt-3 whitespace-pre-wrap text-[11px] text-slate-300 overflow-x-auto">{prettyJSON({
            bookingRaw: booking.bookingRaw,
            requestRaw: booking.requestRaw,
            offerRaw: booking.offerRaw,
            hotelRaw: booking.hotelRaw
          })}</pre>
        </details>

        <p className="text-[0.7rem] text-slate-500">Bu voucher, rezervasyon doğrulaması için tüm detayları tek dosyada saklar.</p>
      </div>
    </div>
  );
}
// =======================
// (5/5) Package voucher modal + room modal + message modal + review modal
// =======================

function PackageVoucherModal({ booking, guestProfile, onClose }: { booking: Booking; guestProfile: any; onClose: () => void }) {
  const rawReq = booking.requestSnapshot || booking.bookingRaw?.requestSnapshot || {};
  const rawOffer = booking.offerSnapshot || booking.bookingRaw?.offerSnapshot || {};
  const agency = booking.agencySnapshot || booking.bookingRaw?.agencySnapshot || {};

  const title = pkgTitle(booking);

  const city = safeStr(rawReq.city || booking.city);
  const district = safeStr(rawReq.district || booking.district);

  const dateFrom = safeStr(rawReq.dateFrom || rawReq.checkIn || booking.checkIn);
  const dateTo = safeStr(rawReq.dateTo || rawReq.checkOut || booking.checkOut);

  const nights = safeNum(rawReq.nights ?? rawReq.hotelNights ?? booking.nights ?? calcNights(dateFrom, dateTo), 1);
  const paxAdults = safeNum(rawReq.paxAdults ?? rawReq.adults ?? booking.adults ?? 0, 0);
  const paxChildren = safeNum(rawReq.paxChildren ?? rawReq.childrenCount ?? booking.childrenCount ?? 0, 0);
  const childAges = Array.isArray(rawReq.childrenAges) ? rawReq.childrenAges : (Array.isArray(booking.childrenAges) ? booking.childrenAges : []);
  const roomsCount = rawReq.roomsCount ?? booking.roomsCount ?? null;

  const currency = safeStr(booking.currency || rawOffer.currency || "TRY");
  const total = safeNum(booking.totalPrice || rawOffer.totalPrice || 0, 0);

  const breakdown = booking.packageBreakdown || booking.bookingRaw?.packageBreakdown || rawOffer.breakdown || {};
  const details = booking.packageDetails || booking.bookingRaw?.packageDetails || rawOffer.packageDetails || {};

  const agencyName = safeStr(agency.businessName || agency.displayName || booking.bookingRaw?.agencyName || rawOffer.agencyName || "Acenta");
  const agencyPhone = safeStr(agency.phone);
  const agencyAddress = safeStr(agency.address);
  const agencyAbout = safeStr(agency.about);
  const offerNote = safeStr(booking.offerNote || rawOffer.note || booking.bookingRaw?.offerNote || "");

  // Program
  const programLines: string[] = [];
  programLines.push(`🧳 Paket: ${title}`);
  programLines.push(`📍 Lokasyon: ${city}${district !== "—" ? " / " + district : ""}`);
  programLines.push(`🗓️ Tarih: ${dateFrom} → ${dateTo} (${nights} gece)`);
  programLines.push(`👥 Kişi: ${paxAdults} yetişkin • ${paxChildren} çocuk${childAges.length ? ` (Yaş: ${childAges.join(", ")})` : ""}`);
  if (roomsCount) programLines.push(`🛏️ Oda: ${roomsCount}`);

  if (details.hotelName || details.roomType || details.boardType) {
    programLines.push("");
    programLines.push("🏨 Konaklama");
    if (details.hotelName) programLines.push(`• Otel: ${details.hotelName}`);
    if (details.roomType) programLines.push(`• Oda: ${details.roomType}`);
    if (details.boardType) programLines.push(`• Pansiyon: ${details.boardType}`);
  }

  if (rawReq.wantFlight || rawReq.wantsFlight || rawReq.flightNotes) {
    programLines.push("");
    programLines.push("✈️ Uçuş");
    if (rawReq.flightNotes) programLines.push(`• Not: ${rawReq.flightNotes}`);
  }

  if (rawReq.wantCar || rawReq.wantsCar || details.carPlan || rawReq.vehicleClass) {
    programLines.push("");
    programLines.push("🚗 Araç");
    if (rawReq.vehicleClass) programLines.push(`• Sınıf: ${rawReq.vehicleClass}`);
    if (details.carPlan) programLines.push(`• Plan: ${details.carPlan}`);
    if (rawReq.carSeats != null) programLines.push(`• Koltuk: ${rawReq.carSeats}`);
    if (rawReq.driverCount != null) programLines.push(`• Sürücü: ${rawReq.driverCount}`);
  }

  if (rawReq.wantTours || rawReq.wantsTours || details.tourPlan || rawReq.activities) {
    programLines.push("");
    programLines.push("🧭 Turlar / Aktiviteler");
    if (Array.isArray(details.tourPlan) && details.tourPlan.length) programLines.push(`• Tur planı: ${details.tourPlan.join(" • ")}`);
    if (rawReq.activities) programLines.push(`• Aktivite notu: ${rawReq.activities}`);
    if (rawReq.toursCount != null) programLines.push(`• Tur sayısı: ${rawReq.toursCount}`);
  }

  if (rawReq.wantsTransfer || rawReq.wantTransfer || details.transferType || rawReq.transferType || rawReq.transferNotes) {
    programLines.push("");
    programLines.push("🚌 Transfer");
    const tType = details.transferType || rawReq.transferType || details.transferPlan;
    if (tType) programLines.push(`• Tip: ${tType}`);
    if (rawReq.transferNotes) programLines.push(`• Not: ${rawReq.transferNotes}`);
  }

  if (rawReq.rentalExtras || rawReq.extras || details.extrasPlan || rawReq.notes) {
    programLines.push("");
    programLines.push("📝 Ek Notlar / İstekler");
    if (rawReq.rentalExtras) programLines.push(`• Ekstra: ${rawReq.rentalExtras}`);
    if (details.extrasPlan) programLines.push(`• Plan: ${details.extrasPlan}`);
    if (rawReq.notes) programLines.push(`• Misafir notu: ${rawReq.notes}`);
  }

  if (offerNote && offerNote !== "—") {
    programLines.push("");
    programLines.push("💬 Acenta Notu");
    programLines.push(offerNote);
  }

  const programText = programLines.join("\n");

  function handlePrint() {
    const pay = paymentBadge(booking.paymentStatus);
    const html = `
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Paket Voucher - ${booking.id}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  body{font-family:'Space Grotesk', Arial, sans-serif; padding:28px; color:#0b1220; background:#f6f7fb}
  .top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
  .brand{font-weight:800;color:#4f46e5;font-size:18px}
  .badge{padding:6px 10px;border-radius:10px;font-weight:700;font-size:12px;background:#eef2ff;color:#3730a3;border:1px solid #c7d2fe}
  .badgeOk{padding:6px 10px;border-radius:10px;font-weight:700;font-size:12px;background:#e8fff3;color:#065f46;border:1px solid #b7f3d3}
  .badgeWait{padding:6px 10px;border-radius:10px;font-weight:700;font-size:12px;background:#fff7ed;color:#92400e;border:1px solid #fed7aa}
  .wrap{background:#fff;border-radius:16px;border:1px solid #e6e8f0;box-shadow:0 10px 30px rgba(14,23,55,.08);overflow:hidden}
  .hero{padding:16px 18px;background:linear-gradient(90deg,#4f46e5,#0ea5e9);color:#fff}
  .hero h1{margin:0;font-size:16px}
  .hero .sub{opacity:.95;font-size:12px;margin-top:4px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:16px 18px}
  .card{border:1px solid #e6e8f0;border-radius:14px;padding:12px}
  .label{font-size:11px;color:#64748b;margin:0 0 6px}
  .val{margin:0;font-size:13px;font-weight:600}
  pre{white-space:pre-wrap;font-size:11px;line-height:1.55;margin:0;padding:16px 18px;background:#0b1220;color:#e5e7eb}
  .foot{padding:12px 18px;font-size:11px;color:#64748b}
</style>
</head>
<body>
  <div class="top">
    <div class="brand">Biddakika</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
      <div class="badge">🧳 Paket</div>
    </div>
  </div>

  <div class="wrap">
    <div class="hero">
      <h1>Paket Rezervasyon Voucherı / Kanıt Dosyası</h1>
      <div class="sub">Rezervasyon No: ${booking.id} • ${title}</div>
    </div>

    <div class="grid">
      <div class="card">
        <p class="label">Lokasyon</p>
        <p class="val">${city}${district !== "—" ? " / " + district : ""}</p>
      </div>
      <div class="card">
        <p class="label">Tarih</p>
        <p class="val">${dateFrom} – ${dateTo} (${nights} gece)</p>
      </div>
      <div class="card">
        <p class="label">Toplam</p>
        <p class="val">${Number(total||0).toLocaleString("tr-TR")} ${currency}</p>
      </div>
      <div class="card">
        <p class="label">Acenta</p>
        <p class="val">${agencyName} • ${agencyPhone}</p>
      </div>
    </div>

    <pre>${programText.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")}</pre>

    <div class="foot">
      Bu belge Biddakika tarafından oluşturulmuştur. Paket planı + talep + teklif kanıt niteliğindedir.
    </div>
  </div>

  <script>window.print();</script>
</body>
</html>`;
    const w = window.open("", "_blank", "width=980,height=900");
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(programText);
      alert("Paket voucher metni panoya kopyalandı.");
    } catch {
      alert("Kopyalama sırasında hata oluştu.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative mt-10 w-full max-w-6xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-2xl max-h-[88vh] overflow-y-auto space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-100">🧳 Paket Voucher / Detay</h2>
            <p className="text-[0.75rem] text-slate-400">
              Rezervasyon No: <span className="text-slate-200 font-semibold">{booking.id}</span>
            </p>
            <p className="text-[0.8rem] text-indigo-200">Paket: <b className="text-slate-100">{title}</b></p>
          </div>

          <div className="flex flex-wrap gap-2 justify-end">
            <button onClick={handlePrint} className="rounded-md bg-slate-100 text-slate-900 px-3 py-2 text-[0.75rem] font-semibold hover:bg-white">
              Yazdır / PDF
            </button>
            <button onClick={handleCopy} className="rounded-md border border-slate-600 px-3 py-2 text-[0.75rem] text-slate-100 hover:bg-slate-800">
              Metni kopyala
            </button>
            <button onClick={onClose} className="rounded-full border border-slate-700 bg-slate-900 px-3 py-2 text-[0.75rem] text-slate-300 hover:border-indigo-400">
              Kapat ✕
            </button>
          </div>
        </div>

        {/* Paket özeti */}
        <div className="grid gap-3 md:grid-cols-3">
          <InfoCard title="Paket" lines={[title, `${city}${district !== "—" ? ` / ${district}` : ""}`]} />
          <InfoCard title="Tarih / Gece" lines={[`${dateFrom} – ${dateTo}`, `${nights} gece`]} />
          <InfoCard
            title="Ödeme"
            lines={[
              `${Number(total || 0).toLocaleString("tr-TR")} ${currency}`,
              `Yöntem: ${paymentMethodText(String(booking.paymentMethod))}`,
              `Durum: ${safeStr(booking.paymentStatus)}`
            ]}
          />
        </div>

        {/* Acenta */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-2">
          <p className="text-[0.75rem] text-slate-400">Acenta (teklifi veren)</p>
          <p className="text-slate-100 font-semibold">{agencyName}</p>
          <div className="text-[0.78rem] text-slate-300">
            Tel: {agencyPhone} • Adres: {agencyAddress}
          </div>
          {agencyAbout && agencyAbout !== "—" ? <div className="text-[0.78rem] text-slate-300">Açıklama: {agencyAbout}</div> : null}
          {offerNote && offerNote !== "—" ? <div className="text-[0.78rem] text-slate-300">Teklif notu: {offerNote}</div> : null}
        </div>

        {/* Kırılım */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <p className="text-[0.75rem] text-slate-400 mb-2">Fiyat kırılımı</p>
          <div className="grid gap-2 md:grid-cols-4">
            <MiniField label="Otel" value={`${safeNum(breakdown.hotel, 0).toLocaleString("tr-TR")} ${currency}`} />
            <MiniField label="Transfer" value={`${safeNum(breakdown.transfer, 0).toLocaleString("tr-TR")} ${currency}`} />
            <MiniField label="Turlar" value={`${safeNum(breakdown.tours, 0).toLocaleString("tr-TR")} ${currency}`} />
            <MiniField label="Diğer" value={`${safeNum(breakdown.other, 0).toLocaleString("tr-TR")} ${currency}`} />
          </div>
        </div>

        {/* Program */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <p className="text-[0.75rem] text-slate-400 mb-2">Program / Tüm detay</p>
          <pre className="text-slate-100 text-sm whitespace-pre-wrap">{programText}</pre>
        </div>

        {/* Ham snapshotlar (isteğe bağlı) */}
        <details className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <summary className="cursor-pointer text-[0.8rem] text-slate-200 font-semibold">Ham veriler (talep + teklif + acenta)</summary>
          <pre className="mt-3 whitespace-pre-wrap text-[11px] text-slate-300 overflow-x-auto">{prettyJSON({
            bookingRaw: booking.bookingRaw,
            requestSnapshot: rawReq,
            offerSnapshot: rawOffer,
            agencySnapshot: agency
          })}</pre>
        </details>

        <p className="text-[0.7rem] text-slate-500">
          Bu belge “paket rezervasyon kanıt dosyasıdır”. Misafir talebi + acenta teklifi + program burada saklanır.
        </p>
      </div>
    </div>
  );
}

/* -------------------- ROOM TYPE MODAL -------------------- */
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

          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
            <p className="text-[0.72rem] text-slate-400">Açıklama</p>
            <p className="text-slate-100 text-sm whitespace-pre-wrap mt-1">{desc}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------- MESSAGE MODAL (GUEST) -------------------- */
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
    const q = query(collection(db, "bookingMessages"), where("bookingId", "==", booking.id));

    const unsub = onSnapshot(
      q,
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
              placeholder={pkg ? "Örn: Tur programında değişiklik mümkün mü?" : "Örn: Geç giriş yapacağız, mümkün mü?"}
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

/* -------------------- REVIEW MODAL -------------------- */
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
