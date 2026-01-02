"use client";

import React, { useEffect, useMemo, useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Protected } from "@/components/Protected";
import { useAuth } from "@/context/AuthContext";
import { getFirestoreDb } from "@/lib/firebase/client";

import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where
} from "firebase/firestore";

/* ---------------- TYPES ---------------- */
type AnyObj = Record<string, any>;

type OfferMode = "simple" | "refreshable" | "negotiable";
type PaymentMethod = "card3d" | "payAtHotel";
type CancellationPolicyType = "non_refundable" | "flexible" | "until_days_before";

type PriceHistoryKind = "initial" | "counter" | "update";
type PriceHistoryActor = "hotel" | "guest";
type PriceHistoryItem = {
  actor: PriceHistoryActor;
  kind: PriceHistoryKind;
  price: number;
  currency?: string;
  note?: string | null;
  createdAt: any; // Timestamp
};

interface GuestOffer {
  id: string;
  requestId: string;
  hotelId: string;
  hotelName?: string | null;
  totalPrice: number;
  currency: string;
  mode: OfferMode;
  note?: string | null;
  status: string; // sent | countered | rejected | accepted | withdrawn | cancelled | hotel_cancelled
  guestCounterPrice?: number | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;

  roomTypeId?: string | null;
  roomTypeName?: string | null;
  roomBreakdown?: {
    roomTypeId?: string;
    roomTypeName?: string;
    nights?: number;
    nightlyPrice?: number;
    totalPrice?: number;
    count?: number;
    name?: string;
  }[];

  cancellationPolicyType?: CancellationPolicyType | null;
  cancellationPolicyDays?: number | null;

  priceHistory?: PriceHistoryItem[];
}

interface RequestSummary {
  id: string;

  city: string;
  district?: string | null;

  checkIn: string;
  checkOut: string;

  checkInTime?: string | null;
  checkOutTime?: string | null;

  sameDayStay?: boolean | null;

  earlyCheckInWanted?: boolean | null;
  earlyCheckInTime?: string | null;

  lateCheckOutWanted?: boolean | null;
  lateCheckOutFrom?: string | null;
  lateCheckOutTo?: string | null;

  adults: number;
  childrenCount?: number;
  childrenAges?: number[];
  roomsCount?: number;
  roomTypes?: string[];

  responseDeadlineMinutes?: number;
  createdAt?: Timestamp;

  status?: string | null;

  // ✅ Restart: eski teklifleri gizlemek için
  restartAt?: Timestamp | null;

  type?: string | null;
  isGroup?: boolean;

  hotelType?: string | null;
  mealPlan?: string | null;
  starRatingPref?: number | null;

  boardTypes?: string[];
  boardTypeNote?: string | null;

  hotelFeaturePrefs?: string[];
  hotelFeatureNote?: string | null;

  desiredStarRatings?: number[] | null;
  generalNote?: string | null;

  nearMe?: boolean | null;

  // DB’deki her şey
  raw?: AnyObj;
}

interface RoomTypeProfile {
  id: string;
  name: string;
  shortDescription?: string;
  description?: string;
  maxAdults?: number | null;
  maxChildren?: number | null;
  imageUrls?: string[];
  images?: string[];
  gallery?: string[];
  photos?: string[];
}

interface HotelProfile {
  address?: string;
  starRating?: number;
  description?: string;

  boardTypes?: string[];
  features?: string[];

  imageUrls?: string[];
  images?: string[];
  gallery?: string[];
  photos?: string[];

  youtubeUrl?: string;
  roomTypes?: RoomTypeProfile[];

  paymentOptions?: {
    card3d: boolean;
    payAtHotel: boolean;
  };

  cancellationPolicyType?: CancellationPolicyType;
  cancellationPolicyDays?: number | null;
  cancellationPolicyLabel?: string | null;

  locationLat?: string | null;
  locationLng?: string | null;
  locationUrl?: string | null;
}

interface HotelInfo {
  id: string;
  displayName?: string;
  email?: string;
  website?: string;
  hotelProfile?: HotelProfile;
}

/* ---------------- PACKAGE TYPES ---------------- */
type PackageRequestStatus = "open" | "expired" | "accepted" | "deleted";
type PackagePaymentMethod = "card3d" | "transfer" | "payAtDoor";

type PackageRequest = {
  id: string;
  raw?: any;

  title?: string | null;

  country?: string | null;
  city?: string | null;
  district?: string | null;

  dateFrom?: string | null;
  dateTo?: string | null;
  nights?: number | null;

  paxAdults?: number | null;
  paxChildren?: number | null;
  childrenAges?: number[] | null;

  roomsCount?: number | null;
  roomTypes?: string[] | null;

  needs?: string[] | null;

  wantsTours?: boolean | null;
  tourCount?: number | null;
  tourNotes?: string | null;

  wantsTransfer?: boolean | null;
  transferType?: "oneway" | "round" | null;
  transferNotes?: string | null;

  wantsCar?: boolean | null;
  carType?: string | null;
  licenseYear?: number | null;
  carNotes?: string | null;

  extras?: string[] | null;
  activities?: any;

  note?: string | null;

  responseDeadlineMinutes?: number | null;
  createdByRole?: string | null;
  createdById?: string | null;

  acceptedOfferId?: string | null;
  bookingId?: string | null;

  status?: string | null;
  createdAt?: Timestamp;

  hiddenFromGuest?: boolean | null;
  hiddenAt?: Timestamp | null;
};

type PackageOffer = {
  id: string;
  requestId: string;

  agencyId: string;
  agencyName?: string | null;

  totalPrice: number;
  currency: string;

  breakdown?: { hotel?: number; transfer?: number; tours?: number; other?: number };
  packageDetails?: {
    hotelName?: string;
    roomType?: string;
    boardType?: string;
    transferType?: string;
    transferPlan?: string;
    tourPlan?: string[];
    carPlan?: string;
    extrasPlan?: string;
  };

  note?: string | null;
  status?: "sent" | "updated" | "withdrawn" | "accepted" | "rejected";
  createdAt?: Timestamp;
  updatedAt?: Timestamp;

  paymentOptions?: {
    card3d?: boolean;
    transfer?: boolean;
    payAtDoor?: boolean;
  };
};

type AgencyInfo = {
  id: string;
  displayName?: string | null;
  email?: string | null;
  agencyProfile?: {
    businessName?: string | null;
    website?: string | null;
    phone?: string | null;
    address?: string | null;
    city?: string | null;
    district?: string | null;
    taxNo?: string | null;
    about?: string | null;
  } | null;
};

const MODE_LABEL_PUBLIC: Record<OfferMode, string> = {
  simple: "Standart teklif",
  refreshable: "Yenilenebilir teklif",
  negotiable: "Pazarlıklı teklif"
};
/* ---------------- HELPERS ---------------- */
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
// ✅ PackageOffersModal helper paketi (TEK ve eksiksiz)

