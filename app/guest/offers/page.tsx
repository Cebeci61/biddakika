"use client";

import { useRouter } from "next/navigation";
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
  doc,
  updateDoc,
  serverTimestamp,
  getDoc,
  addDoc,
  arrayUnion
} from "firebase/firestore";

/* ------------------------------------------------
  PRICE HISTORY (HOTEL OFFERS)
------------------------------------------------- */
type PriceHistoryItem = {
  actor: "hotel" | "guest";
  kind: "initial" | "counter" | "update";
  price: number;
  note?: string | null;
  createdAt: any; // serverTimestamp
};

async function pushOfferPriceHistory(
  db: any,
  offerId: string,
  item: Omit<PriceHistoryItem, "createdAt">
) {
  const ref = doc(db, "offers", offerId);
  await updateDoc(ref, {
    priceHistory: arrayUnion({
      ...item,
      createdAt: serverTimestamp()
    })
  });
}

/* ------------------------------------------------
  HOTEL OFFER TYPES
------------------------------------------------- */
type OfferMode = "simple" | "refreshable" | "negotiable";
type PaymentMethod = "card3d" | "payAtHotel";
type CancellationPolicyType = "non_refundable" | "flexible" | "until_days_before";

interface GuestOffer {
  id: string;
  requestId: string;
  hotelId: string;
  hotelName?: string | null;
  totalPrice: number;
  currency: string;
  mode: OfferMode;
  note?: string | null;
  status: string; // sent | accepted | rejected | countered
  guestCounterPrice?: number | null;
  createdAt?: Timestamp;

  roomTypeId?: string | null;
  roomTypeName?: string | null;
  roomBreakdown?: {
    roomTypeId?: string;
    roomTypeName?: string;
    nights?: number;
    nightlyPrice?: number;
    totalPrice?: number;
  }[];

  cancellationPolicyType?: CancellationPolicyType;
  cancellationPolicyDays?: number | null;

  priceHistory?: PriceHistoryItem[];
}

interface RequestSummary {
  id: string;
  city: string;
  district?: string | null;
  checkIn: string;
  checkOut: string;
  adults: number;
  childrenCount?: number;
  roomsCount?: number;
  roomTypes?: string[];
  responseDeadlineMinutes?: number;
  createdAt?: Timestamp;
  status?: string | null;
  childrenAges?: number[];

  type?: string;
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
  hotelProfile?: HotelProfile;
  website?: string;
}

/* ------------------------------------------------
  PACKAGE TYPES
------------------------------------------------- */
type PackageRequestStatus = "open" | "expired" | "accepted" | "deleted";
type PackagePaymentMethod = "card3d" | "transfer" | "payAtDoor";

