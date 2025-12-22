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
  FieldPath,
  documentId
} from "firebase/firestore";

type PaymentMethod = "card3d" | "payAtHotel";
type CancellationPolicyType = "non_refundable" | "flexible" | "until_days_before";

interface RoomBreakdownItem {
  roomTypeId?: string;
  roomTypeName?: string;
  nights?: number;
  nightlyPrice?: number;
  totalPrice?: number;
}

/** ✅ Teklif fiyat geçmişi — voucher kanıt kısmı için */
type PriceHistoryItem = {
  actor: "hotel" | "guest";
  kind: "initial" | "counter" | "update";
  price: number;
  note?: string | null;
  createdAt?: any; // Timestamp
};

interface Booking {
  id: string;
  offerId?: string | null;
  requestId?: string | null;

  hotelId?: string | null;
  hotelName?: string | null;

  guestId?: string | null;
  guestName?: string | null;

  city?: string;
  district?: string | null;

  // otelin gerçek konumu (profilinden)
  hotelCity?: string;
  hotelDistrict?: string | null;
  hotelLocationUrl?: string | null;
  hotelAddress?: string | null;
  hotelImageUrls?: string[] | null;

  // misafirin talep ettiği konum (request’ten)
  requestCity?: string;
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

  status: string; // active | cancelled | deleted | ...

  roomBreakdown?: RoomBreakdownItem[];
  commissionRate?: number | null;

  cancellationPolicyType?: CancellationPolicyType | null;
  cancellationPolicyDays?: number | null;
  cancellationPolicyLabel?: string | null;

  hasReview?: boolean;
  createdAt?: Timestamp;

  // ✅ voucher kanıtı için (offer’dan)
  offerPriceHistory?: PriceHistoryItem[] | null;
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
}

interface OfferDoc {
  id: string;
  cancellationPolicyType?: CancellationPolicyType;
  cancellationPolicyDays?: number | null;
  commissionRate?: number | null;
  roomBreakdown?: RoomBreakdownItem[];
  priceHistory?: PriceHistoryItem[];
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
  imageUrls?: string[]; // ✅ otel görselleri (voucher)
  roomTypes?: HotelRoomType[];
}

interface BookingMessage {
  id: string;
  bookingId: string;
  hotelId?: string | null;
  guestId?: string | null;
  senderRole: "guest" | "hotel";
  text: string;
  createdAt?: Timestamp;
  read?: boolean;
}

/* ---------- helpers ---------- */

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
function derivedStatus(b: Booking): "active" | "cancelled" | "completed" {
  if (b.status === "cancelled") return "cancelled";
  if (b.status === "active" && bookingIsPast(b)) return "completed";
  return "active";
}
function statusText(booking: Booking): string {
  const st = derivedStatus(booking);
  if (st === "cancelled") return "İptal edildi";
  if (st === "completed") return "Tamamlandı";
  return "Aktif";
}
function statusClass(booking: Booking): string {
  const st = derivedStatus(booking);
  if (st === "cancelled") return "bg-red-500/10 text-red-300 border-red-500/40";
  if (st === "completed") return "bg-slate-500/10 text-slate-300 border-slate-500/40";
  return "bg-emerald-500/10 text-emerald-300 border-emerald-500/40";
}

function cancellationPolicyTextFromBooking(b: Booking): string | null {
  if (b.cancellationPolicyLabel) return b.cancellationPolicyLabel;

  const type: CancellationPolicyType =
    (b.cancellationPolicyType as CancellationPolicyType) ?? "non_refundable";

  if (type === "non_refundable") return "Bu rezervasyon iptal edilemez, ücret iadesi yapılmaz.";
  if (type === "flexible") return "Giriş tarihine kadar ücretsiz iptal hakkın vardır.";
  if (type === "until_days_before") {
    const d = b.cancellationPolicyDays ?? 3;
    return `Giriş tarihinden ${d} gün öncesine kadar ücretsiz iptal hakkın vardır. Sonrasında iptal edilemez.`;
  }
  return null;
}

function canCancelBooking(b: Booking): boolean {
  if (b.status !== "active") return false;

  const checkInDate = parseDate(b.checkIn);
  if (!checkInDate) return false;

  const daysBefore = diffInDays(checkInDate, new Date());
  if (daysBefore < 0) return false;

  const type: CancellationPolicyType =
    (b.cancellationPolicyType as CancellationPolicyType) ?? "non_refundable";

  if (type === "non_refundable") return false;
  if (type === "flexible") return true;
  if (type === "until_days_before") {
    const d = b.cancellationPolicyDays ?? 0;
    return daysBefore >= d;
  }
  return false;
}

function canMessageBooking(b: Booking): boolean {
  if (b.status !== "active") return false;
  const out = parseDate(b.checkOut);
  if (!out) return true;
  return diffInDays(out, new Date()) >= 0;
}

