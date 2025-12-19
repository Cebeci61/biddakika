"use client";

import { useEffect, useMemo, useState, FormEvent } from "react";
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
  onSnapshot,
  updateDoc,
  doc,
  getDoc
} from "firebase/firestore";

type PaymentMethod = "card3d" | "payAtHotel";
type CancellationPolicyType = "non_refundable" | "flexible" | "until_days_before";

type BookingStatusFilter = "all" | "active" | "cancelled" | "deleted" | "completed";
type CancelabilityFilter = "all" | "cancellable_now" | "not_cancellable" | "non_refundable";
type PaymentMethodFilter = "all" | "card3d" | "payAtHotel";
type SortKey =
  | "created_desc"
  | "checkin_asc"
  | "checkin_desc"
  | "remaining_asc"
  | "remaining_desc"
  | "price_desc"
  | "price_asc";

interface RoomBreakdownItem {
  roomTypeId?: string;
  roomTypeName?: string;
  nights?: number;
  nightlyPrice?: number;
  totalPrice?: number;
}

interface OfferDoc {
  id: string;
  commissionRate?: number | null;
  commissionLabel?: string | null;
  roomBreakdown?: RoomBreakdownItem[] | null;
  totalPrice?: number | null;
  currency?: string | null;
}

interface Booking {
  id: string;

  offerId?: string | null;
  requestId?: string | null;

  hotelId?: string | null;
  hotelName?: string | null;

  guestId?: string | null;
  guestName?: string | null;
  guestEmail?: string | null;
  guestPhone?: string | null;
  guestPhone2?: string | null;

  city?: string | null;
  district?: string | null;

  checkIn: string;
  checkOut: string;

  adults?: number | null;
  childrenCount?: number | null;
  childrenAges?: number[] | null;

  roomsCount?: number | null;

  // talep oda tercihleri
  roomTypes?: string[] | null;

  // talep oda satırları
  roomTypeCounts?: Record<string, number> | null;
  roomTypeRows?: { typeKey: string; count: number }[] | null;

  totalPrice: number;
  currency: string;

  paymentMethod: PaymentMethod | string;
  paymentStatus: string;

  status: string; // active|cancelled|deleted etc.

  roomBreakdown?: RoomBreakdownItem[] | null;

  commissionRate?: number | null;
  commissionLabel?: string | null;

  cancellationPolicyType?: CancellationPolicyType | null;
  cancellationPolicyDays?: number | null;
  cancellationPolicyLabel?: string | null;

  // Request fields
  type?: string | null;
  isGroup?: boolean | null;

  accommodationType?: string | null;
  boardType?: string | null;
  boardTypes?: string[] | null;
  boardTypeNote?: string | null;

  starRating?: number | null;
  desiredStarRatings?: number[] | null;

  nearMe?: boolean | null;
  nearMeKm?: number | null;
  locationNote?: string | null;

  featureKeys?: string[] | null;
  hotelFeaturePrefs?: string[] | null;

  extraFeaturesText?: string | null;
  hotelFeatureNote?: string | null;

  contactCompany?: string | null;
  contactNote?: string | null;
  requestNote?: string | null;

  createdAt?: Timestamp;
}

interface RequestDoc {
  id: string;

  type?: string | null;
  isGroup?: boolean | null;

  city?: string;
  district?: string | null;

  checkIn?: string;
  checkOut?: string;

  adults?: number;
  childrenCount?: number;
  childrenAges?: number[];

  roomsCount?: number;
  roomTypes?: string[];

  roomTypeCounts?: Record<string, number>;
  roomTypeRows?: { typeKey: string; count: number }[];

  accommodationType?: string | null;

  boardType?: string | null;
  boardTypes?: string[];
  boardTypeNote?: string | null;

  starRating?: number | null;
  desiredStarRatings?: number[] | null;

  nearMe?: boolean;
  nearMeKm?: number | null;
  locationNote?: string | null;

  featureKeys?: string[];
  hotelFeaturePrefs?: string[];

  extraFeaturesText?: string | null;
  hotelFeatureNote?: string | null;

  note?: string | null;

  contactCompany?: string | null;
  contactNote?: string | null;

  guestName?: string | null;
  guestEmail?: string | null;
  guestPhone?: string | null;
  guestPhone2?: string | null;

  createdAt?: Timestamp;
}