function pickFirst(raw: any, keys: string[], fallback: any = null) {
  for (const k of keys) {
    if (!k) continue;

    // "contact?.name" veya "contact.name"
    if (k.includes("?.") || k.includes(".")) {
      const path = k.replace(/\?\./g, ".").split(".");
      let cur: any = raw;
      for (const p of path) {
        if (!cur) { cur = undefined; break; }
        cur = cur[p];
      }
      if (cur !== undefined && cur !== null && String(cur).trim() !== "") return cur;
      continue;
    }

    const v = raw?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return fallback;
}

function asArray(v: any): any[] {
  if (Array.isArray(v)) return v;
  if (v === null || v === undefined) return [];
  return [v];
}

function joinSmart(v: any, sep = " • ") {
  const arr = asArray(v)
    .map((x) => (x === null || x === undefined ? "" : String(x).trim()))
    .filter(Boolean);
  return arr.length ? arr.join(sep) : "—";
}

function safeBool(v: any) {
  return v === true || v === "true" || v === 1 || v === "1";
}

function normalizePhone(v: any) {
  if (!v) return "—";
  const s = String(v).trim();
  return s.length ? s : "—";
}

function objectToChips(obj: any) {
  if (!obj || typeof obj !== "object") return [];
  return Object.entries(obj)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .slice(0, 50);
}


function stripUndefined<T extends Record<string, any>>(obj: T): Partial<T> {
  const out: Record<string, any> = {};
  Object.keys(obj || {}).forEach((k) => {
    const v = (obj as any)[k];
    if (v !== undefined) out[k] = v;
  });
  return out as Partial<T>;
}

function chunkArray<T>(arr: T[], size = 10) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
function toMillis(ts: any) {
  try {
    if (!ts) return 0;
    if (typeof ts?.toMillis === "function") return ts.toMillis();
    if (typeof ts?.toDate === "function") return ts.toDate().getTime();
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
  } catch {
    return 0;
  }
}
function todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function isCheckInPast(checkIn?: string | null) {
  if (!checkIn) return false;
  const d = new Date(checkIn);
  if (Number.isNaN(d.getTime())) return false;
  d.setHours(0, 0, 0, 0);
  return d.getTime() < todayStart().getTime();
}

function diffInDays(a: Date, b: Date) {
  const aa = new Date(a); aa.setHours(0,0,0,0);
  const bb = new Date(b); bb.setHours(0,0,0,0);
  return Math.floor((aa.getTime() - bb.getTime()) / 86400000);
}
function calcNightsFromISO(a?: string | null, b?: string | null) {
  if (!a || !b) return 1;
  const d1 = new Date(a);
  const d2 = new Date(b);
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return 1;
  const diff = diffInDays(d2, d1);
  return diff > 0 ? diff : 1;
}

/* ---- STATUS / COUNTDOWN (HOTEL REQUEST) ---- */
function computeRequestStatus(req: RequestSummary, nowMs: number) {
  const created = req.createdAt?.toDate?.().getTime();
  const minutes = req.responseDeadlineMinutes ?? 0;
  if (!created || !minutes) return "open" as const;

  const deadlineMs = created + minutes * 60 * 1000;
  return nowMs > deadlineMs ? ("expired" as const) : ("open" as const);
}
function formatRemaining(req: RequestSummary, nowMs: number) {
  const created = req.createdAt?.toDate?.().getTime();
  const minutes = req.responseDeadlineMinutes ?? 0;
  if (!created || !minutes) return { text: "-", color: "green" as const, ratio: 0 };

  const totalMs = minutes * 60 * 1000;
  const deadlineMs = created + totalMs;
  const diff = deadlineMs - nowMs;

  if (diff <= 0) return { text: "Süre doldu", color: "red" as const, ratio: 1 };

  const elapsed = Math.min(totalMs, Math.max(0, nowMs - created));
  const ratio = totalMs ? elapsed / totalMs : 0;

  const totalSec = Math.floor(diff / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  let color: "green" | "yellow" | "red" = "green";
  if (diff < 15 * 60 * 1000) color = "red";
  else if (diff < 60 * 60 * 1000) color = "yellow";

  return { text: `${hours} sa ${mins} dk ${secs} sn`, color, ratio };
}

/* ---- COUNTDOWN (PACKAGE) ---- */
function formatRemainingPkg(createdAt: any, minutes: number, nowMs: number) {
  const createdMs =
    createdAt?.toDate?.().getTime?.() ??
    (typeof createdAt?.toMillis === "function" ? createdAt.toMillis() : null);

  if (!createdMs || !minutes) return { text: "-", color: "green" as const, expired: false, ratio: 0 };

  const totalMs = minutes * 60 * 1000;
  const deadlineMs = createdMs + totalMs;
  const diff = deadlineMs - nowMs;

  if (diff <= 0) return { text: "Süre doldu", color: "red" as const, expired: true, ratio: 1 };

  const elapsed = Math.min(totalMs, Math.max(0, nowMs - createdMs));
  const ratio = totalMs ? elapsed / totalMs : 0;

  const totalSec = Math.floor(diff / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  let color: "green" | "yellow" | "red" = "green";
  if (diff < 15 * 60 * 1000) color = "red";
  else if (diff < 60 * 60 * 1000) color = "yellow";

  return { text: `${hours} sa ${mins} dk ${secs} sn`, color, expired: false, ratio };
}

function badgeByPkgStatus(status: PackageRequestStatus) {
  if (status === "accepted") return "bg-emerald-500/10 text-emerald-300 border-emerald-500/40";
  if (status === "expired") return "bg-red-500/10 text-red-300 border-red-500/40";
  if (status === "deleted") return "bg-slate-500/10 text-slate-300 border-slate-500/40";
  return "bg-sky-500/10 text-sky-300 border-sky-500/40";
}

function guessBestPackageOffer(offers: PackageOffer[]) {
  if (!offers.length) return null;
  const sorted = offers
.filter(o => String(o.status||"").toLowerCase() !== "withdrawn")
    .slice()
    .sort((a, b) => Number(a.totalPrice) - Number(b.totalPrice));
  return sorted[0] ?? offers[0];
}

/* ---- OFFER CANCELLED ---- */
function isHotelCancelledStatus(status?: string) {
  const s = String(status || "").toLowerCase();
  return s === "withdrawn" || s === "cancelled" || s === "hotel_cancelled" || s === "canceled";
}
function offerDisabled(o: GuestOffer) {
  if (o.status === "accepted") return true;
  if (o.status === "rejected") return true;
  if (isHotelCancelledStatus(o.status)) return true;
  return false;
}
function offerStatusLabel(o: GuestOffer) {
  if (isHotelCancelledStatus(o.status)) return "Otelci teklifi iptal etti";
  if (o.status === "countered") return "Karşı teklif gönderdin";
  if (o.status === "rejected") return "Reddettin";
  if (o.status === "accepted") return "Kabul edildi";
  return "Otel teklif gönderdi";
}

/* ---- CANCELLATION LABEL ---- */
function cancellationLabelFromOffer(
  offer: { cancellationPolicyType?: any; cancellationPolicyDays?: any },
  hp?: { cancellationPolicyType?: any; cancellationPolicyDays?: any; cancellationPolicyLabel?: any }
): string | null {
  const type = offer?.cancellationPolicyType ?? hp?.cancellationPolicyType;
  const daysRaw = offer?.cancellationPolicyDays ?? hp?.cancellationPolicyDays;
  const days = Number.isFinite(Number(daysRaw)) ? Number(daysRaw) : null;

  if (!type && hp?.cancellationPolicyLabel) return String(hp.cancellationPolicyLabel);
  if (!type) return null;

  if (type === "non_refundable") return "Bu rezervasyon iptal edilemez, ücret iadesi yapılmaz.";
  if (type === "flexible") return "Giriş tarihine kadar ücretsiz iptal hakkın vardır.";
  if (type === "until_days_before") {
    const d = days ?? 3;
    return `Giriş tarihinden ${d} gün öncesine kadar ücretsiz iptal hakkın vardır. Sonrasında iptal edilemez.`;
  }
  return null;
}
/* ---------------- FIRESTORE ACTIONS ---------------- */
async function createNotification(db: ReturnType<typeof getFirestoreDb>, to: string | null | undefined, payload: any) {
  if (!to) return;
  try {
    await addDoc(collection(db, "notifications"), { to, ...payload, createdAt: serverTimestamp(), read: false });
  } catch (e) {
    console.error("createNotification error:", e);
  }
}

// price history push (counter 1 kez)
async function pushOfferPriceHistory(db: ReturnType<typeof getFirestoreDb>, offerId: string, item: Omit<PriceHistoryItem, "createdAt">) {
  const ref = doc(db, "offers", offerId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Teklif bulunamadı.");

  const offer = snap.data() as AnyObj;

  if (item.kind === "counter" && item.actor === "guest") {
    if (offer?.guestCounterPrice != null) throw new Error("Karşı teklif hakkı zaten kullanıldı.");
  }

  const historyEntry = {
    actor: item.actor,
    kind: item.kind,
    price: Number(item.price),
    currency: String(item.currency ?? offer?.currency ?? "TRY"),
    note: item.note ?? null,
    createdAt: Timestamp.now()
  };

  const patch: AnyObj = {
    priceHistory: arrayUnion(historyEntry),
    updatedAt: serverTimestamp()
  };

  if (item.kind === "counter" && item.actor === "guest") {
    patch.status = "countered";
    patch.guestCounterPrice = Number(item.price);
    patch.guestCounterAt = Timestamp.now();
  }

  await updateDoc(ref, patch);
}

// create HOTEL booking
async function createHotelBooking(params: {
  db: ReturnType<typeof getFirestoreDb>;
  offer: GuestOffer;
  req: RequestSummary | undefined;
  hotel: HotelInfo | undefined;
  guest: AnyObj;
  paymentMethod: PaymentMethod;
}) {
  const { db, offer, req, hotel, guest, paymentMethod } = params;

  const paymentStatus =
    paymentMethod === "card3d" ? "paid" : paymentMethod === "payAtHotel" ? "payAtHotel" : "pending";

  const bookingRef = await addDoc(collection(db, "bookings"), {
    type: "hotel",

    offerId: offer.id,
    requestId: req?.id ?? offer.requestId,

    guestId: guest.uid,
    guestName: guest.displayName ?? null,
    guestEmail: guest.email ?? null,
    guestPhone: guest.phoneNumber ?? null,

    hotelId: hotel?.id ?? offer.hotelId,
    hotelName: hotel?.displayName ?? offer.hotelName ?? null,

    city: req?.city ?? null,
    district: req?.district ?? null,

    checkIn: req?.checkIn ?? null,
    checkOut: req?.checkOut ?? null,

    checkInTime: req?.checkInTime ?? null,
    checkOutTime: req?.checkOutTime ?? null,

    sameDayStay: req?.sameDayStay ?? false,

    earlyCheckInWanted: req?.earlyCheckInWanted ?? false,
    earlyCheckInTime: req?.earlyCheckInTime ?? null,

    lateCheckOutWanted: req?.lateCheckOutWanted ?? false,
    lateCheckOutFrom: req?.lateCheckOutFrom ?? null,
    lateCheckOutTo: req?.lateCheckOutTo ?? null,

    adults: req?.adults ?? null,
    childrenCount: req?.childrenCount ?? null,
    childrenAges: req?.childrenAges ?? null,
    roomsCount: req?.roomsCount ?? null,

    totalPrice: Number(offer.totalPrice ?? 0),
    currency: offer.currency ?? "TRY",

    paymentMethod,
    paymentStatus,

    roomBreakdown: offer.roomBreakdown ?? null,
    cancellationPolicyType: offer.cancellationPolicyType ?? null,
    cancellationPolicyDays: offer.cancellationPolicyDays ?? null,

    createdAt: serverTimestamp(),
    status: "active"
  });

  await updateDoc(doc(db, "offers", offer.id), {
    status: "accepted",
    acceptedAt: serverTimestamp(),
    bookingId: bookingRef.id
  });

  return bookingRef.id;
}

// create PACKAGE booking
async function createPackageBooking(params: {
  db: ReturnType<typeof getFirestoreDb>;
  req: PackageRequest;
  offer: PackageOffer;
  agenciesMap: Record<string, AgencyInfo>;
  guest: AnyObj;
  method: PackagePaymentMethod;
}) {
  const { db, req, offer, agenciesMap, guest, method } = params;

  const paymentStatus =
    method === "card3d" ? "paid" : method === "transfer" ? "transfer_pending" : "pay_at_door";

  const agency = agenciesMap[offer.agencyId];
  const ap = agency?.agencyProfile ?? null;

  const agencySnapshot = {
    id: offer.agencyId,
    displayName: agency?.displayName ?? offer.agencyName ?? null,
    email: agency?.email ?? null,
    businessName: ap?.businessName ?? null,
    phone: ap?.phone ?? null,
    address: ap?.address ?? null,
    city: ap?.city ?? null,
    district: ap?.district ?? null,
    taxNo: ap?.taxNo ?? null,
    about: ap?.about ?? null
  };

  const requestSnapshot = req.raw ?? req;
  const offerSnapshot = offer;

  const bkRef = await addDoc(collection(db, "bookings"), {
    type: "package",

    packageRequestId: req.id,
    packageOfferId: offer.id,

    guestId: guest.uid,
    guestName: guest.displayName ?? null,
    guestEmail: guest.email ?? null,
    guestPhone: guest.phoneNumber ?? null,

    agencyId: offer.agencyId ?? null,
    agencyName: offer.agencyName ?? null,

    agencySnapshot,
    requestSnapshot,
    offerSnapshot,

    title: req.title ?? null,
    country: req.country ?? "Türkiye",
    city: req.city ?? null,
    district: req.district ?? null,
    checkIn: req.dateFrom ?? null,
    checkOut: req.dateTo ?? null,
    nights: req.nights ?? calcNightsFromISO(req.dateFrom, req.dateTo),

    paxAdults: req.paxAdults ?? 0,
    paxChildren: req.paxChildren ?? 0,
    childrenAges: req.childrenAges ?? null,
    roomsCount: req.roomsCount ?? null,
    roomTypes: req.roomTypes ?? null,

    needs: req.needs ?? null,

    wantsTransfer: req.wantsTransfer ?? null,
    transferType: req.transferType ?? null,
    transferNotes: req.transferNotes ?? null,

    wantsTours: req.wantsTours ?? null,
    tourCount: req.tourCount ?? null,
    tourNotes: req.tourNotes ?? null,

    wantsCar: req.wantsCar ?? null,
    carType: req.carType ?? null,
    licenseYear: req.licenseYear ?? null,
    carNotes: req.carNotes ?? null,

    extras: req.extras ?? null,
    activities: req.activities ?? null,

    note: req.note ?? null,

    totalPrice: Number(offer.totalPrice ?? 0),
    currency: offer.currency ?? "TRY",
    paymentMethod: method,
    paymentStatus,

    status: "active",
    createdAt: serverTimestamp(),

    packageBreakdown: offer.breakdown ?? null,
    packageDetails: offer.packageDetails ?? null,
    offerNote: offer.note ?? null
  });

  await updateDoc(doc(getFirestoreDb(), "packageOffers", offer.id), {
    status: "accepted",
    acceptedAt: serverTimestamp(),
    bookingId: bkRef.id
  });

  await updateDoc(doc(getFirestoreDb(), "packageRequests", req.id), {
    status: "accepted",
    acceptedOfferId: offer.id,
    acceptedAt: serverTimestamp(),
    bookingId: bkRef.id
  });

  return bkRef.id;
}
/* ---------------- MODALS ---------------- */
function RestartDatesModal({
  open,
  req,
  onClose,
  onSubmit
}: {
  open: boolean;
  req: RequestSummary | null;
  onClose: () => void;
  onSubmit: (patch: { checkIn: string; checkOut: string; checkInTime?: string; checkOutTime?: string }) => void;
}) {
  const [checkIn, setCheckIn] = useState(req?.checkIn || "");
  const [checkOut, setCheckOut] = useState(req?.checkOut || "");
  const [checkInTime, setCheckInTime] = useState(req?.checkInTime || "");
  const [checkOutTime, setCheckOutTime] = useState(req?.checkOutTime || "");

  useEffect(() => {
    if (!open) return;
    setCheckIn(req?.checkIn || "");
    setCheckOut(req?.checkOut || "");
    setCheckInTime(req?.checkInTime || "");
    setCheckOutTime(req?.checkOutTime || "");
  }, [open, req?.id]);

  if (!open || !req) return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-start justify-center bg-black/70">
      <button className="absolute inset-0" onClick={onClose} aria-label="Kapat" />
      <div className="relative mt-16 w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-2xl space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-100">Tarih güncelle → Yeniden başlat</h3>
            <p className="text-[0.78rem] text-slate-300">Check-in tarihi geçmiş. Yeni tarih seçmeden yeniden başlatılamaz.</p>
          </div>
          <button onClick={onClose} className="btn btn-outline">Kapat ✕</button>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <label className="text-[0.75rem] text-slate-200">Check-in</label>
            <input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className="input" />
          </div>
          <div className="space-y-1">
            <label className="text-[0.75rem] text-slate-200">Check-out</label>
            <input type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} className="input" />
          </div>
          <div className="space-y-1">
            <label className="text-[0.75rem] text-slate-200">Check-in saati</label>
            <input value={checkInTime} onChange={(e) => setCheckInTime(e.target.value)} placeholder="14:00" className="input" />
          </div>
          <div className="space-y-1">
            <label className="text-[0.75rem] text-slate-200">Check-out saati</label>
            <input value={checkOutTime} onChange={(e) => setCheckOutTime(e.target.value)} placeholder="12:00" className="input" />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn btn-outline">Vazgeç</button>
          <button
            onClick={() => {
              if (!checkIn || !checkOut) return alert("Check-in / Check-out seç.");
              if (isCheckInPast(checkIn)) return alert("Check-in geçmiş olamaz.");
              if (checkOut <= checkIn) return alert("Check-out, check-in’den sonra olmalı.");
            onSubmit({
  checkIn,
  checkOut,
  checkInTime: checkInTime?.trim() ? checkInTime.trim() : undefined,
  checkOutTime: checkOutTime?.trim() ? checkOutTime.trim() : undefined
});

            }}
            className="btn btn-primary"
          >
            Güncelle & Yeniden başlat
          </button>
        </div>
      </div>
    </div>
  );
}

function PaymentModal({
  offer,
  hotel,
  onClose,
  onConfirm
}: {
  offer: GuestOffer;
  hotel?: HotelInfo;
  onClose: () => void;
  onConfirm: (method: PaymentMethod) => void;
}) {
  const po = hotel?.hotelProfile?.paymentOptions;
  const available: PaymentMethod[] = po
    ? ([po.card3d && "card3d", po.payAtHotel && "payAtHotel"].filter(Boolean) as PaymentMethod[])
    : (["card3d", "payAtHotel"] as PaymentMethod[]);

  const [method, setMethod] = useState<PaymentMethod>(available[0] ?? "card3d");
  const [threeDS, setThreeDS] = useState(false);

  const [cardName, setCardName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvc, setCardCvc] = useState("");

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-black/70">
      <button className="absolute inset-0" onClick={onClose} aria-label="Kapat" />
      <div className="relative mt-16 w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-2xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-100">Ödeme</h3>
            <p className="text-[0.78rem] text-slate-300">Toplam: <b className="text-slate-100">{money(offer.totalPrice, offer.currency)}</b></p>
          </div>
          <button onClick={onClose} className="btn btn-outline">Kapat ✕</button>
        </div>

        <div className="space-y-2">
          {available.includes("card3d") && (
            <label className="flex items-start gap-2 rounded-lg border border-slate-700 p-3 cursor-pointer hover:border-emerald-400">
              <input type="radio" checked={method === "card3d"} onChange={() => setMethod("card3d")} className="mt-1 h-4 w-4" />
              <div>
                <p className="text-slate-100 font-semibold">💳 3D Secure</p>
                <p className="text-[0.72rem] text-slate-400">Simülasyon. Onay sonrası rezervasyon oluşur.</p>
              </div>
            </label>
          )}

          {available.includes("payAtHotel") && (
            <label className="flex items-start gap-2 rounded-lg border border-slate-700 p-3 cursor-pointer hover:border-emerald-400">
              <input type="radio" checked={method === "payAtHotel"} onChange={() => setMethod("payAtHotel")} className="mt-1 h-4 w-4" />
              <div>
                <p className="text-slate-100 font-semibold">💵 Otelde ödeme</p>
                <p className="text-[0.72rem] text-slate-400">Ödemeyi girişte yaparsın.</p>
              </div>
            </label>
          )}
        </div>

        {method === "card3d" && (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-200">Kart adı</label>
              <input className="input" value={cardName} onChange={(e) => setCardName(e.target.value)} placeholder="Ad Soyad" />
            </div>
            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-200">Kart no</label>
              <input className="input" value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} placeholder="1111 2222 3333 4444" />
            </div>
            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-200">Son kullanma</label>
              <input className="input" value={cardExpiry} onChange={(e) => setCardExpiry(e.target.value)} placeholder="12/29" />
            </div>
            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-200">CVC</label>
              <input className="input" value={cardCvc} onChange={(e) => setCardCvc(e.target.value)} placeholder="123" />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-outline">Vazgeç</button>
          {method === "card3d" ? (
            <button
              onClick={() => {
                if (!cardName || !cardNumber || !cardExpiry || !cardCvc) return alert("Kart bilgilerini doldur.");
                setThreeDS(true);
              }}
              className="btn btn-primary"
            >
              3D Secure
            </button>
          ) : (
            <button onClick={() => onConfirm("payAtHotel")} className="btn btn-primary">Rezervasyonu oluştur</button>
          )}
        </div>

        {threeDS && (
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-2">
            <p className="text-slate-100 font-semibold">3D Secure doğrulama (simülasyon)</p>
            <p className="text-slate-300 text-sm">Onayladığında ödeme başarılı sayılır ve rezervasyon oluşur.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setThreeDS(false)} className="btn btn-outline">İptal</button>
              <button onClick={() => onConfirm("card3d")} className="btn btn-primary">Ödemeyi onayla</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}



/* ---------------- PREMIUM OFFER DETAIL MODAL ---------------- */
function OfferDetailModal({
  offer,
  hotel,
  req,
  onClose
}: {
  offer: GuestOffer;
  hotel?: HotelInfo;
  req?: RequestSummary;
  onClose: () => void;
}) {
  const db = getFirestoreDb();

  // ---------------- SAFE HELPERS ----------------
  const s = (v: any, fb = "—") => {
    if (v === null || v === undefined) return fb;
    const t = String(v).trim();
    return t ? t : fb;
  };
  const n = (v: any, fb = 0) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : fb;
  };
  const mny = (v: any, cur: string) => `${n(v, 0).toLocaleString("tr-TR")} ${cur || "TRY"}`;
  const asArr = (v: any) => (Array.isArray(v) ? v : v == null ? [] : [v]);
  const toMillis = (ts: any) => {
    try {
      if (!ts) return 0;
      if (typeof ts?.toMillis === "function") return ts.toMillis();
      if (typeof ts?.toDate === "function") return ts.toDate().getTime();
      const d = new Date(ts);
      return Number.isNaN(d.getTime()) ? 0 : d.getTime();
    } catch {
      return 0;
    }
  };
  const toTR = (ts: any) => {
    try {
      if (!ts) return "";
      if (typeof ts?.toDate === "function") return ts.toDate().toLocaleString("tr-TR");
      const d = new Date(ts);
      return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("tr-TR");
    } catch {
      return "";
    }
  };

  // "contact?.name" gibi path okuma
  const pick = (raw: any, keys: string[], fb: any = null) => {
    for (const k of keys) {
      if (!k) continue;
      if (k.includes("?.") || k.includes(".")) {
        const path = k.replace(/\?\./g, ".").split(".");
        let cur: any = raw;
        for (const p of path) {
          if (!cur) { cur = undefined; break; }
          cur = cur[p];
        }
        if (cur !== undefined && cur !== null && String(cur).trim() !== "") return cur;
        continue;
      }
      const v = raw?.[k];
      if (v !== undefined && v !== null && String(v).trim() !== "") return v;
    }
    return fb;
  };

  // ---------------- LIVE SNAPSHOTS ----------------
  const [liveOffer, setLiveOffer] = React.useState<GuestOffer>(offer);
  const [liveReq, setLiveReq] = React.useState<any>(req?.raw ? { id: req.id, ...(req.raw as any) } : (req as any) ?? null);
  const [liveHotel, setLiveHotel] = React.useState<HotelInfo | undefined>(hotel);

  const [imgOpen, setImgOpen] = React.useState(false);
  const [imgSrc, setImgSrc] = React.useState<string | null>(null);

  const [activeHotelImage, setActiveHotelImage] = React.useState(0);

  const [roomModalOpen, setRoomModalOpen] = React.useState(false);
  const [roomModalRoom, setRoomModalRoom] = React.useState<RoomTypeProfile | null>(null);

  // modal scroll top
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
  }, []);

  React.useEffect(() => {
    const unsub = onSnapshot(doc(db, "offers", offer.id), (snap) => {
      if (!snap.exists()) return;
      const v = snap.data() as any;
      setLiveOffer((prev) => ({
        ...prev,
        id: snap.id,
        requestId: v.requestId ?? prev.requestId,
        hotelId: v.hotelId ?? prev.hotelId,
        hotelName: v.hotelName ?? prev.hotelName ?? null,
        totalPrice: Number(v.totalPrice ?? prev.totalPrice ?? 0),
        currency: v.currency ?? prev.currency ?? "TRY",
        mode: (v.mode ?? prev.mode ?? "simple") as OfferMode,
        note: v.note ?? null,
        status: v.status ?? prev.status ?? "sent",
        guestCounterPrice: v.guestCounterPrice ?? null,
        createdAt: v.createdAt ?? prev.createdAt,
        updatedAt: v.updatedAt ?? (prev as any)?.updatedAt,
        acceptedAt: v.acceptedAt ?? (prev as any)?.acceptedAt,
        rejectedAt: v.rejectedAt ?? (prev as any)?.rejectedAt,
        guestCounterAt: v.guestCounterAt ?? (prev as any)?.guestCounterAt,
        roomTypeId: v.roomTypeId ?? null,
        roomTypeName: v.roomTypeName ?? null,
        roomBreakdown: Array.isArray(v.roomBreakdown) ? v.roomBreakdown : [],
        cancellationPolicyType: v.cancellationPolicyType ?? null,
        cancellationPolicyDays: v.cancellationPolicyDays ?? null,
        priceHistory: Array.isArray(v.priceHistory) ? v.priceHistory : []
      }));
    });
    return () => unsub();
  }, [db, offer.id]);

  React.useEffect(() => {
    const unsub = onSnapshot(doc(db, "requests", offer.requestId), (snap) => {
      if (!snap.exists()) return;
      setLiveReq({ id: snap.id, ...(snap.data() as any) });
    });
    return () => unsub();
  }, [db, offer.requestId]);

  React.useEffect(() => {
    const hid = liveOffer?.hotelId || offer.hotelId || (hotel as any)?.id;
    if (!hid) return;
    const unsub = onSnapshot(doc(db, "users", hid), (snap) => {
      if (!snap.exists()) return;
      const u = snap.data() as any;
      setLiveHotel({
        id: hid,
        displayName: u.displayName,
        email: u.email,
        website: u.website || u.hotelProfile?.website || "",
        hotelProfile: u.hotelProfile
      });
    });
    return () => unsub();
  }, [db, liveOffer?.hotelId, offer.hotelId, (hotel as any)?.id]);

  const offerAny: any = liveOffer;
  const reqAny: any = liveReq || {};
  const hp = liveHotel?.hotelProfile;

  // ---------------- NORMALIZE REQUEST (çok toleranslı) ----------------
  const city = s(pick(reqAny, ["city"], "—"));
  const district = pick(reqAny, ["district"], null);

  const checkIn = pick(reqAny, ["checkIn", "dateFrom"], null);
  const checkOut = pick(reqAny, ["checkOut", "dateTo"], null);

  const checkInTime = pick(reqAny, ["checkInTime", "earlyCheckInTo", "checkInHour"], null);
  const checkOutTime = pick(reqAny, ["checkOutTime", "lateCheckOutFrom", "checkOutHour"], "12:00");

  const sameDay = !!pick(reqAny, ["sameDayStay"], false);

  const earlyWanted = !!pick(reqAny, ["earlyCheckInWanted", "earlyCheckInWant"], false);
  const earlyTime = pick(reqAny, ["earlyCheckInTime", "earlyCheckInFrom", "earlyCheckInTo"], null);

  const lateWanted = !!pick(reqAny, ["lateCheckOutWanted", "lateCheckOutWant"], false);
  const lateFrom = pick(reqAny, ["lateCheckOutFrom"], null);
  const lateTo = pick(reqAny, ["lateCheckOutTo"], null);

  const adults = n(pick(reqAny, ["adults", "paxAdults"], 0), 0);
  const children = n(pick(reqAny, ["childrenCount", "paxChildren"], 0), 0);
  const roomsCount = n(pick(reqAny, ["roomsCount"], 1), 1);
  const childrenAges = asArr(pick(reqAny, ["childrenAges"], []));

  const contactName = pick(reqAny, ["contactName", "guestName", "contact?.name", "guestDisplayName"], null);
  const guestEmail = pick(reqAny, ["guestEmail", "contactEmail", "contact?.email"], null);
  const guestPhone = pick(reqAny, ["guestPhone", "contactPhone", "contactPhoneLocal", "contact?.phone"], null);

  const accommodationType = pick(reqAny, ["accommodationType", "hotelType"], null);
  const boardType = pick(reqAny, ["boardType", "mealPlan"], null);
  const boardTypes = asArr(pick(reqAny, ["boardTypes"], []));

  const featurePrefs = asArr(pick(reqAny, ["hotelFeaturePrefs", "featureKeys"], []));
  const featurePriorities = pick(reqAny, ["featurePriorities"], null);

  const noteAll = [
    pick(reqAny, ["note"], null),
    pick(reqAny, ["notes"], null),
    pick(reqAny, ["generalNote"], null),
    pick(reqAny, ["contactNote"], null),
    pick(reqAny, ["locationNote"], null),
    pick(reqAny, ["hotelFeatureNote"], null),
    pick(reqAny, ["boardTypeNote"], null),
    pick(reqAny, ["flightNotes"], null),
    pick(reqAny, ["transferNotes"], null),
    pick(reqAny, ["activities"], null)
  ]
    .filter(Boolean)
    .map((x) => String(x))
    .join("\n\n");

  // nights
  const nights = React.useMemo(() => {
    if (!checkIn || !checkOut) return 1;
    const a = new Date(checkIn); a.setHours(0,0,0,0);
    const b = new Date(checkOut); b.setHours(0,0,0,0);
    const diff = Math.floor((b.getTime() - a.getTime()) / 86400000);
    return diff > 0 ? diff : 1;
  }, [checkIn, checkOut]);

  // ---------------- HOTEL MEDIA / FEATURES ----------------
  const hotelImages = React.useMemo(() => {
    const a = (hp?.imageUrls ?? []) as string[];
    const b = (((hp as any)?.images ?? []) as string[]) || [];
    const c = (((hp as any)?.gallery ?? []) as string[]) || [];
    const d = (((hp as any)?.photos ?? []) as string[]) || [];
    return [...a, ...b, ...c, ...d].filter(Boolean);
  }, [hp]);

  React.useEffect(() => {
    if (activeHotelImage >= hotelImages.length) setActiveHotelImage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelImages.length]);

  const mapUrl =
    hp?.locationUrl ||
    (hp?.locationLat && hp?.locationLng
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${hp.locationLat},${hp.locationLng}`)}`
      : null);

  const cancelText = cancellationLabelFromOffer(offerAny, hp);

  const paymentText = (() => {
    const po = hp?.paymentOptions;
    if (!po) return "Ödeme bilgisi yok.";
    const card = !!po.card3d;
    const cash = !!po.payAtHotel;
    if (card && cash) return "3D Secure veya otelde ödeme mümkündür.";
    if (card) return "3D Secure ile online kart ödemesi mümkündür.";
    if (cash) return "Otelde ödeme mümkündür.";
    return "Ödeme bilgisi yok.";
  })();

  // ---------------- OFFER BREAKDOWN / TIMELINE ----------------
  const breakdown = Array.isArray(offerAny?.roomBreakdown) ? offerAny.roomBreakdown : [];
  const offerCurrency = offerAny?.currency ?? "TRY";
  const lastPrice = n(offerAny?.totalPrice, 0);

  const timeline = React.useMemo(() => {
    const rawHist = Array.isArray(offerAny?.priceHistory) ? offerAny.priceHistory : [];
    const out = rawHist
      .slice()
      .sort((a: any, b: any) => toMillis(a?.createdAt) - toMillis(b?.createdAt))
      .map((h: any) => ({
        actor: h?.actor === "guest" ? "guest" : "hotel",
        kind: h?.kind || (h?.actor === "guest" ? "counter" : "update"),
        price: Number(h?.price ?? 0),
        currency: h?.currency ?? offerCurrency,
        note: h?.note ?? "",
        createdAt: h?.createdAt ?? null
      }));

    // current snapshot line
    if (!out.find((x: any) => x.kind === "current")) {
      out.push({
        actor: "system",
        kind: "current",
        price: lastPrice,
        currency: offerCurrency,
        note: "Güncel fiyat",
        createdAt: offerAny?.updatedAt ?? null
      });
    }
    return out;
  }, [offerAny, offerCurrency, lastPrice]);

  // room profile open
  const openRoomProfile = (rb: any) => {
    const rt =
      (hp as any)?.roomTypes?.find?.((r: any) => r?.id === rb?.roomTypeId) ||
      (hp as any)?.roomTypes?.find?.((r: any) => String(r?.name || "").toLowerCase() === String(rb?.roomTypeName || "").toLowerCase()) ||
      null;

    const fallback: RoomTypeProfile = {
      id: rb?.roomTypeId ?? "room",
      name: rb?.roomTypeName ?? rb?.name ?? "Oda",
      shortDescription: rb?.roomShortDescription ?? "",
      description: rb?.roomDescription ?? "",
      imageUrls: (((rt as any)?.imageUrls ?? (rt as any)?.images ?? (rt as any)?.gallery ?? (rt as any)?.photos ?? []) as string[]).filter(Boolean)
    } as any;

    setRoomModalRoom((rt as any) || fallback);
    setRoomModalOpen(true);
  };

  // copy request json
  const prettyJson = React.useMemo(() => {
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
      return String(reqAny);
    }
  }, [reqAny]);

  // ---------------- UI ----------------
  const openImage = (src?: string | null) => {
    if (!src) return;
    setImgSrc(src);
    setImgOpen(true);
  };
  const closeImage = () => {
    setImgOpen(false);
    setImgSrc(null);
  };

  const chip = (text: string, tone: "slate" | "emerald" | "amber" | "sky" | "red" = "slate") => {
    const cls =
      tone === "emerald"
        ? "badge badge-emerald"
        : tone === "amber"
        ? "badge badge-amber"
        : tone === "sky"
        ? "badge badge-sky"
        : tone === "red"
        ? "badge badge-red"
        : "badge badge-slate";
    return <span className={cls}>{text}</span>;
  };

  return (
    <>
      <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/60">
        <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />

        <div
          ref={scrollRef}
          className="relative mt-6 md:mt-10 w-[96vw] max-w-6xl rounded-2xl border border-slate-800 bg-slate-950/95 p-4 md:p-5 shadow-xl max-h-[90vh] overflow-y-auto space-y-4"
        >
          {/* HEADER */}
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-slate-100">Teklif Detayı</h2>
              <p className="text-[0.75rem] text-slate-500">
                Teklif #{offerAny?.id} • {offerAny?.hotelName || liveHotel?.displayName || "Otel"} • {mny(lastPrice, offerCurrency)}
              </p>

              <div className="flex flex-wrap gap-2 pt-1">
                {chip(`Son fiyat: ${mny(lastPrice, offerCurrency)}`, "emerald")}
                {offerAny?.mode === "negotiable" ? chip("💬 Pazarlıklı", "amber") : null}
                {sameDay ? chip("Aynı gün", "amber") : null}
                {earlyWanted ? chip(`Erken giriş: ${s(earlyTime)}`, "sky") : null}
                {lateWanted ? chip(`Geç çıkış: ${s(lateFrom)}-${s(lateTo)}`, "sky") : null}
              </div>
            </div>

            <button onClick={onClose} className="btn btn-outline">Kapat ✕</button>
          </div>

          {/* TOP GRID: Gallery + Hotel card */}
          <div className="grid lg:grid-cols-[1.2fr_1fr] gap-4">
            {/* Gallery */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden flex flex-col">
              {hotelImages.length > 0 ? (
                <>
                  <button
                    type="button"
                    className="flex-1 overflow-hidden min-h-[240px] md:min-h-[280px] relative group"
                    onClick={() => openImage(hotelImages[activeHotelImage])}
                    title="Büyüt"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={hotelImages[activeHotelImage]} alt="otel" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition" />
                    <div className="absolute bottom-3 right-3 rounded-md border border-white/25 bg-black/40 px-2 py-1 text-[0.72rem] text-white">
                      🔍 Büyüt
                    </div>
                  </button>

                  {hotelImages.length > 1 && (
                    <div className="flex gap-2 p-2 bg-slate-950/80 border-t border-slate-800 overflow-x-auto">
                      {hotelImages.slice(0, 14).map((img, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setActiveHotelImage(idx)}
                          className={`w-16 h-16 rounded-lg border overflow-hidden ${
                            activeHotelImage === idx ? "border-emerald-400" : "border-slate-700"
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img} alt={`thumb-${idx}`} className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center justify-center text-slate-500 text-xs flex-1 min-h-[240px] md:min-h-[280px]">
                  <span className="text-3xl mb-1">🏨</span>
                  <span>Otel görsel eklememiş.</span>
                </div>
              )}
            </div>

            {/* Hotel Card */}
            <div className="space-y-3">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-slate-100">{liveHotel?.displayName || offerAny?.hotelName || "Otel"}</h3>
                    <p className="text-[0.8rem] text-slate-300">
                      {hp?.starRating ? <span className="text-amber-300">{hp.starRating}★</span> : "★ Yok"}
                    </p>
                  </div>

                  <div className="flex gap-2">
                    {mapUrl ? (
                      <a href={mapUrl} target="_blank" rel="noreferrer" className="btn btn-sky">
                        Harita
                      </a>
                    ) : null}
                    {liveHotel?.website ? (
                      <a href={String(liveHotel.website)} target="_blank" rel="noreferrer" className="btn btn-outline">
                        Website
                      </a>
                    ) : null}
                  </div>
                </div>

                {hp?.address ? (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                    <p className="text-[0.75rem] text-slate-400 mb-1">Adres</p>
                    <p className="text-slate-200 text-sm">{hp.address}</p>
                  </div>
                ) : null}

                {hp?.description ? (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                    <p className="text-[0.75rem] text-slate-400 mb-1">Otel açıklaması</p>
                    <p className="text-slate-200 text-sm whitespace-pre-wrap">{hp.description}</p>
                  </div>
                ) : null}

                <div className="grid md:grid-cols-2 gap-2">
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                    <p className="text-[0.75rem] text-slate-400 mb-1">Ödeme</p>
                    <p className="text-slate-200 text-sm">{paymentText}</p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                    <p className="text-[0.75rem] text-slate-400 mb-1">İptal</p>
                    <p className="text-slate-200 text-sm">{cancelText || "Bilgi yok"}</p>
                  </div>
                </div>

                {Array.isArray(hp?.features) && hp!.features!.length > 0 ? (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                    <p className="text-[0.75rem] text-slate-400 mb-2">Otel özellikleri</p>
                    <div className="flex flex-wrap gap-2">
                      {hp!.features!.slice(0, 30).map((f, i) => (
                        <span key={i} className="inline-flex items-center rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[0.72rem] text-slate-200">
                          {String(f)}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              {hp?.youtubeUrl ? (
                <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
                  <p className="text-[0.85rem] font-semibold text-slate-100 mb-2">Tanıtım videosu</p>
                  <div className="aspect-video rounded-lg overflow-hidden border border-slate-800">
                    <iframe
                      className="w-full h-full"
                      src={String(hp.youtubeUrl).replace("watch?v=", "embed/")}
                      title="Otel videosu"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {/* REQUEST SUMMARY */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-100">Misafir Talebi</p>
              <button
                className="btn btn-outline"
                onClick={() => {
                  try { navigator.clipboard.writeText(prettyJson); alert("Kopyalandı."); } catch {}
                }}
              >
                Kopyala (JSON)
              </button>
            </div>

            <div className="grid gap-2 md:grid-cols-4">
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-[0.72rem] text-slate-400">Şehir</p>
                <p className="text-slate-100 mt-1 font-semibold">{city}{district ? ` / ${district}` : ""}</p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 md:col-span-2">
                <p className="text-[0.72rem] text-slate-400">Tarih / Saat</p>
                <p className="text-slate-100 mt-1 font-semibold">
                  {s(checkIn)} ({s(checkInTime)}) → {s(checkOut)} ({s(checkOutTime)})
                  {" "}({nights} gece)
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-[0.72rem] text-slate-400">Kişi / Oda</p>
                <p className="text-slate-100 mt-1 font-semibold">{adults} yetişkin • {children} çocuk • {roomsCount} oda</p>
                {childrenAges.length ? <p className="text-[0.75rem] text-slate-300 mt-1">Yaş: {childrenAges.join(", ")}</p> : null}
              </div>
            </div>

            <div className="grid gap-2 md:grid-cols-3">
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-[0.72rem] text-slate-400">İletişim</p>
                <p className="text-slate-100 mt-1 whitespace-pre-wrap">
                  {s(contactName)}{"\n"}{s(guestEmail)}{"\n"}{s(guestPhone)}
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-[0.72rem] text-slate-400">Konaklama / Board</p>
                <p className="text-slate-100 mt-1">
                  {s(accommodationType)}{"\n"}
                  {boardType ? s(boardType) : (boardTypes.length ? boardTypes.join(" • ") : "—")}
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-[0.72rem] text-slate-400">İstekler</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {sameDay ? chip("Aynı gün", "amber") : chip("Aynı gün: Hayır", "slate")}
                  {earlyWanted ? chip(`Erken: ${s(earlyTime)}`, "sky") : chip("Erken: Yok", "slate")}
                  {lateWanted ? chip(`Geç: ${s(lateFrom)}-${s(lateTo)}`, "sky") : chip("Geç: Yok", "slate")}
                </div>
              </div>
            </div>

            {/* Feature prefs + priorities */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-2">
              <p className="text-[0.75rem] text-slate-400">Otel özellik istekleri</p>
              {featurePrefs.length ? (
                <div className="flex flex-wrap gap-2">
                  {featurePrefs.slice(0, 40).map((f: any, i: number) => (
                    <span key={i} className="inline-flex items-center rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[0.72rem] text-slate-200">
                      {String(f)}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-slate-400 text-sm">Belirtilmemiş</div>
              )}

              {featurePriorities && typeof featurePriorities === "object" ? (
                <div className="pt-2">
                  <p className="text-[0.75rem] text-slate-400 mb-2">Öncelikler</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(featurePriorities).slice(0, 40).map(([k, v]: any) => (
                      <span key={k} className="inline-flex items-center rounded-md border border-sky-500/25 bg-sky-500/10 px-2 py-1 text-[0.72rem] text-sky-200">
                        {k}: {String(v)}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            {noteAll ? (
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-[0.75rem] text-slate-400 mb-1">Notlar / İstekler (tam)</p>
                <p className="text-slate-100 whitespace-pre-wrap">{noteAll}</p>
              </div>
            ) : null}
          </div>

          {/* PRICE BREAKDOWN */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/90 p-4 space-y-2">
            <p className="text-slate-100 font-semibold text-[0.9rem]">Oda / Fiyat Kırılımı</p>

            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
              <p className="text-[0.75rem] text-slate-400">Teklif toplam (canlı)</p>
              <p className="text-lg font-extrabold text-emerald-200">{mny(lastPrice, offerCurrency)}</p>
              {offerAny?.note ? <p className="text-[0.8rem] text-slate-200 mt-2">Otel notu: <span className="text-slate-300">{offerAny.note}</span></p> : null}
            </div>

            {breakdown.length ? (
              <div className="grid md:grid-cols-2 gap-2">
                {breakdown.map((rb: any, idx: number) => {
                  const nn = n(rb?.nights, nights);
                  const nightly = n(rb?.nightlyPrice, 0);
                  const total = n(rb?.totalPrice, nightly * nn);
                  const label = rb?.roomTypeName || rb?.roomTypeId || rb?.name || `Oda ${idx + 1}`;

                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => openRoomProfile(rb)}
                      className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-left hover:bg-white/[0.04] hover:border-emerald-500/30 transition"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-slate-100 text-[0.95rem] font-extrabold">{label}</div>
                          <div className="text-[0.78rem] text-slate-300 mt-1">
                            {nn} gece × {nightly.toLocaleString("tr-TR")} {offerCurrency}
                          </div>
                          <div className="text-[0.72rem] text-slate-500 mt-2">👆 Tıkla: oda detayını gör</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[0.72rem] text-slate-400">Toplam</div>
                          <div className="text-emerald-300 text-base font-extrabold">{mny(total, offerCurrency)}</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-slate-300">
                Oda kırılımı yok. Toplam tutar tek kalem.
              </div>
            )}
          </div>

          {/* TIMELINE */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/90 p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-slate-100 font-semibold text-[0.9rem]">Fiyat Geçmişi / Pazarlık</p>
              <p className="text-[0.75rem] text-slate-400">Adım: <b className="text-slate-200">{timeline.length}</b></p>
            </div>

            <div className="grid md:grid-cols-2 gap-2">
              {timeline.map((h: any, i: number) => (
                <div key={i} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                  <div className="text-slate-100 font-semibold">
                    {(h.actor === "hotel" ? "Otel" : h.actor === "guest" ? "Sen" : "Sistem")} • {String(h.kind)}
                  </div>
                  {h.createdAt ? <div className="text-[0.7rem] text-slate-500 mt-2">{toTR(h.createdAt) || new Date(toMillis(h.createdAt)).toLocaleString("tr-TR")}</div> : null}
                  <div className="mt-2 inline-flex items-center rounded-md border border-sky-500/35 bg-sky-500/10 px-2 py-1 text-[0.72rem] text-sky-200">
                    {mny(h.price, h.currency || offerCurrency)}
                  </div>
                  {h.note ? <div className="text-[0.78rem] text-slate-300 mt-2">Not: {h.note}</div> : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* LIGHTBOX */}
      {imgOpen && imgSrc ? (
        <div className="fixed inset-0 z-[99] flex items-center justify-center bg-black/80">
          <button className="absolute inset-0" onClick={closeImage} aria-label="Kapat" />
          <div className="relative max-w-5xl w-[92vw]">
            <button type="button" onClick={closeImage} className="btn btn-outline absolute -top-10 right-0">Kapat ✕</button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imgSrc} alt="Büyük" className="w-full max-h-[78vh] object-contain rounded-xl border border-white/10" />
          </div>
        </div>
      ) : null}

      {/* ROOM MODAL */}
      {roomModalOpen && roomModalRoom ? (
        <RoomTypeModal
          room={roomModalRoom}
          onClose={() => {
            setRoomModalOpen(false);
            setRoomModalRoom(null);
          }}
        />
      ) : null}
    </>
  );
}
function RoomTypeModal({ room, onClose }: { room: RoomTypeProfile; onClose: () => void }) {
  const images = ((room.imageUrls ?? room.images ?? room.gallery ?? room.photos ?? []) as string[]).filter(Boolean);
  const [active, setActive] = React.useState(0);

  const [imgOpen, setImgOpen] = React.useState(false);
  const [imgSrc, setImgSrc] = React.useState<string | null>(null);

  const openImage = (src?: string | null) => { if (!src) return; setImgSrc(src); setImgOpen(true); };
  const closeImage = () => { setImgOpen(false); setImgSrc(null); };

  return (
    <>
      <div className="fixed inset-0 z-[85] flex items-start justify-center bg-black/70">
        <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
        <div className="relative mt-14 w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-xl max-h-[85vh] overflow-y-auto space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-extrabold text-slate-100">{room?.name || "Oda tipi"}</h3>
              {room?.shortDescription ? <p className="text-[0.8rem] text-slate-300 mt-1">{room.shortDescription}</p> : null}
            </div>
            <button type="button" onClick={onClose} className="btn btn-outline">Kapat ✕</button>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden">
            {images.length ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <button type="button" className="w-full h-64 relative group" onClick={() => openImage(images[active])}>
                  <img src={images[active]} alt="oda" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition" />
                  <div className="absolute bottom-3 right-3 rounded-md border border-white/25 bg-black/40 px-2 py-1 text-[0.72rem] text-white">🔍 Büyüt</div>
                </button>

                {images.length > 1 && (
                  <div className="flex gap-2 p-2 bg-slate-950/80 border-t border-slate-800 overflow-x-auto">
                    {images.slice(0, 14).map((img: string, idx: number) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setActive(idx)}
                        className={`w-16 h-16 rounded-lg border overflow-hidden ${active === idx ? "border-emerald-400" : "border-slate-700"}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={img} alt={`thumb-${idx}`} className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="h-64 flex items-center justify-center text-slate-500 text-sm">Bu oda tipi için görsel yok.</div>
            )}
          </div>

          {room?.description ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-[0.75rem] text-slate-400 mb-1">Açıklama</p>
              <p className="text-slate-100 text-sm whitespace-pre-wrap">{room.description}</p>
            </div>
          ) : null}
        </div>
      </div>

      {imgOpen && imgSrc ? (
        <div className="fixed inset-0 z-[99] flex items-center justify-center bg-black/80">
          <button className="absolute inset-0" onClick={closeImage} aria-label="Kapat" />
          <div className="relative max-w-5xl w-[92vw]">
            <button type="button" onClick={closeImage} className="btn btn-outline absolute -top-10 right-0">Kapat ✕</button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imgSrc} alt="Büyük oda görseli" className="w-full max-h-[78vh] object-contain rounded-xl border border-white/10" />
          </div>
        </div>
      ) : null}
    </>
  );
}


   
function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <p className="text-[0.72rem] text-slate-400">{label}</p>
      <p className="text-sm text-slate-100 mt-1 whitespace-pre-wrap">{value}</p>
    </div>
  );
}


export default function GuestOffersPage() {
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth() as any;
  const db = getFirestoreDb();

  // HOTEL/GRUP
  const [offers, setOffers] = useState<GuestOffer[]>([]);
  const [requestsMap, setRequestsMap] = useState<Record<string, RequestSummary>>({});
  const [hotelsMap, setHotelsMap] = useState<Record<string, HotelInfo>>({});

  // PACKAGE
  const [packageRequests, setPackageRequests] = useState<PackageRequest[]>([]);
  const [packageOffersByReq, setPackageOffersByReq] = useState<Record<string, PackageOffer[]>>({});
  const [agenciesMap, setAgenciesMap] = useState<Record<string, AgencyInfo>>({});

  // UI
  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savingAction, setSavingAction] = useState(false);

  // filters
  const [qText, setQText] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "hotel" | "group" | "package">("all");
  const [cityFilter, setCityFilter] = useState<string>("all");

  const [statusFilter, setStatusFilter] = useState<"all" | "sent" | "rejected">("all");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  const [boostNegotiable, setBoostNegotiable] = useState(true);
  const [boostRefreshable, setBoostRefreshable] = useState(true);

  // detail/payment
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsOffer, setDetailsOffer] = useState<GuestOffer | null>(null);

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentOffer, setPaymentOffer] = useState<GuestOffer | null>(null);

  const [selectedForPaymentId, setSelectedForPaymentId] = useState<string | null>(null);

  // counter
  const [counterEditId, setCounterEditId] = useState<string | null>(null);
  const [counterPrice, setCounterPrice] = useState<string>("");

  // restart dates modal
  const [restartModalOpen, setRestartModalOpen] = useState(false);
  const [restartModalReq, setRestartModalReq] = useState<RequestSummary | null>(null);

  // package modals
  const [pkgModalOpen, setPkgModalOpen] = useState(false);
  const [pkgModalReq, setPkgModalReq] = useState<PackageRequest | null>(null);

  const [pkgPayOpen, setPkgPayOpen] = useState(false);
  const [pkgPayReq, setPkgPayReq] = useState<PackageRequest | null>(null);
  const [pkgPayOffer, setPkgPayOffer] = useState<PackageOffer | null>(null);
  const [pkgPayMethod, setPkgPayMethod] = useState<PackagePaymentMethod>("transfer");
  const [pkgPaySaving, setPkgPaySaving] = useState(false);
  const [pkgPayError, setPkgPayError] = useState<string | null>(null);
  const [pkgPayMessage, setPkgPayMessage] = useState<string | null>(null);
  const [pkgThreeDSOpen, setPkgThreeDSOpen] = useState(false);

  // tick
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // OPEN/CLOSE
  function openDetails(o: GuestOffer) { setDetailsOffer(o); setDetailsOpen(true); }
  function closeDetails() { setDetailsOffer(null); setDetailsOpen(false); }

  function openPackageModal(p: PackageRequest) { setPkgModalReq(p); setPkgModalOpen(true); }
  function closePackageModal() { setPkgModalReq(null); setPkgModalOpen(false); }

  function openPkgPayment(req: PackageRequest, offer: PackageOffer) {
    setPkgPayReq(req);
    setPkgPayOffer(offer);
    setPkgPayMethod("transfer");
    setPkgPayError(null);
    setPkgPayMessage(null);
    setPkgPayOpen(true);
    setPkgThreeDSOpen(false);
  }
  function closePkgPayment() {
    setPkgPayOpen(false);
    setPkgPayReq(null);
    setPkgPayOffer(null);
    setPkgPayError(null);
    setPkgPayMessage(null);
    setPkgThreeDSOpen(false);
  }

  // CAN COUNTER
  function canCounter(o: GuestOffer) {
    if (o.mode !== "negotiable") return false;
    if (o.status !== "sent" && o.status !== "countered") return false;
    if (o.guestCounterPrice && o.guestCounterPrice > 0) return false;
    if (offerDisabled(o)) return false;
    return true;
  }
  function startCounter(o: GuestOffer) {
    if (!canCounter(o)) return;
    setCounterEditId(o.id);
    setCounterPrice(String(o.totalPrice));
    setActionError(null);
    setActionMessage(null);
  }
  function cancelCounter() { setCounterEditId(null); setCounterPrice(""); }

  // PAYMENT SELECTION
  function handleSelectForPayment(o: GuestOffer) {
    if (offerDisabled(o)) return;
    setSelectedForPaymentId(o.id);
    setActionMessage("Bu teklifi seçtin. Ödemeye ilerleyebilirsin.");
    setActionError(null);
  }
  function handleCancelSelection() { setSelectedForPaymentId(null); }
  function handleOpenPaymentModal(o: GuestOffer) {
    if (offerDisabled(o)) return;
    setPaymentOffer(o);
    setPaymentOpen(true);
  }
  function handleClosePaymentModal() {
    setPaymentOpen(false);
    setPaymentOffer(null);
  }

  /* ---------------- LOAD ALL ---------------- */
  useEffect(() => {
    async function load() {
      if (authLoading) return;
      if (!profile?.uid) { setLoading(false); return; }

      setLoading(true);
      setActionError(null);

      try {
        // 1) requests
        const qReq = query(collection(db, "requests"), where("guestId", "==", profile.uid));
        const snapReq = await getDocs(qReq);

        const reqs: RequestSummary[] = snapReq.docs
          .map((d) => {
            const v = d.data() as AnyObj;
            return {
              id: d.id,
              raw: { id: d.id, ...v },

              city: v.city,
              district: v.district ?? null,

              checkIn: v.checkIn,
              checkOut: v.checkOut,

              checkInTime: v.checkInTime ?? null,
              checkOutTime: v.checkOutTime ?? null,

              sameDayStay: v.sameDayStay ?? false,

              earlyCheckInWanted: v.earlyCheckInWanted ?? false,
              earlyCheckInTime: v.earlyCheckInTime ?? null,

              lateCheckOutWanted: v.lateCheckOutWanted ?? false,
              lateCheckOutFrom: v.lateCheckOutFrom ?? null,
              lateCheckOutTo: v.lateCheckOutTo ?? null,

              adults: v.adults ?? 0,
              childrenCount: v.childrenCount ?? 0,
              childrenAges: Array.isArray(v.childrenAges) ? v.childrenAges : [],

              roomsCount: v.roomsCount ?? 1,
              roomTypes: v.roomTypes ?? [],

              responseDeadlineMinutes: v.responseDeadlineMinutes ?? 60,
              createdAt: v.createdAt,
              status: v.status ?? "open",

              restartAt: v.restartAt ?? null,

              type: v.type ?? null,
              isGroup: v.isGroup ?? false,

              hotelType: v.hotelType ?? v.accommodationType ?? null,
              mealPlan: v.mealPlan ?? v.boardType ?? null,
              starRatingPref: v.starRatingPref ?? v.starRating ?? null,

              boardTypes: v.boardTypes ?? [],
              boardTypeNote: v.boardTypeNote ?? null,

              hotelFeaturePrefs: v.hotelFeaturePrefs ?? [],
              hotelFeatureNote: v.hotelFeatureNote ?? null,

              desiredStarRatings: v.desiredStarRatings ?? null,
              generalNote: v.generalNote ?? v.note ?? null,

              nearMe: v.nearMe ?? null
            };
          })
          .filter((r) => r.status !== "deleted");

        const reqMap: Record<string, RequestSummary> = {};
        reqs.forEach((r) => (reqMap[r.id] = r));
        const requestIds = reqs.map((r) => r.id);

        // 2) offers
        const offersOut: GuestOffer[] = [];
        for (const part of chunkArray(requestIds, 10)) {
          if (!part.length) continue;
          const qOff = query(collection(db, "offers"), where("requestId", "in", part));
          const snapOff = await getDocs(qOff);
          snapOff.docs.forEach((d) => {
            const v = d.data() as AnyObj;
            offersOut.push({
              id: d.id,
              requestId: v.requestId,
              hotelId: v.hotelId,
              hotelName: v.hotelName ?? null,
              totalPrice: Number(v.totalPrice ?? 0),
              currency: v.currency ?? "TRY",
              mode: (v.mode ?? "simple") as OfferMode,
              note: v.note ?? null,
              status: v.status ?? "sent",
              guestCounterPrice: v.guestCounterPrice ?? null,
              createdAt: v.createdAt,
              updatedAt: v.updatedAt,
              roomTypeId: v.roomTypeId ?? null,
              roomTypeName: v.roomTypeName ?? null,
              roomBreakdown: Array.isArray(v.roomBreakdown) ? v.roomBreakdown : [],
              cancellationPolicyType: v.cancellationPolicyType ?? null,
              cancellationPolicyDays: v.cancellationPolicyDays ?? null,
              priceHistory: Array.isArray(v.priceHistory) ? v.priceHistory : []
            });
          });
        }
        offersOut.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));

        // 3) hotels map
        const hotelIds = Array.from(new Set(offersOut.map((o) => o.hotelId).filter(Boolean)));
        const hotelMap: Record<string, HotelInfo> = {};
        await Promise.all(
          hotelIds.map(async (hid) => {
            const snap = await getDoc(doc(db, "users", hid));
            if (!snap.exists()) return;
            const u = snap.data() as AnyObj;
            hotelMap[hid] = {
              id: hid,
              displayName: u.displayName,
              email: u.email,
              website: u.website || u.hotelProfile?.website || "",
              hotelProfile: u.hotelProfile
            };
          })
        );

        // 4) packageRequests
        let snapPkg = await getDocs(
          query(collection(db, "packageRequests"), where("createdByRole", "==", "guest"), where("createdById", "==", profile.uid))
        );

        const pkgs: PackageRequest[] = snapPkg.docs
          .map((d) => {
            const v = d.data() as AnyObj;
            const raw = { id: d.id, ...v };
            return {
              id: d.id,
              raw,
              title: v.title ?? null,
              country: v.country ?? "Türkiye",
              city: v.city ?? null,
              district: v.district ?? null,
              dateFrom: v.dateFrom ?? v.checkIn ?? null,
              dateTo: v.dateTo ?? v.checkOut ?? null,
              nights: v.nights ?? null,
              paxAdults: v.paxAdults ?? v.adults ?? 0,
              paxChildren: v.paxChildren ?? v.childrenCount ?? 0,
              childrenAges: Array.isArray(v.childrenAges) ? v.childrenAges : null,
              roomsCount: v.roomsCount ?? null,
              roomTypes: Array.isArray(v.roomTypes) ? v.roomTypes : null,
              needs: Array.isArray(v.needs) ? v.needs : null,
              wantsTours: v.wantsTours ?? false,
              tourCount: v.tourCount ?? null,
              tourNotes: v.tourNotes ?? null,
              wantsTransfer: v.wantsTransfer ?? false,
              transferType: v.transferType ?? null,
              transferNotes: v.transferNotes ?? null,
              wantsCar: v.wantsCar ?? false,
              carType: v.carType ?? null,
              licenseYear: v.licenseYear ?? null,
              carNotes: v.carNotes ?? null,
              extras: Array.isArray(v.extras) ? v.extras : null,
              activities: v.activities ?? null,
              note: v.note ?? v.notes ?? null,
              responseDeadlineMinutes: v.responseDeadlineMinutes ?? 180,
              createdByRole: v.createdByRole ?? "guest",
              createdById: v.createdById ?? null,
              acceptedOfferId: v.acceptedOfferId ?? null,
              bookingId: v.bookingId ?? null,
              status: v.status ?? "open",
              createdAt: v.createdAt,
              hiddenFromGuest: v.hiddenFromGuest ?? false,
              hiddenAt: v.hiddenAt ?? null
            };
          })
          .filter((p) => p.status !== "deleted")
          .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));

        // 5) packageOffers (requestId IN)
        const pkgOffersMap: Record<string, PackageOffer[]> = {};
        const agencyIdsSet = new Set<string>();
        const pkgIds = pkgs.map((x) => x.id);

        for (const part of chunkArray(pkgIds, 10)) {
          if (!part.length) continue;
          const qPkgOff = query(collection(db, "packageOffers"), where("requestId", "in", part));
          const snapPkgOff = await getDocs(qPkgOff);

          snapPkgOff.docs.forEach((d) => {
            const v = d.data() as AnyObj;
            const po: PackageOffer = {
              id: d.id,
              requestId: v.requestId,
              agencyId: v.agencyId,
              agencyName: v.agencyName ?? null,
              totalPrice: Number(v.totalPrice ?? 0),
              currency: v.currency ?? "TRY",
              breakdown: v.breakdown ?? {},
              packageDetails: v.packageDetails ?? {},
              note: v.note ?? null,
              status: v.status ?? "sent",
              createdAt: v.createdAt,
              updatedAt: v.updatedAt,
              paymentOptions: v.paymentOptions ?? null
            };

            pkgOffersMap[po.requestId] = pkgOffersMap[po.requestId] || [];
            pkgOffersMap[po.requestId].push(po);

            if (po.agencyId) agencyIdsSet.add(po.agencyId);
          });
        }

        Object.values(pkgOffersMap).forEach((arr) =>
          arr.sort((a, b) => (b.updatedAt?.toMillis?.() ?? b.createdAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? a.createdAt?.toMillis?.() ?? 0))
        );

        // 6) agencies
        const agencies: Record<string, AgencyInfo> = {};
        await Promise.all(
          Array.from(agencyIdsSet).map(async (aid) => {
            const snap = await getDoc(doc(db, "users", aid));
            if (!snap.exists()) return;
            const u = snap.data() as AnyObj;
            agencies[aid] = { id: aid, displayName: u.displayName ?? null, email: u.email ?? null, agencyProfile: u.agencyProfile ?? null };
          })
        );

        // set
        setRequestsMap(reqMap);
        setOffers(offersOut);
        setHotelsMap(hotelMap);

        setPackageRequests(pkgs);
        setPackageOffersByReq(pkgOffersMap);
        setAgenciesMap(agencies);
      } catch (err: any) {
        console.error(err);
        setActionError(err?.message || "Yükleme hatası.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [authLoading, profile?.uid, db]);

  /* ---------------- HOTEL OFFERS: restartAt filter ---------------- */
  const offersFilteredByRestart = useMemo(() => {
    return offers.filter((o) => {
      const req = requestsMap[o.requestId];
      const ra = req?.restartAt?.toMillis?.() ?? 0;
      const oc = o.createdAt?.toMillis?.() ?? 0;
      if (ra > 0 && oc > 0 && oc < ra) return false;
      return true;
    });
  }, [offers, requestsMap]);

  const filteredOffers = useMemo(() => {
    return offersFilteredByRestart.filter((o) => {
      if (o.status === "accepted") return false;
      if (statusFilter !== "all" && o.status !== statusFilter) return false;

      if (fromDate) {
        if (!o.createdAt) return false;
        const d = o.createdAt.toDate().toISOString().slice(0, 10);
        if (d < fromDate) return false;
      }
      if (toDate) {
        if (!o.createdAt) return false;
        const d = o.createdAt.toDate().toISOString().slice(0, 10);
        if (d > toDate) return false;
      }
      return true;
    });
  }, [offersFilteredByRestart, statusFilter, fromDate, toDate]);

  const cityOptions = useMemo(() => {
    const s = new Set<string>();
    Object.values(requestsMap).forEach((r) => r.city && s.add(r.city));
    packageRequests.forEach((p) => p.city && s.add(p.city));
    return ["all", ...Array.from(s)];
  }, [requestsMap, packageRequests]);

  const groupedByRequest = useMemo(() => {
    const blocks: {
      request: RequestSummary;
      offers: GuestOffer[];
      status: "open" | "expired";
      remaining: ReturnType<typeof formatRemaining>;
      bestOfferId: string | null;
    }[] = [];

    const q = qText.trim().toLowerCase();

    Object.values(requestsMap).forEach((req) => {
      if (req.status === "deleted") return;

      const isGroup = req.isGroup || req.type === "group";
      if (typeFilter === "hotel" && isGroup) return;
      if (typeFilter === "group" && !isGroup) return;
      if (typeFilter === "package") return;

      if (cityFilter !== "all" && req.city !== cityFilter) return;

      if (q) {
        const hay = [req.id, req.city, req.district, req.generalNote, req.boardTypeNote, req.hotelFeatureNote, req.type]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return;
      }

      const status = computeRequestStatus(req, now);
      const remaining = formatRemaining(req, now);

      const offersForReq = filteredOffers.filter((o) => o.requestId === req.id);

      const scored = offersForReq.slice().sort((a, b) => {
        const score = (o: GuestOffer) => {
          let s = 0;
          if (boostNegotiable && o.mode === "negotiable") s += 70;
          if (boostRefreshable && (o.updatedAt || (o.priceHistory?.some((h) => h.kind === "update") ?? false))) s += 35;
          if (o.mode === "refreshable") s += 15;

          if (isHotelCancelledStatus(o.status)) s -= 9999;
          if (o.status === "rejected") s -= 9999;

          s += Math.max(0, 500000 - Number(o.totalPrice || 0));
          return s;
        };
        return score(b) - score(a);
      });

      const bestOfferId = scored.length ? scored[0].id : null;

      blocks.push({ request: req, offers: scored, status, remaining, bestOfferId });
    });

    blocks.sort((a, b) => (b.request.createdAt?.toMillis?.() ?? 0) - (a.request.createdAt?.toMillis?.() ?? 0));
    return blocks;
  }, [requestsMap, filteredOffers, now, qText, typeFilter, cityFilter, boostNegotiable, boostRefreshable]);

  // PACKAGE lists
  const pkgAcceptedList = useMemo(
    () => packageRequests.filter((p) => (p.status ?? "") === "accepted" && !!p.bookingId && (p.hiddenFromGuest ?? false) === false),
    [packageRequests]
  );
  const pkgOpenList = useMemo(
    () => packageRequests.filter((p) => (p.status ?? "open") !== "accepted" && (p.status ?? "open") !== "deleted"),
    [packageRequests]
  );

  /* ---------------- ACTIONS ---------------- */
 async function restartRequest(req: RequestSummary, patch?: Partial<RequestSummary>) {
  if (isCheckInPast(req.checkIn) && !patch) {
    setRestartModalReq(req);
    setRestartModalOpen(true);
    return;
  }

  try {
    setSavingAction(true);
    setActionError(null);
    setActionMessage(null);

    // ✅ undefined alanları Firestore’a göndermiyoruz
    const cleanPatch = stripUndefined(patch || {});
    const payload = stripUndefined({
      ...cleanPatch,
      restartAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      status: "open"
    });

    await updateDoc(doc(db, "requests", req.id), payload);

    setRequestsMap((prev) => {
      const copy = { ...prev };
      const cur = copy[req.id];
      if (cur) {
        copy[req.id] = {
          ...cur,
          ...(cleanPatch as any),
          status: "open",
          restartAt: Timestamp.fromDate(new Date()),
          createdAt: Timestamp.fromDate(new Date())
        };
      }
      return copy;
    });

    setActionMessage("Talep yeniden başlatıldı. Eski teklifler gizlendi, yeni açılmış gibi görünecek.");
  } catch (e: any) {
    console.error(e);
    setActionError(`Talep yeniden başlatılamadı: ${e?.message || String(e)}`);
  } finally {
    setSavingAction(false);
  }
}


  function editRequest(req: RequestSummary) {
    router.push(`/guest/requests/new?requestId=${req.id}&mode=edit`);
  }

  async function deleteRequest(req: RequestSummary) {
    const ok = window.confirm("Bu talebi silmek istediğine emin misin?");
    if (!ok) return;

    try {
      setSavingAction(true);
      await updateDoc(doc(db, "requests", req.id), { status: "deleted", deletedAt: serverTimestamp() });

      setRequestsMap((prev) => {
        const copy = { ...prev };
        delete copy[req.id];
        return copy;
      });

      setActionMessage("Talep silindi (DB’de durur, listeden kalktı).");
    } catch (e) {
      console.error(e);
      setActionError("Talep silinemedi.");
    } finally {
      setSavingAction(false);
    }
  }

  function handleRestartModalSubmit(patch: { checkIn: string; checkOut: string; checkInTime?: string; checkOutTime?: string }) {
    if (!restartModalReq) return;
    const r = restartModalReq;
    setRestartModalOpen(false);
    setRestartModalReq(null);
    restartRequest(r, patch as any);
  }

  async function handleCounterSubmit(e: FormEvent<HTMLFormElement>, offer: GuestOffer) {
    e.preventDefault();
    setActionError(null);
    setActionMessage(null);

    if (!canCounter(offer)) {
      setActionError("Bu teklif için pazarlık yapılamaz.");
      return;
    }

    const value = Number(counterPrice);
    if (!Number.isFinite(value) || value <= 0) {
      setActionError("Geçerli bir karşı teklif gir.");
      return;
    }

    if (value > Number(offer.totalPrice || 0)) {
      setActionError("Karşı teklif, otelin teklifinden yüksek olamaz.");
      return;
    }

    try {
      setSavingAction(true);

      await pushOfferPriceHistory(db, offer.id, {
        actor: "guest",
        kind: "counter",
        price: value,
        currency: offer.currency ?? "TRY",
        note: "Misafir karşı teklif"
      });

      setOffers((prev) => prev.map((o) => (o.id === offer.id ? { ...o, guestCounterPrice: value, status: "countered" } : o)));
      await createNotification(db, offer.hotelId, { type: "guestCounter", offerId: offer.id, requestId: offer.requestId, amount: value });

      cancelCounter();
      setActionMessage("Karşı teklifin otele iletildi.");
    } catch (err: any) {
      console.error(err);
      setActionError(`Karşı teklif gönderilemedi: ${err?.message || String(err)}`);
    } finally {
      setSavingAction(false);
    }
  }

  async function handleReject(offer: GuestOffer) {
    if (offerDisabled(offer)) return;
    const ok = window.confirm("Bu teklifi reddetmek istiyor musun?");
    if (!ok) return;

    try {
      setSavingAction(true);
      await updateDoc(doc(db, "offers", offer.id), { status: "rejected", rejectedAt: serverTimestamp() });
      setOffers((prev) => prev.map((o) => (o.id === offer.id ? { ...o, status: "rejected" } : o)));
      await createNotification(db, offer.hotelId, { type: "offerRejected", offerId: offer.id, requestId: offer.requestId });
      setActionMessage("Teklif reddedildi.");
    } catch (e) {
      console.error(e);
      setActionError("Teklif reddedilemedi.");
    } finally {
      setSavingAction(false);
    }
  }

  async function handlePaymentConfirm(method: PaymentMethod) {
    if (!paymentOffer || !profile?.uid) return;

    const offer = paymentOffer;
    const req = requestsMap[offer.requestId];
    const hotel = hotelsMap[offer.hotelId];

    try {
      setSavingAction(true);
      setActionError(null);
      setActionMessage(null);

      const bookingId = await createHotelBooking({ db, offer, req, hotel, guest: profile, paymentMethod: method });
      await createNotification(db, profile.uid, { type: "bookingCreated", bookingId, offerId: offer.id });
      await createNotification(db, offer.hotelId, { type: "bookingCreated", bookingId, offerId: offer.id });

      setSelectedForPaymentId(null);
      handleClosePaymentModal();

      setActionMessage("Rezervasyon oluşturuldu. Rezervasyonlarım sayfasına yönlendiriliyorsun…");
      setTimeout(() => router.push("/guest/bookings"), 900);
    } catch (e: any) {
      console.error(e);
      setActionError(`Rezervasyon oluşturulamadı: ${e?.message || String(e)}`);
    } finally {
      setSavingAction(false);
    }
  }

  // PACKAGE actions
  async function restartPackageRequest(p: PackageRequest) {
    try {
      await updateDoc(doc(db, "packageRequests", p.id), { createdAt: serverTimestamp(), status: "open" });
      setPackageRequests((prev) => prev.map((x) => (x.id === p.id ? { ...x, createdAt: Timestamp.fromDate(new Date()), status: "open" } : x)));
      setActionMessage("Paket talebin yeniden başlatıldı. Acentalar tekrar teklif verebilir.");
    } catch (e) {
      console.error(e);
      setActionError("Paket talebi yeniden başlatılırken hata oluştu.");
    }
  }
  function editPackageRequest(p: PackageRequest) {
    router.push(`/guest/package-requests/new?requestId=${p.id}`);
  }
  async function deletePackageRequest(p: PackageRequest) {
    const ok = window.confirm("Bu paket talebini silmek istediğine emin misin?");
    if (!ok) return;

    try {
      await updateDoc(doc(db, "packageRequests", p.id), { status: "deleted", deletedAt: serverTimestamp() });
      setPackageRequests((prev) => prev.filter((x) => x.id !== p.id));
      setActionMessage("Paket talebi silindi.");
    } catch (e) {
      console.error(e);
      setActionError("Paket talebi silinirken hata oluştu.");
    }
  }

  async function acceptPackageAndCreateBooking(method: PackagePaymentMethod) {
    if (!profile?.uid || !pkgPayReq || !pkgPayOffer) return;

    try {
      setPkgPaySaving(true);
      setPkgPayError(null);
      setPkgPayMessage(null);

      const bookingId = await createPackageBooking({
        db,
        req: pkgPayReq,
        offer: pkgPayOffer,
        agenciesMap,
        guest: profile,
        method
      });

      await createNotification(db, profile.uid, { type: "packageBookingCreated", bookingId, requestId: pkgPayReq.id, offerId: pkgPayOffer.id });
      await createNotification(db, pkgPayOffer.agencyId, { type: "packageBookingCreated", bookingId, requestId: pkgPayReq.id, offerId: pkgPayOffer.id });

      setPkgPayMessage("Paket kabul edildi. Rezervasyon oluşturuldu. Rezervasyonlarım sayfasına yönlendiriliyorsun...");
      setTimeout(() => { closePkgPayment(); router.push("/guest/bookings"); }, 1200);
    } catch (e: any) {
      console.error(e);
      setPkgPayError(e?.message || "Paket kabul/ödeme sırasında hata oluştu.");
    } finally {
      setPkgPaySaving(false);
    }
  }

  /* ---------------- RENDER ---------------- */
  return (
    <Protected allowedRoles={["guest"]}>
      <div className="container-page space-y-6 relative">
        <section className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-100">Taleplerim / Gelen teklifler</h1>
          <p className="text-sm text-slate-300 max-w-4xl">
            Yeniden başlatınca eski teklifler görünmez. Check-in geçmişse tarih güncelleyerek yeniden başlatırsın.
            Otel iptal ederse teklif soluk görünür.
          </p>

          <div className="flex flex-wrap gap-2">
            <button onClick={() => router.push("/guest/requests/new")} className="rounded-full bg-emerald-500 text-slate-950 px-4 py-2 text-sm font-semibold hover:bg-emerald-400">
              + Otel talebi
            </button>
            <button onClick={() => router.push("/guest/group-request")} className="rounded-full border border-white/10 bg-white/5 text-slate-100 px-4 py-2 text-sm hover:bg-white/10">
              + Grup talebi
            </button>
            <button onClick={() => router.push("/guest/package-requests/new")} className="rounded-full border border-white/10 bg-white/5 text-slate-100 px-4 py-2 text-sm hover:bg-white/10">
              + Paket talebi
            </button>
          </div>
        </section>

        {(actionMessage || actionError) && (
          <div className="space-y-2">
            {actionMessage && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-emerald-200 text-sm">{actionMessage}</div>}
            {actionError && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-200 text-sm">{actionError}</div>}
          </div>
        )}

        {/* Filters */}
        <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow text-xs space-y-3">
          <div className="grid gap-3 md:grid-cols-12 items-end">
            <div className="md:col-span-4 space-y-1">
              <label className="text-[0.75rem] text-slate-200">Arama</label>
              <input value={qText} onChange={(e) => setQText(e.target.value)} className="input" placeholder="şehir, not, id..." />
            </div>

            <div className="md:col-span-2 space-y-1">
              <label className="text-[0.75rem] text-slate-200">Tür</label>
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)} className="input">
                <option value="all">Hepsi</option>
                <option value="hotel">Otel</option>
                <option value="group">Grup</option>
                <option value="package">Paket</option>
              </select>
            </div>

            <div className="md:col-span-2 space-y-1">
              <label className="text-[0.75rem] text-slate-200">Şehir</label>
              <select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)} className="input">
                {cityOptions.map((c) => <option key={c} value={c}>{c === "all" ? "Hepsi" : c}</option>)}
              </select>
            </div>

            <div className="md:col-span-2 space-y-1">
              <label className="text-[0.75rem] text-slate-200">Tarih (ilk)</label>
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="input" />
            </div>

            <div className="md:col-span-2 space-y-1">
              <label className="text-[0.75rem] text-slate-200">Tarih (son)</label>
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="input" />
            </div>

            <div className="md:col-span-12 flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex flex-wrap gap-4 text-[0.75rem] text-slate-200">
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={boostNegotiable} onChange={(e) => setBoostNegotiable(e.target.checked)} />
                  Pazarlıklı otelleri öne çıkar
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={boostRefreshable} onChange={(e) => setBoostRefreshable(e.target.checked)} />
                  Güncellenen fiyatları öne çıkar
                </label>
              </div>

              <div className="flex items-center gap-2">
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="input" style={{ width: 220 }}>
                  <option value="all">Teklif durumu: Hepsi</option>
                  <option value="sent">Otel teklif gönderdi</option>
                  <option value="rejected">Reddettiklerin</option>
                </select>

                <button
                  onClick={() => { setQText(""); setTypeFilter("all"); setCityFilter("all"); setFromDate(""); setToDate(""); setStatusFilter("all"); }}
                  className="btn btn-outline"
                >
                  Temizle
                </button>
              </div>
            </div>

            <div className="md:col-span-12 text-right text-[0.75rem] text-slate-400">
              Saat: <span className="text-slate-200 font-semibold">{new Date(now).toLocaleTimeString("tr-TR")}</span>
            </div>
          </div>
        </section>

        {loading && <p className="text-sm text-slate-400">Yükleniyor…</p>}

        {/* PACKAGE */}
        {(typeFilter === "all" || typeFilter === "package") && (pkgAcceptedList.length > 0 || pkgOpenList.length > 0) && (
          <section className="space-y-3">
            {pkgAcceptedList.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-emerald-200">✅ Kabul edilen paketler</h3>
                {pkgAcceptedList.map((p) => (
                  <div key={p.id} className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-slate-100 font-semibold">{p.title || "Paket"} • {safeStr(p.city)}{p.district ? ` / ${p.district}` : ""}</div>
                      <div className="text-[0.8rem] text-slate-300">{safeStr(p.dateFrom)} – {safeStr(p.dateTo)} • Booking ID: <b className="text-slate-100">{p.bookingId}</b></div>
                      <div className="text-[0.75rem] text-slate-400">Bu paket kabul edildi ve rezervasyon oluşturuldu.</div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => router.push("/guest/bookings")} className="btn btn-primary">Rezervasyonlara Git</button>
                      <button onClick={() => openPackageModal(p)} className="btn btn-sky">Detay</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {pkgOpenList.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-200">🧳 Paket taleplerin</h3>

                {pkgOpenList
                  .filter((p) => (cityFilter === "all" ? true : p.city === cityFilter))
                  .filter((p) => {
                    const q = qText.trim().toLowerCase();
                    if (!q) return true;
                    const hay = [p.id, p.title, p.city, p.district, p.note, (p.needs || []).join(" ")].filter(Boolean).join(" ").toLowerCase();
                    return hay.includes(q);
                  })
                  .map((p) => {
                    const offersForReq = packageOffersByReq[p.id] ?? [];
                    const best = guessBestPackageOffer(offersForReq);
                    const pax = safeNum(p.paxAdults, 0) + safeNum(p.paxChildren, 0);
                    const nights = p.nights ?? calcNightsFromISO(p.dateFrom, p.dateTo);

                    const deadlineMin = safeNum(p.responseDeadlineMinutes, 180);
                    const rem = formatRemainingPkg(p.createdAt, deadlineMin, now);
                    const st: PackageRequestStatus =
                      (p.status as any) === "accepted" ? "accepted" :
                      (p.status as any) === "deleted" ? "deleted" :
                      rem.expired ? "expired" : "open";

                    const barColor = rem.color === "red" ? "bg-red-500" : rem.color === "yellow" ? "bg-amber-400" : "bg-emerald-500";

                    return (
                      <div key={p.id} className={`rounded-2xl border border-slate-800 bg-slate-950/80 overflow-hidden ${st === "expired" ? "opacity-80" : ""}`}>
                        <div className="px-4 py-3 bg-slate-900/85 flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="inline-flex items-center rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-[0.7rem] text-indigo-200">🧳 Paket</span>
                              <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[0.7rem] ${badgeByPkgStatus(st)}`}>
                                {st === "open" ? "Açık" : st === "expired" ? "Süre doldu" : st === "accepted" ? "Kabul edildi" : "Silindi"}
                              </span>
                              <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[0.7rem] text-slate-200">
                                Teklif: <b className="ml-1 text-white">{offersForReq.length}</b>
                              </span>
                            </div>

                            <p className="text-slate-100 text-sm font-semibold">{p.title || "Paket talebi"} • {safeStr(p.city)}{p.district ? ` / ${p.district}` : ""}</p>
                            <p className="text-[0.75rem] text-slate-300">{safeStr(p.dateFrom)} – {safeStr(p.dateTo)} • {nights} gece • {pax} kişi</p>

                            <div className="mt-2 w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                              <div className={`h-full ${barColor}`} style={{ width: `${Math.round(rem.ratio * 100)}%` }} />
                            </div>
                            <p className={`text-[0.75rem] font-semibold ${rem.color === "red" ? "text-red-300" : rem.color === "yellow" ? "text-amber-200" : "text-emerald-200"}`}>
                              {rem.text}
                            </p>
                          </div>

                          <div className="flex flex-col items-end gap-2">
                            {best ? (
                              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-right">
                                <p className="text-[0.65rem] text-slate-400">En iyi teklif (şu an)</p>
                                <p className="text-[0.85rem] font-extrabold text-emerald-200">{money(best.totalPrice, best.currency)}</p>
                                <p className="text-[0.7rem] text-slate-300">{best.agencyName || agenciesMap[best.agencyId]?.displayName || "Acenta"}</p>
                              </div>
                            ) : (
                              <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[0.75rem] text-slate-300">Henüz teklif yok</div>
                            )}

                            <button onClick={() => openPackageModal(p)} className="btn btn-sky">Detay / Teklifler</button>
                          </div>
                        </div>

                        <div className="px-4 py-3 border-t border-slate-800 bg-slate-950/60 text-[0.75rem] text-slate-400">
                          Paket teklifleri kırılım ile gelir. Kabul ettiğinde ödeme adımı açılır.
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </section>
        )}

        {/* HOTEL/GROUP */}
        {(typeFilter === "all" || typeFilter === "hotel" || typeFilter === "group") && (
          <section className="space-y-3">
            {groupedByRequest.map((block) => {
              const req = block.request;
              const reqOffers = block.offers;
              const status = block.status;
              const remaining = block.remaining;
              const bestOfferId = block.bestOfferId;

              const totalGuests = (req.adults ?? 0) + (req.childrenCount ?? 0);
              const isGroup = req.isGroup || req.type === "group";

              const remainingClass = remaining.color === "red" ? "text-red-300" : remaining.color === "yellow" ? "text-amber-200" : "text-emerald-200";
              const barColor = remaining.color === "red" ? "bg-red-500" : remaining.color === "yellow" ? "bg-amber-400" : "bg-emerald-500";

              return (
                <section key={req.id} className={`rounded-2xl border border-slate-800 bg-slate-950/80 overflow-hidden ${status === "expired" ? "opacity-80" : ""}`}>
                  <div className="px-4 py-3 bg-slate-900/85">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-slate-100 text-sm font-semibold">{req.city}{req.district ? ` / ${req.district}` : ""} • {req.checkIn} – {req.checkOut}</p>
                          <div className="flex flex-wrap gap-2 mt-1">
                            <span className="badge badge-slate">Check-in: {safeStr(req.checkInTime, "—")}</span>
                            <span className="badge badge-slate">Check-out: {safeStr(req.checkOutTime, "12:00")}</span>
                            {req.sameDayStay && <span className="badge badge-amber">Aynı gün</span>}
                            {req.earlyCheckInWanted && <span className="badge badge-sky">Erken: {safeStr(req.earlyCheckInTime, "—")}</span>}
                            {req.lateCheckOutWanted && <span className="badge badge-sky">Geç: {safeStr(req.lateCheckOutFrom, "—")} - {safeStr(req.lateCheckOutTo, "—")}</span>}
                            {isGroup && <span className="badge badge-amber">Grup</span>}
                            <span className={`badge ${status === "expired" ? "badge-red" : "badge-sky"}`}>{status === "expired" ? "Süresi doldu" : "Açık"}</span>
                          </div>
                        </div>

                        <p className="text-[0.75rem] text-slate-300">{totalGuests} kişi • {req.roomsCount || 1} oda</p>

                        <div className="mt-2 w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                          <div className={`h-full ${barColor}`} style={{ width: `${Math.round(remaining.ratio * 100)}%` }} />
                        </div>
                      </div>

                      <div className="text-right space-y-1">
                        <p className={`text-[0.78rem] font-semibold ${remainingClass}`}>{remaining.text}</p>
                        <p className="text-[0.7rem] text-slate-400">Talep ID: {req.id}</p>
                      </div>
                    </div>
                  </div>

                  {status === "expired" ? (
                    <div className="px-4 py-4 border-t border-slate-800 bg-slate-950/60 text-[0.75rem] text-slate-300 space-y-2">
                      <p>Bu talebin süresi doldu. Yeni teklif gelmez.</p>
                      <div className="flex flex-wrap justify-end gap-2">
                        <button onClick={() => restartRequest(req)} disabled={savingAction} className="btn btn-warning">Yeniden başlat</button>
                        <button onClick={() => editRequest(req)} className="btn btn-sky">Düzenle</button>
                        <button onClick={() => deleteRequest(req)} disabled={savingAction} className="btn btn-danger">Sil</button>
                      </div>
                    </div>
                  ) : (
                    <div className="pt-2 pb-3">
                      {reqOffers.length === 0 ? (
                        <div className="px-4 py-4 text-[0.8rem] text-slate-400 border-t border-slate-800">Henüz teklif yok.</div>
                      ) : (
                        <>
                          <div className="hidden md:grid grid-cols-[1.6fr_1.1fr_1.1fr_1.2fr_auto] bg-slate-900 text-[0.75rem] font-semibold text-slate-100 px-4 py-2">
                            <div>Otel</div><div>Toplam fiyat</div><div>Teklif tipi</div><div>Durum</div><div className="text-right">İşlemler</div>
                          </div>

                          {reqOffers.map((o) => {
                            const createdStr = o.createdAt ? o.createdAt.toDate().toLocaleString("tr-TR") : "";
                            const isSelected = selectedForPaymentId === o.id;
                            const isBest = bestOfferId === o.id;
                            const disabled = offerDisabled(o);

                            return (
                              <div key={o.id} className={`border-t border-slate-800 ${isBest ? "bg-emerald-500/5" : ""} ${disabled ? "opacity-70" : ""}`}>
                                <div className="grid md:grid-cols-[1.6fr_1.1fr_1.1fr_1.2fr_auto] gap-2 px-4 py-3 items-center">
                                  <div className="space-y-1 text-slate-100">
                                    <div className="md:hidden text-[0.7rem] text-slate-400">Otel</div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <div className="font-semibold text-sm">{o.hotelName || hotelsMap[o.hotelId]?.displayName || "Otel"}</div>
                                      {isBest && <span className="badge badge-emerald">⚡ En iyi</span>}
                                      {o.mode === "negotiable" && <span className="badge badge-amber">💬 Pazarlıklı</span>}
                                      {isHotelCancelledStatus(o.status) && <span className="badge badge-red">İptal</span>}
                                    </div>
                                  </div>

                                  <div className="text-slate-100">
                                    <div className="md:hidden text-[0.7rem] text-slate-400">Toplam fiyat</div>
                                    <div className="font-extrabold text-sm text-emerald-300">{money(o.totalPrice, o.currency)}</div>
                                    <div className="text-[0.7rem] text-slate-400">{createdStr ? `Teklif: ${createdStr}` : ""}</div>
                                  </div>

                                  <div className="text-slate-100">
                                    <div className="md:hidden text-[0.7rem] text-slate-400">Teklif tipi</div>
                                    <div className="font-semibold">{MODE_LABEL_PUBLIC[o.mode]}</div>
                                    {o.mode === "negotiable" && <p className="text-[0.65rem] text-amber-300">1 defa karşı teklif hakkın var.</p>}
                                  </div>

                                  <div className="space-y-1">
                                    <div className="md:hidden text-[0.7rem] text-slate-400">Durum</div>
                                    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[0.7rem] ${
                                      isHotelCancelledStatus(o.status)
                                        ? "bg-slate-500/10 text-slate-300 border-slate-500/40"
                                        : o.status === "rejected"
                                        ? "bg-red-500/10 text-red-300 border-red-500/40"
                                        : o.status === "countered"
                                        ? "bg-amber-500/10 text-amber-300 border-amber-500/40"
                                        : "bg-slate-500/10 text-slate-300 border-slate-500/40"
                                    }`}>{offerStatusLabel(o)}</span>
                                    {o.guestCounterPrice ? <p className="text-[0.7rem] text-slate-400">Karşı teklifin: {money(o.guestCounterPrice, o.currency)}</p> : null}
                                  </div>

                                  <div className="flex justify-end gap-2 flex-wrap">
                                    {!disabled && (o.status === "sent" || o.status === "countered") && (
                                      <>
                                        {isSelected ? (
                                          <>
                                            <button onClick={() => handleOpenPaymentModal(o)} disabled={savingAction} className="btn btn-primary">Ödemeye ilerle</button>
                                            <button onClick={handleCancelSelection} disabled={savingAction} className="btn btn-outline">Vazgeç</button>
                                          </>
                                        ) : (
                                          <button onClick={() => handleSelectForPayment(o)} disabled={savingAction} className="btn btn-success">Kabul et</button>
                                        )}

                                        <button onClick={() => handleReject(o)} disabled={savingAction} className="btn btn-danger">Reddet</button>

                                        {canCounter(o) && o.status === "sent" && (
                                          <button onClick={() => startCounter(o)} disabled={savingAction || !!o.guestCounterPrice} className="btn btn-warning">Pazarlık</button>
                                        )}
                                      </>
                                    )}

                                    <button onClick={() => openDetails(o)} className="btn btn-sky">Detay</button>
                                  </div>
                                </div>

                                {counterEditId === o.id && canCounter(o) && (
                                  <div className="bg-slate-950 px-4 pb-4 text-[0.7rem]">
                                    <form onSubmit={(e) => handleCounterSubmit(e, o)} className="mt-1 space-y-2 rounded-xl border border-slate-800 bg-slate-950/90 p-3">
                                      <p className="text-slate-200 font-semibold mb-1">Pazarlık – karşı teklifini yaz</p>
                                      <div className="space-y-1">
                                        <label className="text-slate-400">Önerdiğin toplam fiyat ({o.currency})</label>
                                        <input type="number" min={0} step="0.01" value={counterPrice} onChange={(e) => setCounterPrice(e.target.value)} className="input" />
                                        <p className="text-[0.65rem] text-slate-500">Bu hakkı sadece 1 defa kullanabilirsin.</p>
                                      </div>
                                      <div className="flex justify-end gap-2 mt-1">
                                        <button type="button" onClick={cancelCounter} className="btn btn-outline">İptal</button>
                                        <button type="submit" disabled={savingAction} className="btn btn-warning">Karşı teklif gönder</button>
                                      </div>
                                    </form>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </section>
        )}

        {/* MODALS */}
        {detailsOpen && detailsOffer && (
          <OfferDetailModal
            offer={detailsOffer}
            hotel={hotelsMap[detailsOffer.hotelId]}
            req={requestsMap[detailsOffer.requestId]}
            onClose={closeDetails}
          />
        )}

        {paymentOpen && paymentOffer && (
          <PaymentModal
            offer={paymentOffer}
            hotel={hotelsMap[paymentOffer.hotelId]}
            onClose={handleClosePaymentModal}
            onConfirm={handlePaymentConfirm}
          />
        )}

        <RestartDatesModal
          open={restartModalOpen}
          req={restartModalReq}
          onClose={() => { setRestartModalOpen(false); setRestartModalReq(null); }}
          onSubmit={handleRestartModalSubmit}
        />

               {pkgModalOpen && pkgModalReq && (
          <PackageOffersModal
            req={pkgModalReq}
            offers={packageOffersByReq[pkgModalReq.id] ?? []}
            agenciesMap={agenciesMap}
            nowMs={now}
            onClose={closePackageModal}
            onRestart={() => restartPackageRequest(pkgModalReq)}
            onEdit={() => editPackageRequest(pkgModalReq)}
            onDelete={() => deletePackageRequest(pkgModalReq)}
            onAccept={(o) => openPkgPayment(pkgModalReq, o)}
          />
        )}

        {pkgPayOpen && pkgPayReq && pkgPayOffer && (
          <PackagePaymentModal
            req={pkgPayReq}
            offer={pkgPayOffer}
            agenciesMap={agenciesMap}
            method={pkgPayMethod}
            setMethod={setPkgPayMethod}
            saving={pkgPaySaving}
            error={pkgPayError}
            message={pkgPayMessage}
            threeDSOpen={pkgThreeDSOpen}
            setThreeDSOpen={setPkgThreeDSOpen}
            onClose={closePkgPayment}
            onConfirm={() => {
              if (pkgPayMethod === "card3d") {
                setPkgThreeDSOpen(true);
                return;
              }
              acceptPackageAndCreateBooking(pkgPayMethod);
            }}
            on3DConfirm={() => acceptPackageAndCreateBooking("card3d")}
          />
        )}

        {/* GLOBAL STYLES */}
        <style jsx global>{`
          .container-page {
            width: min(1200px, 96vw);
            margin: 0 auto;
            padding: 18px 0;
          }

          .input {
            width: 100%;
            border-radius: 0.75rem;
            background: rgba(15, 23, 42, 0.72);
            border: 1px solid rgba(51, 65, 85, 1);
            padding: 0.65rem 0.85rem;
            color: #e5e7eb;
            outline: none;
            font-size: 0.85rem;
          }
          .input:focus {
            border-color: rgba(52, 211, 153, 0.8);
          }

          .btn {
            border-radius: 0.75rem;
            padding: 0.6rem 0.9rem;
            font-size: 0.8rem;
            border: 1px solid rgba(148, 163, 184, 0.25);
            background: rgba(255, 255, 255, 0.04);
            color: #e5e7eb;
            transition: 0.15s ease;
          }
          .btn:hover {
            border-color: rgba(52, 211, 153, 0.6);
            transform: translateY(-1px);
          }
          .btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
          }

          .btn-outline {
            border-color: rgba(148, 163, 184, 0.25);
            background: rgba(255, 255, 255, 0.04);
          }
          .btn-primary {
            border-color: rgba(52, 211, 153, 0.35);
            background: rgba(16, 185, 129, 0.9);
            color: #020617;
            font-weight: 800;
          }
          .btn-success {
            border-color: rgba(52, 211, 153, 0.35);
            background: rgba(16, 185, 129, 0.12);
            color: #a7f3d0;
          }
          .btn-warning {
            border-color: rgba(251, 191, 36, 0.35);
            background: rgba(251, 191, 36, 0.12);
            color: #fde68a;
          }
          .btn-danger {
            border-color: rgba(239, 68, 68, 0.35);
            background: rgba(239, 68, 68, 0.12);
            color: #fecaca;
          }
          .btn-sky {
            border-color: rgba(56, 189, 248, 0.35);
            background: rgba(56, 189, 248, 0.12);
            color: #bae6fd;
          }

          .badge {
            display: inline-flex;
            align-items: center;
            border-radius: 9999px;
            border: 1px solid rgba(255, 255, 255, 0.12);
            background: rgba(255, 255, 255, 0.05);
            padding: 0.15rem 0.55rem;
            font-size: 0.7rem;
            color: #e5e7eb;
            gap: 0.35rem;
          }
          .badge-slate {
            border-color: rgba(148, 163, 184, 0.25);
            background: rgba(2, 6, 23, 0.4);
            color: #e2e8f0;
          }
          .badge-emerald {
            border-color: rgba(52, 211, 153, 0.35);
            background: rgba(16, 185, 129, 0.12);
            color: #a7f3d0;
          }
          .badge-amber {
            border-color: rgba(251, 191, 36, 0.35);
            background: rgba(251, 191, 36, 0.12);
            color: #fde68a;
          }
          .badge-sky {
            border-color: rgba(56, 189, 248, 0.35);
            background: rgba(56, 189, 248, 0.12);
            color: #bae6fd;
          }
          .badge-red {
            border-color: rgba(239, 68, 68, 0.35);
            background: rgba(239, 68, 68, 0.12);
            color: #fecaca;
          }
        `}</style>
      </div>
    </Protected>
  );
}

/* -------------------- PACKAGE OFFERS MODAL -------------------- */
function PackageOffersModal({
  req,
  offers,
  agenciesMap,
  nowMs,
  onClose,
  onRestart,
  onEdit,
  onDelete,
  onAccept
}: {
  req: any;
  offers: PackageOffer[];
  agenciesMap: Record<string, AgencyInfo>;
  nowMs: number;
  onClose: () => void;
  onRestart: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAccept: (offer: PackageOffer) => void;
}) {
  const deadlineMin = safeNum(req?.responseDeadlineMinutes, 180);
  const rem = formatRemainingPkg(req?.createdAt, deadlineMin, nowMs);

  const st: PackageRequestStatus =
    (req?.status as any) === "accepted"
      ? "accepted"
      : (req?.status as any) === "deleted"
      ? "deleted"
      : rem.expired
      ? "expired"
      : "open";

  const raw: any = req?.raw && typeof req.raw === "object" ? req.raw : req;

  const barColor =
    rem.color === "red" ? "bg-red-500" : rem.color === "yellow" ? "bg-amber-400" : "bg-emerald-500";
const modalScrollRef = React.useRef<HTMLDivElement | null>(null);

useEffect(() => {
  modalScrollRef.current?.scrollTo(0, 0);
}, []);

  // ✅ Talep alanları (DB'de gördüğün farklı isimleri tolere eder)
  const title = safeStr(pickFirst(raw, ["title", "requestTitle"], "Paket talebi"));
  const city = safeStr(pickFirst(raw, ["city"], "—"));
  const district = pickFirst(raw, ["district"], null);

  const dateFrom = pickFirst(raw, ["dateFrom", "checkIn"], null);
  const dateTo = pickFirst(raw, ["dateTo", "checkOut"], null);
  const nights = safeNum(pickFirst(raw, ["nights"], calcNightsFromISO(dateFrom, dateTo)), calcNightsFromISO(dateFrom, dateTo));

  const adults = safeNum(pickFirst(raw, ["paxAdults", "adults"], 0), 0);
  const children = safeNum(pickFirst(raw, ["paxChildren", "childrenCount"], 0), 0);
  const pax = adults + children;

const childrenAges = asArray(pickFirst(raw, ["childrenAges"], []) ?? []);
  const roomsCount = safeNum(pickFirst(raw, ["roomsCount"], 0), 0);

  const contactName = pickFirst(raw, ["contactName", "guestName", "contact?.name"], null);
  const guestEmail = pickFirst(raw, ["guestEmail", "contactEmail", "contact?.email"], null);
  const guestPhone = pickFirst(raw, ["guestPhone", "contactPhone", "contactPhoneLocal", "contact?.phone"], null);

  // erken / geç
  const earlyWanted = safeBool(pickFirst(raw, ["earlyCheckInWanted", "earlyCheckInWant"], false));
  const earlyFrom = pickFirst(raw, ["earlyCheckInFrom", "earlyCheckInTime", "earlyCheckInTo"], null);
  const lateWanted = safeBool(pickFirst(raw, ["lateCheckOutWanted", "lateCheckOutWant"], false));
  const lateFrom = pickFirst(raw, ["lateCheckOutFrom"], null);
  const lateTo = pickFirst(raw, ["lateCheckOutTo"], null);

  // oda istekleri (roomTypes / roomTypeCounts / roomTypeRows)
  const roomTypes = asArray(pickFirst(raw, ["roomTypes"], []));
  const roomTypeCounts = pickFirst(raw, ["roomTypeCounts"], null);
  const roomTypeRows = asArray(pickFirst(raw, ["roomTypeRows"], []));

  const boardType = pickFirst(raw, ["boardType", "mealPlan"], null);
  const boardTypes = asArray(pickFirst(raw, ["boardTypes"], []));
  const accommodationType = pickFirst(raw, ["accommodationType", "hotelType"], null);

  const responseTimeUnit = pickFirst(raw, ["responseTimeUnit"], null);
  const responseTimeAmount = pickFirst(raw, ["responseTimeAmount"], null);

  const note = pickFirst(raw, ["note", "notes", "generalNote", "contactNote"], null);
  const locationNote = pickFirst(raw, ["locationNote"], null);

  // otel özellik istekleri & öncelikler
  const featurePrefs = asArray(pickFirst(raw, ["hotelFeaturePrefs", "featureKeys"], []));
  const featurePriorities = pickFirst(raw, ["featurePriorities"], null);
  const featurePriorityChips = objectToChips(featurePriorities);

  // KVKK uyumlu: ekranda gösterim var ama bu zaten misafir kendi verisi, sorun yok.

  const prettyJson = useMemo(() => {
    try {
      return JSON.stringify(
        raw,
        (_k, v) => {
          if (v && typeof v === "object" && typeof (v as any).toDate === "function") return (v as any).toDate().toISOString();
          return v;
        },
        2
      );
    } catch {
      return String(raw);
    }
  }, [raw]);

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/70">
      <div className="absolute inset-0" onClick={onClose} />
<div ref={modalScrollRef} className="relative mt-10 w-full max-w-5xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-2xl max-h-[85vh] overflow-y-auto space-y-4">
        {/* HEADER */}
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-[0.7rem] text-indigo-200">
                🧳 Paket Detayı & Teklifler
              </span>

              <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[0.7rem] ${badgeByPkgStatus(st)}`}>
                {st === "open" ? "Açık" : st === "expired" ? "Süre doldu" : st === "accepted" ? "Kabul edildi" : "Silindi"}
              </span>

              <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[0.7rem] text-slate-200">
                Teklif: <b className="ml-1 text-white">{offers.length}</b>
              </span>
            </div>

            <h2 className="text-base font-semibold text-slate-100">{title}</h2>
            <p className="text-[0.8rem] text-slate-300">
              {city}{district ? ` / ${district}` : ""} • {safeStr(dateFrom)} – {safeStr(dateTo)} • {nights} gece • {pax} kişi
            </p>

            <div className="mt-2 w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
              <div className={`h-full ${barColor}`} style={{ width: `${Math.round(rem.ratio * 100)}%` }} />
            </div>

            <p className={`text-[0.75rem] font-semibold ${rem.color === "red" ? "text-red-300" : rem.color === "yellow" ? "text-amber-200" : "text-emerald-200"}`}>
              {rem.text}
            </p>
          </div>

          <div className="flex flex-wrap gap-2 justify-end">
            {st === "expired" ? (
              <>
                <button type="button" onClick={onRestart} className="btn btn-warning">Yeniden başlat</button>
                <button type="button" onClick={onEdit} className="btn btn-sky">Düzenle</button>
                <button type="button" onClick={onDelete} className="btn btn-danger">Sil</button>
              </>
            ) : null}

            <button onClick={onClose} className="btn btn-outline">Kapat ✕</button>
          </div>
        </div>

        {/* ✅ TALEP ÖZETİ (yukarıda görünsün) */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
          <p className="text-sm font-semibold text-slate-100">Talep Özeti</p>

          <div className="grid gap-2 md:grid-cols-4">
            <Mini label="Tarih" value={`${safeStr(dateFrom)} → ${safeStr(dateTo)} (${nights} gece)`} />
            <Mini label="Kişi" value={`${adults} yetişkin • ${children} çocuk`} />
            <Mini label="Çocuk yaşları" value={childrenAges.length ? childrenAges.join(", ") : "—"} />
            <Mini label="Oda" value={roomsCount ? String(roomsCount) : (roomTypes.length ? String(roomTypes.length) : "—")} />
          </div>

          <div className="grid gap-2 md:grid-cols-3">
            <Mini label="İletişim" value={`${safeStr(contactName)} • ${safeStr(guestEmail)} • ${normalizePhone(guestPhone)}`} />
            <Mini label="Konaklama tipi" value={safeStr(accommodationType)} />
            <Mini label="Board" value={boardType ? safeStr(boardType) : joinSmart(boardTypes)} />
          </div>

          <div className="grid gap-2 md:grid-cols-3">
            <Mini label="Erken giriş" value={earlyWanted ? `İsteniyor • ${safeStr(earlyFrom)}` : "İstenmiyor"} />
            <Mini label="Geç çıkış" value={lateWanted ? `İsteniyor • ${safeStr(lateFrom)} - ${safeStr(lateTo)}` : "İstenmiyor"} />
            <Mini label="Yanıt süresi" value={`${safeStr(responseTimeAmount, "—")} ${safeStr(responseTimeUnit, "")}`.trim() || "—"} />
          </div>

          {(note || locationNote) && (
            <div className="grid gap-2 md:grid-cols-2">
              <Mini label="Not / İstek" value={safeStr(note)} />
              <Mini label="Konum Notu" value={safeStr(locationNote)} />
            </div>
          )}
        </div>

        {/* ✅ OTEL ÖZELLİKLERİ (İSTEKLER + ÖNCELİKLER) */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-100">Otel Özellikleri</p>
            <span className="text-[0.72rem] text-slate-400">Misafir isteği / öncelik listesi</span>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
            <p className="text-[0.75rem] text-slate-400 mb-2">İstenen özellikler</p>
            {featurePrefs.length ? (
              <div className="flex flex-wrap gap-2">
                {featurePrefs.slice(0, 40).map((f: any, i: number) => (
                  <span key={i} className="inline-flex items-center rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[0.72rem] text-slate-200">
                    {String(f)}
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-slate-400 text-sm">Belirtilmemiş</div>
            )}
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
            <p className="text-[0.75rem] text-slate-400 mb-2">Öncelikler (featurePriorities)</p>
            {featurePriorityChips.length ? (
              <div className="flex flex-wrap gap-2">
                {featurePriorityChips.map((t, i) => (
                  <span key={i} className="inline-flex items-center rounded-md border border-sky-500/25 bg-sky-500/10 px-2 py-1 text-[0.72rem] text-sky-200">
                    {t}
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-slate-400 text-sm">Öncelik girilmemiş</div>
            )}
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            <Mini label="Oda tipleri (roomTypes)" value={roomTypes.length ? roomTypes.join(" • ") : "—"} />
            <Mini
              label="Oda sayıları (roomTypeCounts / roomTypeRows)"
              value={
                roomTypeCounts
                  ? JSON.stringify(roomTypeCounts)
                  : roomTypeRows.length
                  ? roomTypeRows.map((r: any) => `${r.typeKey || r.roomType || r.name}: ${r.count ?? 1}`).join(" • ")
                  : "—"
              }
            />
          </div>
        </div>

      

          <details className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
            <summary className="cursor-pointer text-[0.8rem] text-slate-200 font-semibold">DB’deki tüm alanları aç (JSON)</summary>
            <pre className="mt-3 whitespace-pre-wrap text-[0.72rem] text-slate-300 overflow-x-auto">{prettyJson}</pre>
          </details>
        </div>

        {/* Offers */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-2">
          <p className="text-sm font-semibold text-slate-100">Gelen Paket Teklifleri</p>

          {offers.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-slate-300">Henüz paket teklifi yok.</div>
          ) : (
            <div className="grid gap-3">
              {offers.map((o) => {
                const agency = agenciesMap[o.agencyId];
                const ap = agency?.agencyProfile ?? null;
                const b = o.breakdown ?? {};
                const d = o.packageDetails ?? {};
                const updatedStr = o.updatedAt?.toDate ? o.updatedAt.toDate().toLocaleString("tr-TR") : "";
                const createdStr = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString("tr-TR") : "";

                const disabled = st === "expired" || st === "accepted" || o.status === "accepted";

                // ✅ Teklifin “otel özellikleri” varsa göster (yoksa “eklenmemiş”)
             const offeredHotelFeatures = asArray(
  (d as any)?.hotelFeatures ??
  (d as any)?.features ??
  (o as any)?.hotelFeatures ??
  (o as any)?.features ??
  []
);

                return (
                  <div key={o.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-slate-100 font-semibold text-sm">{o.agencyName || agency?.displayName || "Acenta"}</p>
                          <span className="text-[0.7rem] text-slate-500">{o.id}</span>
                          <span className="inline-flex items-center rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[0.65rem] text-sky-200">
                            {o.status || "sent"}
                          </span>
                          <span className="text-[0.7rem] text-slate-400">{updatedStr ? `Güncelleme: ${updatedStr}` : createdStr ? `Teklif: ${createdStr}` : ""}</span>
                        </div>

                        <div className="rounded-xl border border-white/10 bg-black/10 p-3">
                          <p className="text-[0.72rem] text-slate-400 mb-1">Acenta bilgileri</p>
                          <p className="text-[0.8rem] text-slate-200">
                            İşletme: <b>{safeStr(ap?.businessName || agency?.displayName || o.agencyName)}</b>
                          </p>
                          <div className="text-[0.75rem] text-slate-300">Tel: {safeStr(ap?.phone)} {ap?.taxNo ? ` • Vergi No: ${ap.taxNo}` : ""}</div>
                          {ap?.address ? <div className="text-[0.75rem] text-slate-400 mt-1">Adres: {ap.address}</div> : null}
                          {ap?.about ? <div className="text-[0.75rem] text-slate-400 mt-1">Açıklama: {ap.about}</div> : null}
                        </div>

                        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-2">
                          <div>
                            <p className="text-[0.75rem] text-slate-400 mb-1">Teklif planı</p>
                            <p className="text-[0.8rem] text-slate-200">
                              Otel: <b>{safeStr(d.hotelName)}</b> • Oda: <b>{safeStr(d.roomType)}</b> • Board: <b>{safeStr(d.boardType)}</b>
                            </p>
                            <p className="text-[0.75rem] text-slate-300">Transfer: <b>{safeStr(d.transferType || d.transferPlan)}</b></p>
                            {Array.isArray(d.tourPlan) && d.tourPlan.length > 0 ? (
                              <p className="text-[0.75rem] text-slate-300">Tur planı: <span className="text-slate-200">{d.tourPlan.join(" • ")}</span></p>
                            ) : null}
                            {o.note ? <p className="text-[0.75rem] text-slate-300">Not: <span className="text-slate-200">{o.note}</span></p> : null}
                          </div>

                          {/* ✅ Otelin sunduğu özellikler */}
                          <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                            <p className="text-[0.72rem] text-slate-400 mb-2">Otel özellikleri (teklif)</p>
                            {offeredHotelFeatures.length ? (
                              <div className="flex flex-wrap gap-2">
                                {offeredHotelFeatures.slice(0, 32).map((f: any, i: number) => (
                                  <span key={i} className="inline-flex items-center rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[0.72rem] text-emerald-200">
                                    {String(f)}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <div className="text-slate-400 text-sm">Acenta bu teklif için otel özelliklerini eklememiş.</div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3 min-w-[280px]">
                        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-right">
                          <p className="text-[0.7rem] text-slate-400">Toplam</p>
                          <p className="text-lg font-extrabold text-emerald-200">{money(o.totalPrice, o.currency)}</p>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <Mini label="Otel" value={money(b.hotel ?? 0, o.currency)} />
                          <Mini label="Transfer" value={money(b.transfer ?? 0, o.currency)} />
                          <Mini label="Turlar" value={money(b.tours ?? 0, o.currency)} />
                          <Mini label="Diğer" value={money(b.other ?? 0, o.currency)} />
                        </div>

                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => onAccept(o)}
                          className="w-full btn btn-primary"
                        >
                          {disabled ? "Kabul edildi / Kapalı" : "Teklifi kabul et → Ödeme"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {/* DB JSON (en alta taşındı) */}
<div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
  <div className="flex items-center justify-between gap-2">
    <p className="text-sm font-semibold text-slate-100">Talep Detayı (DB)</p>

    <button
      type="button"
      onClick={() => {
        try {
          navigator.clipboard.writeText(prettyJson);
          alert("Kopyalandı.");
        } catch {}
      }}
      className="btn btn-outline"
    >
      Kopyala
    </button>
  </div>

<details className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
    <summary className="cursor-pointer text-[0.8rem] text-slate-200 font-semibold">
      DB’deki tüm alanları aç (JSON)
    </summary>

    <pre className="mt-3 whitespace-pre-wrap text-[0.72rem] text-slate-300 overflow-x-auto max-h-[320px] overflow-y-auto">
      {prettyJson}
    </pre>
  </details>
</div>

      
    </div>
  );
}


/* -------------------- PACKAGE PAYMENT MODAL -------------------- */
function PackagePaymentModal({
  req,
  offer,
  agenciesMap,
  method,
  setMethod,
  saving,
  error,
  message,
  threeDSOpen,
  setThreeDSOpen,
  onClose,
  onConfirm,
  on3DConfirm
}: {
  req: PackageRequest;
  offer: PackageOffer;
  agenciesMap: Record<string, AgencyInfo>;
  method: PackagePaymentMethod;
  setMethod: (m: PackagePaymentMethod) => void;
  saving: boolean;
  error: string | null;
  message: string | null;
  threeDSOpen: boolean;
  setThreeDSOpen: (b: boolean) => void;
  onClose: () => void;
  onConfirm: () => void;
  on3DConfirm: () => void;
}) {
  const agency = agenciesMap[offer.agencyId];
  const ap = agency?.agencyProfile ?? null;

  const nights = req.nights ?? calcNightsFromISO(req.dateFrom, req.dateTo);
  const pax = safeNum(req.paxAdults, 0) + safeNum(req.paxChildren, 0);

  const po = offer.paymentOptions || {};
  const allowCard3d = po.card3d !== false;
  const allowTransfer = po.transfer !== false;
  const allowDoor = po.payAtDoor !== false;

  return (
    <>
      <div className="fixed inset-0 z-[95] flex items-start justify-center bg-black/70">
        <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
        <div className="relative mt-16 w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-2xl space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-slate-100">Ödeme • Paket kabul</h3>
              <p className="text-[0.78rem] text-slate-300">
                {req.title || "Paket"} • {safeStr(req.city)}{req.district ? ` / ${req.district}` : ""} • {nights} gece • {pax} kişi
              </p>
            </div>
            <button onClick={onClose} className="btn btn-outline">Kapat ✕</button>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-[0.75rem] text-slate-400">Seçilen teklif</p>
            <div className="mt-1 flex items-end justify-between gap-3">
              <div>
                <p className="text-slate-100 font-semibold">{offer.agencyName || agency?.displayName || "Acenta"}</p>
                <p className="text-[0.75rem] text-slate-400">
                  İşletme: <b className="text-slate-200">{safeStr(ap?.businessName || agency?.displayName || offer.agencyName)}</b>
                </p>
              </div>
              <div className="text-right">
                <p className="text-[0.7rem] text-slate-400">Toplam</p>
                <p className="text-lg font-extrabold text-emerald-200">{money(offer.totalPrice, offer.currency)}</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
            <p className="text-[0.75rem] text-slate-300">Ödeme yöntemi seç.</p>

            {allowTransfer && (
              <label className="flex items-start gap-2">
                <input type="radio" checked={method === "transfer"} onChange={() => setMethod("transfer")} className="mt-1 h-4 w-4" />
                <div>
                  <p className="text-slate-100 font-semibold text-sm">🏦 Havale / EFT</p>
                  <p className="text-[0.72rem] text-slate-400">transfer_pending</p>
                </div>
              </label>
            )}

            {allowCard3d && (
              <label className="flex items-start gap-2">
                <input type="radio" checked={method === "card3d"} onChange={() => setMethod("card3d")} className="mt-1 h-4 w-4" />
                <div>
                  <p className="text-slate-100 font-semibold text-sm">💳 3D Secure</p>
                  <p className="text-[0.72rem] text-slate-400">paid (simülasyon)</p>
                </div>
              </label>
            )}

            {allowDoor && (
              <label className="flex items-start gap-2">
                <input type="radio" checked={method === "payAtDoor"} onChange={() => setMethod("payAtDoor")} className="mt-1 h-4 w-4" />
                <div>
                  <p className="text-slate-100 font-semibold text-sm">🚪 Kapıda ödeme</p>
                  <p className="text-[0.72rem] text-slate-400">pay_at_door</p>
                </div>
              </label>
            )}
          </div>

          {error ? <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[0.8rem] text-red-200">{error}</div> : null}
          {message ? <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[0.8rem] text-emerald-200">{message}</div> : null}

          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="btn btn-outline">Vazgeç</button>
            <button disabled={saving} onClick={onConfirm} className="btn btn-primary">{saving ? "İşleniyor..." : "Ödemeye ilerle"}</button>
          </div>
        </div>
      </div>

      {threeDSOpen && (
        <div className="fixed inset-0 z-[99] flex items-center justify-center bg-black/70">
          <div className="bg-slate-950/95 rounded-2xl border border-slate-800 p-5 w-full max-w-md text-xs space-y-3 shadow-xl">
            <h2 className="text-sm font-semibold text-slate-100 mb-1">3D Secure doğrulama</h2>
            <p className="text-[0.75rem] text-slate-300">Simülasyon. Onayladığında paket rezervasyonu oluşturulur.</p>
            <p className="text-[0.75rem] text-slate-200">{money(offer.totalPrice, offer.currency)} ödemeyi onaylıyor musun?</p>
            <div className="flex justify-end gap-2 mt-2">
              <button onClick={() => setThreeDSOpen(false)} className="btn btn-outline">İptal</button>
              <button onClick={on3DConfirm} className="btn btn-primary">Ödemeyi onayla</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