function canReviewBooking(b: Booking): boolean {
  if (b.hasReview) return false;
  if (b.status === "cancelled") return false;
  return bookingIsPast(b);
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
    hotel.roomTypes.find((r) =>
      String(r.name ?? r.title ?? r.roomTypeName ?? r.key ?? r.typeKey ?? "").toLowerCase() === needle
    ) ||
    hotel.roomTypes.find((r) =>
      String(r.name ?? r.title ?? r.roomTypeName ?? "").toLowerCase().includes(needle)
    ) ||
    null
  );
}

/** ✅ index istemesin diye "in" chunk */
function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** ✅ check-in’e kalan süre */
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
export default function GuestBookingsPage() {
  const { profile, loading: authLoading } = useAuth();
  const db = getFirestoreDb();

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [hotelMap, setHotelMap] = useState<Record<string, HotelDoc>>({});
  const [loading, setLoading] = useState(true);

  const [pageMessage, setPageMessage] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [cancelSavingId, setCancelSavingId] = useState<string | null>(null);

  // voucher modal
  const [voucherOpen, setVoucherOpen] = useState(false);
  const [voucherBooking, setVoucherBooking] = useState<Booking | null>(null);

  // room modal
  const [roomOpen, setRoomOpen] = useState(false);
  const [roomBooking, setRoomBooking] = useState<Booking | null>(null);
  const [roomTypeName, setRoomTypeName] = useState<string>("");

  // mesaj modal
  const [messageOpen, setMessageOpen] = useState(false);
  const [messageBooking, setMessageBooking] = useState<Booking | null>(null);
  const [messageText, setMessageText] = useState("");
  const [messageSending, setMessageSending] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [messageSuccess, setMessageSuccess] = useState<string | null>(null);

  // yorum modal
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewBooking, setReviewBooking] = useState<Booking | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewText, setReviewText] = useState("");
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewSuccess, setReviewSuccess] = useState<string | null>(null);

  // ✅ Filters
  const [qText, setQText] = useState("");
  const [statusF, setStatusF] = useState<"all" | "active" | "completed" | "cancelled">("all");
  const [fromDate, setFromDate] = useState(""); // checkIn min
  const [toDate, setToDate] = useState(""); // checkOut max
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [sortKey, setSortKey] = useState<"created_desc" | "checkin_asc" | "checkout_asc" | "price_desc">("created_desc");

  // ✅ Live “reklam” ticker (hafif)
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => (t + 1) % 999999), 3400);
    return () => window.clearInterval(id);
  }, []);
  const promoLine = useMemo(() => {
    const lines = [
      "Türkiye’nin en hızlı teklif platformu: Biddakika ✅",
      "Fiyat düştüyse kaçırma — aynı gün rezervasyon yapanlar avantajlı ⚡",
      "Voucher + mesaj + yorum: hepsi tek ekranda, kanıt niteliğinde 📄",
      "Oteller “talebe özel” fiyat verir — parite baskısı yok 🧠",
      "Tamamlanan konaklamalarda yorumlar gerçek puana dönüşür ⭐"
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
        // 1) bookings (sadece misafir)
        const qBk = query(collection(db, "bookings"), where("guestId", "==", profile.uid));
        const snap = await getDocs(qBk);

        const raw: Booking[] = snap.docs
          .map((d) => {
            const v = d.data() as any;
            return {
              id: d.id,
              offerId: v.offerId ?? null,
              requestId: v.requestId ?? null,

              hotelId: v.hotelId ?? null,
              hotelName: v.hotelName ?? null,

              guestId: v.guestId ?? null,
              guestName: v.guestName ?? v.guestDisplayName ?? null,

              city: v.city ?? null,
              district: v.district ?? null,

              checkIn: v.checkIn,
              checkOut: v.checkOut,

              adults: v.adults ?? null,
              childrenCount: v.childrenCount ?? null,
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
              createdAt: v.createdAt
            } as Booking;
          })
          .filter((b) => b.status !== "deleted");

        // 2) collect ids
        const offerIds = Array.from(new Set(raw.map((b) => b.offerId).filter(Boolean))) as string[];
        const requestIds = Array.from(new Set(raw.map((b) => b.requestId).filter(Boolean))) as string[];
        const hotelIds = Array.from(new Set(raw.map((b) => b.hotelId).filter(Boolean))) as string[];

        // 3) OFFERS (rules/index güvenli: documentId in chunk)
        const offerMap: Record<string, OfferDoc> = {};
        for (const part of chunk(offerIds, 10)) {
          if (!part.length) continue;
          const qOff = query(collection(db, "offers"), where(documentId(), "in", part)
);
          const snapOff = await getDocs(qOff);
          snapOff.docs.forEach((d) => {
            const v = d.data() as any;
            offerMap[d.id] = {
              id: d.id,
              cancellationPolicyType: v.cancellationPolicyType as CancellationPolicyType | undefined,
              cancellationPolicyDays: v.cancellationPolicyDays ?? null,
              commissionRate: v.commissionRate ?? null,
              roomBreakdown: v.roomBreakdown ?? [],
              priceHistory: Array.isArray(v.priceHistory) ? v.priceHistory : []
            };
          });
        }

        // 4) REQUESTS (documentId in chunk)
        const reqMap: Record<string, RequestDoc> = {};
        for (const part of chunk(requestIds, 10)) {
          if (!part.length) continue;
          const qReq = query(collection(db, "requests"), where(documentId(), "in", part)
);
          const snapReq = await getDocs(qReq);
          snapReq.docs.forEach((d) => {
            const v = d.data() as any;
            reqMap[d.id] = {
              id: d.id,
              city: v.city,
              district: v.district ?? null,
              checkIn: v.checkIn,
              checkOut: v.checkOut,
              adults: v.adults,
              childrenCount: v.childrenCount ?? 0,
              childrenAges: v.childrenAges ?? [],
              roomsCount: v.roomsCount ?? 1,
              roomTypes: v.roomTypes ?? []
            };
          });
        }

        // 5) HOTELS (users/{hotelId} documentId in chunk)
        const hMap: Record<string, HotelDoc> = {};
        for (const part of chunk(hotelIds, 10)) {
          if (!part.length) continue;
          const qH = query(collection(db, "users"), where(documentId(), "in", part)
);
          const snapH = await getDocs(qH);
          snapH.docs.forEach((d) => {
            const v = d.data() as any;
            const hp = v.hotelProfile || {};
            const roomTypes: HotelRoomType[] = hp.roomTypes || hp.rooms || hp.roomCatalog || hp.roomTypeCatalog || [];
            const imageUrls: string[] = hp.imageUrls || hp.images || hp.gallery || [];

            hMap[d.id] = {
              id: d.id,
              city: hp.city || v.city,
              district: hp.district ?? v.district ?? null,
              locationUrl: hp.locationUrl || v.locationUrl || null,
              address: hp.address || v.address || null,
              imageUrls: Array.isArray(imageUrls) ? imageUrls : [],
              roomTypes: Array.isArray(roomTypes) ? roomTypes : []
            };
          });
        }
        setHotelMap(hMap);

        // 6) enrich bookings
        const enriched: Booking[] = raw.map((b) => {
          const off = b.offerId ? offerMap[b.offerId] : undefined;
          const req = b.requestId ? reqMap[b.requestId] : undefined;
          const hotel = b.hotelId ? hMap[b.hotelId] : undefined;

          const checkIn = b.checkIn ?? req?.checkIn ?? "";
          const checkOut = b.checkOut ?? req?.checkOut ?? "";
          const nights = calcNights(checkIn, checkOut);

          const roomBreakdown =
            (b.roomBreakdown && b.roomBreakdown.length > 0 ? b.roomBreakdown : off?.roomBreakdown) ?? [];

          const cancellationPolicyType =
            (b.cancellationPolicyType as CancellationPolicyType) ?? off?.cancellationPolicyType ?? null;

          const cancellationPolicyDays = b.cancellationPolicyDays ?? off?.cancellationPolicyDays ?? null;

          return {
            ...b,
            city: req?.city ?? b.city,
            district: (req?.district as string | null) ?? b.district,
            requestCity: req?.city,
            requestDistrict: (req?.district as string | null) ?? null,

            hotelCity: hotel?.city,
            hotelDistrict: hotel?.district ?? null,
            hotelLocationUrl: hotel?.locationUrl ?? null,
            hotelAddress: hotel?.address ?? null,
            hotelImageUrls: hotel?.imageUrls ?? null,

            checkIn,
            checkOut,
            nights,
            roomBreakdown,

            cancellationPolicyType,
            cancellationPolicyDays,
            commissionRate: b.commissionRate ?? off?.commissionRate ?? null,

            adults: b.adults ?? req?.adults ?? b.adults ?? null,
            childrenCount: b.childrenCount ?? req?.childrenCount ?? null,
            childrenAges: b.childrenAges ?? req?.childrenAges ?? null,
            roomsCount: b.roomsCount ?? req?.roomsCount ?? null,

            offerPriceHistory: off?.priceHistory ?? null
          };
        });

        enriched.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
        setBookings(enriched);
      } catch (err: any) {
        console.error("Misafir rezervasyonları yüklenirken hata:", err);
        setPageError(err?.message || "Rezervasyonlar yüklenirken bir hata oluştu.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [authLoading, profile, db]);

  // ✅ Summary Cards
  const summary = useMemo(() => {
    const valid = bookings.filter((b) => b.status !== "cancelled" && b.status !== "deleted");
    const totalSpend = valid.reduce((s, b) => s + Number(b.totalPrice || 0), 0);
    const totalNights = valid.reduce((s, b) => s + Number(b.nights ?? calcNights(b.checkIn, b.checkOut)), 0);

    const cityCount: Record<string, number> = {};
    valid.forEach((b) => {
      const c = (b.hotelCity || b.city || "—").toString();
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

    return { totalSpend, totalNights, topCity, activeCount: valid.length };
  }, [bookings]);

  // ✅ Filters apply
  const filteredBookings = useMemo(() => {
    let list = [...bookings];

    const q = qText.trim().toLowerCase();
    if (q) {
      list = list.filter((b) => {
        const hay = [
          b.id,
          b.hotelName,
          b.hotelCity,
          b.hotelDistrict,
          b.city,
          b.district,
          b.checkIn,
          b.checkOut
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }

    if (statusF !== "all") {
      list = list.filter((b) => derivedStatus(b) === statusF);
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
  }, [bookings, qText, statusF, fromDate, toDate, minPrice, maxPrice, sortKey]);

  // --- UI handlers
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

      await addDoc(collection(db, "bookingMessages"), {
        bookingId: messageBooking.id,
        hotelId: messageBooking.hotelId ?? null,
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
      console.error("Misafir mesaj gönderirken hata:", err);
      setMessageError("Mesaj gönderilirken bir hata oluştu. (Rules / bağlantı kontrol et)");
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
      setCancelSavingId(b.id);
      setPageError(null);
      setPageMessage(null);

      await updateDoc(doc(db, "bookings", b.id), {
        status: "cancelled",
        cancelledAt: serverTimestamp()
      });

      setBookings((prev) => prev.map((bk) => (bk.id === b.id ? { ...bk, status: "cancelled" } : bk)));
      setPageMessage("Rezervasyonun iptal edildi.");
    } catch (err) {
      console.error("Rezervasyon iptal edilirken hata:", err);
      setPageError("Rezervasyon iptal edilirken bir hata oluştu.");
    } finally {
      setCancelSavingId(null);
    }
  }
  async function handleDeleteCompletedBooking(b: Booking) {
  // sadece tamamlanan + misafirin kendi booking'i ise gösterilecek zaten
  const ok1 = window.confirm("Bu tamamlanan rezervasyonu silmek istiyor musun?");
  if (!ok1) return;

  const ok2 = window.confirm("Emin misin? Bu işlem geri alınamaz ve rezervasyon listenden kaldırılacak.");
  if (!ok2) return;

  try {
    setCancelSavingId(b.id); // aynı spinner state'i kullanalım
    setPageError(null);
    setPageMessage(null);

    await updateDoc(doc(db, "bookings", b.id), {
      status: "deleted",
      deletedAt: serverTimestamp()
    });

    // listeden kaldır
    setBookings((prev) => prev.filter((x) => x.id !== b.id));
    setPageMessage("Tamamlanan rezervasyon listenden kaldırıldı.");
  } catch (err) {
    console.error("Tamamlanan rezervasyon silinirken hata:", err);
    setPageError("Rezervasyon silinirken hata oluştu.");
  } finally {
    setCancelSavingId(null);
  }
}


  /** ✅ İptal/ tamamlanan rezervasyonu “listeden kaldır” (silme) */
  async function handleArchiveBooking(b: Booking) {
    const ok = window.confirm("Bu rezervasyonu listeden kaldırmak (arşivlemek) istiyor musun?");
    if (!ok) return;

    try {
      await updateDoc(doc(db, "bookings", b.id), { status: "deleted", deletedAt: serverTimestamp() });
      setBookings((prev) => prev.filter((bk) => bk.id !== b.id));
      setPageMessage("Rezervasyon listeden kaldırıldı.");
      setTimeout(() => setPageMessage(null), 1200);
    } catch (err) {
      console.error("Rezervasyonu arşivlerken hata:", err);
      setPageError("Rezervasyonu listeden kaldırırken bir hata oluştu.");
    }
  }

  return (
    <Protected allowedRoles={["guest"]}>
      <div className="container-page space-y-6">
        {/* Premium promo strip */}
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
                Burada tüm rezervasyonların var. <b>Voucher</b> (kanıt), <b>mesajlaşma</b>, <b>yorum</b>, oda görselleri ve fiyat kırılımı tek yerde.
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 w-full md:w-auto">
              <StatCard title="Aktif" value={`${summary.activeCount}`} />
              <StatCard title="Toplam gece" value={`${summary.totalNights}`} />
              <StatCard title="Toplam harcama" value={`${summary.totalSpend.toLocaleString("tr-TR")} ₺`} strong />
              <StatCard title="En sık şehir" value={summary.topCity} />
            </div>
          </div>

          {/* Ads small */}
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            ✅ “İyi ki var Biddakika” — voucher + mesaj + yorum = tam kayıt. Otelde elinde kanıt olur.
          </div>

          {/* Filters */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3 shadow shadow-slate-950/40">
            <div className="grid gap-3 md:grid-cols-12 items-end">
              <div className="md:col-span-4 space-y-1">
                <label className="text-[0.7rem] text-slate-300">Ara</label>
                <input
                  value={qText}
                  onChange={(e) => setQText(e.target.value)}
                  placeholder="Otel adı / şehir / tarih / rezervasyon no..."
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

              <div className="md:col-span-1 space-y-1">
                <label className="text-[0.7rem] text-slate-300">Min ₺</label>
                <input
                  value={minPrice}
                  onChange={(e) => setMinPrice(e.target.value)}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
                  placeholder="0"
                />
              </div>

              <div className="md:col-span-1 space-y-1">
                <label className="text-[0.7rem] text-slate-300">Max ₺</label>
                <input
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
                  placeholder="99999"
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
            {pageError && (
              <p className="text-red-300 bg-red-500/10 border border-red-500/40 rounded-md px-3 py-2">{pageError}</p>
            )}
            {pageMessage && (
              <p className="text-emerald-300 bg-emerald-500/10 border border-emerald-500/40 rounded-md px-3 py-2">{pageMessage}</p>
            )}
          </section>
        )}

        {loading && <p className="text-sm text-slate-400">Rezervasyonlar yükleniyor...</p>}

        {!loading && filteredBookings.length === 0 && (
          <p className="text-sm text-slate-400">Filtrelere uygun rezervasyon bulunamadı.</p>
        )}
        {filteredBookings.length > 0 && (
          <section className="rounded-2xl border border-slate-800 bg-slate-950/80 shadow shadow-slate-950/40 text-xs overflow-hidden">
            <div className="hidden md:grid grid-cols-[2fr_1.6fr_1.4fr_1.2fr_auto] bg-slate-900 text-[0.75rem] font-semibold text-slate-100 px-4 py-2">
              <div>Tesis / konum</div>
              <div>Tarih / kişi</div>
              <div>Ödeme & iptal</div>
              <div>Kalan süre</div>
              <div className="text-right">İşlemler</div>
            </div>

            {filteredBookings.map((b) => {
              const createdStr = b.createdAt ? b.createdAt.toDate().toLocaleString("tr-TR") : "—";
              const nights = b.nights ?? calcNights(b.checkIn, b.checkOut);
              const st = derivedStatus(b);

              const canCancel = canCancelBooking(b);
              const canMsg = canMessageBooking(b);
              const canReview = canReviewBooking(b);

              const cd = checkInCountdown(b.checkIn);
              const mapsUrl = buildMapsUrl(b, b.hotelId ? hotelMap[b.hotelId] : null);

              // “kanıt”: price history varsa fiyat düştü mü?
              const ph = Array.isArray(b.offerPriceHistory) ? b.offerPriceHistory : [];
              const hotelPrices = ph.filter((x) => x?.actor === "hotel").map((x) => Number(x.price || 0)).filter((x) => x > 0);
              const minHotel = hotelPrices.length ? Math.min(...hotelPrices) : null;
              const maxHotel = hotelPrices.length ? Math.max(...hotelPrices) : null;
              const hasDrop = minHotel != null && maxHotel != null && minHotel < maxHotel;

              return (
                <div key={b.id} className="border-t border-slate-800">
                  <div className="grid md:grid-cols-[2fr_1.6fr_1.4fr_1.2fr_auto] gap-2 px-4 py-3 items-start">
                    {/* Tesis */}
                    <div className="space-y-1">
                      <div className="text-slate-100 text-sm font-semibold flex items-center gap-2 flex-wrap">
                        {b.hotelName || "Tesis"}
                        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[0.7rem] ${statusClass(b)}`}>
                          {statusText(b)}
                        </span>

                        {hasDrop && (
                          <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[0.7rem] ${pillTone("emerald")}`}>
                            🔥 Fiyat düştü
                          </span>
                        )}
                      </div>

                      <div className="text-[0.75rem] text-slate-300">
                        {safeStr(b.hotelCity || b.city)}
                        {b.hotelDistrict ? ` / ${b.hotelDistrict}` : ""}
                      </div>

                      {b.hotelAddress && (
                        <div className="text-[0.72rem] text-slate-500">
                          Adres: {b.hotelAddress}
                        </div>
                      )}

                      {mapsUrl && (
                        <a className="text-[0.72rem] text-sky-300 hover:underline" href={mapsUrl} target="_blank" rel="noreferrer">
                          Konumu aç (Maps)
                        </a>
                      )}

                      <div className="text-[0.7rem] text-slate-500">
                        Rezervasyon No: <span className="text-slate-200">{b.id}</span> • Oluşturma: {createdStr}
                      </div>

                      {/* küçük reklam */}
                      <div className="text-[0.72rem] text-emerald-200/80">
                        ✅ Biddakika: Voucher + mesaj + yorum = tek dosya.
                      </div>
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
                      <p className="text-[0.75rem] text-slate-400">
                        Ödeme: {paymentMethodText(b.paymentMethod as string)}
                      </p>
                      <p className="text-[0.75rem] text-slate-400">
                        Durum: {safeStr(b.paymentStatus)}
                      </p>
                      {cancellationPolicyTextFromBooking(b) && (
                        <p className="text-[0.7rem] text-slate-400">
                          İptal: {cancellationPolicyTextFromBooking(b)}
                        </p>
                      )}
                    </div>

                    {/* Kalan süre */}
                    <div className="space-y-1">
                      <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[0.75rem] ${pillTone(cd.tone as any)}`}>
                        ⏱️ {cd.label}
                      </span>
                      {st === "completed" && (
                        <div className="text-[0.72rem] text-slate-400">Konaklama bitti — yorum bırakmayı unutma ⭐</div>
                      )}
                      {st === "cancelled" && (
                        <div className="text-[0.72rem] text-red-300">İptal edildi</div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex md:flex-col flex-col gap-2 items-end">
                      {canMsg ? (
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

                      <button
                        type="button"
                        onClick={() => openVoucher(b)}
                        className="w-full md:w-auto rounded-md bg-sky-500 text-white px-3 py-2 text-[0.75rem] font-semibold hover:bg-sky-400"
                      >
                        Voucher / Detay
                      </button>

                      {canCancel && (
                        <button
                          type="button"
                          onClick={() => handleCancelBooking(b)}
                          disabled={cancelSavingId === b.id}
                          className="w-full md:w-auto rounded-md bg-amber-500 text-slate-950 px-3 py-2 text-[0.75rem] font-semibold hover:bg-amber-400 disabled:opacity-60"
                        >
                          {cancelSavingId === b.id ? "İptal ediliyor..." : "İptal et"}
                        </button>
                      )}

                     

                      {b.status === "cancelled" && (
                        <button
                          type="button"
                          onClick={() => handleArchiveBooking(b)}
                          className="w-full md:w-auto rounded-md border border-slate-700 px-3 py-2 text-[0.75rem] text-slate-200 hover:border-red-500 hover:text-red-300"
                        >
                          İptali sil
                        </button>
                      )}

                      {canReview && (
                        <button
                          type="button"
                          onClick={() => openReviewModal(b)}
                          className="w-full md:w-auto rounded-md border border-emerald-500/70 px-3 py-2 text-[0.75rem] text-emerald-300 hover:bg-emerald-500/10"
                        >
                          Yorum yap
                        </button>
                      )}
                      {/* ✅ Tamamlanan rezervasyonu sil (2 kez onay) */}
{derivedStatus(b) === "completed" && (
  <button
    type="button"
    onClick={() => handleDeleteCompletedBooking(b)}
    disabled={cancelSavingId === b.id}
    className="w-full md:w-auto rounded-md border border-red-500/50 px-3 py-2 text-[0.75rem] text-red-200 hover:bg-red-500/10 disabled:opacity-60"
  >
    {cancelSavingId === b.id ? "Siliniyor..." : "Sil"}
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

        {/* VOUCHER */}
        {voucherOpen && voucherBooking && profile && (
          <BookingVoucherModalAdvanced
            booking={voucherBooking}
            guestProfile={profile}
            hotel={voucherBooking.hotelId ? hotelMap[voucherBooking.hotelId] : undefined}
            onOpenRoom={(roomName) => openRoomDetail(voucherBooking, roomName)}
            onClose={closeVoucher}
          />
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
/* -------------------- VOUCHER / DETAY (ADVANCED + SUNUM) -------------------- */

function BookingVoucherModalAdvanced({
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

  // hotel images
  const hotelImages = (booking.hotelImageUrls || hotel?.imageUrls || []).filter(Boolean);
  const [activeImg, setActiveImg] = useState(0);

  // price history (kanıt)
  const ph = Array.isArray(booking.offerPriceHistory) ? booking.offerPriceHistory : [];
  const phSorted = useMemo(() => {
    const arr = [...ph];
    arr.sort((a, b) => (a?.createdAt?.toMillis?.() ?? 0) - (b?.createdAt?.toMillis?.() ?? 0));
    return arr;
  }, [ph]);

  function actorTR(a: string) {
    return a === "hotel" ? "Otel" : "Misafir";
  }
  function kindTR(k: string) {
    if (k === "initial") return "İlk fiyat";
    if (k === "update") return "Fiyat güncellendi";
    return "Karşı teklif";
  }

  // voucher text (print)
  const voucherLines: string[] = [];
  voucherLines.push("Biddakika — Rezervasyon Voucherı");
  voucherLines.push(`Rezervasyon No: ${booking.id}`);
  voucherLines.push(`Tesis: ${safeStr(booking.hotelName)}`);
  voucherLines.push(`Konum: ${safeStr(booking.hotelCity || booking.city)}${booking.hotelDistrict ? " / " + booking.hotelDistrict : ""}`);
  if (booking.hotelAddress) voucherLines.push(`Adres: ${booking.hotelAddress}`);
  voucherLines.push(`Konaklama: ${booking.checkIn} – ${booking.checkOut} (${nights} gece)`);
  voucherLines.push(`Kişi/Oda: ${(booking.adults ?? 0)} yetişkin${booking.childrenCount ? " • " + booking.childrenCount + " çocuk" : ""} • ${booking.roomsCount || 1} oda`);
  voucherLines.push("");
  voucherLines.push(`Toplam: ${Number(booking.totalPrice || 0).toLocaleString("tr-TR")} ${safeStr(booking.currency, "TRY")}`);
  voucherLines.push(`Ödeme: ${paymentMethodText(String(booking.paymentMethod))} • Durum: ${safeStr(booking.paymentStatus)}`);
  if (cancelText) voucherLines.push(`İptal: ${cancelText}`);

  if (roomBreakdown.length) {
    voucherLines.push("");
    voucherLines.push("Oda/Fiyat Kırılımı:");
    roomBreakdown.forEach((rb) => {
      const n = rb.nights ?? nights;
      const nightly = Number(rb.nightlyPrice ?? 0);
      const total = Number(rb.totalPrice ?? nightly * n);
      voucherLines.push(`• ${rb.roomTypeName || "Oda"} — ${n} gece x ${nightly} = ${total} ${safeStr(booking.currency, "TRY")}`);
    });
  }

  if (phSorted.length) {
    voucherLines.push("");
    voucherLines.push("Fiyat Geçmişi (kanıt):");
    phSorted.forEach((x) => {
      voucherLines.push(`• ${actorTR(x.actor)} / ${kindTR(x.kind)}: ${Number(x.price).toLocaleString("tr-TR")} ${safeStr(booking.currency, "TRY")}`);
    });
  }

  voucherLines.push("");
  voucherLines.push("Misafir:");
  voucherLines.push(`Ad Soyad: ${safeStr(guestProfile?.displayName || booking.guestName)}`);
  voucherLines.push(`E-posta: ${safeStr(guestProfile?.email)}`);

  const voucherText = voucherLines.join("\n");

  function handlePrint() {
    const html = `
<!doctype html><html><head><meta charset="utf-8" />
<title>Voucher - ${booking.id}</title>
<style>
  body{font-family:Arial,sans-serif;padding:24px;color:#111}
  h1{font-size:18px;margin:0 0 12px}
  pre{white-space:pre-wrap;font-size:12px;line-height:1.45}
  .box{border:1px solid #ddd;padding:12px;border-radius:10px}
  .brand{color:#059669;font-weight:700}
</style>
</head><body>
<h1><span class="brand">Biddakika</span> — Rezervasyon Voucherı</h1>
<div class="box"><pre>${voucherText.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</pre></div>
<script>window.print();</script>
</body></html>`;
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

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative mt-10 w-full max-w-5xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-2xl max-h-[88vh] overflow-y-auto space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-100">Biddakika Voucher / Kanıt</h2>
            <p className="text-[0.75rem] text-slate-400">
              Rezervasyon No: <span className="text-slate-200 font-semibold">{booking.id}</span>
            </p>
            <p className="text-[0.75rem] text-emerald-200/80">
              ✅ Türkiye’nin en iyi otel satış platformu — iyi ki var Biddakika.
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

        {/* hotel presentation */}
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
              title="Konaklama"
              lines={[
                `${booking.checkIn} – ${booking.checkOut} (${booking.nights ?? calcNights(booking.checkIn, booking.checkOut)} gece)`,
                `${(booking.adults ?? 0) + (booking.childrenCount ?? 0)} kişi • ${booking.roomsCount || 1} oda`
              ]}
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

        {/* room breakdown */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-2">
          <p className="text-[0.75rem] text-slate-400">Oda / fiyat kırılımı (kanıt)</p>

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

        {/* price history */}
        {phSorted.length > 0 && (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-2">
            <p className="text-[0.75rem] text-slate-400">Fiyat geçmişi (pazarlık / güncelleme kanıtı)</p>
            <div className="grid gap-2 md:grid-cols-2">
              {phSorted.map((x, idx) => (
                <div key={idx} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-slate-100 font-semibold">
                      {actorTR(x.actor)} • <span className="text-slate-300">{kindTR(x.kind)}</span>
                    </div>
                    <div className="text-emerald-300 font-extrabold">
                      {Number(x.price || 0).toLocaleString("tr-TR")} {safeStr(booking.currency, "TRY")}
                    </div>
                  </div>
                  {x.createdAt?.toDate && (
                    <div className="text-[0.7rem] text-slate-500 mt-1">{x.createdAt.toDate().toLocaleString("tr-TR")}</div>
                  )}
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

        <p className="text-[0.7rem] text-slate-500">
          Bu voucher, otelde hızlı kontrol için tüm bilgileri içerir. İstersen yazdırıp PDF al.
        </p>
      </div>
    </div>
  );
}

function actorTR(a: string) {
  return a === "hotel" ? "Otel" : "Misafir";
}
function kindTR(k: string) {
  if (k === "initial") return "İlk fiyat";
  if (k === "update") return "Fiyat güncellendi";
  return "Karşı teklif";
}

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
    (room?.images as string[]) ||
    (room?.gallery as string[]) ||
    (room?.photos as string[]) ||
    (room?.imageUrls as string[]) ||
    [];

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
          <button
            onClick={onClose}
            className="rounded-full border border-slate-700 bg-slate-900 px-3 py-2 text-[0.75rem] text-slate-300 hover:border-emerald-400"
          >
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

        <p className="text-[0.7rem] text-slate-500">Oda detayları, otelin profilinde tanımladığı bilgilere göre gösterilir.</p>
      </div>
    </div>
  );
}

/* -------------------- MESAJ MODALI (GUEST) — index’siz güvenli -------------------- */

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
    // ✅ orderBy kaldırdım (index istemesin diye) — snapshot içinden sort yapıyoruz
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
            guestId: v.guestId ?? null,
            senderRole: v.senderRole,
            text: v.text,
            createdAt: v.createdAt,
            read: v.read
          };
        });

        // client-side sort
        msgs.sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));

        setMessages(msgs);
        setLoadingMessages(false);

        // otelden gelen okunmamış mesajları okundu işaretle
        const unreadHotelMsgs = snap.docs.filter((d) => {
          const v = d.data() as any;
          return v.senderRole === "hotel" && v.read === false;
        });

        for (const dSnap of unreadHotelMsgs) {
          try {
            await updateDoc(dSnap.ref, { read: true });
          } catch (err) {
            console.error("Mesaj okundu işaretlenirken hata:", err);
          }
        }
      },
      (err) => {
        console.error("Mesajlar okunurken hata:", err);
        setLoadingMessages(false);
      }
    );

    return () => unsub();
  }, [db, booking.id]);

  const messagingClosed = !canMessageBooking(booking);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />

      <div className="relative mt-16 w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-xl shadow-slate-950/60 text-sm space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-100">Otelle mesajlaş</h2>
            <p className="text-[0.78rem] text-slate-400">{safeStr(booking.hotelName)} • {booking.checkIn} – {booking.checkOut}</p>
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
                <div
                  className={`max-w-[82%] rounded-2xl px-3 py-2 text-[0.85rem] shadow ${
                    isGuest ? "bg-emerald-500 text-slate-950 rounded-br-none" : "bg-slate-800 text-slate-100 rounded-bl-none"
                  }`}
                >
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
              placeholder="Örn: Geç giriş yapacağız, mümkün mü?"
              className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm resize-none disabled:opacity-60 outline-none focus:border-emerald-400"
            />
          </div>

          {error && <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[0.8rem] text-red-200">{error}</div>}
          {success && <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[0.8rem] text-emerald-200">{success}</div>}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md border border-slate-700 px-3 py-2 text-[0.8rem] text-slate-200 hover:border-slate-500">
              Kapat
            </button>
            <button
              type="submit"
              disabled={sending || messagingClosed}
              className="rounded-md bg-emerald-500 text-slate-950 px-4 py-2 text-[0.8rem] font-semibold hover:bg-emerald-400 disabled:opacity-60"
            >
              {sending ? "Gönderiliyor..." : "Gönder"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* -------------------- YORUM MODALI -------------------- */

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
            <p className="text-[0.78rem] text-slate-400">{safeStr(booking.hotelName)} • {booking.checkIn} – {booking.checkOut}</p>
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
                  className={`w-9 h-9 rounded-full text-sm font-semibold ${
                    rating >= star ? "bg-amber-400 text-slate-950" : "bg-slate-800 text-slate-300"
                  }`}
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
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-emerald-500 text-slate-950 px-4 py-2 text-[0.8rem] font-semibold hover:bg-emerald-400 disabled:opacity-60"
            >
              {saving ? "Gönderiliyor..." : "Gönder"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
