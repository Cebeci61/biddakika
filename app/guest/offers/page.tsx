// app/guest/offers/page.tsx
"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
  FormEvent,
  ReactNode
} from "react";
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
  addDoc
} from "firebase/firestore";
import { arrayUnion,} from "firebase/firestore";

type PriceHistoryItem = {
  actor: "hotel" | "guest";
  kind: "initial" | "counter" | "update";
  price: number;
  note?: string | null;
  createdAt: any; // serverTimestamp
};

async function pushOfferPriceHistory(db: any, offerId: string, item: Omit<PriceHistoryItem, "createdAt">) {
  const ref = doc(db, "offers", offerId);
  await updateDoc(ref, {
    // geçmiş kaydı EKLE (asla overwrite etme)
    priceHistory: arrayUnion({
      ...item,
      createdAt: serverTimestamp()
    })
  });
}

/* ------------------------------------------------
   Tipler
------------------------------------------------- */

type OfferMode = "simple" | "refreshable" | "negotiable";
type PaymentMethod = "card3d" | "payAtHotel";
type CancellationPolicyType =
  | "non_refundable"
  | "flexible"
  | "until_days_before";

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

  // 🔽 Otel / grup talebi sayfasında doldurulan ekstra alanlar
  type?: string;                // 'standard' | 'group' vb.
  isGroup?: boolean;

  hotelType?: string | null;    // tesis türü: Otel, Apart, Pansiyon...
  mealPlan?: string | null;     // yeme-içme tipi
  starRatingPref?: number | null; // tercih ettiği yıldız (tek seçimli senaryoda)

  boardTypes?: string[];        // konaklama tipleri (RO, BB, HB, ...)
  boardTypeNote?: string | null;

  hotelFeaturePrefs?: string[]; // seçili otel özellikleri
  hotelFeatureNote?: string | null;

  desiredStarRatings?: number[] | null; // birden fazla yıldız tercihi varsa
  generalNote?: string | null;          // misafirin genel notu
  nearMe?: boolean | null;              // yakınımda ara işareti
}


interface RoomTypeProfile {
  id: string;
  name: string;
  shortDescription?: string;
  description?: string;
  maxAdults?: number | null;
  maxChildren?: number | null;
  imageUrls?: string[];
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