type PackageRequest = {
  id: string;

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
  activities?: string[] | null;

  note?: string | null;

  responseDeadlineMinutes?: number | null;
  responseTimeAmount?: number | null;
  responseTimeUnit?: "minutes" | "hours" | "days" | null;

  createdByRole?: string | null;
  createdById?: string | null;

  acceptedOfferId?: string | null;
  bookingId?: string | null;

  status?: string | null;
  createdAt?: Timestamp;

    // ✅ TALEPLERİMDEN KALDIR
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

  breakdown?: {
    hotel?: number;
    transfer?: number;
    tours?: number;
    other?: number;
  };

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

/* ------------------------------------------------
  CONSTANTS
------------------------------------------------- */
const MODE_LABEL_PUBLIC: Record<OfferMode, string> = {
  simple: "Standart teklif",
  refreshable: "Yenilenebilir teklif",
  negotiable: "Pazarlıklı teklif"
};

/* ------------------------------------------------
  HELPERS
------------------------------------------------- */
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
function calcNightsFromISO(a?: string | null, b?: string | null) {
  const d1 = parseDate(a);
  const d2 = parseDate(b);
  if (!d1 || !d2) return 1;
  const diff = diffInDays(d2, d1);
  return diff > 0 ? diff : 1;
}

function chunkArray<T>(arr: T[], size = 10) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function computeRequestStatus(req: RequestSummary, hasAcceptedOffer: boolean) {
  if (hasAcceptedOffer) return "accepted" as const;
  const created = req.createdAt?.toDate?.().getTime();
  const minutes = req.responseDeadlineMinutes ?? 0;
  if (!created || !minutes) return "open" as const;
  const deadlineMs = created + minutes * 60 * 1000;
  return Date.now() > deadlineMs ? ("expired" as const) : ("open" as const);
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

function formatRemainingPkg(createdAt: Timestamp | undefined, minutes: number, nowMs: number) {
  const createdMs = createdAt?.toDate?.().getTime?.() ?? null;
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

function getHistoryMeta(offer: GuestOffer) {
  const hist = Array.isArray(offer.priceHistory) ? offer.priceHistory : [];
  const sorted = hist
    .slice()
    .sort((a: any, b: any) => (a?.createdAt?.toMillis?.() ?? 0) - (b?.createdAt?.toMillis?.() ?? 0));
  const first = sorted[0]?.price ? Number(sorted[0].price) : null;
  const hotelUpdate = [...sorted].reverse().find((x: any) => x.actor === "hotel" && x.kind === "update");
  const hasHotelUpdate = !!hotelUpdate;
  return { firstPrice: first, hasHotelUpdate };
}

function guessBestPackageOffer(offers: PackageOffer[]) {
  if (!offers.length) return null;
  const sorted = offers
    .filter((o) => o.status !== "rejected" && o.status !== "withdrawn")
    .slice()
    .sort((a, b) => Number(a.totalPrice) - Number(b.totalPrice));
  return sorted[0] ?? offers[0];
}

function cancellationLabelFromOffer(
  offer: Pick<GuestOffer, "cancellationPolicyType" | "cancellationPolicyDays">,
  hp?: HotelProfile
): string | null {
  const type: CancellationPolicyType | undefined = offer.cancellationPolicyType ?? hp?.cancellationPolicyType;
  const days = offer.cancellationPolicyDays ?? hp?.cancellationPolicyDays;
  if (!type && hp?.cancellationPolicyLabel) return hp.cancellationPolicyLabel;
  if (!type) return null;

  if (type === "non_refundable") return "Bu rezervasyon iptal edilemez, ücret iadesi yapılmaz.";
  if (type === "flexible") return "Giriş tarihine kadar ücretsiz iptal hakkın vardır.";
  if (type === "until_days_before") {
    const d = days ?? 3;
    return `Giriş tarihinden ${d} gün öncesine kadar ücretsiz iptal hakkın vardır. Sonrasında iptal edilemez.`;
  }
  return null;
}

async function createNotification(db: ReturnType<typeof getFirestoreDb>, to: string | null | undefined, payload: any) {
  if (!to) return;
  try {
    await addDoc(collection(db, "notifications"), { to, ...payload, createdAt: serverTimestamp(), read: false });
  } catch (e) {
    console.error("createNotification error:", e);
  }
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

  // filters
  const [statusFilter, setStatusFilter] = useState<"all" | "sent" | "rejected">("all");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  const [qText, setQText] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "hotel" | "group" | "package">("all");
  const [cityFilter, setCityFilter] = useState<string>("all");

  const [boostNegotiable, setBoostNegotiable] = useState(true);
  const [boostRefreshable, setBoostRefreshable] = useState(true);

  // detail/payment for hotel offers
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsOffer, setDetailsOffer] = useState<GuestOffer | null>(null);

  const [counterEditId, setCounterEditId] = useState<string | null>(null);
  const [counterPrice, setCounterPrice] = useState<string>("");

  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savingAction, setSavingAction] = useState(false);

  const [selectedForPaymentId, setSelectedForPaymentId] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentOffer, setPaymentOffer] = useState<GuestOffer | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [savingPayment, setSavingPayment] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [threeDSOpen, setThreeDSOpen] = useState(false);

  const [cardName, setCardName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvc, setCardCvc] = useState("");

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

  // countdown tick
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  /* ---------------------------
    HOTEL OFFER ACTIONS
  --------------------------- */
  function openDetails(o: GuestOffer) {
    setDetailsOffer(o);
    setDetailsOpen(true);
  }
  function closeDetails() {
    setDetailsOpen(false);
    setDetailsOffer(null);
  }

  function canCounter(o: GuestOffer): boolean {
    if (o.mode !== "negotiable") return false;
    if (o.status !== "sent" && o.status !== "countered") return false;
    if (o.guestCounterPrice && o.guestCounterPrice > 0) return false;
    return true;
  }

  function startCounter(o: GuestOffer) {
    if (!canCounter(o)) return;
    setCounterEditId(o.id);
    setCounterPrice(String(o.totalPrice));
    setActionError(null);
    setActionMessage(null);
  }

  function cancelCounter() {
    setCounterEditId(null);
    setCounterPrice("");
  }
  async function hideAcceptedPackageFromGuest(p: any) {
  const ok = window.confirm(
    "Bu paket rezervasyonlara taşındı.\nTaleplerim sayfasından kaldırmak istiyor musun?"
  );
  if (!ok) return;

  try {
    await updateDoc(doc(db, "packageRequests", p.id), {
      hiddenFromGuest: true,
      hiddenAt: serverTimestamp()
    });

    // UI'dan kaldır
    setPackageRequests((prev: any[]) =>
      prev.filter((x) => x.id !== p.id)
    );
  } catch (e) {
    console.error(e);
    alert("Paket taleplerden kaldırılırken hata oluştu.");
  }
}


  async function handleCounterSubmit(e: FormEvent<HTMLFormElement>, offer: GuestOffer) {
    e.preventDefault();
    if (!canCounter(offer)) return;

    const value = Number(counterPrice);
    if (!Number.isFinite(value) || value <= 0) {
      setActionError("Lütfen geçerli bir karşı teklif girin.");
      return;
    }

    try {
      setSavingAction(true);
      await updateDoc(doc(db, "offers", offer.id), {
        guestCounterPrice: value,
        status: "countered",
        guestCounterAt: serverTimestamp()
      });

      await pushOfferPriceHistory(db, offer.id, {
        actor: "guest",
        kind: "counter",
        price: value,
        note: null
      });

      setOffers((prev) => prev.map((o) => (o.id === offer.id ? { ...o, guestCounterPrice: value, status: "countered" } : o)));
      setActionMessage("Karşı teklifin otelle paylaşıldı.");
      await createNotification(db, offer.hotelId, { type: "guestCounter", offerId: offer.id, requestId: offer.requestId, amount: value });

      cancelCounter();
    } catch (err) {
      console.error(err);
      setActionError("Karşı teklif gönderilirken hata oluştu.");
    } finally {
      setSavingAction(false);
    }
  }

  function handleSelectForPayment(offer: GuestOffer) {
    setSelectedForPaymentId(offer.id);
    setActionMessage("Bu teklifi seçtin. Ödemeye ilerleyerek rezervasyon oluşturabilirsin.");
    setActionError(null);
  }
  function handleCancelSelection() {
    setSelectedForPaymentId(null);
  }

  function handleOpenPaymentModal(offer: GuestOffer) {
    const hotel = hotelsMap[offer.hotelId];
    const po = hotel?.hotelProfile?.paymentOptions;

    const availableMethods: PaymentMethod[] = po
      ? ([po.card3d && "card3d", po.payAtHotel && "payAtHotel"].filter(Boolean) as PaymentMethod[])
      : (["card3d", "payAtHotel"] as PaymentMethod[]);

    const finalMethods = availableMethods.length ? availableMethods : (["card3d", "payAtHotel"] as PaymentMethod[]);

    setPaymentOffer(offer);
    setPaymentMethod(finalMethods[0] ?? null);
    setPaymentError(null);
    setPaymentMessage(null);
    setPaymentOpen(true);
  }

  function handleClosePaymentModal() {
    setPaymentOpen(false);
    setPaymentOffer(null);
    setPaymentMethod(null);
    setThreeDSOpen(false);
  }

  async function createBooking(finalPaymentMethod: PaymentMethod) {
    if (!paymentOffer || !profile) {
      setPaymentError("Giriş bilgisi veya teklif bulunamadı.");
      return;
    }

    const offer = paymentOffer;
    const req = requestsMap[offer.requestId];
    const hotel = hotelsMap[offer.hotelId];

    try {
      setSavingPayment(true);

      const bookingRef = await addDoc(collection(db, "bookings"), {
        type: "hotel",

        offerId: offer.id,
        requestId: req?.id ?? offer.requestId,

        guestId: profile.uid,
        guestName: profile.displayName || (req as any)?.guestName || (req as any)?.contactName || null,
        guestEmail: profile.email || (req as any)?.guestEmail || null,
        guestPhone: (req as any)?.guestPhone || null,

        hotelId: hotel?.id ?? offer.hotelId,
        hotelName: hotel?.displayName || offer.hotelName || null,

        city: req?.city ?? null,
        district: req?.district ?? null,
        checkIn: req?.checkIn ?? null,
        checkOut: req?.checkOut ?? null,
        adults: req?.adults ?? null,
        childrenCount: req?.childrenCount ?? null,
        childrenAges: (req as any)?.childrenAges ?? null,
        roomsCount: req?.roomsCount ?? null,

        totalPrice: offer.totalPrice,
        currency: offer.currency,

        paymentMethod: finalPaymentMethod,
        paymentStatus: finalPaymentMethod === "card3d" ? "paid" : "pending",

        createdAt: serverTimestamp(),
        status: "active",

        roomBreakdown: offer.roomBreakdown ?? null,
        cancellationPolicyType: offer.cancellationPolicyType ?? null,
        cancellationPolicyDays: offer.cancellationPolicyDays ?? null
      });

      await updateDoc(doc(db, "offers", offer.id), {
        status: "accepted",
        acceptedAt: serverTimestamp(),
        bookingId: bookingRef.id
      });

      await createNotification(db, profile.uid, { type: "bookingCreated", bookingId: bookingRef.id, offerId: offer.id });
      await createNotification(db, hotel?.id, { type: "bookingCreated", bookingId: bookingRef.id, offerId: offer.id });

      setPaymentMessage("Rezervasyonun oluşturuldu. Rezervasyonlarım sayfasına yönlendiriyorum…");
      setSelectedForPaymentId(null);

      setTimeout(() => {
        handleClosePaymentModal();
        router.push("/guest/bookings");
      }, 1100);
    } catch (err) {
      console.error(err);
      setPaymentError("Rezervasyon oluşturulurken hata oluştu.");
    } finally {
      setSavingPayment(false);
      setThreeDSOpen(false);
    }
  }

  async function handlePaymentConfirm() {
    setPaymentError(null);
    setPaymentMessage(null);

    if (!paymentOffer || !paymentMethod) {
      setPaymentError("Lütfen bir ödeme yöntemi seçin.");
      return;
    }

    if (paymentMethod === "card3d") {
      if (!cardName || !cardNumber || !cardExpiry || !cardCvc) {
        setPaymentError("3D Secure için kart bilgilerini doldurun.");
        return;
      }
      setThreeDSOpen(true);
      return;
    }

    await createBooking("payAtHotel");
  }

  async function handleReject(offer: GuestOffer) {
    const ok = window.confirm("Bu teklifi reddetmek istediğine emin misin?");
    if (!ok) return;

    try {
      setSavingAction(true);
      await updateDoc(doc(db, "offers", offer.id), { status: "rejected", rejectedAt: serverTimestamp() });
      setOffers((prev) => prev.map((o) => (o.id === offer.id ? { ...o, status: "rejected" } : o)));
      setActionMessage("Bu teklifi reddettin.");
      await createNotification(db, offer.hotelId, { type: "offerRejected", offerId: offer.id, requestId: offer.requestId });
    } catch (err) {
      console.error(err);
      setActionError("Teklif reddedilirken hata oluştu.");
    } finally {
      setSavingAction(false);
    }
  }

  /* ---------------------------
    PACKAGE ACTIONS
  --------------------------- */
  function openPackageModal(p: PackageRequest) {
    setPkgModalReq(p);
    setPkgModalOpen(true);
  }
  function closePackageModal() {
    setPkgModalOpen(false);
    setPkgModalReq(null);
  }

  async function restartPackageRequest(p: PackageRequest) {
    try {
      await updateDoc(doc(db, "packageRequests", p.id), { createdAt: serverTimestamp(), status: "open" });
      setPackageRequests((prev) =>
        prev.map((x) => (x.id === p.id ? { ...x, createdAt: Timestamp.fromDate(new Date()), status: "open" } : x))
      );
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
    const ok1 = window.confirm("Bu paket talebini silmek istediğine emin misin?");
    if (!ok1) return;
    const ok2 = window.confirm("Son kez soruyorum: Silinsin mi? (Geri alamazsın)");
    if (!ok2) return;

    try {
      await updateDoc(doc(db, "packageRequests", p.id), { status: "deleted", deletedAt: serverTimestamp() });
      setPackageRequests((prev) => prev.filter((x) => x.id !== p.id));
      setActionMessage("Paket talebi silindi.");
    } catch (e) {
      console.error(e);
      setActionError("Paket talebi silinirken hata oluştu.");
    }
  }

  function openPkgPayment(req: PackageRequest, offer: PackageOffer) {
    setPkgPayReq(req);
    setPkgPayOffer(offer);
    setPkgPayMethod("transfer");
    setPkgPayError(null);
    setPkgPayMessage(null);
    setPkgPayOpen(true);
  }

  function closePkgPayment() {
    setPkgPayOpen(false);
    setPkgPayReq(null);
    setPkgPayOffer(null);
    setPkgPayError(null);
    setPkgPayMessage(null);
    setPkgThreeDSOpen(false);
  }

  async function acceptPackageAndCreateBooking(method: PackagePaymentMethod) {
    if (!profile?.uid || !pkgPayReq || !pkgPayOffer) return;

    try {
      setPkgPaySaving(true);
      setPkgPayError(null);
      setPkgPayMessage(null);

      const paymentStatus =
        method === "card3d" ? "paid" : method === "transfer" ? "transfer_pending" : "pay_at_door";

      const agency = agenciesMap[pkgPayOffer.agencyId];
      const ap = agency?.agencyProfile ?? null;

      const agencySnapshot = {
        id: pkgPayOffer.agencyId,
        displayName: agency?.displayName ?? pkgPayOffer.agencyName ?? null,
        email: agency?.email ?? null,
        businessName: ap?.businessName ?? null,
        phone: ap?.phone ?? null,
        address: ap?.address ?? null,
        city: ap?.city ?? null,
        district: ap?.district ?? null,
        taxNo: ap?.taxNo ?? null,
        about: ap?.about ?? null
      };

      const requestSnapshot = pkgPayReq;
      const offerSnapshot = pkgPayOffer;

      const bkRef = await addDoc(collection(db, "bookings"), {
        type: "package",

        packageRequestId: pkgPayReq.id,
        packageOfferId: pkgPayOffer.id,

        guestId: profile.uid,
        guestName: profile.displayName ?? null,
        guestEmail: profile.email ?? null,
        guestPhone: profile.phoneNumber ?? null,

        agencyId: pkgPayOffer.agencyId ?? null,
        agencyName: pkgPayOffer.agencyName ?? null,

        agencySnapshot,
        requestSnapshot,
        offerSnapshot,

        title: pkgPayReq.title ?? null,
        country: pkgPayReq.country ?? "Türkiye",
        city: pkgPayReq.city ?? null,
        district: pkgPayReq.district ?? null,
        checkIn: pkgPayReq.dateFrom ?? null,
        checkOut: pkgPayReq.dateTo ?? null,
        nights: pkgPayReq.nights ?? calcNightsFromISO(pkgPayReq.dateFrom, pkgPayReq.dateTo),

        paxAdults: pkgPayReq.paxAdults ?? 0,
        paxChildren: pkgPayReq.paxChildren ?? 0,
        childrenAges: pkgPayReq.childrenAges ?? null,
        roomsCount: pkgPayReq.roomsCount ?? null,
        roomTypes: pkgPayReq.roomTypes ?? null,

        needs: pkgPayReq.needs ?? null,
        wantsTransfer: pkgPayReq.wantsTransfer ?? null,
        transferType: pkgPayReq.transferType ?? null,
        transferNotes: pkgPayReq.transferNotes ?? null,
        wantsTours: pkgPayReq.wantsTours ?? null,
        tourCount: pkgPayReq.tourCount ?? null,
        tourNotes: pkgPayReq.tourNotes ?? null,
        wantsCar: pkgPayReq.wantsCar ?? null,
        carType: pkgPayReq.carType ?? null,
        licenseYear: pkgPayReq.licenseYear ?? null,
        carNotes: pkgPayReq.carNotes ?? null,
        extras: pkgPayReq.extras ?? null,
        activities: pkgPayReq.activities ?? null,
        note: pkgPayReq.note ?? null,

        totalPrice: Number(pkgPayOffer.totalPrice ?? 0),
        currency: pkgPayOffer.currency ?? "TRY",
        paymentMethod: method,
        paymentStatus,

        status: "active",
        createdAt: serverTimestamp(),

        packageBreakdown: pkgPayOffer.breakdown ?? null,
        packageDetails: pkgPayOffer.packageDetails ?? null,
        offerNote: pkgPayOffer.note ?? null
      });

      await updateDoc(doc(db, "packageOffers", pkgPayOffer.id), {
        status: "accepted",
        acceptedAt: serverTimestamp(),
        bookingId: bkRef.id
      });

      await updateDoc(doc(db, "packageRequests", pkgPayReq.id), {
        status: "accepted",
        acceptedOfferId: pkgPayOffer.id,
        acceptedAt: serverTimestamp(),
        bookingId: bkRef.id
      });

      await createNotification(db, profile.uid, {
        type: "packageBookingCreated",
        bookingId: bkRef.id,
        requestId: pkgPayReq.id,
        offerId: pkgPayOffer.id
      });
      await createNotification(db, pkgPayOffer.agencyId, {
        type: "packageBookingCreated",
        bookingId: bkRef.id,
        requestId: pkgPayReq.id,
        offerId: pkgPayOffer.id
      });

      setPackageRequests((prev) =>
        prev.map((x) => (x.id === pkgPayReq.id ? { ...x, status: "accepted", acceptedOfferId: pkgPayOffer.id, bookingId: bkRef.id } : x))
      );

      setPkgPayMessage("Paket kabul edildi. Rezervasyon oluşturuldu. Rezervasyonlarım sayfasına yönlendiriliyorsun...");
      setTimeout(() => {
        closePkgPayment();
        router.push("/guest/bookings");
      }, 1200);
    } catch (e) {
      console.error(e);
      setPkgPayError("Paket kabul/ödeme sırasında hata oluştu.");
    } finally {
      setPkgPaySaving(false);
    }
  }
  /* ---------------------------
    LOAD
  --------------------------- */
  useEffect(() => {
    async function load() {
      if (authLoading) return;
      if (!profile) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setActionError(null);

      try {
        // 1) hotel/group requests
        const qReq = query(collection(db, "requests"), where("guestId", "==", profile.uid));
        const snapReq = await getDocs(qReq);

        const reqs: RequestSummary[] = snapReq.docs
          .map((d) => {
            const v = d.data() as any;
            return {
              id: d.id,
              city: v.city,
              district: v.district ?? null,
              checkIn: v.checkIn,
              checkOut: v.checkOut,
              adults: v.adults,
              childrenCount: v.childrenCount ?? 0,
              childrenAges: Array.isArray(v.childrenAges) ? v.childrenAges : [],
              roomsCount: v.roomsCount ?? 1,
              roomTypes: v.roomTypes ?? [],
              responseDeadlineMinutes: v.responseDeadlineMinutes ?? 60,
              createdAt: v.createdAt,
              status: v.status ?? "open",

              type: v.type,
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
            } as RequestSummary;
          })
          .filter((r) => r.status !== "deleted");

        const reqMap: Record<string, RequestSummary> = {};
        reqs.forEach((r) => (reqMap[r.id] = r));
        const requestIds = reqs.map((r) => r.id);

        // 2) hotel offers
        const offersOut: GuestOffer[] = [];
        for (const part of chunkArray(requestIds, 10)) {
          if (!part.length) continue;
          const qOff = query(collection(db, "offers"), where("requestId", "in", part));
          const snapOff = await getDocs(qOff);

          snapOff.docs.forEach((d) => {
            const v = d.data() as any;
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
              roomTypeId: v.roomTypeId ?? null,
              roomTypeName: v.roomTypeName ?? null,
              roomBreakdown: v.roomBreakdown ?? [],
              cancellationPolicyType: v.cancellationPolicyType as CancellationPolicyType | undefined,
              cancellationPolicyDays: v.cancellationPolicyDays ?? null,
              priceHistory: v.priceHistory ?? []
            });
          });
        }
        offersOut.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));

        // 3) hotel profiles
        const hotelIds = Array.from(new Set(offersOut.map((o) => o.hotelId).filter(Boolean)));
        const hotelMap: Record<string, HotelInfo> = {};

        await Promise.all(
          hotelIds.map(async (hid) => {
            const snap = await getDoc(doc(db, "users", hid));
            if (!snap.exists()) return;
            const data = snap.data() as any;
            hotelMap[hid] = {
              id: hid,
              displayName: data.displayName,
              email: data.email,
              website: data.website || data.hotelProfile?.website || "",
              hotelProfile: data.hotelProfile as HotelProfile | undefined
            };
          })
        );

        // 4) packageRequests
      // 4) packageRequests (önce uid ile dene)
let snapPkg = await getDocs(
  query(
    collection(db, "packageRequests"),
    where("createdByRole", "==", "guest"),
    where("createdById", "==", profile.uid)
  )
);

// Eğer boşsa: farklı alan isimleri / farklı uid ihtimali için geniş çekip client-side filtrele
if (snapPkg.empty) {
  const allSnap = await getDocs(
    query(collection(db, "packageRequests"), where("createdByRole", "==", "guest"))
  );

  const myUid = (profile.uid || "").toLowerCase();
  const myEmail = (profile.email || "").toLowerCase();
  const myName = (profile.displayName || "").toLowerCase();
  const myPhone = (profile.phoneNumber || "").replace(/\D/g, "");

  const filteredDocs = allSnap.docs.filter((d) => {
    const v: any = d.data();

    const createdById = String(v.createdById || "").toLowerCase();
    const createdByName = String(v.createdByName || "").toLowerCase();
    const createdByEmail = String(v.createdByEmail || "").toLowerCase();
    const createdByPhone = String(v.createdByPhone || "").replace(/\D/g, "");

    const contactEmail = String(v.contact?.email || "").toLowerCase();
    const contactName = String(v.contact?.name || "").toLowerCase();
    const contactPhone = String(v.contact?.phone || "").replace(/\D/g, "");

    // UID eşleşmesi (en güçlü)
    if (createdById && myUid && createdById === myUid) return true;

    // Email eşleşmesi (çok güçlü)
    if (myEmail && (createdByEmail === myEmail || contactEmail === myEmail)) return true;

    // Telefon eşleşmesi (güçlü)
    if (myPhone && (createdByPhone === myPhone || contactPhone === myPhone)) return true;

    // İsim eşleşmesi (zayıf ama bazen kurtarır)
    if (myName && (createdByName === myName || contactName === myName)) return true;

    return false;
  });

  // snap gibi kullanmak için taklit ediyoruz
  snapPkg = { docs: filteredDocs } as any;
}


   const pkgs: any[] = snapPkg.docs
  .map((d) => {
    const v = d.data() as any;

    // 🔥 EN ÖNEMLİ: Firestore’daki her şeyi sakla
    const raw = { id: d.id, ...v };

    // UI için normalize (ama raw asla kaybolmaz)
    return {
      id: d.id,

      // raw snapshot (modal bunu okuyacak)
      raw,

      // normalize alanlar (UI’nin hızlı kartları için)
      title: v.title ?? null,
      country: v.country ?? "Türkiye",
      city: v.city ?? null,
      district: v.district ?? null,

      dateFrom: v.dateFrom ?? v.checkIn ?? null,
      dateTo: v.dateTo ?? v.checkOut ?? null,
      nights: v.nights ?? v.hotelNights ?? v.days ?? null,

      paxAdults: v.paxAdults ?? v.adults ?? 0,
      paxChildren: v.paxChildren ?? v.childrenCount ?? 0,
      childrenAges: Array.isArray(v.childrenAges) ? v.childrenAges : null,

      roomsCount: v.roomsCount ?? null,
      roomTypes: Array.isArray(v.roomTypes) ? v.roomTypes : null,

      needs: Array.isArray(v.needs) ? v.needs : null,

      wantsTours: v.wantsTours ?? v.wantTours ?? false,
      tourCount: v.tourCount ?? v.toursCount ?? null,
      tourNotes: v.tourNotes ?? null,

      wantsTransfer: v.wantsTransfer ?? v.wantTransfer ?? false,
      transferType: v.transferType ?? null,
      transferNotes: v.transferNotes ?? null,

      wantsCar: v.wantsCar ?? v.wantCar ?? false,
      carType: v.carType ?? null,
      licenseYear: v.licenseYear ?? null,
      carNotes: v.carNotes ?? null,

      extras: Array.isArray(v.extras) ? v.extras : null,
      activities: v.activities ?? null, // string de olabilir

      note: v.note ?? v.notes ?? v.generalNote ?? null,

      responseDeadlineMinutes: v.responseDeadlineMinutes ?? 180,
      responseTimeAmount: v.responseTimeAmount ?? null,
      responseTimeUnit: v.responseTimeUnit ?? null,

      createdByRole: v.createdByRole ?? "guest",
      createdById: v.createdById ?? v.guestId ?? null,

      acceptedOfferId: v.acceptedOfferId ?? v.acceptedOffer ?? null,
      bookingId: v.bookingId ?? null,

      status: v.status ?? "open",
      createdAt: v.createdAt
    };
  })
  .filter((p) => p.status !== "deleted")
  .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));


        // 5) packageOffers (requestId IN chunk)
        const pkgOffersMap: Record<string, PackageOffer[]> = {};
        const agencyIdsSet = new Set<string>();
        const pkgIds = pkgs.map((x) => x.id);

        for (const part of chunkArray(pkgIds, 10)) {
          if (!part.length) continue;
          const qPkgOff = query(collection(db, "packageOffers"), where("requestId", "in", part));
          const snapPkgOff = await getDocs(qPkgOff);

          snapPkgOff.docs.forEach((d) => {
            const v = d.data() as any;
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
          arr.sort(
            (a, b) =>
              (b.updatedAt?.toMillis?.() ?? b.createdAt?.toMillis?.() ?? 0) -
              (a.updatedAt?.toMillis?.() ?? a.createdAt?.toMillis?.() ?? 0)
          )
        );

        // 6) agencies
        const agencies: Record<string, AgencyInfo> = {};
        await Promise.all(
          Array.from(agencyIdsSet).map(async (aid) => {
            const snap = await getDoc(doc(db, "users", aid));
            if (!snap.exists()) return;
            const u = snap.data() as any;
            agencies[aid] = {
              id: aid,
              displayName: u.displayName ?? null,
              email: u.email ?? null,
              agencyProfile: u.agencyProfile ?? null
            };
          })
        );

        setRequestsMap(reqMap);
        setOffers(offersOut);
        setHotelsMap(hotelMap);

        setPackageRequests(pkgs);
        setPackageOffersByReq(pkgOffersMap);
        setAgenciesMap(agencies);
      } catch (err: any) {
        console.error(err);
        setActionError(err?.message || "Teklifler yüklenemedi.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [authLoading, profile, db]);

  const acceptedRequestIds = useMemo(() => {
    const set = new Set<string>();
    offers.forEach((o) => {
      if (o.status === "accepted") set.add(o.requestId);
    });
    return set;
  }, [offers]);

  const filteredOffers = useMemo(() => {
    return offers.filter((o) => {
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
  }, [offers, statusFilter, fromDate, toDate]);

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
      status: "open" | "expired" | "accepted";
      remaining: ReturnType<typeof formatRemaining>;
      bestOfferId: string | null;
    }[] = [];

    const allRequests = Object.values(requestsMap).filter((r) => r.status !== "deleted");
    const q = qText.trim().toLowerCase();

    allRequests.forEach((req) => {
      const hasAccepted = acceptedRequestIds.has(req.id);
      const reqStatus = computeRequestStatus(req, hasAccepted);
      if (reqStatus === "accepted") return;

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

      const offersForReq = filteredOffers.filter((o) => o.requestId === req.id);

      const scored = offersForReq.slice().sort((a, b) => {
        const score = (o: GuestOffer) => {
          let s = 0;
          if (boostNegotiable && o.mode === "negotiable") s += 70;
          if (boostRefreshable && getHistoryMeta(o).hasHotelUpdate) s += 35;
          if (o.mode === "refreshable") s += 15;
          if (o.status === "sent") s += 10;
          if (o.status === "countered") s += 8;
          if (o.status === "rejected") s -= 1000;
          s += Math.max(0, 500000 - Number(o.totalPrice || 0));
          return s;
        };
        return score(b) - score(a);
      });

      const bestOfferId = scored.length ? scored[0].id : null;

      blocks.push({
        request: req,
        offers: scored,
        status: reqStatus,
        remaining: formatRemaining(req, now),
        bestOfferId
      });
    });

    return blocks.sort((a, b) => (b.request.createdAt?.toMillis?.() ?? 0) - (a.request.createdAt?.toMillis?.() ?? 0));
  }, [requestsMap, filteredOffers, acceptedRequestIds, now, qText, typeFilter, cityFilter, boostNegotiable, boostRefreshable]);

  // Paketleri ayır: kabul edilenler üstte
 const pkgAcceptedList = useMemo(
  () =>
    packageRequests.filter(
      (p) => (p.status ?? "") === "accepted" && !!p.bookingId && (p.hiddenFromGuest ?? false) === false
    ),
  [packageRequests]
);

  const pkgOpenList = useMemo(
    () => packageRequests.filter((p) => (p.status ?? "open") !== "accepted" && (p.status ?? "open") !== "deleted"),
    [packageRequests]
  );
  return (
    <Protected allowedRoles={["guest"]}>
      <div className="container-page space-y-6 relative">
        {/* Header */}
        <section className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-100">Taleplerim / Gelen teklifler</h1>
          <p className="text-sm text-slate-300 max-w-4xl">
            Otel, grup ve paket taleplerini tek ekranda görürsün. Süre bittiğinde satır soluk olur.
            Yeniden başlat / düzenle / sil ile yönetebilirsin. Pazarlıklı ve güncellenmiş teklifleri öne çıkarabilirsin.
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => router.push("/guest/requests/new")}
              className="rounded-full bg-emerald-500 text-slate-950 px-4 py-2 text-sm font-semibold hover:bg-emerald-400"
            >
              + Otel talebi
            </button>
            <button
              onClick={() => router.push("/guest/group-request")}
              className="rounded-full border border-white/10 bg-white/5 text-slate-100 px-4 py-2 text-sm hover:bg-white/10"
            >
              + Grup talebi
            </button>
            <button
              onClick={() => router.push("/guest/package-requests/new")}
              className="rounded-full border border-white/10 bg-white/5 text-slate-100 px-4 py-2 text-sm hover:bg-white/10"
            >
              + Paket talebi
            </button>
          </div>
        </section>

        {/* Action messages */}
        {(actionMessage || actionError) && (
          <div className="space-y-2">
            {actionMessage && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-emerald-200 text-sm">
                {actionMessage}
              </div>
            )}
            {actionError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-200 text-sm">
                {actionError}
              </div>
            )}
          </div>
        )}

        {/* Filters */}
        <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow shadow-slate-950/40 text-xs space-y-3">
          <div className="grid gap-3 md:grid-cols-12 items-end">
            <div className="md:col-span-4 space-y-1">
              <label className="text-[0.75rem] text-slate-200">Arama</label>
              <input
                value={qText}
                onChange={(e) => setQText(e.target.value)}
                className="input"
                placeholder="şehir, not, id..."
              />
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
                {cityOptions.map((c) => (
                  <option key={c} value={c}>{c === "all" ? "Hepsi" : c}</option>
                ))}
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
                  Fiyat güncellemesi olanları öne çıkar
                </label>
              </div>

              <div className="flex items-center gap-2">
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="input" style={{ width: 220 }}>
                  <option value="all">Teklif durumu: Hepsi</option>
                  <option value="sent">Otel teklif gönderdi</option>
                  <option value="rejected">Reddettiklerin</option>
                </select>

                <button
                  type="button"
                  onClick={() => {
                    setQText("");
                    setTypeFilter("all");
                    setCityFilter("all");
                    setFromDate("");
                    setToDate("");
                    setStatusFilter("all");
                  }}
                  className="rounded-md border border-slate-700 px-3 py-2 text-[0.75rem] text-slate-200 hover:border-slate-500"
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

        {loading && <p className="text-sm text-slate-400">Teklifler yükleniyor…</p>}

        {!loading && groupedByRequest.length === 0 && pkgOpenList.length === 0 && pkgAcceptedList.length === 0 && (
          <p className="text-sm text-slate-400">Henüz bir talebin veya teklif yok.</p>
        )}

        {/* ✅ PACKAGE */}
        {(typeFilter === "all" || typeFilter === "package") && (pkgAcceptedList.length > 0 || pkgOpenList.length > 0) && (
          <section className="space-y-3">
            {pkgAcceptedList.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-emerald-200">✅ Kabul edilen paketler</h3>

                {pkgAcceptedList
.filter((p) => (p.hiddenFromGuest ?? false) === false)
                  .filter((p) => (cityFilter === "all" ? true : p.city === cityFilter))
                  .filter((p) => {
                    const q = qText.trim().toLowerCase();
                    if (!q) return true;
                    const hay = [p.id, p.title, p.city, p.district, p.note].filter(Boolean).join(" ").toLowerCase();
                    return hay.includes(q);
                  })
                  .map((p) => (
                    <div key={p.id} className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                      <div className="space-y-1">
                        <div className="text-slate-100 font-semibold">
                          {p.title || "Paket"} • {safeStr(p.city)}{p.district ? ` / ${p.district}` : ""}
                        </div>
                        <div className="text-[0.8rem] text-slate-300">
                          {safeStr(p.dateFrom)} – {safeStr(p.dateTo)} • Booking ID:{" "}
                          <b className="text-slate-100">{p.bookingId}</b>
                        </div>
                        <div className="text-[0.75rem] text-slate-400">
                          Bu paket kabul edildi ve rezervasyon oluşturuldu. Rezervasyonlarım’da tüm detaylar var.
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={() => router.push("/guest/bookings")}
                          className="rounded-md bg-emerald-500 text-slate-950 px-4 py-2 text-[0.8rem] font-semibold hover:bg-emerald-400"
                        >
                          Rezervasyonlara Git
                        </button>
                        <button
                          onClick={() => openPackageModal(p)}
                          className="rounded-md border border-slate-700 px-4 py-2 text-[0.8rem] text-slate-200 hover:border-slate-500"
                        >
                          Detay
                        </button>
                        <button
  type="button"
  onClick={() => hideAcceptedPackageFromGuest(p)}
  className="rounded-md border border-slate-600 px-4 py-2 text-[0.8rem] font-semibold text-slate-300 hover:bg-slate-800"
>
🗂️ Taleplerimden kaldır
</button>

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
                    const hay = [p.id, p.title, p.city, p.district, p.note, (p.needs || []).join(" ")]
                      .filter(Boolean)
                      .join(" ")
                      .toLowerCase();
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

                    const barColor =
                      rem.color === "red" ? "bg-red-500" : rem.color === "yellow" ? "bg-amber-400" : "bg-emerald-500";

                    return (
                      <div key={p.id} className={`rounded-2xl border border-slate-800 bg-slate-950/80 shadow shadow-slate-950/40 overflow-hidden ${st === "expired" ? "opacity-80" : ""}`}>
                        <div className="px-4 py-3 bg-slate-900/85 flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="inline-flex items-center rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-[0.7rem] text-indigo-200">
                                🧳 Paket
                              </span>
                              <span className="text-[0.7rem] text-slate-500">#{p.id}</span>
                              <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[0.7rem] ${badgeByPkgStatus(st)}`}>
                                {st === "open" ? "Açık" : st === "expired" ? "Süre doldu" : st === "accepted" ? "Kabul edildi" : "Silindi"}
                              </span>
                              <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[0.7rem] text-slate-200">
                                Teklif: <b className="ml-1 text-white">{offersForReq.length}</b>
                              </span>
                            </div>

                            <p className="text-slate-100 text-sm font-semibold">
                              {p.title || "Paket talebi"} • {safeStr(p.city)}{p.district ? ` / ${p.district}` : ""}
                            </p>

                            <p className="text-[0.75rem] text-slate-300">
                              {safeStr(p.dateFrom)} – {safeStr(p.dateTo)} • {nights} gece • {pax} kişi
                              {p.roomsCount ? ` • ${p.roomsCount} oda` : ""}
                            </p>

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
                                <p className="text-[0.7rem] text-slate-300">
                                  {best.agencyName || agenciesMap[best.agencyId]?.displayName || "Acenta"}
                                </p>
                              </div>
                            ) : (
                              <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[0.75rem] text-slate-300">
                                Henüz teklif yok
                              </div>
                            )}

                            <button
                              type="button"
                              onClick={() => openPackageModal(p)}
                              className="rounded-md bg-sky-500 text-white px-4 py-2 text-[0.8rem] font-semibold hover:bg-sky-400"
                            >
                              Detay / Teklifler
                            </button>

                            <div className="flex gap-2">
                              {st === "expired" && (
                                <button
                                  onClick={() => restartPackageRequest(p)}
                                  className="rounded-md border border-emerald-500/60 px-3 py-2 text-[0.75rem] text-emerald-200 hover:bg-emerald-500/10"
                                >
                                  Yeniden başlat
                                </button>
                              )}

                              <button
                                onClick={() => editPackageRequest(p)}
                                className="rounded-md border border-sky-500/60 px-3 py-2 text-[0.75rem] text-sky-200 hover:bg-sky-500/10"
                              >
                                Düzenle
                              </button>

                              <button
                                onClick={() => deletePackageRequest(p)}
                                className="rounded-md border border-red-500/60 px-3 py-2 text-[0.75rem] text-red-200 hover:bg-red-500/10"
                              >
                                Sil
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="px-4 py-3 border-t border-slate-800 bg-slate-950/60 text-[0.75rem] text-slate-400">
                          Paket teklifleri “otel + transfer + tur + diğer” kırılımı ile gelir. Kabul ettiğinde ödeme adımı açılır.
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </section>
        )}

        {/* ✅ HOTEL/GROUP REQUEST BLOCKS */}
        {(typeFilter === "all" || typeFilter === "hotel" || typeFilter === "group") && (
          <section className="space-y-3">
            {groupedByRequest.map((block) => {
              const { request: req, offers: reqOffers, status, remaining, bestOfferId } = block;
              const totalGuests = (req.adults ?? 0) + (req.childrenCount ?? 0);
              const isGroup = req.isGroup || req.type === "group";

              const statusBadge =
                status === "expired"
                  ? { label: "Süresi doldu", className: "bg-red-500/10 text-red-300 border-red-500/40" }
                  : { label: "Açık", className: "bg-sky-500/10 text-sky-300 border-sky-500/40" };

              const remainingClass =
                remaining.color === "red" ? "text-red-300" : remaining.color === "yellow" ? "text-amber-200" : "text-emerald-200";

              const barColor =
                remaining.color === "red" ? "bg-red-500" : remaining.color === "yellow" ? "bg-amber-400" : "bg-emerald-500";

              return (
                <section key={req.id} className={`rounded-2xl border border-slate-800 bg-slate-950/80 shadow shadow-slate-950/40 overflow-hidden ${status === "expired" ? "opacity-70" : ""}`}>
                  <div className="px-4 py-3 bg-slate-900/85">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-slate-100 text-sm font-semibold">
                            {req.city}{req.district ? ` / ${req.district}` : ""} • {req.checkIn} – {req.checkOut}
                          </p>
                          {isGroup && (
                            <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[0.65rem] text-amber-200">
                              Grup talebi
                            </span>
                          )}
                          <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[0.7rem] ${statusBadge.className}`}>
                            {statusBadge.label}
                          </span>
                        </div>

                        <p className="text-[0.75rem] text-slate-300">
                          {totalGuests} kişi • {req.roomsCount || 1} oda
                        </p>

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
                        <button
                          onClick={async () => {
                            try {
                              await updateDoc(doc(db, "requests", req.id), { createdAt: serverTimestamp(), status: "open" });
                              setRequestsMap((prev) => {
                                const copy = { ...prev };
                                if (copy[req.id]) copy[req.id] = { ...copy[req.id], createdAt: Timestamp.fromDate(new Date()), status: "open" };
                                return copy;
                              });
                              setActionMessage("Talebin yeniden başlatıldı. Oteller yeniden teklif verebilecek.");
                            } catch {
                              setActionError("Talep yeniden başlatılırken hata oluştu.");
                            }
                          }}
                          className="rounded-md border border-emerald-500/70 px-3 py-2 text-[0.75rem] text-emerald-200 hover:bg-emerald-500/10"
                        >
                          Yeniden başlat
                        </button>

                        <button
                          onClick={() => router.push(`/guest/requests/new?requestId=${req.id}`)}
                          className="rounded-md border border-sky-500/70 px-3 py-2 text-[0.75rem] text-sky-200 hover:bg-sky-500/10"
                        >
                          Düzenle
                        </button>

                        <button
                          onClick={async () => {
                            const ok = window.confirm("Bu talebi silmek istediğine emin misin?");
                            if (!ok) return;
                            try {
                              await updateDoc(doc(db, "requests", req.id), { status: "deleted", deletedAt: serverTimestamp() });
                              setRequestsMap((prev) => {
                                const copy = { ...prev };
                                delete copy[req.id];
                                return copy;
                              });
                              setActionMessage("Talebin silindi.");
                            } catch {
                              setActionError("Talep silinirken hata oluştu.");
                            }
                          }}
                          className="rounded-md border border-red-500/70 px-3 py-2 text-[0.75rem] text-red-200 hover:bg-red-500/10"
                        >
                          Sil
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="pt-2 pb-3">
                      {reqOffers.length === 0 ? (
                        <div className="px-4 py-4 text-[0.8rem] text-slate-400 border-t border-slate-800">
                          Bu talebe henüz teklif gelmedi. Oteller teklif gönderdikçe burada göreceksin.
                        </div>
                      ) : (
                        <>
                          <div className="hidden md:grid grid-cols-[1.6fr_1.1fr_1.1fr_1.2fr_auto] bg-slate-900 text-[0.75rem] font-semibold text-slate-100 px-4 py-2">
                            <div>Otel</div>
                            <div>Toplam fiyat</div>
                            <div>Teklif tipi</div>
                            <div>Durum</div>
                            <div className="text-right">İşlemler</div>
                          </div>

                          {reqOffers.map((o) => {
                            const createdStr = o.createdAt ? o.createdAt.toDate().toLocaleString("tr-TR") : "";
                            const canCounterFlag = canCounter(o);
                            const isSelected = selectedForPaymentId === o.id;
                            const meta = getHistoryMeta(o);
                            const isBest = bestOfferId === o.id;

                            return (
                              <div key={o.id} className={`border-t border-slate-800 ${isBest ? "bg-emerald-500/5" : ""}`}>
                                <div className="grid md:grid-cols-[1.6fr_1.1fr_1.1fr_1.2fr_auto] gap-2 px-4 py-3 items-center">
                                  <div className="space-y-1 text-slate-100">
                                    <div className="md:hidden text-[0.7rem] text-slate-400">Otel</div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <div className="font-semibold text-sm">{o.hotelName || hotelsMap[o.hotelId]?.displayName || "Otel"}</div>
                                      {isBest && (
                                        <span className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[0.65rem] text-emerald-200">
                                          ⚡ En iyi
                                        </span>
                                      )}
                                      {o.mode === "negotiable" && (
                                        <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[0.65rem] text-amber-200">
                                          💬 Pazarlıklı
                                        </span>
                                      )}
                                      {meta.hasHotelUpdate && (
                                        <span className="inline-flex items-center rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[0.65rem] text-sky-200">
                                          📉 Güncellendi
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  <div className="text-slate-100">
                                    <div className="md:hidden text-[0.7rem] text-slate-400">Toplam fiyat</div>
                                    {meta.firstPrice && meta.firstPrice !== o.totalPrice ? (
                                      <div className="text-[0.75rem] text-slate-400 line-through">{money(meta.firstPrice, o.currency)}</div>
                                    ) : null}
                                    <div className="font-extrabold text-sm text-emerald-300">{money(o.totalPrice, o.currency)}</div>
                                    <div className="text-[0.7rem] text-slate-400">{createdStr ? `Teklif tarihi: ${createdStr}` : ""}</div>
                                  </div>

                                  <div className="text-slate-100">
                                    <div className="md:hidden text-[0.7rem] text-slate-400">Teklif tipi</div>
                                    <div className="font-semibold">{MODE_LABEL_PUBLIC[o.mode]}</div>
                                    {o.mode === "negotiable" && (
                                      <p className="text-[0.65rem] text-amber-300">1 defa karşı teklif hakkın var.</p>
                                    )}
                                  </div>

                                  <div className="space-y-1">
                                    <div className="md:hidden text-[0.7rem] text-slate-400">Durum</div>
                                    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[0.7rem] ${
                                      o.status === "rejected" ? "bg-red-500/10 text-red-300 border-red-500/40" :
                                      o.status === "countered" ? "bg-amber-500/10 text-amber-300 border-amber-500/40" :
                                      "bg-slate-500/10 text-slate-300 border-slate-500/40"
                                    }`}>
                                      {o.status === "countered" ? "Karşı teklif gönderdin" : o.status === "rejected" ? "Reddettin" : "Otel teklif gönderdi"}
                                    </span>

                                    {o.guestCounterPrice ? (
                                      <p className="text-[0.7rem] text-slate-400">Karşı teklifin: {money(o.guestCounterPrice, o.currency)}</p>
                                    ) : null}
                                  </div>

                                  <div className="flex justify-end gap-2 flex-wrap">
                                    {(o.status === "sent" || o.status === "countered") && (
                                      <>
                                        {isSelected ? (
                                          <>
                                            <button
                                              onClick={() => handleOpenPaymentModal(o)}
                                              disabled={savingAction}
                                              className="rounded-md bg-emerald-500 text-slate-950 px-3 py-2 text-[0.75rem] font-semibold hover:bg-emerald-400 disabled:opacity-60"
                                            >
                                              Ödemeye ilerle
                                            </button>
                                            <button
                                              onClick={handleCancelSelection}
                                              disabled={savingAction}
                                              className="rounded-md border border-slate-700 px-3 py-2 text-[0.75rem] text-slate-200 hover:border-slate-500"
                                            >
                                              Vazgeç
                                            </button>
                                          </>
                                        ) : (
                                          <button
                                            onClick={() => handleSelectForPayment(o)}
                                            disabled={savingAction}
                                            className="rounded-md border border-emerald-500/70 px-3 py-2 text-[0.75rem] text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-60"
                                          >
                                            Kabul et
                                          </button>
                                        )}

                                        <button
                                          onClick={() => handleReject(o)}
                                          disabled={savingAction}
                                          className="rounded-md border border-red-500/70 px-3 py-2 text-[0.75rem] text-red-300 hover:bg-red-500/10 disabled:opacity-60"
                                        >
                                          Reddet
                                        </button>
                                      </>
                                    )}

                                    {canCounterFlag && o.status === "sent" && (
                                      <button
                                        onClick={() => startCounter(o)}
                                        disabled={savingAction || !!o.guestCounterPrice}
                                        className="rounded-md border border-amber-500/70 px-3 py-2 text-[0.75rem] text-amber-300 hover:bg-amber-500/10 disabled:opacity-60"
                                      >
                                        Pazarlık yap
                                      </button>
                                    )}

                                    <button
                                      onClick={() => openDetails(o)}
                                      className="rounded-md bg-sky-500 text-white px-3 py-2 text-[0.75rem] font-semibold hover:bg-sky-400"
                                    >
                                      Detay
                                    </button>
                                  </div>
                                </div>

                                {counterEditId === o.id && canCounterFlag && (
                                  <div className="bg-slate-950 px-4 pb-4 text-[0.7rem]">
                                    <form onSubmit={(e) => handleCounterSubmit(e, o)} className="mt-1 space-y-2 rounded-xl border border-slate-800 bg-slate-950/90 p-3">
                                      <p className="text-slate-200 font-semibold mb-1">Pazarlık – karşı teklifini yaz</p>
                                      <div className="space-y-1">
                                        <label className="text-slate-400">Önerdiğin toplam fiyat ({o.currency})</label>
                                        <input type="number" min={0} step="0.01" value={counterPrice} onChange={(e) => setCounterPrice(e.target.value)} className="input" />
                                        <p className="text-[0.65rem] text-slate-500">Bu hakkı sadece 1 defa kullanabilirsin.</p>
                                      </div>
                                      <div className="flex justify-end gap-2 mt-1">
                                        <button type="button" onClick={cancelCounter} className="rounded-md border border-slate-700 px-3 py-2 text-[0.75rem] text-slate-200 hover:border-slate-500">
                                          İptal
                                        </button>
                                        <button type="submit" disabled={savingAction} className="rounded-md bg-amber-500 text-slate-950 px-3 py-2 text-[0.75rem] font-semibold hover:bg-amber-400 disabled:opacity-60">
                                          Karşı teklif gönder
                                        </button>
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

        {/* HOTEL OFFER DETAIL MODAL */}
        {detailsOpen && detailsOffer && (
          <OfferDetailModal
            offer={detailsOffer}
            hotel={hotelsMap[detailsOffer.hotelId]}
            req={requestsMap[detailsOffer.requestId]}
            onClose={closeDetails}
          />
        )}

        {/* HOTEL PAYMENT MODAL */}
        {paymentOpen && paymentOffer && (
          <PaymentModal
            offer={paymentOffer}
            hotel={hotelsMap[paymentOffer.hotelId]}
            paymentMethod={paymentMethod}
            setPaymentMethod={setPaymentMethod}
            saving={savingPayment}
            error={paymentError}
            message={paymentMessage}
            onConfirm={handlePaymentConfirm}
            onClose={handleClosePaymentModal}
            threeDSOpen={threeDSOpen}
            setThreeDSOpen={setThreeDSOpen}
            createBooking={createBooking}
            cardName={cardName}
            setCardName={setCardName}
            cardNumber={cardNumber}
            setCardNumber={setCardNumber}
            cardExpiry={cardExpiry}
            setCardExpiry={setCardExpiry}
            cardCvc={cardCvc}
            setCardCvc={setCardCvc}
          />
        )}

        {/* PACKAGE DETAIL MODAL */}
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

        {/* PACKAGE PAYMENT MODAL */}
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

        <style jsx global>{`
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
        `}</style>
      </div>
    </Protected>
  );
}
function MiniStat({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <p className="text-[0.7rem] text-slate-400">{title}</p>
      <p className="text-slate-100 font-extrabold mt-1">{value}</p>
    </div>
  );
}

/* -------------------- HOTEL OFFER DETAIL MODAL -------------------- */
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
  const hp = hotel?.hotelProfile;
  const hotelImages = (hp?.imageUrls ?? []).filter(Boolean);
  const [activeHotelImage, setActiveHotelImage] = useState(0);

  // Lightbox
  const [imgOpen, setImgOpen] = useState(false);
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const openImage = (src?: string | null) => {
    if (!src) return;
    setImgSrc(src);
    setImgOpen(true);
  };
  const closeImage = () => {
    setImgOpen(false);
    setImgSrc(null);
  };

  const [roomModalOpen, setRoomModalOpen] = useState(false);
  const [roomModalRoom, setRoomModalRoom] = useState<RoomTypeProfile | null>(null);

  const breakdown = offer.roomBreakdown ?? [];
  const profileRoom = hp?.roomTypes?.find((rt) => rt.id === offer.roomTypeId) ?? null;

  const cancelText = cancellationLabelFromOffer(offer, hp);

  const po = hp?.paymentOptions;
  const paymentText = (() => {
    if (!po) return null;
    if (po.card3d && po.payAtHotel) return "Bu tesiste 3D Secure kart ile online ödeme yapabilir veya ödemeni girişte otelde yapabilirsin.";
    if (po.card3d) return "Bu tesiste 3D Secure ile kart ödemesi yapabilirsin.";
    if (po.payAtHotel) return "Bu tesiste ödemeni girişte, otelde yaparsın.";
    return null;
  })();

  const mapUrl =
    hp?.locationUrl ||
    (hp?.locationLat && hp?.locationLng
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${hp.locationLat},${hp.locationLng}`)}`
      : null);

  const nights = (() => {
    if (!req) return 1;
    const ci = new Date(req.checkIn);
    const co = new Date(req.checkOut);
    const diff = Math.floor((co.setHours(0, 0, 0, 0) - ci.setHours(0, 0, 0, 0)) / (1000 * 60 * 60 * 24)) || 0;
    return diff > 0 ? diff : 1;
  })();

  const reqAny: any = req || {};
  const reqChildrenAges: number[] = Array.isArray(reqAny.childrenAges) ? reqAny.childrenAges : [];

  const hist = Array.isArray(offer.priceHistory) ? offer.priceHistory : [];
  const histSorted = hist
    .slice()
    .sort((a: any, b: any) => (a?.createdAt?.toMillis?.() ?? 0) - (b?.createdAt?.toMillis?.() ?? 0));

  const pricesAll = histSorted.map((h: any) => Number(h?.price ?? 0)).filter((n) => n > 0);
  const pricesHotel = histSorted.filter((h: any) => h?.actor === "hotel").map((h: any) => Number(h?.price ?? 0)).filter((n) => n > 0);

  const firstHotel = pricesHotel.length ? pricesHotel[0] : (Number(offer.totalPrice ?? 0) || 0);
  const minHotel = pricesHotel.length ? Math.min(...pricesHotel) : null;
  const lastPrice = Number(offer.totalPrice ?? 0) || (pricesAll.length ? pricesAll[pricesAll.length - 1] : 0);

  const bargained = (() => {
    if (!pricesHotel.length) return false;
    if (pricesHotel.length >= 2) return true;
    return histSorted.some((h: any) => h?.actor === "guest");
  })();

  const dropAmount = (minHotel != null && firstHotel > 0) ? (firstHotel - minHotel) : 0;
  const dropPct = (minHotel != null && firstHotel > 0) ? Math.round((dropAmount / firstHotel) * 100) : 0;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60">
        <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />

        <div className="relative mt-10 w-full max-w-5xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-xl shadow-slate-950/60 max-h-[88vh] overflow-y-auto text-[0.85rem] space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-slate-100">Otel Detayı</h2>
              <p className="text-[0.75rem] text-slate-500">
                Teklif #{offer.id} • {offer.hotelName || hotel?.displayName || "Otel"}
              </p>

              <div className="flex flex-wrap gap-2 pt-1">
                <span className="inline-flex items-center rounded-md border border-slate-700 bg-slate-950/60 px-2 py-1 text-[0.72rem] text-slate-200">
                  Başlangıç: <b className="ml-1 text-slate-100">{money(firstHotel, offer.currency)}</b>
                </span>

                {minHotel != null && (
                  <span className="inline-flex items-center rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[0.72rem] text-emerald-200">
                    En düşük: <b className="ml-1">{money(minHotel, offer.currency)}</b>
                    {dropAmount > 0 ? <span className="ml-2 text-emerald-300">(-{dropPct}%)</span> : null}
                  </span>
                )}

                <span className="inline-flex items-center rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-[0.72rem] text-sky-200">
                  Son fiyat: <b className="ml-1">{money(lastPrice, offer.currency)}</b>
                </span>

                <span className={`inline-flex items-center rounded-md border px-2 py-1 text-[0.72rem] ${bargained ? "border-amber-500/35 bg-amber-500/10 text-amber-200" : "border-slate-700 bg-slate-950/60 text-slate-300"}`}>
                  {bargained ? "Pazarlık yapıldı" : "Pazarlık yok"}
                </span>
              </div>
            </div>

            <button type="button" onClick={onClose} className="rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-emerald-400">
              Kapat ✕
            </button>
          </div>

          <div className="grid md:grid-cols-[1.4fr_minmax(0,1.6fr)] gap-4">
            {/* Gallery */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden flex flex-col">
              {hotelImages.length > 0 ? (
                <>
                  <button
                    type="button"
                    className="flex-1 overflow-hidden min-h-[260px] relative group"
                    onClick={() => openImage(hotelImages[activeHotelImage])}
                    title="Büyütmek için tıkla"
                  >
                    <img src={hotelImages[activeHotelImage]} alt="otel görseli" className="w-full h-full object-cover" />
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
                          className={`w-16 h-16 rounded-lg border overflow-hidden ${activeHotelImage === idx ? "border-emerald-400" : "border-slate-700"}`}
                        >
                          <img src={img} alt={`thumb-${idx}`} className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center justify-center text-slate-500 text-xs flex-1 min-h-[260px]">
                  <span className="text-3xl mb-1">🏨</span>
                  <span>Bu otel henüz görsel eklememiş.</span>
                </div>
              )}
            </div>

            {/* Details */}
            <div className="space-y-3">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-100">{hotel?.displayName || offer.hotelName || "Otel"}</h2>
                    {hp?.starRating ? <p className="text-[0.8rem] text-amber-300 mt-1">{hp.starRating}★</p> : null}
                  </div>
                  {mapUrl ? (
                    <a href={mapUrl} target="_blank" rel="noreferrer" className="rounded-md border border-slate-700 px-3 py-2 text-[0.75rem] text-sky-200 hover:border-sky-400">
                      Haritada gör
                    </a>
                  ) : null}
                </div>

                {hp?.address ? (
                  <p className="text-[0.8rem] text-slate-300 mt-3">
                    <span className="text-slate-400">Adres: </span>{hp.address}
                  </p>
                ) : null}

                {hp?.description ? (
                  <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                    <p className="text-[0.75rem] text-slate-400 mb-1">Otel hakkında</p>
                    <p className="text-[0.82rem] text-slate-200 leading-relaxed">{hp.description}</p>
                  </div>
                ) : null}

                <div className="grid md:grid-cols-2 gap-2 mt-3">
                  <div className="rounded-xl border border-slate-800 bg-slate-950/90 p-3">
                    <p className="text-[0.75rem] text-slate-400 mb-1">İptal</p>
                    <p className="text-[0.8rem] text-slate-200">{cancelText || "Bilgi yok"}</p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/90 p-3">
                    <p className="text-[0.75rem] text-slate-400 mb-1">Ödeme</p>
                    <p className="text-[0.8rem] text-slate-200">{paymentText || "Bilgi yok"}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
                <p className="text-[0.8rem] font-semibold text-slate-100 mb-2">Senin talebin</p>
                <div className="grid md:grid-cols-2 gap-2 text-[0.8rem]">
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                    <p className="text-[0.72rem] text-slate-400">Tarih</p>
                    <p className="text-slate-100 font-semibold">{req?.checkIn} → {req?.checkOut} • {nights} gece</p>
                  </div>

                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                    <p className="text-[0.72rem] text-slate-400">Kişi / Oda</p>
                    <p className="text-slate-100 font-semibold">
                      {reqAny.adults ?? "-"} yetişkin • {reqAny.childrenCount ?? 0} çocuk • {reqAny.roomsCount ?? 1} oda
                    </p>
                    {reqChildrenAges.length ? (
                      <p className="text-[0.75rem] text-slate-300 mt-1">Çocuk yaşları: {reqChildrenAges.join(", ")}</p>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* breakdown */}
          <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-950/90 p-4">
            <p className="text-slate-400 text-[0.75rem] mb-0.5">Fiyat & oda kırılımı</p>
            <p className="text-slate-100">
              <span className="text-lg font-extrabold text-emerald-300">{money(offer.totalPrice, offer.currency)}</span>{" "}
              <span className="text-[0.8rem] text-slate-300">• {MODE_LABEL_PUBLIC[offer.mode]}</span>
            </p>

            {breakdown.length > 0 ? (
              <div className="mt-2 space-y-2">
                {breakdown.map((rb, idx) => {
                  const n = rb.nights ?? nights;
                  const nightly = rb.nightlyPrice ?? 0;
                  const total = rb.totalPrice ?? nightly * n;

                  const rtProfile =
                    hp?.roomTypes?.find((rt) => rt.id === rb.roomTypeId || rt.name === rb.roomTypeName) || null;

                  const label = rb.roomTypeName || rtProfile?.name || `Oda ${idx + 1}`;

                  return (
                    <div key={idx} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-slate-100 text-[0.95rem] font-extrabold">
                            Oda {idx + 1}:{" "}
                            {rtProfile ? (
                              <button
                                type="button"
                                onClick={() => { setRoomModalRoom(rtProfile); setRoomModalOpen(true); }}
                                className="underline underline-offset-2 hover:text-emerald-300"
                              >
                                {label}
                              </button>
                            ) : (
                              <span className="font-extrabold">{label}</span>
                            )}
                          </p>
                          <p className="text-[0.78rem] text-slate-300 mt-1">
                            {n} gece × {nightly.toLocaleString("tr-TR")} {offer.currency}
                          </p>
                        </div>

                        <div className="text-right">
                          <p className="text-[0.72rem] text-slate-400">Toplam</p>
                          <p className="text-emerald-300 text-base font-extrabold">{money(total, offer.currency)}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-[0.78rem] text-slate-400">Oda kırılımı yok. Toplam tutar tek kalem.</p>
            )}
          </div>

          {histSorted.length > 0 ? (
            <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-950/90 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-slate-100 font-semibold text-[0.9rem]">Fiyat geçmişi</p>
                <p className="text-[0.75rem] text-slate-400">Adım: <span className="text-slate-200 font-semibold">{histSorted.length}</span></p>
              </div>

              <div className="grid md:grid-cols-3 gap-2">
                <MiniStat title="Başlangıç (otel)" value={money(firstHotel, offer.currency)} />
                <MiniStat title="En düşük (otel)" value={minHotel != null ? money(minHotel, offer.currency) : "—"} />
                <MiniStat title="Son fiyat" value={money(lastPrice, offer.currency)} />
              </div>

              <div className="mt-2 space-y-2">
                {histSorted.slice(-10).map((h: any, i: number) => {
                  const t = h?.createdAt?.toDate?.() ? h.createdAt.toDate().toLocaleString("tr-TR") : "";
                  const who = h.actor === "hotel" ? "Otel" : "Sen";
                  const kind = h.kind === "initial" ? "İlk fiyat" : h.kind === "update" ? "Güncelleme" : "Karşı teklif";

                  return (
                    <div key={i} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-slate-100 font-semibold">{who} • <span className="text-slate-300">{kind}</span></div>
                        <div className="text-emerald-300 font-extrabold">{money(h.price, offer.currency)}</div>
                      </div>
                      <div className="text-[0.7rem] text-slate-500 mt-1">{t}</div>
                      {h.note ? <div className="text-[0.78rem] text-slate-300 mt-2">{h.note}</div> : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

        {hp?.youtubeUrl ? (
            <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-950/90 p-4">
              <p className="text-slate-100 font-semibold text-[0.9rem]">Otel tanıtım videosu</p>
              <div className="aspect-video rounded-xl overflow-hidden border border-slate-800">
                <iframe
                  className="w-full h-full"
                  src={hp.youtubeUrl.replace("watch?v=", "embed/")}
                  title="Otel tanıtım videosu"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {imgOpen && imgSrc ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80">
          <button className="absolute inset-0" onClick={closeImage} aria-label="Kapat" />
          <div className="relative max-w-5xl w-[92vw]">
            <button type="button" onClick={closeImage} className="absolute -top-10 right-0 rounded-md border border-white/20 bg-black/40 px-3 py-2 text-sm text-white hover:bg-black/60">
              Kapat ✕
            </button>
            <img src={imgSrc} alt="Büyük görsel" className="w-full max-h-[78vh] object-contain rounded-xl border border-white/10" />
          </div>
        </div>
      ) : null}

      {roomModalOpen && roomModalRoom ? (
        <RoomTypeModal
          room={roomModalRoom}
          onClose={() => { setRoomModalOpen(false); setRoomModalRoom(null); }}
        />
      ) : null}
    </>
  );
}

function RoomTypeModal({ room, onClose }: { room: RoomTypeProfile; onClose: () => void }) {
  const images = ((room.imageUrls ?? room.images ?? room.gallery ?? room.photos ?? []) as string[]).filter(Boolean);
  const [active, setActive] = useState(0);

  const [imgOpen, setImgOpen] = useState(false);
  const [imgSrc, setImgSrc] = useState<string | null>(null);

  const openImage = (src?: string | null) => { if (!src) return; setImgSrc(src); setImgOpen(true); };
  const closeImage = () => { setImgOpen(false); setImgSrc(null); };

  return (
    <>
      <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/70">
        <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
        <div className="relative mt-14 w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-xl shadow-slate-950/60 max-h-[85vh] overflow-y-auto space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-extrabold text-slate-100">{room?.name || "Oda tipi"}</h3>
              {room?.shortDescription ? <p className="text-[0.8rem] text-slate-300 mt-1">{room.shortDescription}</p> : null}
            </div>
            <button type="button" onClick={onClose} className="rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-emerald-400">
              Kapat ✕
            </button>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden">
            {images.length ? (
              <>
                <button type="button" className="w-full h-64 relative group" onClick={() => openImage(images[active])} title="Büyütmek için tıkla">
                  <img src={images[active]} alt="oda görseli" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition" />
                  <div className="absolute bottom-3 right-3 rounded-md border border-white/25 bg-black/40 px-2 py-1 text-[0.72rem] text-white">🔍 Büyüt</div>
                </button>

                {images.length > 1 ? (
                  <div className="flex gap-2 p-2 bg-slate-950/80 border-t border-slate-800 overflow-x-auto">
                    {images.slice(0, 14).map((img: string, idx: number) => (
                      <button key={idx} type="button" onClick={() => setActive(idx)} className={`w-16 h-16 rounded-lg border overflow-hidden ${active === idx ? "border-emerald-400" : "border-slate-700"}`}>
                        <img src={img} alt={`thumb-${idx}`} className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                ) : null}
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
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80">
          <button className="absolute inset-0" onClick={closeImage} aria-label="Kapat" />
          <div className="relative max-w-5xl w-[92vw]">
            <button type="button" onClick={closeImage} className="absolute -top-10 right-0 rounded-md border border-white/20 bg-black/40 px-3 py-2 text-sm text-white hover:bg-black/60">
              Kapat ✕
            </button>
            <img src={imgSrc} alt="Büyük oda görseli" className="w-full max-h-[78vh] object-contain rounded-xl border border-white/10" />
          </div>
        </div>
      ) : null}
    </>
  );
}
function PaymentModal({
  offer,
  hotel,
  paymentMethod,
  setPaymentMethod,
  saving,
  error,
  message,
  onConfirm,
  onClose,
  threeDSOpen,
  setThreeDSOpen,
  createBooking,
  cardName,
  setCardName,
  cardNumber,
  setCardNumber,
  cardExpiry,
  setCardExpiry,
  cardCvc,
  setCardCvc
}: {
  offer: GuestOffer;
  hotel?: HotelInfo;
  paymentMethod: PaymentMethod | null;
  setPaymentMethod: (m: PaymentMethod | null) => void;
  saving: boolean;
  error: string | null;
  message: string | null;
  onConfirm: () => void;
  onClose: () => void;
  threeDSOpen: boolean;
  setThreeDSOpen: (b: boolean) => void;
  createBooking: (m: PaymentMethod) => Promise<void>;
  cardName: string;
  setCardName: (s: string) => void;
  cardNumber: string;
  setCardNumber: (s: string) => void;
  cardExpiry: string;
  setCardExpiry: (s: string) => void;
  cardCvc: string;
  setCardCvc: (s: string) => void;
}) {
  const po = hotel?.hotelProfile?.paymentOptions;

  const availableMethods: PaymentMethod[] = po
    ? ([po.card3d && "card3d", po.payAtHotel && "payAtHotel"].filter(Boolean) as PaymentMethod[])
    : (["card3d", "payAtHotel"] as PaymentMethod[]);

  const hasCard3d = availableMethods.includes("card3d");
  const hasPayAtHotel = availableMethods.includes("payAtHotel");

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70">
        <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
        <div className="relative mt-20 w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-xl shadow-slate-950/60 text-xs space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100">Ödeme yöntemini seç</h2>
            <button type="button" onClick={onClose} className="text-[0.7rem] text-slate-400 hover:text-slate-200">
              ✕ Kapat
            </button>
          </div>

          <p className="text-[0.75rem] text-slate-300">
            Toplam <span className="font-semibold">{money(offer.totalPrice, offer.currency)}</span>.
          </p>

          <div className="space-y-2">
            {hasCard3d && (
              <label className="flex items-start gap-2 rounded-lg border border-slate-700 p-3 hover:border-emerald-500 cursor-pointer">
                <input type="radio" checked={paymentMethod === "card3d"} onChange={() => setPaymentMethod("card3d")} className="mt-1 h-4 w-4" />
                <div>
                  <p className="text-slate-100 text-[0.8rem] font-semibold">💳 3D Secure</p>
                  <p className="text-[0.7rem] text-slate-400">Kartla ödeme (simülasyon). Ödeme sonrası rezervasyon oluşur.</p>
                </div>
              </label>
            )}

            {hasPayAtHotel && (
              <label className="flex items-start gap-2 rounded-lg border border-slate-700 p-3 hover:border-emerald-500 cursor-pointer">
                <input type="radio" checked={paymentMethod === "payAtHotel"} onChange={() => setPaymentMethod("payAtHotel")} className="mt-1 h-4 w-4" />
                <div>
                  <p className="text-slate-100 text-[0.8rem] font-semibold">💵 Otelde ödeme</p>
                  <p className="text-[0.7rem] text-slate-400">Ödemeyi girişte yaparsın.</p>
                </div>
              </label>
            )}
          </div>

          {paymentMethod === "card3d" && hasCard3d ? (
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">Kart üzerindeki ad</label>
                <input value={cardName} onChange={(e) => setCardName(e.target.value)} placeholder="Ad Soyad" className="input" />
              </div>
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">Kart numarası</label>
                <input value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} placeholder="1111 2222 3333 4444" className="input" />
              </div>
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">Son kullanma</label>
                <input value={cardExpiry} onChange={(e) => setCardExpiry(e.target.value)} placeholder="12/29" className="input" />
              </div>
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">CVC</label>
                <input value={cardCvc} onChange={(e) => setCardCvc(e.target.value)} placeholder="123" className="input" />
              </div>
            </div>
          ) : null}

          {error ? <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[0.8rem] text-red-200">{error}</div> : null}
          {message ? <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[0.8rem] text-emerald-200">{message}</div> : null}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md border border-slate-700 px-3 py-2 text-[0.75rem] text-slate-200 hover:border-slate-500">
              Vazgeç
            </button>
            <button type="button" disabled={saving || !paymentMethod} onClick={onConfirm} className="rounded-md bg-emerald-500 text-slate-950 px-4 py-2 text-[0.8rem] font-semibold hover:bg-emerald-400 disabled:opacity-60">
              {saving ? "İşleniyor..." : "Rezervasyonu tamamla"}
            </button>
          </div>
        </div>
      </div>

      {threeDSOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/70">
          <div className="bg-slate-950/95 rounded-2xl border border-slate-800 p-5 w-full max-w-md text-xs space-y-3 shadow-xl shadow-slate-950/60">
            <h2 className="text-sm font-semibold text-slate-100 mb-1">3D Secure doğrulama</h2>
            <p className="text-[0.75rem] text-slate-300">Simülasyon. Onayladığında ödeme başarılı sayılır ve rezervasyon oluşur.</p>
            <p className="text-[0.75rem] text-slate-200">{money(offer.totalPrice, offer.currency)} ödemeyi onaylıyor musun?</p>
            <div className="flex justify-end gap-2 mt-2">
              <button type="button" onClick={() => setThreeDSOpen(false)} className="rounded-md border border-slate-700 px-3 py-2 text-[0.75rem] text-slate-200 hover:border-slate-500">
                İptal
              </button>
              <button type="button" disabled={saving} onClick={() => createBooking("card3d")} className="rounded-md bg-emerald-500 text-slate-950 px-3 py-2 text-[0.75rem] font-semibold hover:bg-emerald-400 disabled:opacity-60">
                Ödemeyi onayla
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

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
  // ✅ Firestore’daki tam doküman burada
  const raw: any = (req?.raw && typeof req.raw === "object") ? req.raw : req;

  const deadlineMin = safeNum(raw?.responseDeadlineMinutes ?? req?.responseDeadlineMinutes, 180);
  const rem = formatRemainingPkg(raw?.createdAt ?? req?.createdAt, deadlineMin, nowMs);

  const st: ("open" | "expired" | "accepted" | "deleted") =
    String(raw?.status || req?.status || "open") === "accepted" ? "accepted" :
    String(raw?.status || req?.status || "open") === "deleted" ? "deleted" :
    rem.expired ? "expired" : "open";

  const barColor = rem.color === "red" ? "bg-red-500" : rem.color === "yellow" ? "bg-amber-400" : "bg-emerald-500";

  // ✅ pretty JSON (timestamp’ları bozmadan)
  const prettyJson = useMemo(() => {
    try {
      return JSON.stringify(raw, (_k, v) => {
        // Timestamp ise toDate dene
        if (v && typeof v === "object" && typeof (v as any).toDate === "function") {
          return (v as any).toDate().toISOString();
        }
        return v;
      }, 2);
    } catch {
      return String(raw);
    }
  }, [raw]);

  // ✅ Tüm alanları otomatik “kart” olarak yazdırır
  function renderValue(v: any) {
    if (v === null || v === undefined) return "—";
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
    if (Array.isArray(v)) {
      if (v.length === 0) return "—";
      // basit dizi
      if (v.every((x) => typeof x === "string" || typeof x === "number" || typeof x === "boolean")) {
        return v.join(" • ");
      }
      // karma dizi
      return v.map((x, i) => `${i + 1}) ${typeof x === "object" ? JSON.stringify(x) : String(x)}`).join("\n");
    }
    // obje
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  }

  const topPairs: { k: string; v: any }[] = [
    { k: "Başlık", v: raw?.title },
    { k: "Şehir", v: raw?.city },
    { k: "İlçe", v: raw?.district },
    { k: "Tarih", v: `${safeStr(raw?.dateFrom)} – ${safeStr(raw?.dateTo)}` },
    { k: "Gece", v: raw?.nights ?? raw?.hotelNights ?? raw?.days },
    { k: "Kişi", v: `${safeNum(raw?.paxAdults, 0)} yetişkin • ${safeNum(raw?.paxChildren, 0)} çocuk` },
    { k: "Çocuk yaşları", v: raw?.childrenAges },
    { k: "Bütçe", v: `${safeStr(raw?.budgetMin)} – ${safeStr(raw?.budgetMax)} ${safeStr(raw?.currency, "TRY")}` },
    { k: "Board", v: raw?.boardPref },
    { k: "Otel pref", v: raw?.hotelPref },
    { k: "Oda pref", v: raw?.roomTypePref },
    { k: "Transfer", v: `${raw?.wantsTransfer ? "Var" : "Yok"} • ${safeStr(raw?.transferType)}` },
    { k: "Transfer Notu", v: raw?.transferNotes },
    { k: "Uçuş Notu", v: raw?.flightNotes },
    { k: "Araç", v: `${raw?.wantCar || raw?.wantsCar ? "Var" : "Yok"} • ${safeStr(raw?.vehicleClass)}` },
    { k: "Araç koltuk", v: raw?.carSeats },
    { k: "Sürücü sayısı", v: raw?.driverCount },
    { k: "Notlar", v: raw?.notes ?? raw?.note },
    { k: "Aktiviteler", v: raw?.activities },
    { k: "Quality Score", v: raw?.qualityScore },
    { k: "Rental Extras", v: raw?.rentalExtras },
    { k: "Contact", v: raw?.contact },
    { k: "Alternatif şehirler", v: raw?.cities }
  ].filter((x) => x.v !== undefined);

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/70">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative mt-10 w-full max-w-5xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-2xl max-h-[85vh] overflow-y-auto space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-[0.7rem] text-indigo-200">
                🧳 Paket Detayı & Teklifler
              </span>
              <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[0.7rem] ${badgeByPkgStatus(st as any)}`}>
                {st === "open" ? "Açık" : st === "expired" ? "Süre doldu" : st === "accepted" ? "Kabul edildi" : "Silindi"}
              </span>
              <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[0.7rem] text-slate-200">
                Teklif: <b className="ml-1 text-white">{offers.length}</b>
              </span>
            </div>

            <h2 className="text-base font-semibold text-slate-100">{safeStr(raw?.title || "Paket talebi")}</h2>
            <p className="text-[0.8rem] text-slate-300">
              {safeStr(raw?.city)}{raw?.district ? ` / ${raw.district}` : ""} • {safeStr(raw?.dateFrom)} – {safeStr(raw?.dateTo)}
            </p>

            <div className="mt-2 w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
              <div className={`h-full ${barColor}`} style={{ width: `${Math.round(rem.ratio * 100)}%` }} />
            </div>
            <p className={`text-[0.75rem] font-semibold ${rem.color === "red" ? "text-red-300" : rem.color === "yellow" ? "text-amber-200" : "text-emerald-200"}`}>
              {rem.text}
            </p>
          </div>

          <div className="flex flex-wrap gap-2 justify-end">
            {st !== "accepted" ? (
              <>
                {st === "expired" && (
                  <button onClick={onRestart} className="rounded-md border border-emerald-500/70 px-3 py-2 text-[0.75rem] text-emerald-200 hover:bg-emerald-500/10">
                    Yeniden başlat
                  </button>
                )}
                <button onClick={onEdit} className="rounded-md border border-sky-500/70 px-3 py-2 text-[0.75rem] text-sky-200 hover:bg-sky-500/10">
                  Düzenle
                </button>
                <button onClick={onDelete} className="rounded-md border border-red-500/70 px-3 py-2 text-[0.75rem] text-red-200 hover:bg-red-500/10">
                  Sil
                </button>
              </>
            ) : null}

            <button onClick={onClose} className="rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-[0.75rem] text-slate-200 hover:border-emerald-400">
              Kapat ✕
            </button>
          </div>
        </div>

        {/* ✅ Firestore’daki TÜM bilgiler (otomatik) */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-100">Talep Detayı (DB’de kayıtlı tüm bilgiler)</p>
            <button
              type="button"
              onClick={() => {
                try {
                  navigator.clipboard.writeText(prettyJson);
                  alert("Talep detayları panoya kopyalandı.");
                } catch {}
              }}
              className="rounded-md border border-slate-700 px-3 py-2 text-[0.75rem] text-slate-200 hover:border-slate-500"
            >
              Kopyala
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {topPairs.map((it) => (
              <div key={it.k} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-[0.72rem] text-slate-400">{it.k}</p>
                <pre className="text-slate-100 text-sm mt-1 whitespace-pre-wrap">{renderValue(it.v)}</pre>
              </div>
            ))}
          </div>

          <details className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
            <summary className="cursor-pointer text-[0.8rem] text-slate-200 font-semibold">Tüm alanları aç (JSON)</summary>
            <pre className="mt-3 whitespace-pre-wrap text-[0.72rem] text-slate-300 overflow-x-auto">{prettyJson}</pre>
          </details>

          <p className="text-[0.7rem] text-slate-500">
            Bu bölüm Firestore dokümanının tamamını gösterir. Artık hiçbir bilgi boş kalmaz.
          </p>
        </div>

        {/* ✅ Teklifler */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-100">Gelen Paket Teklifleri</p>
            <p className="text-[0.75rem] text-slate-400">Her teklifi yapan acentanın işletme bilgileri görünür.</p>
          </div>

          {offers.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-slate-300">
              Henüz paket teklifi yok.
            </div>
          ) : (
            <div className="grid gap-3">
              {offers.map((o) => {
                const agency = agenciesMap[o.agencyId];
                const ap = agency?.agencyProfile ?? null;
                const b = o.breakdown ?? {};
                const d = o.packageDetails ?? {};
                const updatedStr = o.updatedAt?.toDate ? o.updatedAt.toDate().toLocaleString("tr-TR") : "";
                const createdStr = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString("tr-TR") : "";

                const disabled = st === "expired" || o.status === "accepted" || st === "accepted";

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
                            {ap?.city ? ` • ${ap.city}${ap?.district ? " / " + ap.district : ""}` : ""}
                          </p>
                          <div className="text-[0.75rem] text-slate-300">
                            Tel: {safeStr(ap?.phone)} {ap?.taxNo ? ` • Vergi No: ${ap.taxNo}` : ""}
                          </div>
                          {ap?.address ? <div className="text-[0.75rem] text-slate-400 mt-1">Adres: {ap.address}</div> : null}
                          {ap?.about ? <div className="text-[0.75rem] text-slate-400 mt-1">Açıklama: {ap.about}</div> : null}
                        </div>

                        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                          <p className="text-[0.75rem] text-slate-400 mb-1">Teklif planı</p>
                          <p className="text-[0.8rem] text-slate-200">
                            Otel: <b>{safeStr(d.hotelName)}</b> • Oda: <b>{safeStr(d.roomType)}</b> • Board: <b>{safeStr(d.boardType)}</b>
                          </p>
                          <p className="text-[0.75rem] text-slate-300">
                            Transfer: <b>{safeStr(d.transferType || d.transferPlan)}</b>
                          </p>
                          {Array.isArray(d.tourPlan) && d.tourPlan.length > 0 ? (
                            <p className="text-[0.75rem] text-slate-300">Tur planı: <span className="text-slate-200">{d.tourPlan.join(" • ")}</span></p>
                          ) : null}
                          {o.note ? <p className="text-[0.75rem] text-slate-300">Not: <span className="text-slate-200">{o.note}</span></p> : null}
                        </div>
                      </div>

                      <div className="space-y-3 min-w-[280px]">
                        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-right">
                          <p className="text-[0.7rem] text-slate-400">Toplam</p>
                          <p className="text-lg font-extrabold text-emerald-200">{money(o.totalPrice, o.currency)}</p>
                          <p className="text-[0.7rem] text-slate-400">Para birimi: <b className="text-slate-200">{o.currency}</b></p>
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
                          className="w-full rounded-md bg-emerald-500 text-slate-950 px-4 py-2 text-[0.85rem] font-semibold hover:bg-emerald-400 disabled:opacity-60"
                        >
                          {disabled ? "Kabul edildi / Kapalı" : "Teklifi kabul et → Ödeme"}
                        </button>

                        {st === "expired" ? (
                          <p className="text-[0.75rem] text-amber-200">Süre doldu. Yeniden başlatmadan kabul edemezsin.</p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}


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
            <button onClick={onClose} className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-[0.75rem] text-slate-200 hover:bg-white/10">
              Kapat ✕
            </button>
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
            <p className="text-[0.75rem] text-slate-300">
              Ödeme yöntemi seç. Kabul + ödeme sonrası iletişim bilgilerin acentaya görünür ve rezervasyon açılır.
            </p>

            {allowTransfer && (
              <label className="flex items-start gap-2">
                <input type="radio" checked={method === "transfer"} onChange={() => setMethod("transfer")} className="mt-1 h-4 w-4" />
                <div>
                  <p className="text-slate-100 font-semibold text-sm">🏦 Havale / EFT</p>
                  <p className="text-[0.72rem] text-slate-400">“transfer_pending” statüsü açılır.</p>
                </div>
              </label>
            )}

            {allowCard3d && (
              <label className="flex items-start gap-2">
                <input type="radio" checked={method === "card3d"} onChange={() => setMethod("card3d")} className="mt-1 h-4 w-4" />
                <div>
                  <p className="text-slate-100 font-semibold text-sm">💳 3D Secure</p>
                  <p className="text-[0.72rem] text-slate-400">Ödeme “paid” olur (simülasyon).</p>
                </div>
              </label>
            )}

            {allowDoor && (
              <label className="flex items-start gap-2">
                <input type="radio" checked={method === "payAtDoor"} onChange={() => setMethod("payAtDoor")} className="mt-1 h-4 w-4" />
                <div>
                  <p className="text-slate-100 font-semibold text-sm">🚪 Kapıda ödeme</p>
                  <p className="text-[0.72rem] text-slate-400">Ödeme “pay_at_door” statüsü açılır.</p>
                </div>
              </label>
            )}
          </div>

          {error ? <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[0.8rem] text-red-200">{error}</div> : null}
          {message ? <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[0.8rem] text-emerald-200">{message}</div> : null}

          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-[0.8rem] text-slate-200 hover:bg-white/10">
              Vazgeç
            </button>
            <button disabled={saving} onClick={onConfirm} className="rounded-md bg-emerald-500 text-slate-950 px-4 py-2 text-[0.85rem] font-semibold hover:bg-emerald-400 disabled:opacity-60">
              {saving ? "İşleniyor..." : "Ödemeye ilerle → Rezervasyonu oluştur"}
            </button>
          </div>
        </div>
      </div>

      {threeDSOpen && (
        <div className="fixed inset-0 z-[99] flex items-center justify-center bg-black/70">
          <div className="bg-slate-950/95 rounded-2xl border border-slate-800 p-5 w-full max-w-md text-xs space-y-3 shadow-xl shadow-slate-950/60">
            <h2 className="text-sm font-semibold text-slate-100 mb-1">3D Secure doğrulama</h2>
            <p className="text-[0.75rem] text-slate-300">Simülasyon. Onayladığında paket rezervasyonu oluşturulur.</p>
            <p className="text-[0.75rem] text-slate-200">{money(offer.totalPrice, offer.currency)} ödemeyi onaylıyor musun?</p>
            <div className="flex justify-end gap-2 mt-2">
              <button onClick={() => setThreeDSOpen(false)} className="rounded-md border border-slate-700 px-3 py-2 text-[0.75rem] text-slate-200 hover:border-slate-500">
                İptal
              </button>
              <button onClick={on3DConfirm} className="rounded-md bg-emerald-500 text-slate-950 px-3 py-2 text-[0.75rem] font-semibold hover:bg-emerald-400">
                Ödemeyi onayla
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function KeyVal({ k, v }: { k: string; v: any }) {
  const val = v === null || v === undefined || String(v).trim() === "" ? "—" : String(v);
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <p className="text-[0.72rem] text-slate-400">{k}</p>
      <p className="text-slate-100 text-sm mt-1 whitespace-pre-wrap">{val}</p>
    </div>
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