function safeStr(v: any, fallback = "—") {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s.length ? s : fallback;
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

function paymentMethodText(method: string) {
  if (method === "card3d") return "3D Secure kart";
  if (method === "payAtHotel") return "Otelde ödeme";
  return method;
}

function derivedStatus(booking: Booking): "active" | "cancelled" | "deleted" | "completed" {
  if (booking.status === "cancelled") return "cancelled";
  if (booking.status === "deleted") return "deleted";
  if (booking.status === "active" && bookingIsPast(booking)) return "completed";
  if (booking.status === "active") return "active";
  if (bookingIsPast(booking)) return "completed";
  return "active";
}

function statusText(booking: Booking): string {
  const st = derivedStatus(booking);
  if (st === "cancelled") return "İptal edildi";
  if (st === "deleted") return "Silindi";
  if (st === "completed") return "Tamamlandı";
  return "Aktif";
}

function statusClass(booking: Booking): string {
  const st = derivedStatus(booking);
  if (st === "cancelled") return "bg-red-500/10 text-red-300 border-red-500/40";
  if (st === "deleted") return "bg-slate-500/10 text-slate-300 border-slate-500/40";
  if (st === "completed") return "bg-slate-500/10 text-slate-300 border-slate-500/40";
  return "bg-emerald-500/10 text-emerald-300 border-emerald-500/40";
}

function watermarkText(b: Booking) {
  const st = derivedStatus(b);
  if (st === "cancelled") return "İPTAL EDİLDİ";
  if (st === "deleted") return "SİLİNDİ";
  return null;
}

function cancellationPolicyText(b: Booking): string | null {
  if (b.cancellationPolicyLabel) return b.cancellationPolicyLabel;

  const type: CancellationPolicyType =
    (b.cancellationPolicyType as CancellationPolicyType) ?? "non_refundable";

  if (type === "non_refundable")
    return "Bu rezervasyon iptal edilemez, ücret iadesi yapılmaz.";
  if (type === "flexible")
    return "Giriş tarihine kadar ücretsiz iptal hakkı vardır.";
  if (type === "until_days_before") {
    const d = b.cancellationPolicyDays ?? 3;
    return `Giriş tarihinden ${d} gün öncesine kadar ücretsiz iptal hakkı vardır. Sonrasında iptal edilmez.`;
  }
  return null;
}

function canCancelNow(b: Booking): boolean {
  if (derivedStatus(b) !== "active") return false;
  const ci = parseDate(b.checkIn);
  if (!ci) return false;
  const now = new Date();
  if (ci.getTime() <= now.getTime()) return false;

  const type: CancellationPolicyType =
    (b.cancellationPolicyType as CancellationPolicyType) ?? "non_refundable";

  if (type === "non_refundable") return false;
  if (type === "flexible") return true;
  if (type === "until_days_before") {
    const d = b.cancellationPolicyDays ?? 3;
    const daysLeft = diffInDays(ci, now);
    return daysLeft >= d;
  }
  return false;
}

function cancelabilityBadge(b: Booking) {
  const st = derivedStatus(b);
  if (st !== "active") return null;

  const type: CancellationPolicyType =
    (b.cancellationPolicyType as CancellationPolicyType) ?? "non_refundable";

  if (type === "non_refundable") {
    return { text: "İptal edilemez", cls: "bg-amber-500/10 text-amber-200 border-amber-500/30" };
  }
  if (canCancelNow(b)) {
    return { text: "Şu an iptal edilebilir", cls: "bg-emerald-500/10 text-emerald-200 border-emerald-500/30" };
  }
  return { text: "İptal süresi geçti", cls: "bg-slate-500/10 text-slate-300 border-slate-500/30" };
}

function canMessageBooking(b: Booking): boolean {
  if (derivedStatus(b) !== "active") return false;
  if (bookingIsPast(b)) return false;
  return true;
}

function timeUntilCheckIn(b: Booking): { label: string; ms: number } {
  const ci = parseDate(b.checkIn);
  if (!ci) return { label: "-", ms: Number.POSITIVE_INFINITY };

  const now = new Date();
  const diffMs = ci.getTime() - now.getTime();
  if (diffMs <= 0) return { label: "Giriş zamanı geçti", ms: 0 };

  const totalMin = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;

  if (days > 0) return { label: `${days} gün ${hours} sa ${mins} dk`, ms: diffMs };
  if (hours > 0) return { label: `${hours} sa ${mins} dk`, ms: diffMs };
  return { label: `${mins} dk`, ms: diffMs };
}

function normalizeRoomBreakdown(
  rb: RoomBreakdownItem[] | null | undefined,
  booking: Booking
): RoomBreakdownItem[] {
  const nights = calcNights(booking.checkIn, booking.checkOut);
  const arr = Array.isArray(rb) ? rb : [];
  return arr.map((x) => {
    const n = x.nights ?? nights;
    const nightly = Number(x.nightlyPrice ?? 0);
    const total = x.totalPrice != null ? Number(x.totalPrice) : nightly * n;
    return {
      roomTypeId: x.roomTypeId,
      roomTypeName: x.roomTypeName,
      nights: n,
      nightlyPrice: nightly,
      totalPrice: total
    };
  });
}

function escapeHtml(str: string) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/** booking içine request + offer merge (komisyon + oda kırılımı OFFER’dan gelsin) */
function mergeAll(b: Booking, req?: RequestDoc | null, offer?: OfferDoc | null): Booking {
  const merged: Booking = { ...b };

  if (req) {
    merged.type = merged.type ?? req.type ?? null;
    merged.isGroup = merged.isGroup ?? req.isGroup ?? null;

    merged.city = merged.city ?? req.city ?? null;
    merged.district = merged.district ?? req.district ?? null;

    merged.checkIn = merged.checkIn || req.checkIn || "";
    merged.checkOut = merged.checkOut || req.checkOut || "";

    merged.adults = merged.adults ?? req.adults ?? null;
    merged.childrenCount = merged.childrenCount ?? req.childrenCount ?? null;
    merged.childrenAges = merged.childrenAges ?? req.childrenAges ?? null;

    merged.roomsCount = merged.roomsCount ?? req.roomsCount ?? null;
    merged.roomTypes = merged.roomTypes ?? req.roomTypes ?? null;
    merged.roomTypeCounts = merged.roomTypeCounts ?? req.roomTypeCounts ?? null;
    merged.roomTypeRows = merged.roomTypeRows ?? req.roomTypeRows ?? null;

    merged.accommodationType = merged.accommodationType ?? req.accommodationType ?? null;
    merged.boardType = merged.boardType ?? req.boardType ?? null;
    merged.boardTypes = merged.boardTypes ?? req.boardTypes ?? null;
    merged.boardTypeNote = merged.boardTypeNote ?? req.boardTypeNote ?? null;

    merged.starRating = merged.starRating ?? req.starRating ?? null;
    merged.desiredStarRatings = merged.desiredStarRatings ?? req.desiredStarRatings ?? null;

    merged.nearMe = merged.nearMe ?? req.nearMe ?? null;
    merged.nearMeKm = merged.nearMeKm ?? req.nearMeKm ?? null;
    merged.locationNote = merged.locationNote ?? req.locationNote ?? null;

    merged.featureKeys = merged.featureKeys ?? req.featureKeys ?? null;
    merged.hotelFeaturePrefs = merged.hotelFeaturePrefs ?? req.hotelFeaturePrefs ?? null;
    merged.extraFeaturesText = merged.extraFeaturesText ?? req.extraFeaturesText ?? null;
    merged.hotelFeatureNote = merged.hotelFeatureNote ?? req.hotelFeatureNote ?? null;

    merged.requestNote = merged.requestNote ?? req.note ?? null;
    merged.contactCompany = merged.contactCompany ?? req.contactCompany ?? null;
    merged.contactNote = merged.contactNote ?? req.contactNote ?? null;

    merged.guestName = merged.guestName ?? req.guestName ?? null;
    merged.guestEmail = merged.guestEmail ?? req.guestEmail ?? null;
    merged.guestPhone = merged.guestPhone ?? req.guestPhone ?? null;
    merged.guestPhone2 = merged.guestPhone2 ?? req.guestPhone2 ?? null;
  }

  // OFFER öncelikli komisyon + oda kırılımı
  if (offer) {
    if (merged.commissionRate == null && offer.commissionRate != null) merged.commissionRate = offer.commissionRate;
    if (!merged.commissionLabel && offer.commissionLabel) merged.commissionLabel = offer.commissionLabel;

    // oda kırılımı: booking yoksa offer’dan
    const bookingRB = Array.isArray(merged.roomBreakdown) ? merged.roomBreakdown : null;
    const offerRB = Array.isArray(offer.roomBreakdown) ? offer.roomBreakdown : null;

    if (!bookingRB || bookingRB.length === 0) merged.roomBreakdown = offerRB ?? [];
  }

  // normalize
  merged.roomBreakdown = normalizeRoomBreakdown(merged.roomBreakdown, merged);

  return merged;
}

export default function HotelBookingsPage() {
  const { profile, loading: authLoading } = useAuth();
  const db = getFirestoreDb();

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  // unread msg counts
  const [messageCounts, setMessageCounts] = useState<Record<string, number>>({});

  // message modal
  const [messageOpen, setMessageOpen] = useState(false);
  const [messageBooking, setMessageBooking] = useState<Booking | null>(null);
  const [messageText, setMessageText] = useState("");
  const [messageSending, setMessageSending] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [messageSuccess, setMessageSuccess] = useState<string | null>(null);

  // voucher modal
  const [voucherOpen, setVoucherOpen] = useState(false);
  const [voucherBooking, setVoucherBooking] = useState<Booking | null>(null);

  // drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerBooking, setDrawerBooking] = useState<Booking | null>(null);

  // filters
  const [qText, setQText] = useState("");
  const [statusF, setStatusF] = useState<BookingStatusFilter>("all");
  const [cancelF, setCancelF] = useState<CancelabilityFilter>("all");
  const [payMethodF, setPayMethodF] = useState<PaymentMethodFilter>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("created_desc");

  function openDrawer(b: Booking) {
    setDrawerBooking(b);
    setDrawerOpen(true);
  }
  function closeDrawer() {
    setDrawerOpen(false);
    setDrawerBooking(null);
  }

  // 1) Load bookings + fetch request + offer per booking (EXACT & complete)
  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (authLoading) return;
      if (!profile || profile.role !== "hotel") {
        setLoading(false);
        return;
      }

      setLoading(true);
      setPageError(null);

      try {
        const qBk = query(collection(db, "bookings"), where("hotelId", "==", profile.uid));
        const snap = await getDocs(qBk);

        const raw: Booking[] = snap.docs.map((d) => {
          const v = d.data() as any;
          return {
            id: d.id,
            offerId: v.offerId ?? null,
            requestId: v.requestId ?? null,

            hotelId: v.hotelId ?? null,
            hotelName: v.hotelName ?? null,

            guestId: v.guestId ?? null,
            guestName: v.guestName || v.guestDisplayName || null,
            guestEmail: v.guestEmail ?? null,
            guestPhone: v.guestPhone ?? null,
            guestPhone2: v.guestPhone2 ?? null,

            city: v.city ?? null,
            district: v.district ?? null,

            checkIn: v.checkIn || "",
            checkOut: v.checkOut || "",

            adults: v.adults ?? null,
            childrenCount: v.childrenCount ?? null,
            childrenAges: v.childrenAges ?? null,

            roomsCount: v.roomsCount ?? null,
            roomTypes: v.roomTypes ?? null,
            roomTypeCounts: v.roomTypeCounts ?? null,
            roomTypeRows: v.roomTypeRows ?? null,

            totalPrice: Number(v.totalPrice ?? 0),
            currency: v.currency ?? "TRY",

            paymentMethod: v.paymentMethod ?? "payAtHotel",
            paymentStatus: v.paymentStatus ?? "—",

            status: v.status ?? "active",

            roomBreakdown: Array.isArray(v.roomBreakdown) ? v.roomBreakdown : [],

            // booking’de yoksa offer’dan gelecek
            commissionRate: v.commissionRate ?? null,
            commissionLabel: v.commissionLabel ?? v.commissionNote ?? null,

            cancellationPolicyType: v.cancellationPolicyType ?? null,
            cancellationPolicyDays: v.cancellationPolicyDays ?? null,
            cancellationPolicyLabel: v.cancellationPolicyLabel ?? null,

            accommodationType: v.accommodationType ?? null,
            boardType: v.boardType ?? null,
            boardTypes: v.boardTypes ?? null,
            boardTypeNote: v.boardTypeNote ?? null,

            starRating: v.starRating ?? null,
            desiredStarRatings: v.desiredStarRatings ?? null,

            nearMe: v.nearMe ?? null,
            nearMeKm: v.nearMeKm ?? null,
            locationNote: v.locationNote ?? null,

            featureKeys: v.featureKeys ?? null,
            hotelFeaturePrefs: v.hotelFeaturePrefs ?? null,
            extraFeaturesText: v.extraFeaturesText ?? null,
            hotelFeatureNote: v.hotelFeatureNote ?? null,

            contactCompany: v.contactCompany ?? null,
            contactNote: v.contactNote ?? null,
            requestNote: v.requestNote ?? null,

            createdAt: v.createdAt
          };
        });

        const enriched = await Promise.all(
          raw.map(async (b) => {
            let req: RequestDoc | null = null;
            let offer: OfferDoc | null = null;

            try {
              if (b.requestId) {
                const rs = await getDoc(doc(db, "requests", b.requestId));
                if (rs.exists()) {
                  const v = rs.data() as any;
                  req = {
                    id: rs.id,
                    type: v.type ?? null,
                    isGroup: v.isGroup ?? null,

                    city: v.city,
                    district: v.district ?? null,

                    checkIn: v.checkIn,
                    checkOut: v.checkOut,

                    adults: v.adults,
                    childrenCount: v.childrenCount ?? 0,
                    childrenAges: v.childrenAges ?? [],

                    roomsCount: v.roomsCount ?? 1,
                    roomTypes: v.roomTypes ?? [],

                    roomTypeCounts: v.roomTypeCounts ?? undefined,
                    roomTypeRows: v.roomTypeRows ?? undefined,

                    accommodationType: v.accommodationType ?? null,

                    boardType: v.boardType ?? null,
                    boardTypes: v.boardTypes ?? [],
                    boardTypeNote: v.boardTypeNote ?? null,

                    starRating: v.starRating ?? null,
                    desiredStarRatings: v.desiredStarRatings ?? null,

                    nearMe: v.nearMe ?? false,
                    nearMeKm: v.nearMeKm ?? null,
                    locationNote: v.locationNote ?? null,

                    featureKeys: v.featureKeys ?? [],
                    hotelFeaturePrefs: v.hotelFeaturePrefs ?? [],

                    extraFeaturesText: v.extraFeaturesText ?? null,
                    hotelFeatureNote: v.hotelFeatureNote ?? null,

                    note: v.note ?? null,

                    contactCompany: v.contactCompany ?? null,
                    contactNote: v.contactNote ?? null,

                    guestName: v.guestName ?? v.contactName ?? null,
                    guestEmail: v.guestEmail ?? v.contactEmail ?? null,
                    guestPhone: v.guestPhone ?? v.contactPhone ?? null,
                    guestPhone2: v.guestPhone2 ?? v.contactPhone2 ?? null,

                    createdAt: v.createdAt
                  };
                }
              }
            } catch {
              // ignore
            }

            // offers collection (verdiğim teklifler) -> komisyon/oda kırılımı buradan gelsin
            try {
              if (b.offerId) {
                const os = await getDoc(doc(db, "offers", b.offerId));
                if (os.exists()) {
                  const v = os.data() as any;
                  offer = {
                    id: os.id,
                    commissionRate: v.commissionRate ?? v.commission ?? null,
                    commissionLabel: v.commissionLabel ?? v.commissionType ?? v.commissionNote ?? null,
                    roomBreakdown: Array.isArray(v.roomBreakdown) ? v.roomBreakdown : (Array.isArray(v.rooms) ? v.rooms : null),
                    totalPrice: v.totalPrice ?? null,
                    currency: v.currency ?? null
                  };
                }
              }
            } catch {
              // ignore
            }

            const merged = mergeAll(b, req, offer);

            // offer para birimi booking’de yoksa
            if ((!merged.currency || merged.currency === "TRY") && offer?.currency) merged.currency = offer.currency;

            return merged;
          })
        );

        if (cancelled) return;

        enriched.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
        setBookings(enriched);
      } catch (err) {
        console.error("Otel rezervasyonları yüklenirken hata:", err);
        setPageError("Rezervasyonlar yüklenirken bir hata oluştu.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [authLoading, profile, db]);

  // 2) unread message counts (SAFE unsubscribe to prevent INTERNAL ASSERTION)
  useEffect(() => {
    if (authLoading) return;
    if (!profile || profile.role !== "hotel") return;

    let unsub: null | (() => void) = null;
    let disposed = false;

    try {
      const qMsg = query(
        collection(db, "bookingMessages"),
        where("hotelId", "==", profile.uid),
        where("senderRole", "==", "guest"),
        where("read", "==", false)
      );

      unsub = onSnapshot(
        qMsg,
        (snap) => {
          if (disposed) return;
          const counts: Record<string, number> = {};
          snap.docs.forEach((d) => {
            const v = d.data() as any;
            const bookingId = v.bookingId as string;
            if (!bookingId) return;
            counts[bookingId] = (counts[bookingId] || 0) + 1;
          });
          setMessageCounts(counts);
        },
        (err) => {
          // Firestore bazen dev modda state hatası fırlatabiliyor -> sayfayı çökertmeyelim
          console.error("Mesaj sayıları okunurken hata:", err);
        }
      );
    } catch (e) {
      console.error("onSnapshot kurulamadı:", e);
    }

    return () => {
      disposed = true;
      try {
        if (typeof unsub === "function") unsub();
      } catch (e) {
        // STRICT MODE çift cleanup'ta patlamasın
        console.warn("unsubscribe warning (ignored):", e);
      }
    };
  }, [authLoading, profile, db]);

  const stats = useMemo(() => {
    let revenue = 0;
    let active = 0;
    let cancelled = 0;
    let deleted = 0;
    let completed = 0;

    for (const b of bookings) {
      const st = derivedStatus(b);
      if (st === "active") active++;
      if (st === "cancelled") cancelled++;
      if (st === "deleted") deleted++;
      if (st === "completed") completed++;

      if (st !== "cancelled" && st !== "deleted") revenue += Number(b.totalPrice || 0);
    }

    return { revenue, active, cancelled, deleted, completed };
  }, [bookings]);

  const filteredBookings = useMemo(() => {
    const q = qText.trim().toLowerCase();
    const from = parseDate(fromDate);
    const to = parseDate(toDate);

    let list = [...bookings];

    if (q) {
      list = list.filter((b) => {
        const hay = [
          b.id,
          b.requestId,
          b.offerId,
          b.guestName,
          b.guestEmail,
          b.guestPhone,
          b.city,
          b.district,
          b.hotelName
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }

    if (statusF !== "all") list = list.filter((b) => derivedStatus(b) === statusF);

    if (payMethodF !== "all") list = list.filter((b) => String(b.paymentMethod) === payMethodF);

    if (cancelF !== "all") {
      list = list.filter((b) => {
        const type: CancellationPolicyType =
          (b.cancellationPolicyType as CancellationPolicyType) ?? "non_refundable";
        if (cancelF === "cancellable_now") return canCancelNow(b);
        if (cancelF === "non_refundable") return type === "non_refundable";
        if (cancelF === "not_cancellable") return derivedStatus(b) === "active" && !canCancelNow(b);
        return true;
      });
    }

    if (from) {
      list = list.filter((b) => {
        const ci = parseDate(b.checkIn);
        if (!ci) return false;
        return normalized(ci).getTime() >= normalized(from).getTime();
      });
    }
    if (to) {
      list = list.filter((b) => {
        const ci = parseDate(b.checkIn);
        if (!ci) return false;
        return normalized(ci).getTime() <= normalized(to).getTime();
      });
    }

    list.sort((a, b) => {
      if (sortKey === "created_desc") return (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0);

      if (sortKey === "checkin_asc") return (parseDate(a.checkIn)?.getTime() ?? Infinity) - (parseDate(b.checkIn)?.getTime() ?? Infinity);
      if (sortKey === "checkin_desc") return (parseDate(b.checkIn)?.getTime() ?? 0) - (parseDate(a.checkIn)?.getTime() ?? 0);

      if (sortKey === "remaining_asc") return timeUntilCheckIn(a).ms - timeUntilCheckIn(b).ms;
      if (sortKey === "remaining_desc") return timeUntilCheckIn(b).ms - timeUntilCheckIn(a).ms;

      if (sortKey === "price_desc") return Number(b.totalPrice || 0) - Number(a.totalPrice || 0);
      if (sortKey === "price_asc") return Number(a.totalPrice || 0) - Number(b.totalPrice || 0);

      return 0;
    });

    return list;
  }, [bookings, qText, statusF, payMethodF, cancelF, fromDate, toDate, sortKey]);

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

      await addDoc(collection(db, "bookingMessages"), {
        bookingId: messageBooking.id,
        hotelId: profile.uid,
        guestId: messageBooking.guestId ?? null,
        senderRole: "hotel",
        text,
        createdAt: serverTimestamp(),
        read: false
      });

      setMessageSuccess("Mesaj kaydedildi.");
      setMessageText("");
      setTimeout(() => setMessageSuccess(null), 900);
    } catch (err) {
      console.error("Mesaj gönderirken hata:", err);
      setMessageError("Mesaj gönderilirken hata oluştu. Rules/bağlantıyı kontrol et.");
    } finally {
      setMessageSending(false);
    }
  }

  function openVoucherModal(b: Booking) {
    setVoucherBooking(b);
    setVoucherOpen(true);
  }
  function closeVoucherModal() {
    setVoucherOpen(false);
    setVoucherBooking(null);
  }

  const hasAny = bookings.length > 0;

  return (
    <Protected allowedRoles={["hotel"]}>
      <div className="container-page space-y-6">
        {/* HEADER */}
        <section className="space-y-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold text-slate-100">Rezervasyonlar</h1>
              <p className="text-sm text-slate-300 max-w-3xl">
                Filtrele / sırala / drawer ile hızlı incele. Voucher ve mesajlar eksiksiz.
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 w-full md:w-auto">
              <StatCard title="Toplam gelir" value={`${stats.revenue.toLocaleString("tr-TR")} ₺`} strong />
              <StatCard title="Aktif" value={String(stats.active)} />
              <StatCard title="Tamamlandı" value={String(stats.completed)} />
              <StatCard title="İptal/Silindi" value={String(stats.cancelled + stats.deleted)} />
            </div>
          </div>

          {/* FILTER BAR */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3 shadow shadow-slate-950/40">
            <div className="grid gap-3 md:grid-cols-12 items-end">
              <div className="md:col-span-4 space-y-1">
                <label className="text-[0.7rem] text-slate-300">Arama</label>
                <input
                  value={qText}
                  onChange={(e) => setQText(e.target.value)}
                  placeholder="Misafir / şehir / bookingId / requestId / offerId..."
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400 transition"
                />
              </div>

              <div className="md:col-span-2 space-y-1">
                <label className="text-[0.7rem] text-slate-300">Durum</label>
                <select
                  value={statusF}
                  onChange={(e) => setStatusF(e.target.value as any)}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400 transition"
                >
                  <option value="all">Tümü</option>
                  <option value="active">Aktif</option>
                  <option value="completed">Tamamlandı</option>
                  <option value="cancelled">İptal</option>
                  <option value="deleted">Silindi</option>
                </select>
              </div>

              <div className="md:col-span-2 space-y-1">
                <label className="text-[0.7rem] text-slate-300">İptal durumu</label>
                <select
                  value={cancelF}
                  onChange={(e) => setCancelF(e.target.value as any)}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400 transition"
                >
                  <option value="all">Tümü</option>
                  <option value="cancellable_now">Şu an iptal edilebilir</option>
                  <option value="not_cancellable">Şu an iptal edilemez</option>
                  <option value="non_refundable">Non-refundable</option>
                </select>
              </div>

              <div className="md:col-span-2 space-y-1">
                <label className="text-[0.7rem] text-slate-300">Ödeme yöntemi</label>
                <select
                  value={payMethodF}
                  onChange={(e) => setPayMethodF(e.target.value as any)}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400 transition"
                >
                  <option value="all">Tümü</option>
                  <option value="payAtHotel">Otelde ödeme</option>
                  <option value="card3d">3D Secure kart</option>
                </select>
              </div>

              <div className="md:col-span-1 space-y-1">
                <label className="text-[0.7rem] text-slate-300">Giriş min</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400 transition"
                />
              </div>

              <div className="md:col-span-1 space-y-1">
                <label className="text-[0.7rem] text-slate-300">Giriş max</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400 transition"
                />
              </div>

              <div className="md:col-span-12 flex flex-col md:flex-row md:items-center md:justify-between gap-2 mt-2">
                <div className="flex items-center gap-2">
                  <span className="text-[0.75rem] text-slate-400">
                    Sonuç: <span className="text-slate-100 font-semibold">{filteredBookings.length}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setQText("");
                      setStatusF("all");
                      setCancelF("all");
                      setPayMethodF("all");
                      setFromDate("");
                      setToDate("");
                      setSortKey("created_desc");
                    }}
                    className="rounded-md border border-slate-700 px-3 py-1.5 text-[0.75rem] text-slate-200 hover:border-slate-500 transition"
                  >
                    Filtreleri sıfırla
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[0.75rem] text-slate-400">Sırala</span>
                  <select
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as any)}
                    className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400 transition"
                  >
                    <option value="created_desc">Oluşturma (yeni→eski)</option>
                    <option value="checkin_asc">Check-in (en yakın)</option>
                    <option value="checkin_desc">Check-in (en uzak)</option>
                    <option value="remaining_asc">Girişe kalan (az→çok)</option>
                    <option value="remaining_desc">Girişe kalan (çok→az)</option>
                    <option value="price_desc">Tutar (yüksek→düşük)</option>
                    <option value="price_asc">Tutar (düşük→yüksek)</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </section>

        {pageError && (
          <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/40 rounded-md px-3 py-2">
            {pageError}
          </p>
        )}

        {loading && <p className="text-sm text-slate-400">Rezervasyonlar yükleniyor...</p>}

        {!loading && !hasAny && <p className="text-sm text-slate-400">Henüz rezervasyon yok.</p>}

        {!loading && hasAny && filteredBookings.length === 0 && (
          <p className="text-sm text-slate-400">Filtrelere uygun rezervasyon bulunamadı.</p>
        )}

        {!loading && filteredBookings.length > 0 && (
          <section className="rounded-2xl border border-slate-800 bg-slate-950/80 shadow shadow-slate-950/40 overflow-hidden">
            <div className="hidden md:grid grid-cols-[1.8fr_1.4fr_1.3fr_1.6fr_auto] bg-slate-900 text-[0.75rem] font-semibold text-slate-100 px-4 py-3">
              <div>Misafir / Konum</div>
              <div>Tarih</div>
              <div>Ödeme</div>
              <div>Durum / İptal / Kalan</div>
              <div className="text-right">İşlemler</div>
            </div>

            {filteredBookings.map((b) => {
              const createdStr = b.createdAt?.toDate ? b.createdAt.toDate().toLocaleString("tr-TR") : "—";
              const msgCount = messageCounts[b.id] || 0;
              const nights = calcNights(b.checkIn, b.checkOut);
              const st = derivedStatus(b);
              const allowVoucher = st !== "cancelled" && st !== "deleted";
              const watermark = watermarkText(b);
              const cancelBadge = cancelabilityBadge(b);
              const kalan = timeUntilCheckIn(b);

              const commissionRate = b.commissionRate != null ? Number(b.commissionRate) : null;
              const commissionLabel = safeStr(b.commissionLabel, "Platform komisyonu");
              const commissionAmount = commissionRate != null ? Number(b.totalPrice || 0) * (commissionRate / 100) : null;

              return (
                <div
                  key={b.id}
                  onClick={() => openDrawer(b)}
                  className="border-t border-slate-800 relative cursor-pointer hover:bg-white/[0.02] transition"
                >
                  {watermark && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <div className="text-[2.6rem] md:text-[4.2rem] font-extrabold tracking-widest text-white/5 select-none rotate-[-12deg]">
                        {watermark}
                      </div>
                    </div>
                  )}

                  <div className="grid md:grid-cols-[1.8fr_1.4fr_1.3fr_1.6fr_auto] gap-3 px-4 py-4 items-start relative">
                    <div className="space-y-1">
                      <div className="text-slate-100 text-sm flex items-center gap-2">
                        <span className="font-semibold">{b.guestName || "Misafir"}</span>
                        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[0.7rem] ${statusClass(b)}`}>
                          {statusText(b)}
                        </span>
                      </div>

                      <div className="text-[0.78rem] text-slate-300">
                        {safeStr(b.city)}{b.district ? ` / ${b.district}` : ""}
                      </div>

                      <div className="text-[0.7rem] text-slate-500">Oluşturma: {createdStr}</div>

                      {b.requestId && (
                        <div className="text-[0.7rem] text-slate-500">
                          Request: <span className="text-slate-300">{b.requestId}</span>
                        </div>
                      )}
                      {b.offerId && (
                        <div className="text-[0.7rem] text-slate-500">
                          Offer: <span className="text-slate-300">{b.offerId}</span>
                        </div>
                      )}
                    </div>

                    <div className="space-y-1 text-slate-100">
                      <div className="text-[0.85rem] font-semibold">
                        {b.checkIn} – {b.checkOut}
                      </div>
                      <div className="text-[0.75rem] text-slate-300">
                        {nights} gece • {(b.adults ?? 0)} yetişkin
                        {b.childrenCount && b.childrenCount > 0 ? ` • ${b.childrenCount} çocuk` : ""} • {b.roomsCount || 1} oda
                      </div>
                      {Array.isArray(b.childrenAges) && b.childrenAges.length > 0 && (
                        <div className="text-[0.72rem] text-slate-400">
                          Çocuk yaşları: <span className="text-slate-200">{b.childrenAges.join(", ")}</span>
                        </div>
                      )}
                    </div>

                    <div className="space-y-1 text-slate-100">
                      <div className="text-[0.95rem] font-extrabold">
                        {Number(b.totalPrice || 0).toLocaleString("tr-TR")} {b.currency}
                      </div>
                      <div className="text-[0.72rem] text-slate-400">
                        {paymentMethodText(String(b.paymentMethod))} • {safeStr(b.paymentStatus)}
                      </div>

                      {commissionRate != null && (
                        <div className="text-[0.72rem] text-slate-400">
                          Komisyon: <span className="text-emerald-300 font-semibold">%{commissionRate}</span>{" "}
                          <span className="text-slate-500">({commissionLabel})</span>
                        </div>
                      )}
                      {commissionAmount != null && (
                        <div className="text-[0.72rem] text-slate-400">
                          Toplam komisyon:{" "}
                          <span className="text-emerald-300 font-semibold">
                            {Number(commissionAmount).toLocaleString("tr-TR")} {b.currency}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        {cancelBadge && (
                          <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[0.7rem] ${cancelBadge.cls}`}>
                            {cancelBadge.text}
                          </span>
                        )}
                        {cancellationPolicyText(b) && (
                          <span className="inline-flex items-center rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 text-[0.7rem] text-slate-200">
                            İptal: {cancellationPolicyText(b)}
                          </span>
                        )}
                      </div>
                      <div className="text-[0.75rem] text-slate-400">
                        Girişe kalan: <span className="text-slate-100 font-semibold">{kalan.label}</span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 items-end">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!canMessageBooking(b)) return;
                          openMessageModal(b);
                        }}
                        className={`w-full md:w-auto inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-[0.75rem] font-semibold transition ${
                          canMessageBooking(b)
                            ? "border border-emerald-500/70 text-emerald-300 hover:bg-emerald-500/10"
                            : "border border-slate-700 text-slate-500 cursor-not-allowed"
                        }`}
                        disabled={!canMessageBooking(b)}
                      >
                        <span>Mesajlar</span>
                        {msgCount > 0 && (
                          <span className="inline-flex items-center justify-center rounded-full bg-red-500 text-white text-[0.65rem] min-w-[18px] h-[18px] px-1">
                            {msgCount}
                          </span>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (allowVoucher) openVoucherModal(b);
                        }}
                        disabled={!allowVoucher}
                        title={!allowVoucher ? "İptal/Silindi: Voucher kapalı" : "Voucher / Detay"}
                        className={`w-full md:w-auto rounded-md px-3 py-2 text-[0.75rem] font-semibold transition ${
                          allowVoucher
                            ? "bg-sky-500 text-white hover:bg-sky-400"
                            : "bg-slate-800 text-slate-500 cursor-not-allowed"
                        }`}
                      >
                        Voucher / Detay
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {/* MESSAGE MODAL */}
        {messageOpen && messageBooking && profile && (
          <BookingMessageModalHotel
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

        {/* VOUCHER MODAL */}
        {voucherOpen && voucherBooking && (
          <BookingVoucherModal booking={voucherBooking} onClose={closeVoucherModal} />
        )}

        {/* DRAWER */}
        {drawerOpen && drawerBooking && (
          <BookingMiniDrawer
            booking={drawerBooking}
            onClose={closeDrawer}
            onOpenVoucher={() => {
              const st = derivedStatus(drawerBooking);
              if (st === "cancelled" || st === "deleted") return;
              setVoucherBooking(drawerBooking);
              setVoucherOpen(true);
            }}
            onOpenMessages={() => {
              if (!canMessageBooking(drawerBooking)) return;
              openMessageModal(drawerBooking);
            }}
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
function BookingMessageModalHotel({
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
  booking: any;
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
  const [messages, setMessages] = useState<any[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(true);

  useEffect(() => {
    let unsub: null | (() => void) = null;
    let disposed = false;

    try {
      const qRef = query(collection(db, "bookingMessages"), where("bookingId", "==", booking.id));
      unsub = onSnapshot(
        qRef,
        async (snap) => {
          if (disposed) return;

          const msgs = snap.docs
            .map((d) => {
              const v = d.data() as any;
              return {
                id: d.id,
                senderRole: v.senderRole,
                text: v.text,
                createdAt: v.createdAt,
                read: v.read
              };
            })
            .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));

          setMessages(msgs);
          setLoadingMessages(false);

          // misafirden gelen okunmamış mesajları okundu işaretle
          const unread = snap.docs.filter((d) => {
            const v = d.data() as any;
            return v.senderRole === "guest" && v.read === false;
          });

          for (const ds of unread) {
            try {
              await updateDoc(ds.ref, { read: true });
            } catch (e) {
              console.warn("read update warning:", e);
            }
          }
        },
        (err) => {
          console.error("Mesajlar okunurken hata:", err);
          setLoadingMessages(false);
        }
      );
    } catch (e) {
      console.error("message onSnapshot kurulamadı:", e);
      setLoadingMessages(false);
    }

    return () => {
      disposed = true;
      try {
        if (typeof unsub === "function") unsub();
      } catch (e) {
        console.warn("unsubscribe warning (ignored):", e);
      }
    };
  }, [db, booking.id]);

  const messagingClosed = !canMessageBooking(booking);

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative mt-12 w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-xl shadow-slate-950/60 text-sm space-y-3 animate-[fadeIn_.18s_ease-out]">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-slate-100">Mesajlar</h2>
              <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[0.7rem] ${statusClass(booking)}`}>
                {statusText(booking)}
              </span>
            </div>
            <p className="text-[0.78rem] text-slate-400">
              {safeStr(booking.guestName)} • {booking.checkIn} – {booking.checkOut}
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
            const isHotel = m.senderRole === "hotel";
            const timeStr = m.createdAt?.toDate ? m.createdAt.toDate().toLocaleString("tr-TR") : "";
            return (
              <div key={m.id} className={`flex ${isHotel ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[82%] rounded-2xl px-3 py-2 text-[0.85rem] shadow ${
                    isHotel ? "bg-emerald-500 text-slate-950 rounded-br-none" : "bg-slate-800 text-slate-100 rounded-bl-none"
                  }`}
                >
                  <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
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
              placeholder="Örn: Check-in saatinizi teyit edebilir misiniz?"
              className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm resize-none disabled:opacity-60 outline-none focus:border-emerald-400 transition"
            />
          </div>

          {error && (
            <p className="text-[0.8rem] text-red-300 bg-red-500/10 border border-red-500/40 rounded-md px-3 py-2">
              {error}
            </p>
          )}
          {success && (
            <p className="text-[0.8rem] text-emerald-300 bg-emerald-500/10 border border-emerald-500/40 rounded-md px-3 py-2">
              {success}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md border border-slate-700 px-3 py-2 text-[0.8rem] text-slate-200 hover:border-slate-500 transition">
              Kapat
            </button>
            <button
              type="submit"
              disabled={sending || messagingClosed}
              className="rounded-md bg-emerald-500 text-slate-950 px-4 py-2 text-[0.8rem] font-semibold hover:bg-emerald-400 disabled:opacity-60 transition"
            >
              {sending ? "Gönderiliyor..." : "Gönder"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function BookingVoucherModal({ booking, onClose }: { booking: any; onClose: () => void }) {
  const nights = calcNights(booking.checkIn, booking.checkOut);
  const st = derivedStatus(booking);

  const roomBreakdown = normalizeRoomBreakdown(booking.roomBreakdown, booking);

  const commissionRate = booking.commissionRate != null ? Number(booking.commissionRate) : null;
  const commissionLabel = safeStr(booking.commissionLabel, "Platform komisyonu");
  const commissionAmount = commissionRate != null ? Number(booking.totalPrice || 0) * (commissionRate / 100) : null;

  const boardTypes = Array.isArray(booking.boardTypes) ? booking.boardTypes : [];
  const featureKeys = Array.isArray(booking.featureKeys) ? booking.featureKeys : [];
  const hotelFeaturePrefs = Array.isArray(booking.hotelFeaturePrefs) ? booking.hotelFeaturePrefs : [];
  const wantedFeatures = featureKeys.length ? featureKeys : hotelFeaturePrefs;

  const childrenAges = Array.isArray(booking.childrenAges) ? booking.childrenAges : [];
  const cancelText = cancellationPolicyText(booking);

  const voucherLines: string[] = [];
  voucherLines.push("Biddakika — Rezervasyon Voucherı (Otel)");
  voucherLines.push(`Booking ID: ${booking.id}`);
  if (booking.requestId) voucherLines.push(`Request ID: ${booking.requestId}`);
  if (booking.offerId) voucherLines.push(`Offer ID: ${booking.offerId}`);
  voucherLines.push(`Durum: ${statusText(booking)}`);
  voucherLines.push("");

  voucherLines.push(`Tesis: ${safeStr(booking.hotelName)}`);
  voucherLines.push(`Konum: ${safeStr(booking.city)}${booking.district ? " / " + booking.district : ""}`);
  voucherLines.push("");

  voucherLines.push(`Misafir: ${safeStr(booking.guestName)}`);
  voucherLines.push(`Telefon: ${safeStr(booking.guestPhone)}`);
  voucherLines.push(`2. Telefon: ${safeStr(booking.guestPhone2)}`);
  voucherLines.push(`E-posta: ${safeStr(booking.guestEmail)}`);
  voucherLines.push(`Firma/Kurum: ${safeStr(booking.contactCompany)}`);
  voucherLines.push("");

  voucherLines.push(`Konaklama: ${booking.checkIn} - ${booking.checkOut} (${nights} gece)`);
  voucherLines.push(
    `Kişi/Oda: ${(booking.adults ?? 0)} yetişkin${booking.childrenCount ? " • " + booking.childrenCount + " çocuk" : ""} • ${booking.roomsCount || 1} oda`
  );
  if (childrenAges.length) voucherLines.push(`Çocuk yaşları: ${childrenAges.join(", ")}`);
  voucherLines.push("");

  voucherLines.push(`Ödeme: ${paymentMethodText(String(booking.paymentMethod))} • Durum: ${safeStr(booking.paymentStatus)}`);
  voucherLines.push(`Toplam: ${Number(booking.totalPrice || 0).toLocaleString("tr-TR")} ${booking.currency}`);

  if (commissionRate != null) {
    voucherLines.push(`Komisyon: %${commissionRate} • ${commissionLabel}`);
    voucherLines.push(`Toplam komisyon: ${Number(commissionAmount || 0).toLocaleString("tr-TR")} ${booking.currency}`);
  }

  if (cancelText) voucherLines.push(`İptal koşulu: ${cancelText}`);

  voucherLines.push("");
  voucherLines.push("Otelin verdiği oda kırılımı:");
  if (roomBreakdown.length) {
    roomBreakdown.forEach((rb, idx) => {
      voucherLines.push(
        `Oda ${idx + 1}: ${rb.roomTypeName || "Oda"} • ${rb.nights} gece × ${Number(rb.nightlyPrice || 0)} = ${Number(rb.totalPrice || 0)} ${booking.currency}`
      );
    });
  } else {
    voucherLines.push("— (Kayıt yok)");
  }

  voucherLines.push("");
  voucherLines.push("Misafir talep detayları:");
  voucherLines.push(`Tesis türü: ${safeStr(booking.accommodationType)}`);
  voucherLines.push(`Konaklama tipi: ${booking.boardType ? booking.boardType : (boardTypes.length ? boardTypes.join(", ") : "—")}`);
  voucherLines.push(`Konaklama notu: ${safeStr(booking.boardTypeNote)}`);
  voucherLines.push(`Konum notu: ${safeStr(booking.locationNote)}`);
  voucherLines.push(`Ek özellik notu: ${safeStr(booking.extraFeaturesText)}`);
  voucherLines.push(`Otel özellik notu: ${safeStr(booking.hotelFeatureNote)}`);
  voucherLines.push(`Genel not: ${safeStr(booking.requestNote)}`);
  voucherLines.push(`İletişim notu: ${safeStr(booking.contactNote)}`);
  if (wantedFeatures.length) voucherLines.push(`İstenen özellikler: ${wantedFeatures.join(", ")}`);

  const voucherText = voucherLines.join("\n");

  function handlePrint() {
    const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Voucher - ${booking.id}</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
    h1 { font-size: 18px; margin: 0 0 12px 0; }
    pre { white-space: pre-wrap; font-size: 12px; line-height: 1.45; }
    .meta { font-size: 12px; color: #444; margin-bottom: 12px; }
    .box { border: 1px solid #ddd; padding: 12px; border-radius: 10px; }
  </style>
</head>
<body>
  <h1>Biddakika — Rezervasyon Voucherı</h1>
  <div class="meta">Booking ID: ${booking.id} • Durum: ${statusText(booking)}</div>
  <div class="box"><pre>${escapeHtml(voucherText)}</pre></div>
  <script>window.print();</script>
</body>
</html>
`;
    const w = window.open("", "_blank", "width=900,height=900");
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

  const statusBadge =
    st === "cancelled"
      ? "bg-red-500/10 text-red-300 border-red-500/40"
      : st === "deleted"
      ? "bg-slate-500/10 text-slate-300 border-slate-500/40"
      : st === "completed"
      ? "bg-slate-500/10 text-slate-300 border-slate-500/40"
      : "bg-emerald-500/10 text-emerald-300 border-emerald-500/40";

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/60">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative mt-8 w-full max-w-5xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-xl shadow-slate-950/60 max-h-[88vh] overflow-y-auto space-y-4 animate-[fadeIn_.18s_ease-out]">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-slate-100">Voucher / Detay</h2>
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.7rem] ${statusBadge}`}>
                {statusText(booking)}
              </span>
            </div>
            <p className="text-[0.8rem] text-slate-400">
              {safeStr(booking.guestName)} • {booking.checkIn} – {booking.checkOut} • {nights} gece
            </p>
          </div>

          <div className="flex flex-wrap gap-2 justify-end">
            <button onClick={handlePrint} className="rounded-md bg-slate-100 text-slate-900 px-3 py-2 text-[0.8rem] font-semibold hover:bg-white transition">
              Yazdır / PDF
            </button>
            <button onClick={handleCopy} className="rounded-md border border-slate-500 px-3 py-2 text-[0.8rem] text-slate-100 hover:bg-slate-800 transition">
              Metni kopyala
            </button>
            <button onClick={onClose} className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-[0.8rem] text-slate-300 hover:border-emerald-400 transition">
              Kapat ✕
            </button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <InfoCard title="Tesis" lines={[safeStr(booking.hotelName, "Tesis"), `${safeStr(booking.city)}${booking.district ? ` / ${booking.district}` : ""}`]} />
          <InfoCard
            title="Misafir / İletişim"
            lines={[
              safeStr(booking.guestName),
              `Tel: ${safeStr(booking.guestPhone)}`,
              `Tel2: ${safeStr(booking.guestPhone2)}`,
              `E-posta: ${safeStr(booking.guestEmail)}`
            ]}
          />
          <InfoCard
            title="Ödeme & Komisyon"
            lines={[
              `${Number(booking.totalPrice || 0).toLocaleString("tr-TR")} ${booking.currency}`,
              `${paymentMethodText(String(booking.paymentMethod))} • ${safeStr(booking.paymentStatus)}`,
              commissionRate != null ? `Komisyon: %${commissionRate} • ${commissionLabel}` : "Komisyon: —",
              commissionAmount != null ? `Toplam komisyon: ${Number(commissionAmount).toLocaleString("tr-TR")} ${booking.currency}` : ""
            ].filter(Boolean)}
          />
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
          <p className="text-[0.75rem] text-slate-400">Otelin verdiği oda kırılımı</p>
          {roomBreakdown.length === 0 ? (
            <p className="text-sm text-slate-400">Oda kırılımı kaydı yok.</p>
          ) : (
            <div className="space-y-2">
              {roomBreakdown.map((rb, i) => (
                <div key={i} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 flex justify-between gap-3">
                  <div>
                    <p className="text-sm text-slate-100 font-semibold">{rb.roomTypeName || `Oda ${i + 1}`}</p>
                    <p className="text-[0.75rem] text-slate-400">
                      {rb.nights} gece × {Number(rb.nightlyPrice || 0).toLocaleString("tr-TR")} {booking.currency}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[0.72rem] text-slate-400">Toplam</p>
                    <p className="text-sm text-emerald-300 font-extrabold">
                      {Number(rb.totalPrice || 0).toLocaleString("tr-TR")} {booking.currency}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
          <p className="text-[0.75rem] text-slate-400">İptal koşulu</p>
          <p className="text-sm text-slate-100 whitespace-pre-wrap">{cancelText || "—"}</p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
          <p className="text-[0.75rem] text-slate-400">Misafir talep formu</p>
          <div className="grid gap-2 md:grid-cols-2">
            <FieldBox label="Tesis türü" value={safeStr(booking.accommodationType)} />
            <FieldBox label="Konaklama tipi" value={booking.boardType ? booking.boardType : (boardTypes.length ? boardTypes.join(", ") : "—")} />
            <FieldBox label="Çocuk yaşları" value={childrenAges.length ? childrenAges.join(", ") : "—"} />
            <FieldBox label="Konum notu" value={safeStr(booking.locationNote)} />
            <FieldBox label="Genel not" value={safeStr(booking.requestNote)} />
            <FieldBox label="İletişim notu" value={safeStr(booking.contactNote)} />
          </div>

          <div className="mt-2">
            <p className="text-[0.72rem] text-slate-400">İstenen özellikler</p>
            {wantedFeatures.length ? (
              <div className="flex flex-wrap gap-2 mt-2">
                {wantedFeatures.map((k: any, i: number) => (
                  <span key={i} className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
                    {String(k)}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400 mt-1">Belirtilmemiş.</p>
            )}
          </div>
        </div>

        <p className="text-[0.7rem] text-slate-500">Bu voucher operasyon/muhasebe için eksiksiz çıktı niteliğindedir.</p>
      </div>
    </div>
  );
}

function FieldBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <p className="text-[0.72rem] text-slate-400">{label}</p>
      <p className="text-sm text-slate-100 mt-1 whitespace-pre-wrap">{value}</p>
    </div>
  );
}

function InfoCard({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
      <p className="text-[0.75rem] text-slate-400">{title}</p>
      <div className="mt-1 space-y-1">
        {lines.map((x, i) => (
          <p key={i} className={`${i === 0 ? "text-slate-100 font-semibold" : "text-slate-300"} text-sm`}>
            {x}
          </p>
        ))}
      </div>
    </div>
  );
}
function BookingMiniDrawer({
  booking,
  onClose,
  onOpenVoucher,
  onOpenMessages
}: {
  booking: any;
  onClose: () => void;
  onOpenVoucher: () => void;
  onOpenMessages: () => void;
}) {
  const nights = calcNights(booking.checkIn, booking.checkOut);
  const st = derivedStatus(booking);

  const canVoucher = st !== "cancelled" && st !== "deleted";
  const canMsg = canMessageBooking(booking);

  const roomBreakdown = normalizeRoomBreakdown(booking.roomBreakdown, booking);

  const commissionRate = booking.commissionRate != null ? Number(booking.commissionRate) : null;
  const commissionLabel = safeStr(booking.commissionLabel, "Platform komisyonu");
  const commissionAmount = commissionRate != null ? Number(booking.totalPrice || 0) * (commissionRate / 100) : null;

  const childrenAges = Array.isArray(booking.childrenAges) ? booking.childrenAges : [];
  const boardTypes = Array.isArray(booking.boardTypes) ? booking.boardTypes : [];
  const featureKeys = Array.isArray(booking.featureKeys) ? booking.featureKeys : [];
  const hotelFeaturePrefs = Array.isArray(booking.hotelFeaturePrefs) ? booking.hotelFeaturePrefs : [];
  const wantedFeatures = featureKeys.length ? featureKeys : hotelFeaturePrefs;

  const cancelText = cancellationPolicyText(booking);
  const kalan = timeUntilCheckIn(booking);

  return (
    <div className="fixed inset-0 z-[80]">
      {/* overlay */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* drawer */}
      <div
        className="
          absolute right-0 top-0 h-full w-full max-w-[560px]
          bg-slate-950/95 border-l border-slate-800 shadow-2xl shadow-black/40
          translate-x-0
          animate-[slideIn_.16s_ease-out]
        "
      >
        {/* header */}
        <div className="p-4 border-b border-slate-800 flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-slate-100">Mini Detay</h3>
              <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[0.7rem] ${statusClass(booking)}`}>
                {statusText(booking)}
              </span>
            </div>

            <p className="text-[0.78rem] text-slate-400">
              {safeStr(booking.guestName)} • {booking.checkIn} – {booking.checkOut} • {nights} gece
            </p>

            <p className="text-[0.72rem] text-slate-500">
              Girişe kalan: <span className="text-slate-200 font-semibold">{kalan.label}</span>
            </p>
          </div>

          <button
            onClick={onClose}
            className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-[0.8rem] text-slate-300 hover:border-emerald-400 transition"
          >
            Kapat ✕
          </button>
        </div>

        {/* actions */}
        <div className="p-4 border-b border-slate-800 flex flex-wrap gap-2 justify-end">
          <button
            onClick={onOpenMessages}
            disabled={!canMsg}
            className={`rounded-md px-3 py-2 text-[0.8rem] font-semibold transition ${
              canMsg ? "border border-emerald-500/70 text-emerald-300 hover:bg-emerald-500/10" : "border border-slate-700 text-slate-500 cursor-not-allowed"
            }`}
          >
            Mesajlar
          </button>

          <button
            onClick={onOpenVoucher}
            disabled={!canVoucher}
            className={`rounded-md px-3 py-2 text-[0.8rem] font-semibold transition ${
              canVoucher ? "bg-sky-500 text-white hover:bg-sky-400" : "bg-slate-800 text-slate-500 cursor-not-allowed"
            }`}
            title={!canVoucher ? "İptal/Silindi: Voucher kapalı" : "Voucher / Detay"}
          >
            Voucher / Detay
          </button>
        </div>

        {/* content */}
        <div className="p-4 space-y-3 overflow-y-auto h-[calc(100%-124px)]">
          <DrawerSection title="Ödeme & Komisyon">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-slate-100 font-semibold">
                  {Number(booking.totalPrice || 0).toLocaleString("tr-TR")} {safeStr(booking.currency, "TRY")}
                </p>
                <p className="text-[0.78rem] text-slate-400">
                  {paymentMethodText(String(booking.paymentMethod))} • {safeStr(booking.paymentStatus)}
                </p>
              </div>

              {commissionRate != null && (
                <div className="text-right">
                  <p className="text-[0.72rem] text-slate-400">Komisyon oranı</p>
                  <p className="text-sm text-emerald-300 font-extrabold">%{commissionRate}</p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-2 mt-2">
              <MiniField label="Komisyon türü" value={commissionRate != null ? commissionLabel : "—"} />
              <MiniField
                label="Toplam komisyon"
                value={commissionAmount != null ? `${Number(commissionAmount).toLocaleString("tr-TR")} ${safeStr(booking.currency, "TRY")}` : "—"}
              />
            </div>
          </DrawerSection>

          <DrawerSection title="Tesis / Konum">
            <MiniField label="Tesis" value={safeStr(booking.hotelName, "Tesis")} />
            <MiniField label="Şehir / İlçe" value={`${safeStr(booking.city)}${booking.district ? ` / ${booking.district}` : ""}`} />
            <div className="grid grid-cols-2 gap-2">
              <MiniField label="Tesis türü" value={safeStr(booking.accommodationType)} />
              <MiniField label="Konaklama tipi" value={booking.boardType ? booking.boardType : (boardTypes.length ? boardTypes.join(", ") : "—")} />
            </div>
          </DrawerSection>

          <DrawerSection title="Kişi / Oda">
            <div className="grid grid-cols-2 gap-2">
              <MiniField label="Yetişkin" value={String(booking.adults ?? 0)} />
              <MiniField label="Çocuk" value={String(booking.childrenCount ?? 0)} />
              <MiniField label="Oda" value={String(booking.roomsCount || 1)} />
              <MiniField label="Gece" value={String(nights)} />
            </div>
            <MiniField label="Çocuk yaşları" value={childrenAges.length ? childrenAges.join(", ") : "—"} />
          </DrawerSection>

          <DrawerSection title="İletişim">
            <MiniField label="Ad Soyad" value={safeStr(booking.guestName)} />
            <MiniField label="Telefon" value={safeStr(booking.guestPhone)} />
            <MiniField label="2. Telefon" value={safeStr(booking.guestPhone2)} />
            <MiniField label="E-posta" value={safeStr(booking.guestEmail)} />
            <MiniField label="Firma/Kurum" value={safeStr(booking.contactCompany)} />
          </DrawerSection>

          <DrawerSection title="İptal Koşulu">
            <p className="text-sm text-slate-100 whitespace-pre-wrap">{cancelText || "—"}</p>
          </DrawerSection>

          <DrawerSection title="Otelin verdiği oda kırılımı">
            {roomBreakdown.length === 0 ? (
              <p className="text-sm text-slate-400">Kayıt yok.</p>
            ) : (
              <div className="space-y-2">
                {roomBreakdown.map((rb: any, i: number) => (
                  <div key={i} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 flex justify-between gap-3">
                    <div>
                      <p className="text-sm text-slate-100 font-semibold">{rb.roomTypeName || `Oda ${i + 1}`}</p>
                      <p className="text-[0.75rem] text-slate-400">
                        {rb.nights} gece × {Number(rb.nightlyPrice || 0).toLocaleString("tr-TR")} {safeStr(booking.currency, "TRY")}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[0.72rem] text-slate-400">Toplam</p>
                      <p className="text-sm text-emerald-300 font-extrabold">
                        {Number(rb.totalPrice || 0).toLocaleString("tr-TR")} {safeStr(booking.currency, "TRY")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </DrawerSection>

          <DrawerSection title="Misafir istekleri / özellikler">
            <MiniField label="Konum notu" value={safeStr(booking.locationNote)} />
            <MiniField label="Ek özellik notu" value={safeStr(booking.extraFeaturesText)} />
            <MiniField label="Otel özellik notu" value={safeStr(booking.hotelFeatureNote)} />
            <MiniField label="Genel not" value={safeStr(booking.requestNote)} />
            <MiniField label="İletişim notu" value={safeStr(booking.contactNote)} />

            <div className="mt-2">
              <p className="text-[0.72rem] text-slate-400">İstenen özellikler</p>
              {wantedFeatures.length ? (
                <div className="flex flex-wrap gap-2 mt-2">
                  {wantedFeatures.map((k: any, i: number) => (
                    <span key={i} className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
                      {String(k)}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400 mt-1">Belirtilmemiş.</p>
              )}
            </div>
          </DrawerSection>
        </div>
      </div>

      {/* küçük anim keyframes */}
      <style jsx global>{`
        @keyframes slideIn {
          from { transform: translateX(12px); opacity: 0.6; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

function DrawerSection({ title, children }: { title: string; children: any }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
      <p className="text-[0.75rem] text-slate-400">{title}</p>
      {children}
    </div>
  );
}

function MiniField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <p className="text-[0.72rem] text-slate-400">{label}</p>
      <p className="text-sm text-slate-100 mt-1 whitespace-pre-wrap">{value}</p>
    </div>
  );
}