  // lokasyon
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
   Yardımcı sabitler
------------------------------------------------- */

const MODE_LABEL_PUBLIC: Record<OfferMode, string> = {
  simple: "Standart teklif",
  refreshable: "Yenilenebilir teklif",
  negotiable: "Pazarlıklı teklif"
};

const BOARD_LABEL: Record<string, string> = {
  RO: "Sadece oda (RO)",
  BB: "Oda + Kahvaltı (BB)",
  HB: "Yarım pansiyon (HB)",
  FB: "Tam pansiyon (FB)",
  AI: "Her şey dahil (AI)",
  UAI: "Ultra her şey dahil (UAI)"
};

const FEATURE_LABEL: Record<string, string> = {
  pool: "Havuz",
  spa: "Spa / Wellness",
  parking: "Otopark",
  wifi: "Ücretsiz Wi-Fi",
  seaView: "Deniz manzarası",
  balcony: "Balkon",
  family: "Aile odaları",
  petFriendly: "Evcil hayvan kabul edilir"
};

/* ------------------------------------------------
   Yardımcı fonksiyonlar
------------------------------------------------- */

function roomTypeLabel(type?: string) {
  switch (type) {
    case "standard":
      return "Standart oda";
    case "family":
      return "Aile odası";
    case "suite":
      return "Suit oda";
    case "deluxe":
      return "Deluxe oda";
    default:
      return "Fark etmez";
  }
}

function computeRequestStatus(
  req: RequestSummary,
  hasAcceptedOffer: boolean
) {
  if (hasAcceptedOffer) return "accepted" as const;
  const created = req.createdAt?.toDate().getTime();
  const minutes = req.responseDeadlineMinutes ?? 0;
  if (!created || !minutes) return "open" as const;
  const deadlineMs = created + minutes * 60 * 1000;
  const now = Date.now();
  return now > deadlineMs ? "expired" as const : ("open" as const);
}
// Basit tarih yardımcıları (gece sayısı hesaplamak için)
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
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function formatRemaining(
  req: RequestSummary,
  nowMs?: number
): { text: string; color: "green" | "yellow" | "red" } {
  const created = req.createdAt?.toDate().getTime();
  const minutes = req.responseDeadlineMinutes ?? 0;
  if (!created || !minutes) return { text: "-", color: "green" };

  const deadlineMs = created + minutes * 60 * 1000;
  const diff = deadlineMs - (nowMs ?? Date.now());

  if (diff <= 0) return { text: "Süre doldu", color: "red" };

  const totalSec = Math.floor(diff / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const text = `${hours} sa ${mins} dk ${secs} sn`;

  let color: "green" | "yellow" | "red" = "green";
  if (diff < 15 * 60 * 1000) color = "red";
  else if (diff < 60 * 60 * 1000) color = "yellow";
  return { text, color };
}

function cancellationLabelFromOffer(
  offer: Pick<
    GuestOffer,
    "cancellationPolicyType" | "cancellationPolicyDays"
  >,
  hp?: HotelProfile
): string | null {
  const type: CancellationPolicyType | undefined =
    offer.cancellationPolicyType ?? hp?.cancellationPolicyType;
  const days = offer.cancellationPolicyDays ?? hp?.cancellationPolicyDays;
  if (!type && hp?.cancellationPolicyLabel) return hp.cancellationPolicyLabel;
  if (!type) return null;

  if (type === "non_refundable") {
    return "Bu rezervasyon iptal edilemez, ücret iadesi yapılmaz.";
  }
  if (type === "flexible") {
    return "Giriş tarihine kadar ücretsiz iptal hakkın vardır.";
  }
  if (type === "until_days_before") {
    const d = days ?? 3;
    return `Giriş tarihinden ${d} gün öncesine kadar ücretsiz iptal hakkın vardır. Sonrasında iptal edilemez.`;
  }
  return null;
}

// basit notification helper (isteğe bağlı)
async function createNotification(
  db: ReturnType<typeof getFirestoreDb>,
  to: string | null | undefined,
  payload: any
) {
  if (!to) return;
  try {
    await addDoc(collection(db, "notifications"), {
      to,
      ...payload,
      createdAt: serverTimestamp(),
      read: false
    });
  } catch (e) {
    console.error("createNotification error:", e);
  }
}

/* ------------------------------------------------
   ANA BİLEŞEN – GuestOffersPage
------------------------------------------------- */

export default function GuestOffersPage() {
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();
  const db = getFirestoreDb();
  

  const [offers, setOffers] = useState<GuestOffer[]>([]);
  const [requestsMap, setRequestsMap] = useState<
    Record<string, RequestSummary>
  >({});
  const [hotelsMap, setHotelsMap] = useState<Record<string, HotelInfo>>({});
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState<
    "all" | "sent" | "rejected"
  >("all");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  // detay / pazarlık / ödeme state’leri
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsOffer, setDetailsOffer] = useState<GuestOffer | null>(
    null
  );
  const [packageRequests, setPackageRequests] = useState<any[]>([]);


  const [counterEditId, setCounterEditId] = useState<string | null>(
    null
  );
  const [counterPrice, setCounterPrice] = useState<string>("");

  const [actionMessage, setActionMessage] = useState<string | null>(
    null
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [savingAction, setSavingAction] = useState(false);

  const [selectedForPaymentId, setSelectedForPaymentId] =
    useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentOffer, setPaymentOffer] =
    useState<GuestOffer | null>(null);
  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethod | null>(null);
  const [savingPayment, setSavingPayment] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState<string | null>(
    null
  );
  const [paymentError, setPaymentError] = useState<string | null>(
    null
  );
  const [threeDSOpen, setThreeDSOpen] = useState(false);
  const [cardName, setCardName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvc, setCardCvc] = useState("");
// Talebi yeniden başlat: createdAt'i şimdiye çeker, status'u "open" yapar
async function handleRestartRequest(req: RequestSummary) {
  try {
    const ref = doc(db, "requests", req.id);
    await updateDoc(ref, {
      createdAt: serverTimestamp(),
      status: "open",
    });

    // lokal state'i güncelle
    setRequestsMap((prev) => {
      const copy = { ...prev };
      const current = copy[req.id];
      if (current) {
        copy[req.id] = {
          ...current,
          createdAt: Timestamp.fromDate(new Date()),
          status: "open",
        };
      }
      return copy;
    });

    setActionMessage("Talebin yeniden başlatıldı. Oteller yeniden teklif verebilecek.");
  } catch (err) {
    console.error("Talep yeniden başlatılırken hata:", err);
    setActionError("Talep yeniden başlatılırken bir hata oluştu. Lütfen tekrar dene.");
  }
}

// Talebi düzenle: Otel talebi formuna yönlendir (requestId ile)
function handleEditRequest(req: RequestSummary) {
  // Otel talebi sayfan, bu query paramı okuyup formu doldurmalı:
  // /guest/requests/new?requestId=...
  router.push(`/guest/requests/new?requestId=${req.id}`);
}

// Talebi sil: status'u "deleted" yap ve local state'ten çıkar
async function handleDeleteRequest(req: RequestSummary) {
  if (typeof window !== "undefined") {
    const ok = window.confirm("Bu talebi silmek istediğine emin misin?");
    if (!ok) return;
  }

  try {
    const ref = doc(db, "requests", req.id);
    await updateDoc(ref, {
      status: "deleted",
      deletedAt: serverTimestamp(),
    });

    // map'ten tamamen çıkaralım
    setRequestsMap((prev) => {
      const copy: Record<string, RequestSummary> = { ...prev };
      delete copy[req.id];
      return copy;
    });

    setActionMessage("Talebin silindi.");
  } catch (err) {
    console.error("Talep silinirken hata:", err);
    setActionError("Talep silinirken bir hata oluştu. Lütfen tekrar dene.");
  }
}

  // geri sayım için
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  /* ----------------- VERİ YÜKLEME ----------------- */

  useEffect(() => {
    async function load() {
      if (authLoading) return;
      if (!profile) {
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        // 1) Bu misafirin tüm talepleri
        const qReq = query(
          collection(db, "requests"),
          where("guestId", "==", profile.uid)
        );
        const snapReq = await getDocs(qReq);

     const requests: RequestSummary[] = snapReq.docs.map((d) => {
  const v = d.data() as any;
  return {
    id: d.id,
    city: v.city,
    district: v.district ?? null,
    checkIn: v.checkIn,
    checkOut: v.checkOut,
    adults: v.adults,
    childrenCount: v.childrenCount ?? 0,
    roomsCount: v.roomsCount ?? 1,
    roomTypes: v.roomTypes ?? [],
    responseDeadlineMinutes: v.responseDeadlineMinutes ?? 60,
    createdAt: v.createdAt,
    status: v.status ?? "open",

    // 🔽 yeni alanlar – isimleri kendi request kaydına göre ayarla
    type: v.type,
    isGroup: v.isGroup ?? false,

    hotelType: v.hotelType ?? null,
    mealPlan: v.mealPlan ?? null,
    starRatingPref: v.starRatingPref ?? null,

    boardTypes: v.boardTypes ?? [],
    boardTypeNote: v.boardTypeNote ?? null,

    hotelFeaturePrefs: v.hotelFeaturePrefs ?? [],
    hotelFeatureNote: v.hotelFeatureNote ?? null,

    desiredStarRatings: v.desiredStarRatings ?? null,
    generalNote: v.generalNote ?? v.note ?? null,
    nearMe: v.nearMe ?? null,
  } as RequestSummary;
});


        const requestIds = requests.map((r) => r.id);
        const reqMap: Record<string, RequestSummary> = {};
        for (const r of requests) reqMap[r.id] = r;

        // 2) Bu taleplere gelen tüm teklifler
        const snapOffers = await getDocs(collection(db, "offers"));
        let guestOffers: GuestOffer[] = snapOffers.docs
          .map((d) => {
            const v = d.data() as any;
            return {
              id: d.id,
              requestId: v.requestId,
              hotelId: v.hotelId,
              hotelName: v.hotelName ?? null,
              totalPrice: v.totalPrice,
              currency: v.currency,
              mode: v.mode as OfferMode,
              note: v.note ?? null,
              status: v.status ?? "sent",
              guestCounterPrice: v.guestCounterPrice ?? null,
              createdAt: v.createdAt,
              roomTypeId: v.roomTypeId ?? null,
              roomTypeName: v.roomTypeName ?? null,
              roomBreakdown: v.roomBreakdown ?? [],
              cancellationPolicyType:
                v.cancellationPolicyType as CancellationPolicyType | undefined,
              cancellationPolicyDays: v.cancellationPolicyDays ?? null
            } as GuestOffer;
          })
          .filter((o) => requestIds.includes(o.requestId));

        guestOffers = guestOffers.sort((a, b) => {
          const ta = a.createdAt?.toMillis() ?? 0;
          const tb = b.createdAt?.toMillis() ?? 0;
          return tb - ta;
        });

        // 3) Otel profilleri
        const hotelIds = Array.from(
          new Set(guestOffers.map((o) => o.hotelId))
        );
        const hotelMap: Record<string, HotelInfo> = {};
        await Promise.all(
          hotelIds.map(async (hid) => {
            try {
              const snap = await getDoc(doc(db, "users", hid));
              if (!snap.exists()) return;
              const data = snap.data() as any;
              hotelMap[hid] = {
                id: hid,
                displayName: data.displayName,
                email: data.email,
                website: data.website || data.hotelProfile?.website || "",
                hotelProfile: data.hotelProfile as
                  | HotelProfile
                  | undefined
              };
            } catch (err) {
              console.error("Otel profili okunurken hata:", err);
            }
          })
        );
        // ✅ Misafirin paket talepleri (packageRequests)
try {
  const snapPkg = await getDocs(
    query(
      collection(db, "packageRequests"),
      where("createdByRole", "==", "guest"),
      where("createdById", "==", profile.uid)
    )
  );

  const pkg = snapPkg.docs.map((d) => {
    const v = d.data() as any;
    return {
      id: d.id,
      title: v.title ?? null,
      city: v.city ?? "",
      district: v.district ?? null,
      dateFrom: v.dateFrom ?? "",
      dateTo: v.dateTo ?? "",
      paxAdults: Number(v.paxAdults ?? 0),
      paxChildren: Number(v.paxChildren ?? 0),
      status: v.status ?? "open",
      createdAt: v.createdAt
    };
  });

  setPackageRequests(pkg);
} catch (e) {
  console.error("packageRequests okunamadı:", e);
}


        setRequestsMap(reqMap);
        setHotelsMap(hotelMap);
        setOffers(guestOffers);
      } catch (err) {
        console.error("Gelen teklifler yüklenirken hata:", err);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [authLoading, profile, db]);

  /* ----------------- FİLTRELER / GRUPLAMA ----------------- */

// Teklif filtresi (durum + tarih)
const filteredOffers = useMemo(
  () =>
    offers.filter((o) => {
      // kabul edilmiş teklifler bu sayfada görünmesin (rezervasyonlara gitti)
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
    }),
  [offers, statusFilter, fromDate, toDate]
);


  const acceptedRequestIds = useMemo(() => {
    const set = new Set<string>();
    offers.forEach((o) => {
      if (o.status === "accepted") set.add(o.requestId);
    });
    return set;
  }, [offers]);

  const groupedByRequest = useMemo(() => {
    const blocks: {
      request: RequestSummary;
      offers: GuestOffer[];
      status: "open" | "expired" | "accepted";
      remaining: { text: string; color: "green" | "yellow" | "red" };
    }[] = [];

const allRequests = Object.values(requestsMap).filter(
  (r) => r.status !== "deleted"   // 👈 Silinmiş talep gelmesin
);

    allRequests.forEach((req) => {
      const offersForReq = filteredOffers.filter(
        (o) => o.requestId === req.id
      );
      const hasAccepted = acceptedRequestIds.has(req.id);
      const reqStatus = computeRequestStatus(req, hasAccepted);
      if (reqStatus === "accepted") return;

      const remaining = formatRemaining(req, now);
      blocks.push({
        request: req,
        offers: offersForReq,
        status: reqStatus,
        remaining
      });
    });

    return blocks.sort((a, b) => {
      const ta = a.request.createdAt?.toMillis() ?? 0;
      const tb = b.request.createdAt?.toMillis() ?? 0;
      return tb - ta;
    });
  }, [filteredOffers, requestsMap, acceptedRequestIds, now]);

  /* ----------------- Aksiyonlar ----------------- */

  function openDetails(o: GuestOffer) {
    setDetailsOffer(o);
    setDetailsOpen(true);
  }

  function closeDetails() {
    setDetailsOpen(false);
    setDetailsOffer(null);
  }

  function statusLabel(status: string) {
    switch (status) {
      case "accepted":
        return "Rezervasyona dönüştü";
      case "rejected":
        return "Reddettin";
      case "countered":
        return "Karşı teklif gönderdin";
      case "sent":
      default:
        return "Otel teklif gönderdi";
    }
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

  async function handleCounterSubmit(
    e: FormEvent<HTMLFormElement>,
    offer: GuestOffer
  ) {
    e.preventDefault();
    if (!canCounter(offer)) return;

    const value = Number(counterPrice);
    if (isNaN(value) || value <= 0) {
      setActionError("Lütfen geçerli bir karşı teklif girin.");
      return;
    }

    try {
      setSavingAction(true);
      const ref = doc(db, "offers", offer.id);
      await updateDoc(ref, {
        guestCounterPrice: value,
        status: "countered",
        guestCounterAt: serverTimestamp()
      });

      setOffers((prev) =>
        prev.map((o) =>
          o.id === offer.id
            ? { ...o, guestCounterPrice: value, status: "countered" }
            : o
        )
      );

      setActionMessage(
        "Karşı teklifin otelle paylaşıldı. Otel yeni fiyata göre karar verecek."
      );

      // otele bildirim
      await createNotification(db, offer.hotelId, {
        type: "guestCounter",
        offerId: offer.id,
        requestId: offer.requestId,
        amount: value
      });

      setCounterEditId(null);
      setCounterPrice("");
    } catch (err) {
      console.error("Karşı teklif gönderilirken hata:", err);
      setActionError("Karşı teklif gönderilirken bir hata oluştu.");
    } finally {
      setSavingAction(false);
    }
  }

  function handleSelectForPayment(offer: GuestOffer) {
    setSelectedForPaymentId(offer.id);
    setActionError(null);
    setActionMessage(
      "Bu teklifi seçtin. Ödemeye ilerleyerek rezervasyon oluşturabilirsin."
    );
  }

  function handleCancelSelection() {
    setSelectedForPaymentId(null);
  }

  function handleOpenPaymentModal(offer: GuestOffer) {
    const hotel = hotelsMap[offer.hotelId];
    const po = hotel?.hotelProfile?.paymentOptions;

    const availableMethods: PaymentMethod[] = po
      ? ([
          po.card3d && "card3d",
          po.payAtHotel && "payAtHotel"
        ].filter(Boolean) as PaymentMethod[])
      : (["card3d", "payAtHotel"] as PaymentMethod[]);

    const finalMethods =
      availableMethods.length > 0
        ? availableMethods
        : (["card3d", "payAtHotel"] as PaymentMethod[]);

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
        offerId: offer.id,
        requestId: req?.id ?? offer.requestId,
        guestId: profile.uid,
        hotelId: hotel?.id ?? offer.hotelId,
        hotelName: hotel?.displayName || offer.hotelName || null,
        city: req?.city ?? null,
        district: req?.district ?? null,
        checkIn: req?.checkIn ?? null,
        checkOut: req?.checkOut ?? null,
        adults: req?.adults ?? null,
        childrenCount: req?.childrenCount ?? null,
        roomsCount: req?.roomsCount ?? null,
        totalPrice: offer.totalPrice,
        currency: offer.currency,
        paymentMethod: finalPaymentMethod,
        paymentStatus:
          finalPaymentMethod === "card3d" ? "paid" : "payAtHotel",
        createdAt: serverTimestamp(),
        status: "active",
        guestName:
          profile.displayName ||
          (req as any)?.guestName ||
          (req as any)?.contactName ||
          null,
        guestEmail: profile.email || (req as any)?.guestEmail || null,
        guestPhone: (req as any)?.guestPhone || null,
        roomBreakdown: offer.roomBreakdown ?? null,
        cancellationPolicyType: offer.cancellationPolicyType ?? null,
        cancellationPolicyDays: offer.cancellationPolicyDays ?? null
      });

      await updateDoc(doc(db, "offers", offer.id), {
        status: "accepted",
        acceptedAt: serverTimestamp(),
        bookingId: bookingRef.id
      });

      // Bildirimler
      await createNotification(db, profile.uid, {
        type: "bookingCreated",
        bookingId: bookingRef.id,
        offerId: offer.id
      });
      await createNotification(db, hotel?.id, {
        type: "bookingCreated",
        bookingId: bookingRef.id,
        offerId: offer.id
      });

      setPaymentMessage(
        "Rezervasyonun oluşturuldu. Rezervasyonlarım sayfasından detaylara bakabilirsin."
      );
      setSelectedForPaymentId(null);

      setTimeout(() => {
        handleClosePaymentModal();
        router.push("/guest/bookings");
      }, 1300);
    } catch (err) {
      console.error("Rezervasyon oluşturulurken hata:", err);
      setPaymentError(
        "Rezervasyon oluşturulurken bir hata oluştu. Lütfen tekrar dene."
      );
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

    if (paymentMethod === "payAtHotel") {
      await createBooking("payAtHotel");
    }
  }

  async function handleReject(offer: GuestOffer) {
    setActionError(null);
    setActionMessage(null);

    if (typeof window !== "undefined") {
      const ok = window.confirm(
        "Bu teklifi reddetmek istediğine emin misin?"
      );
      if (!ok) return;
    }

    try {
      setSavingAction(true);
      const ref = doc(db, "offers", offer.id);
      await updateDoc(ref, {
        status: "rejected",
        rejectedAt: serverTimestamp()
      });
      setOffers((prev) =>
        prev.map((o) =>
          o.id === offer.id ? { ...o, status: "rejected" } : o
        )
      );
      setActionMessage("Bu teklifi reddettin.");

      await createNotification(db, offer.hotelId, {
        type: "offerRejected",
        offerId: offer.id,
        requestId: offer.requestId
      });
    } catch (err) {
      console.error("Teklif reddedilirken hata:", err);
      setActionError("Teklif reddedilirken bir hata oluştu.");
    } finally {
      setSavingAction(false);
    }
  }

  /* ----------------- RENDER ----------------- */

  return (
    <Protected allowedRoles={["guest"]}>
      <div className="container-page space-y-6 relative">
        {/* Başlık */}
        <section className="space-y-2">
          <h1 className="text-2xl font-semibold">Gelen teklifler</h1>
          <p className="text-sm text-slate-300 max-w-3xl">
            Açtığın her talep için hangi otellerin teklif
            verdiğini, bu sayfadan talep bazlı olarak görebilirsin.
            Talebin başlığında kalan süre / açık / süresi doldu
            bilgisini; altında o talebe teklif veren otelleri
            görürsün. Beğendiğini önce{" "}
            <strong>Kabul et</strong>, ardından{" "}
            <strong>Ödemeye ilerle</strong> diyerek rezervasyona
            çevir. Rezervasyona dönen talepler bu listeden çıkar ve
            Rezervasyonlarım sayfasına taşınır.
          </p>
        </section>


        {/* Filtre paneli */}
        <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow shadow-slate-950/40 text-xs space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-200">
                Teklif durumu
              </label>
              <select
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(
                    e.target.value as typeof statusFilter
                  )
                }
                className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
              >
                <option value="all">Hepsi</option>
                <option value="sent">Otel teklif gönderdi</option>
                <option value="rejected">Reddettiklerin</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-200">
                Tarih (ilk)
              </label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-200">
                Tarih (son)
              </label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
              />
            </div>
          </div>
        </section>

        {loading && (
          <p className="text-sm text-slate-400">
            Teklifler yükleniyor...
          </p>
        )}

        {!loading && groupedByRequest.length === 0 && (
          <p className="text-sm text-slate-400">
            Henüz bir talebin veya taleplerine gelen teklif yok.
          </p>
        )}
{/* ✅ PAKET TALEPLERİ (misafirin taleplerim listesinde görünür) */}
{packageRequests.length > 0 && (
  <section className="space-y-3">
    {packageRequests
      .slice()
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))
      .map((p) => {
        const pax = (p.paxAdults ?? 0) + (p.paxChildren ?? 0);
        return (
          <div key={p.id} className="rounded-2xl border border-slate-800 bg-slate-950/80 shadow shadow-slate-950/40 text-xs overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-slate-900/90">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-1 text-[0.7rem] text-sky-200">
                    🧳 Paket talebi
                  </span>
                  <span className="text-[0.7rem] text-slate-500">#{p.id}</span>
                </div>

                <p className="text-slate-100 text-sm">
                  {p.title || `${p.city}${p.district ? " / " + p.district : ""} Paket Talebi`}
                </p>

                <p className="text-[0.75rem] text-slate-300">
                  {p.city}{p.district ? ` / ${p.district}` : ""} • {p.dateFrom} – {p.dateTo} • {pax} kişi
                </p>
              </div>

              <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[0.7rem] ${
                p.status === "open"
                  ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/40"
                  : "bg-slate-500/10 text-slate-300 border-slate-500/40"
              }`}>
                {p.status === "open" ? "Açık" : p.status}
              </span>
            </div>
          </div>
        );
      })}
  </section>
)}

        {/* Talep bazlı bloklar */}
        {groupedByRequest.map((block) => {
          const { request: req, offers: reqOffers, status, remaining } =
            block;
          const totalGuests =
            req.adults + (req.childrenCount || 0);

          const roomTypesTextForReq =
            req.roomTypes && req.roomTypes.length > 0
              ? req.roomTypes.map(roomTypeLabel).join(", ")
              : "Fark etmez";

          const statusBadge = (() => {
            if (status === "accepted")
              return {
                label: "Rezervasyona dönüştü",
                className:
                  "bg-emerald-500/10 text-emerald-300 border-emerald-500/40"
              };
            if (status === "expired")
              return {
                label: "Süresi doldu",
                className:
                  "bg-red-500/10 text-red-300 border-red-500/40"
              };
            return {
              label: "Açık",
              className:
                "bg-sky-500/10 text-sky-300 border-sky-500/40"
            };
          })();

          const remainingClass =
            remaining.color === "red"
              ? "text-red-400"
              : remaining.color === "yellow"
              ? "text-amber-300"
              : "text-emerald-300";

          return (
            <section
              key={req.id}
              className={`rounded-2xl border border-slate-800 bg-slate-950/80 shadow shadow-slate-950/40 text-xs overflow-hidden ${
                status === "expired" ? "opacity-60" : ""
              }`}
            >
              {/* Talep başlık satırı */}
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-slate-900/90">
                <div className="space-y-1">
                  <p className="text-slate-100 text-sm">
                    {req.city}
                    {req.district ? ` / ${req.district}` : ""} •{" "}
                    {req.checkIn} – {req.checkOut}
                  </p>
                  <p className="text-[0.75rem] text-slate-300">
                    {totalGuests} kişi • {req.roomsCount || 1} oda
                  </p>
                </div>
                <div className="text-right space-y-1">
                  <p
                    className={`text-[0.75rem] font-semibold ${remainingClass}`}
                  >
                    {remaining.text}
                  </p>
                  <span
                    className={`inline-flex items-center rounded-full border px-3 py-1 text-[0.7rem] ${statusBadge.className}`}
                  >
                    {statusBadge.label}
                  </span>
                </div>
              </div>
{req.type === "package" && (
  <span className="inline-flex items-center gap-1 rounded-full
    bg-indigo-500/10 text-indigo-300 border border-indigo-500/30
    px-2 py-0.5 text-[0.65rem]">
    🧳 Paket talebi
  </span>
)}

              {/* Süresi dolmuş talep özeti */}
             {status === "expired" ? (
  <div className="px-4 py-4 border-t border-slate-800 bg-slate-950/70 text-[0.75rem] text-slate-400 space-y-2">
    <p>Bu talebin süresi doldu. Artık bu talebe yeni teklif verilemez.</p>
    <p>
      Talep detayların: {req.city}
      {req.district ? ` / ${req.district}` : ""} • {req.checkIn} –{" "}
      {req.checkOut} • {totalGuests} kişi • {req.roomsCount || 1} oda
    </p>
    <p>
      İstediğin oda tipleri:{" "}
      <span className="text-slate-300">{roomTypesTextForReq}</span>
    </p>

    {/* 👇 Süresi dolan talep aksiyonları */}
    <div className="flex flex-wrap justify-end gap-2 mt-2">
      <button
        type="button"
        onClick={() => handleRestartRequest(req)}
        className="rounded-md border border-emerald-500/70 px-3 py-1 text-[0.7rem] text-emerald-300 hover:bg-emerald-500/10"
      >
        Talebi yeniden başlat
      </button>
      <button
        type="button"
        onClick={() => handleEditRequest(req)}
        className="rounded-md border border-sky-500/70 px-3 py-1 text-[0.7rem] text-sky-300 hover:bg-sky-500/10"
      >
        Talebi düzenle
      </button>
      <button
        type="button"
        onClick={() => handleDeleteRequest(req)}
        className="rounded-md border border-red-500/70 px-3 py-1 text-[0.7rem] text-red-300 hover:bg-red-500/10"
      >
        Talebi sil
      </button>
    </div>
  </div>
) : (


                <div className="pt-2 pb-3">
                  {reqOffers.length === 0 ? (
                    <div className="px-4 py-4 text-[0.8rem] text-slate-400 border-t border-slate-800">
                      Bu talebe henüz teklif gelmedi. Oteller teklif
                      gönderdikçe burada göreceksin.
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
                        const createdStr = o.createdAt
                          ? o.createdAt
                              .toDate()
                              .toLocaleString()
                          : "";
                        const canCounterFlag = canCounter(o);
                        const isSelected =
                          selectedForPaymentId === o.id;

                        return (
                          <div
                            key={o.id}
                            className="border-t border-slate-800"
                          >
                            <div className="grid md:grid-cols-[1.6fr_1.1fr_1.1fr_1.2fr_auto] gap-2 px-4 py-3 items-center">
                              {/* Otel */}
                              <div className="space-y-1 text-slate-100">
                                <div className="md:hidden text-[0.7rem] text-slate-400">
                                  Otel
                                </div>
                                <div className="font-semibold text-sm">
                                  {o.hotelName || "Otel"}
                                </div>
                              </div>

                              {/* Fiyat */}
                              <div className="text-slate-100">
                                <div className="md:hidden text-[0.7rem] text-slate-400">
                                  Toplam fiyat
                                </div>
                                <div className="font-semibold text-sm">
                                  {o.totalPrice} {o.currency}
                                </div>
                                <div className="text-[0.7rem] text-slate-400">
                                  {createdStr &&
                                    `Teklif tarihi: ${createdStr}`}
                                </div>
                              </div>

                              {/* Teklif tipi */}
                              <div className="text-slate-100">
                                <div className="md:hidden text-[0.7rem] text-slate-400">
                                  Teklif tipi
                                </div>
                                <div>{MODE_LABEL_PUBLIC[o.mode]}</div>
                                {o.mode === "negotiable" && (
                                  <p className="text-[0.65rem] text-amber-300">
                                    Pazarlıklı teklif – 1 defa karşı
                                    teklif hakkın var.
                                  </p>
                                )}
                              </div>

                              {/* Durum */}
                              <div className="space-y-1">
                                <div className="md:hidden text-[0.7rem] text-slate-400">
                                  Durum
                                </div>
                                <span
                                  className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[0.7rem] ${
                                    o.status === "accepted"
                                      ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/40"
                                      : o.status === "rejected"
                                      ? "bg-red-500/10 text-red-300 border-red-500/40"
                                      : o.status === "countered"
                                      ? "bg-amber-500/10 text-amber-300 border-amber-500/40"
                                      : "bg-slate-500/10 text-slate-300 border-slate-500/40"
                                  }`}
                                >
                                  {statusLabel(o.status)}
                                </span>
                                {o.guestCounterPrice && (
                                  <p className="text-[0.7rem] text-slate-400">
                                    Gönderdiğin karşı teklif:{" "}
                                    {o.guestCounterPrice} {o.currency}
                                  </p>
                                )}
                              </div>

                              {/* İşlemler */}
                              <div className="flex justify-end gap-2">
                                {(o.status === "sent" ||
                                  o.status === "countered") && (
                                  <>
                                    {isSelected ? (
                                      <>
                                        <button
                                          type="button"
                                          disabled={savingAction}
                                          onClick={() =>
                                            handleOpenPaymentModal(o)
                                          }
                                          className="rounded-md bg-emerald-500 text-slate-950 px-3 py-1 text-[0.7rem] font-semibold hover:bg-emerald-400 disabled:opacity-60"
                                        >
                                          Ödemeye ilerle
                                        </button>
                                        <button
                                          type="button"
                                          disabled={savingAction}
                                          onClick={
                                            handleCancelSelection
                                          }
                                          className="rounded-md border border-slate-700 px-3 py-1 text-[0.7rem] text-slate-200 hover:border-slate-500"
                                        >
                                          Vazgeç
                                        </button>
                                      </>
                                    ) : (
                                      <button
                                        type="button"
                                        disabled={savingAction}
                                        onClick={() =>
                                          handleSelectForPayment(o)
                                        }
                                        className="rounded-md border border-emerald-500/70 px-3 py-1 text-[0.7rem] text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-60"
                                      >
                                        Kabul et
                                      </button>
                                    )}

                                    <button
                                      type="button"
                                      disabled={savingAction}
                                      onClick={() => handleReject(o)}
                                      className="rounded-md bg-red-500 text-white px-3 py-1 text-[0.7rem] font-semibold hover:bg-red-400 disabled:opacity-60"
                                    >
                                      Reddet
                                    </button>
                                  </>
                                )}
                                {canCounterFlag &&
                                  o.status === "sent" && (
                                    <button
                                      type="button"
                                      disabled={
                                        savingAction ||
                                        !!o.guestCounterPrice
                                      }
                                      onClick={() => startCounter(o)}
                                      className="rounded-md border border-amber-500/70 px-3 py-1 text-[0.7rem] text-amber-300 hover:bg-amber-500/10 disabled:opacity-60"
                                    >
                                      Pazarlık yap
                                    </button>
                                  )}
                                <button
                                  type="button"
                                  onClick={() => openDetails(o)}
                                  className="rounded-md bg-sky-500 text-white px-3 py-1 text-[0.7rem] font-semibold hover:bg-sky-400"
                                >
                                  Detay
                                </button>
                              </div>
                            </div>

                            {/* Karşı teklif formu */}
                            {counterEditId === o.id &&
                              canCounterFlag && (
                                <div className="bg-slate-950 px-4 pb-4 text-[0.7rem]">
                                  <form
                                    onSubmit={(e) =>
                                      handleCounterSubmit(e, o)
                                    }
                                    className="mt-1 space-y-2 rounded-xl border border-slate-800 bg-slate-950/90 p-3"
                                  >
                                    <p className="text-slate-200 font-semibold mb-1">
                                      Pazarlık – karşı teklifini yaz
                                    </p>
                                    <div className="space-y-1">
                                      <label className="text-slate-400">
                                        Önerdiğin toplam fiyat (
                                        {o.currency})
                                      </label>
                                      <input
                                        type="number"
                                        min={0}
                                        step="0.01"
                                        value={counterPrice}
                                        onChange={(e) =>
                                          setCounterPrice(
                                            e.target.value
                                          )
                                        }
                                        className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-xs"
                                      />
                                      <p className="text-[0.65rem] text-slate-500">
                                        Bu hakkı sadece{" "}
                                        <strong>1 defa</strong>{" "}
                                        kullanabilirsin. Otel bu fiyata
                                        göre kabul veya reddetme
                                        kararı verecek.
                                      </p>
                                    </div>
                                    <div className="flex justify-end gap-2 mt-1">
                                      <button
                                        type="button"
                                        onClick={cancelCounter}
                                        className="rounded-md border border-slate-700 px-3 py-1 text-[0.7rem] text-slate-200 hover:border-slate-500"
                                      >
                                        İptal
                                      </button>
                                      <button
                                        type="submit"
                                        disabled={savingAction}
                                        className="rounded-md bg-amber-500 text-slate-950 px-3 py-1 text-[0.7rem] font-semibold hover:bg-amber-400 disabled:opacity-60"
                                      >
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

        {/* Genel aksiyon mesajları */}
        {(actionMessage || actionError) && (
          <div className="text-[0.7rem] space-y-1">
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

        {/* DETAY MODAL */}
        {detailsOpen && detailsOffer && (
          <OfferDetailModal
            offer={detailsOffer}
            hotel={hotelsMap[detailsOffer.hotelId]}
            req={requestsMap[detailsOffer.requestId]}
            onClose={closeDetails}
          />
        )}

        {/* ÖDEME MODAL + 3D simülasyon */}
        {paymentOpen && paymentOffer && (
          <PaymentModal
            offer={paymentOffer}
            req={requestsMap[paymentOffer.requestId]}
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
      </div>
    </Protected>
  );
}
/* ------------------------------------------------
   TEKLİF DETAY MODALI + ODA MODALİ
------------------------------------------------- */

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
  const hotelImages = hp?.imageUrls ?? [];
  const [activeHotelImage, setActiveHotelImage] = useState(0);

  const [roomModalOpen, setRoomModalOpen] = useState(false);
  const [roomModalRoom, setRoomModalRoom] =
    useState<RoomTypeProfile | null>(null);

  const breakdown = offer.roomBreakdown ?? [];
  const profileRoom =
    hp?.roomTypes?.find((rt) => rt.id === offer.roomTypeId) ??
    null;

  const cancelText = cancellationLabelFromOffer(offer, hp);

  const po = hp?.paymentOptions;
  const paymentText = (() => {
    if (!po) return null;
    if (po.card3d && po.payAtHotel) {
      return "Bu tesiste 3D Secure kart ile online ödeme yapabilir veya ödemeni girişte otelde yapabilirsin.";
    }
    if (po.card3d) return "Bu tesiste 3D Secure ile kart ödemesi yapabilirsin.";
    if (po.payAtHotel)
      return "Bu tesiste ödemeni girişte, otelde yaparsın.";
    return null;
  })();

  const mapUrl =
    hp?.locationUrl ||
    (hp?.locationLat &&
      hp?.locationLng &&
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `${hp.locationLat},${hp.locationLng}`
      )}`);

  const isGroup = req?.isGroup || req?.type === "group";
  const nights = (() => {
    if (!req) return 1;
    const ci = new Date(req.checkIn);
    const co = new Date(req.checkOut);
    const diff =
      Math.floor(
        (co.setHours(0, 0, 0, 0) - ci.setHours(0, 0, 0, 0)) /
          (1000 * 60 * 60 * 24)
      ) || 0;
    return diff > 0 ? diff : 1;
  })();
  const totalGuests =
    (req?.adults ?? 0) + (req?.childrenCount ?? 0);
  const roomsCount = req?.roomsCount ?? 1;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60">
        <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
        <div className="relative mt-16 w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-xl shadow-slate-950/60 max-h-[80vh] overflow-y-auto text-[0.8rem] space-y-4">
          {/* OTEL GALERİ + ÖZET */}
          <div className="grid md:grid-cols-[1.4fr_minmax(0,1.6fr)] gap-4">
            <div className="rounded-xl border border-slate-800 bg-slate-900/80 overflow-hidden flex flex-col">
              {hotelImages.length > 0 ? (
                <>
                  <div className="flex-1 overflow-hidden min-h-[180px]">
                    <img
                      src={hotelImages[activeHotelImage]}
                      alt={hotel?.displayName || "Otel görseli"}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  {hotelImages.length > 1 && (
                    <div className="flex gap-1 p-1 bg-slate-950/80 border-t border-slate-800 overflow-x-auto">
                      {hotelImages.map((img, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setActiveHotelImage(idx)}
                          className={`w-14 h-14 rounded-md border overflow-hidden ${
                            activeHotelImage === idx
                              ? "border-emerald-400"
                              : "border-slate-700"
                          }`}
                        >
                          <img
                            src={img}
                            alt={`Otel görsel ${idx + 1}`}
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center justify-center text-slate-500 text-xs flex-1 min-h-[180px]">
                  <span className="text-3xl mb-1">🏨</span>
                  <span>Bu otel henüz görsel eklememiş.</span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">
                  Otel: {hotel?.displayName || offer.hotelName || "Otel"}
                </h2>
                {hp?.starRating && (
                  <p className="text-[0.75rem] text-amber-300">
                    {hp.starRating}★
                  </p>
                )}
              </div>

              {hp?.address && (
                <p className="text-[0.75rem] text-slate-300">
                  <span className="text-slate-400">Adres: </span>
                  {hp.address}
                </p>
              )}

              {mapUrl && (
                <p className="text-[0.75rem] text-sky-300">
                  <a
                    href={mapUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline"
                  >
                    Haritada konumu gör
                  </a>
                </p>
              )}

              <div className="space-y-1">
                {hp?.boardTypes && hp.boardTypes.length > 0 && (
                  <p className="text-[0.7rem] text-slate-300">
                    <span className="text-slate-400">
                      Konaklama tipleri:{" "}
                    </span>
                    {hp.boardTypes.join(", ")}
                  </p>
                )}
                {hp?.features && hp.features.length > 0 && (
                  <p className="text-[0.7rem] text-slate-300">
                    <span className="text-slate-400">
                      Öne çıkan özellikler:{" "}
                    </span>
                    {hp.features.join(", ")}
                  </p>
                )}
              </div>

              {hp?.description && (
                <p className="text-[0.7rem] text-slate-300">
                  <span className="text-slate-400">Otel hakkında: </span>
                  {hp.description}
                </p>
              )}

              {cancelText && (
                <p className="text-[0.7rem] text-slate-300">
                  <span className="text-slate-400">
                    Bu teklife özel iptal:{" "}
                  </span>
                  {cancelText}
                </p>
              )}

              {paymentText && (
                <p className="text-[0.7rem] text-slate-300">
                  <span className="text-slate-400">
                    Ödeme seçenekleri:{" "}
                  </span>
                  {paymentText}
                </p>
              )}

              <p className="text-[0.7rem] text-slate-500">
                Yorumlar ve puanlama sistemi yakında eklenecek. Şimdilik tesis
                bilgilerini, konumu ve gelen teklifleri baz alarak seçim
                yapabilirsin.
              </p>
            </div>
          </div>

          {/* FİYAT + ODA KIRILIMI */}
          <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/90 p-3">
            <p className="text-slate-400 text-[0.75rem] mb-0.5">
              Fiyat & oda kırılımı
            </p>
            <p className="text-slate-100">
              <span className="font-semibold">
                {offer.totalPrice} {offer.currency}
              </span>{" "}
              • {MODE_LABEL_PUBLIC[offer.mode]}
            </p>
            {offer.note && (
              <p className="text-[0.75rem] text-slate-300">
                <span className="text-slate-400">Otelin notu: </span>
                {offer.note}
              </p>
            )}

            {breakdown.length > 0 && (
              <div className="mt-2 space-y-1">
                {breakdown.map((rb, idx) => {
                  const n = rb.nights ?? nights;
                  const nightly = rb.nightlyPrice ?? 0;
                  const total = rb.totalPrice ?? nightly * n;

                  const rtProfile =
                    hp?.roomTypes?.find(
                      (rt) =>
                        rt.id === rb.roomTypeId ||
                        rt.name === rb.roomTypeName
                    ) || null;

                  const label =
                    rb.roomTypeName || rtProfile?.name || "Oda";

                  return (
                    <p
                      key={idx}
                      className="text-[0.75rem] text-slate-300"
                    >
                      Oda {idx + 1}:{" "}
                      {rtProfile ? (
                        <button
                          type="button"
                          onClick={() => {
                            setRoomModalRoom(rtProfile);
                            setRoomModalOpen(true);
                          }}
                          className="underline underline-offset-2 hover:text-emerald-300"
                        >
                          {label}
                        </button>
                      ) : (
                        <span>{label}</span>
                      )}{" "}
                      • {n} gece ×{" "}
                      {nightly.toLocaleString("tr-TR")} {offer.currency} ={" "}
                      <span className="font-semibold text-emerald-300">
                        {total.toLocaleString("tr-TR")} {offer.currency}
                      </span>
                    </p>
                  );
                })}
              </div>
            )}
          </div>

          {/* PROFİLDEKİ REFERANS ODA */}
          {profileRoom && (
            <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/90 p-3">
              <p className="text-slate-400 text-[0.75rem] mb-0.5">
                Teklifin referans oda tipi
              </p>
              <button
                type="button"
                onClick={() => {
                  setRoomModalRoom(profileRoom);
                  setRoomModalOpen(true);
                }}
                className="text-slate-100 font-semibold underline underline-offset-2 hover:text-emerald-300"
              >
                {profileRoom.name}
              </button>
              {profileRoom.shortDescription && (
                <p className="text-[0.75rem] text-slate-300">
                  {profileRoom.shortDescription}
                </p>
              )}
            </div>
          )}
      {/* İLGİLİ TALEP – zengin özet */}
<div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/90 p-3">
  <p className="text-slate-400 text-[0.75rem] mb-0.5">İlgili talep</p>

  {!req ? (
    <p className="text-[0.75rem] text-slate-400">
      Talep özeti bulunamadı.
    </p>
  ) : (
    <>
      {/* Konaklama */}
      <div className="space-y-1">
        <p className="text-[0.75rem] text-slate-400">Konaklama</p>
        <p className="text-slate-100">
          {req.city}
          {req.district ? ` / ${req.district}` : ""}
        </p>
        <p className="text-[0.75rem] text-slate-300">
          {req.checkIn} – {req.checkOut} •{" "}
        {(() => {
  const ci = parseDate(req.checkIn);
  const co = parseDate(req.checkOut);
  if (!ci || !co) return "gece sayısı hesaplanamadı";
  const n = diffInDays(co, ci);
  return `${n > 0 ? n : 1} gece`;
})()}

        </p>
      </div>

      {/* Kişi & oda */}
      <div className="space-y-1">
        <p className="text-[0.75rem] text-slate-400">Kişi & oda</p>
        <p className="text-[0.8rem] text-slate-100">
          {(req.adults || 0) + (req.childrenCount || 0)} kişi •{" "}
          {req.roomsCount || 1} oda
        </p>
        <p className="text-[0.75rem] text-slate-300">
          Yetişkin: {req.adults ?? 0}
          {" • "}Çocuk: {req.childrenCount ?? 0}
        </p>
      </div>

      {/* Tesis türü, yeme-içme, yıldız tercihi (talep formunda varsa) */}
      {(req.hotelType || req.mealPlan || req.starRatingPref || 
        (req.desiredStarRatings && req.desiredStarRatings.length > 0)) && (
        <div className="space-y-1">
          <p className="text-[0.75rem] text-slate-400">
            Tesis türü, yeme-içme ve yıldız tercihi
          </p>
          {req.hotelType && (
            <p className="text-[0.75rem] text-slate-300">
              Tesis türü: {req.hotelType}
            </p>
          )}
          {req.mealPlan && (
            <p className="text-[0.75rem] text-slate-300">
              Yeme-içme tipi: {req.mealPlan}
            </p>
          )}
          {req.starRatingPref && (
            <p className="text-[0.75rem] text-slate-300">
              Tercih edilen yıldız: {req.starRatingPref}★
            </p>
          )}
          {req.desiredStarRatings && req.desiredStarRatings.length > 0 && (
            <p className="text-[0.75rem] text-slate-300">
              Yıldız tercihleri:{" "}
              {req.desiredStarRatings.map((s) => `${s}★`).join(", ")}
            </p>
          )}
        </div>
      )}

      {/* Konaklama tipleri (RO, BB, HB...) */}
      {(req.boardTypes && req.boardTypes.length > 0) || req.boardTypeNote && (
        <div className="space-y-1">
          <p className="text-[0.75rem] text-slate-400">
            Konaklama tipi tercihleri
          </p>
          {req.boardTypes && req.boardTypes.length > 0 && (
            <p className="text-[0.75rem] text-slate-300">
              {req.boardTypes.join(", ")}
            </p>
          )}
          {req.boardTypeNote && (
            <p className="text-[0.75rem] text-slate-300">
              Not: {req.boardTypeNote}
            </p>
          )}
        </div>
      )}

      {/* Otel özellikleri */}
      {((req.hotelFeaturePrefs && req.hotelFeaturePrefs.length > 0) ||
        req.hotelFeatureNote) && (
        <div className="space-y-1">
          <p className="text-[0.75rem] text-slate-400">
            Otel özellik tercihler
          </p>
          {req.hotelFeaturePrefs && req.hotelFeaturePrefs.length > 0 && (
            <p className="text-[0.75rem] text-slate-300">
              {req.hotelFeaturePrefs.join(", ")}
            </p>
          )}
          {req.hotelFeatureNote && (
            <p className="text-[0.75rem] text-slate-300">
              Misafirin özellik notu: {req.hotelFeatureNote}
            </p>
          )}
        </div>
      )}

      {/* Oda tipi tercihleri */}
      <div className="space-y-1">
        <p className="text-[0.75rem] text-slate-400">Oda tipi tercihleri</p>
        {req.roomTypes && req.roomTypes.length > 0 ? (
          <p className="text-[0.75rem] text-slate-300">
            {req.roomTypes.map(roomTypeLabel).join(", ")}
          </p>
        ) : (
          <p className="text-[0.75rem] text-slate-400">
            Oda tipi tercihi belirtilmemiş.
          </p>
        )}
      </div>

      {/* Yakınımda ara */}
      {req.nearMe && (
        <div className="space-y-1">
          <p className="text-[0.75rem] text-slate-400">Konum tercihi</p>
          <p className="text-[0.75rem] text-slate-300">
            Misafir &quot;yakınımda ara&quot; seçeneğini işaretlemiş.
          </p>
        </div>
      )}

      {/* Genel not */}
      {req.generalNote && (
        <div className="space-y-1">
          <p className="text-[0.75rem] text-slate-400">
            Misafirin genel notu
          </p>
          <p className="text-[0.75rem] text-slate-300">
            {req.generalNote}
          </p>
        </div>
      )}
    </>
  )}
</div>


          {/* video */}
          {hp?.youtubeUrl && (
            <div className="space-y-1 rounded-xl border border-slate-800 bg-slate-950/90 p-3">
              <p className="text-slate-400 text-[0.75rem] mb-0.5">
                Tesis tanıtım videosu
              </p>
              <div className="aspect-video rounded-lg overflow-hidden border border-slate-800">
                <iframe
                  className="w-full h-full"
                  src={hp.youtubeUrl.replace("watch?v=", "embed/")}
                  title="Otel tanıtım videosu"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-700 px-3 py-1 text-[0.7rem] text-slate-200 hover:border-slate-500"
            >
              Kapat
            </button>
          </div>
        </div>
      </div>

      {roomModalOpen && roomModalRoom && (
        <RoomTypeModal
          room={roomModalRoom}
          onClose={() => {
            setRoomModalOpen(false);
            setRoomModalRoom(null);
          }}
        />
      )}
    </>
  );
}

/* Oda tipi modalı */

function RoomTypeModal({
  room,
  onClose
}: {
  room: RoomTypeProfile;
  onClose: () => void;
}) {
  const images = room.imageUrls ?? [];
  const [active, setActive] = useState(0);

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/70">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative mt-16 w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-xl shadow-slate-950/60 max-h-[80vh] overflow-y-auto text-[0.8rem] space-y-4">
        <div className="flex items-start justify-between gap-4 mb-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">
              {room.name}
            </h2>
            {room.shortDescription && (
              <p className="text-[0.75rem] text-slate-300">
                {room.shortDescription}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-700 bg-slate-900 px-2 py-1 text-[0.7rem] text-slate-300 hover:border-emerald-400"
          >
            Kapat ✕
          </button>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/80 overflow-hidden flex flex-col">
          {images.length > 0 ? (
            <>
              <div className="flex-1 overflow-hidden min-h-[180px]">
                <img
                  src={images[active]}
                  alt={`${room.name} görseli`}
                  className="w-full h-full object-cover"
                />
              </div>
              {images.length > 1 && (
                <div className="flex gap-1 p-1 bg-slate-950/80 border-t border-slate-800 overflow-x-auto">
                  {images.map((img, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setActive(idx)}
                      className={`w-16 h-16 rounded-md border overflow-hidden ${
                        active === idx
                          ? "border-emerald-400"
                          : "border-slate-700"
                      }`}
                    >
                      <img
                        src={img}
                        alt={`${room.name} ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center text-slate-500 text-xs flex-1 min-h-[180px]">
              <span className="text-2xl mb-1">🛏️</span>
              <span>Bu oda tipi için henüz görsel eklenmemiş.</span>
            </div>
          )}
        </div>

        {(room.maxAdults || room.maxChildren != null) && (
          <p className="text-[0.75rem] text-slate-300">
            Kapasite:{" "}
            {room.maxAdults ? `${room.maxAdults} yetişkin` : ""}
            {room.maxChildren != null &&
              ` + ${room.maxChildren} çocuk`}
          </p>
        )}
        {room.description && (
          <p className="text-[0.75rem] text-slate-300">
            {room.description}
          </p>
        )}
      </div>
    </div>
  );
}
/* ------------------------------------------------
   ÖDEME MODALI
------------------------------------------------- */

function PaymentModal({
  offer,
  req,
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
  req?: RequestSummary;
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
    ? ([
        po.card3d && "card3d",
        po.payAtHotel && "payAtHotel"
      ].filter(Boolean) as PaymentMethod[])
    : (["card3d", "payAtHotel"] as PaymentMethod[]);

  const hasCard3d = availableMethods.includes("card3d");
  const hasPayAtHotel = availableMethods.includes("payAtHotel");

  const descriptionText =
    hasCard3d && hasPayAtHotel
      ? "Aşağıdan 3D Secure kart ödemesi veya otelde ödeme seçeneklerinden birini seçebilirsin."
      : hasCard3d
      ? "Bu otelde 3D Secure ile kart ödemesi yapabilirsin."
      : hasPayAtHotel
      ? "Bu otelde ödemeyi girişte, otelde yapabilirsin."
      : "Bu otel için şu an tanımlı bir ödeme yöntemi bulunmuyor.";

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70">
        <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
        <div className="relative mt-20 w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-xl shadow-slate-950/60 text-xs space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100">
              Ödeme yöntemini seç
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="text-[0.7rem] text-slate-400 hover:text-slate-200"
            >
              ✕ Kapat
            </button>
          </div>

          <p className="text-[0.75rem] text-slate-300">
            {hotel?.displayName || offer.hotelName || "Otel"} için toplam{" "}
            <span className="font-semibold">
              {offer.totalPrice} {offer.currency}
            </span>{" "}
            tutarında ödeme yapacaksın. {descriptionText}
          </p>

          <div className="space-y-2">
            {hasCard3d && (
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="paymentMethod"
                  value="card3d"
                  checked={paymentMethod === "card3d"}
                  onChange={() => setPaymentMethod("card3d")}
                  className="mt-1 h-4 w-4"
                />
                <div>
                  <p className="text-slate-100 text-[0.8rem] font-semibold">
                    💳 3D Secure ile kart ödemesi
                  </p>
                  <p className="text-[0.7rem] text-slate-400">
                    Kart bilgilerini girersin, banka 3D ekranını simüle eden
                    onay penceresi açılır. &quot;Ödemeyi onayla&quot; dersen
                    rezervasyonun ödenmiş olur.
                  </p>
                </div>
              </label>
            )}

            {hasPayAtHotel && (
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="paymentMethod"
                  value="payAtHotel"
                  checked={paymentMethod === "payAtHotel"}
                  onChange={() => setPaymentMethod("payAtHotel")}
                  className="mt-1 h-4 w-4"
                />
                <div>
                  <p className="text-slate-100 text-[0.8rem] font-semibold">
                    💵 Otelde ödeme
                  </p>
                  <p className="text-[0.7rem] text-slate-400">
                    Ödemeyi girişte, otelde yaparsın. Rezervasyonun Biddakika
                    üzerinde &quot;ödemesi otelde&quot; statüsünde açılır.
                  </p>
                </div>
              </label>
            )}

            {!hasCard3d && !hasPayAtHotel && (
              <p className="text-[0.75rem] text-red-300">
                Bu otel için aktif bir ödeme yöntemi bulunmuyor. Lütfen tesisle
                iletişime geç.
              </p>
            )}
          </div>

          {paymentMethod === "card3d" && hasCard3d && (
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">
                  Kart üzerindeki ad
                </label>
                <input
                  value={cardName}
                  onChange={(e) => setCardName(e.target.value)}
                  placeholder="Ad Soyad"
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">
                  Kart numarası
                </label>
                <input
                  value={cardNumber}
                  onChange={(e) => setCardNumber(e.target.value)}
                  placeholder="1111 2222 3333 4444"
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">
                  Son kullanma (AA/YY)
                </label>
                <input
                  value={cardExpiry}
                  onChange={(e) => setCardExpiry(e.target.value)}
                  placeholder="12/29"
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">
                  CVC
                </label>
                <input
                  value={cardCvc}
                  onChange={(e) => setCardCvc(e.target.value)}
                  placeholder="123"
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                />
              </div>
            </div>
          )}

          {error && (
            <p className="text-[0.75rem] text-red-300 bg-red-500/10 border border-red-500/40 rounded-md px-3 py-2">
              {error}
            </p>
          )}
          {message && (
            <p className="text-[0.75rem] text-emerald-300 bg-emerald-500/10 border border-emerald-500/40 rounded-md px-3 py-2">
              {message}
            </p>
          )}

          <div className="flex justify-end gap-2 mt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-700 px-3 py-1 text-[0.7rem] text-slate-200 hover:border-slate-500"
            >
              İptal
            </button>
            <button
              type="button"
              disabled={
                saving ||
                !paymentMethod ||
                availableMethods.length === 0
              }
              onClick={onConfirm}
              className="rounded-md bg-emerald-500 text-slate-950 px-3 py-1 text-[0.7rem] font-semibold hover:bg-emerald-400 disabled:opacity-60"
            >
              Rezervasyonu tamamla
            </button>
          </div>
        </div>
      </div>

      {threeDSOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/70">
          <div className="bg-slate-950/95 rounded-2xl border border-slate-800 p-5 w-full max-w-md text-xs space-y-3 shadow-xl shadow-slate-950/60">
            <h2 className="text-sm font-semibold text-slate-100 mb-1">
              Banka 3D Secure doğrulama
            </h2>
            <p className="text-[0.75rem] text-slate-300">
              Bu ekran, gerçek ortamda bankanın 3D Secure sayfası olacaktır.
              MVP&apos;de simülasyon yapıyoruz. &quot;Ödemeyi onayla&quot;
              dersen ödeme başarılı kabul edilir ve rezervasyon oluşturulur.
            </p>
            <p className="text-[0.75rem] text-slate-200">
              {offer.totalPrice} {offer.currency} tutarında ödemeyi
              onaylıyor musun?
            </p>
            <div className="flex justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={() => setThreeDSOpen(false)}
                className="rounded-md border border-slate-700 px-3 py-1 text-[0.7rem] text-slate-200 hover:border-slate-500"
              >
                İptal
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => createBooking("card3d")}
                className="rounded-md bg-emerald-500 text-slate-950 px-3 py-1 text-[0.7rem] font-semibold hover:bg-emerald-400 disabled:opacity-60"
              >
                Ödemeyi onayla
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
