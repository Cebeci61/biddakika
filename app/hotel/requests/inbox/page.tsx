// app/hotel/requests/inbox/page.tsx
"use client";

import {
  useEffect,
  useMemo,
  useState,
  FormEvent
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
  addDoc,
  serverTimestamp,
  doc,
  updateDoc,
  getDoc
} from "firebase/firestore";

type OfferMode = "simple" | "refreshable" | "negotiable";
type CommissionRate = 8 | 10 | 15;
type CancellationPolicyType =
  | "non_refundable"
  | "flexible"
  | "until_days_before";

interface RequestItem {
  id: string;
  city: string;
  district?: string | null;
  checkIn: string;
  checkOut: string;
  adults: number;
  childrenCount?: number;
  roomsCount?: number;
  roomTypes?: string[];
  guestName?: string;
  createdAt?: Timestamp;
  responseDeadlineMinutes?: number;

  guestId?: string | null; // talebi açan misafir

  // grup & gelişmiş alanlar
  type?: string;
  isGroup?: boolean;
  roomTypeCounts?: Record<string, number>;
  roomTypeRows?: { typeKey: string; count: number }[];
  boardTypes?: string[];
  boardTypeNote?: string | null;
  hotelFeaturePrefs?: string[];
  hotelFeatureNote?: string | null;
  desiredStarRatings?: number[] | null;

  contactEmail?: string | null;
  contactPhone?: string | null;
  contactCompany?: string | null;
  contactNote?: string | null;
}

interface ExistingOffer {
  id: string;
  requestId: string;
  hotelId: string;
  totalPrice: number;
  currency: string;
  mode: OfferMode;
  commissionRate: CommissionRate;
  status: string; // sent | accepted | rejected | countered
  note?: string | null;
  roomBreakdown?: {
    roomTypeId?: string;
    roomTypeName?: string;
    nights?: number;
    nightlyPrice?: number;
    totalPrice?: number;
  }[];
  cancellationPolicyType?: CancellationPolicyType;
  cancellationPolicyDays?: number | null;
  createdAt?: Timestamp;
}

interface HotelRoomType {
  id: string;
  name: string;
}

interface HotelProfile {
  city?: string;
  district?: string;
  name?: string;
  roomTypes?: HotelRoomType[];
}

interface RoomQuoteState {
  roomTypeId: string;
  nightlyPrice: string; // input string, sonradan sayıya çevireceğiz
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
  return Math.floor(ms / (1000 * 60 * 60 * 24));
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

function computeDeadlineInfo(req: RequestItem) {
  const created = req.createdAt?.toDate();
  const minutes = req.responseDeadlineMinutes ?? 0;
  if (!created || !minutes) {
    return {
      label: "Süre bilgisi yok",
      color: "text-slate-300",
      ratio: 1
    } as const;
  }

  const totalMs = minutes * 60 * 1000;
  const deadline = new Date(created.getTime() + totalMs);
  const now = new Date();
  const remainingMs = deadline.getTime() - now.getTime();

  if (remainingMs <= 0) {
    return {
      label: "Süresi doldu",
      color: "text-red-400",
      ratio: 0
    } as const;
  }

  const sec = Math.floor(remainingMs / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const label = `${h} sa ${m} dk ${s} sn`;

  const ratio = Math.min(1, Math.max(0, remainingMs / totalMs));

  let color = "text-emerald-300";
  if (ratio <= 0.25) color = "text-red-400";
  else if (ratio <= 0.5) color = "text-amber-300";

  return { label, color, ratio } as const;
}

function isRequestExpired(req: RequestItem): boolean {
  const created = req.createdAt?.toDate();
  const minutes = req.responseDeadlineMinutes ?? 0;
  if (!created || !minutes) return false;
  const deadline = new Date(created.getTime() + minutes * 60 * 1000);
  return deadline.getTime() < Date.now();
}

function calculateNights(req: RequestItem): number {
  const ci = parseDate(req.checkIn);
  const co = parseDate(req.checkOut);
  if (!ci || !co) return 1;
  const diff = diffInDays(co, ci);
  return diff > 0 ? diff : 1;
}

function cancellationPolicyLabelForOffer(
  type?: CancellationPolicyType,
  days?: number | null
): string | null {
  const t = type ?? "non_refundable";
  if (t === "non_refundable") return "İptal edilemez / iade yok.";
  if (t === "flexible") return "Giriş tarihine kadar ücretsiz iptal.";
  if (t === "until_days_before") {
    const d = days ?? 3;
    return `Giriş tarihinden ${d} gün öncesine kadar ücretsiz iptal.`;
  }
  return null;
}

/* --------------- KVKK MASKELEME --------------- */

function maskName(name?: string | null): string {
  if (!name) return "Misafir";
  const parts = name.split(" ").filter(Boolean);
  return parts
    .map((p) => p[0] + "*".repeat(Math.max(2, p.length - 1)))
    .join(" ");
}

function maskEmail(email?: string | null): string {
  if (!email) return "—";
  const [user, domain] = email.split("@");
  if (!domain) return "—";
  const maskedUser = user[0] + "*".repeat(Math.max(3, user.length - 1));
  const [domainName, ext] = domain.split(".");
  const maskedDomain =
    domainName[0] + "*".repeat(Math.max(3, domainName.length - 1));
  return `${maskedUser}@${maskedDomain}${ext ? "." + ext : ""}`;
}

function maskPhone(phone?: string | null): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "—";
  const last2 = digits.slice(-2);
  return `${phone.slice(0, 3)} ***** ${last2}`;
}

function maskCompany(text?: string | null): string {
  if (!text) return "—";
  return maskName(text);
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
export default function HotelRequestsInboxPage() {
  const { profile, loading: authLoading } = useAuth();
  const db = getFirestoreDb();

  const [hotelProfile, setHotelProfile] = useState<HotelProfile | null>(
    null
  );
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [offers, setOffers] = useState<ExistingOffer[]>([]);
  const [acceptedRequestIds, setAcceptedRequestIds] = useState<Set<string>>(
    () => new Set()
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // filtreler
  const [districtFilter, setDistrictFilter] = useState<string>("all");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [minGuests, setMinGuests] = useState<string>("");
  const [minRooms, setMinRooms] = useState<string>("");

  // teklif form state
  const [openRequestId, setOpenRequestId] = useState<string | null>(
    null
  );
  const [commissionRate, setCommissionRate] =
    useState<CommissionRate>(10);
  const [currency, setCurrency] =
    useState<"TRY" | "USD" | "EUR">("TRY");
  const [note, setNote] = useState<string>("");
  const [roomBreakdown, setRoomBreakdown] = useState<RoomQuoteState[]>(
    []
  );
  const [offerCancelType, setOfferCancelType] =
    useState<CancellationPolicyType>("non_refundable");
  const [offerCancelDays, setOfferCancelDays] =
    useState<number | null>(3);
  const [savingOffer, setSavingOffer] = useState(false);
  const [actionMessage, setActionMessage] =
    useState<string | null>(null);
  const [actionError, setActionError] =
    useState<string | null>(null);

  // talep detayı modal
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRequest, setDetailRequest] =
    useState<RequestItem | null>(null);

  useEffect(() => {
    async function load() {
      if (authLoading) return;
      if (!profile || profile.role !== "hotel") {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        // 1) Otel profilini oku
        const userSnap = await getDoc(doc(db, "users", profile.uid));
        let hp: HotelProfile | null = null;
        if (userSnap.exists()) {
          const v = userSnap.data() as any;
          const hpData = (v.hotelProfile || {}) as any;
          hp = {
            city: hpData.city || v.city || "",
            district: hpData.district || v.district || "",
            name: hpData.name || v.displayName || "",
            roomTypes: Array.isArray(hpData.roomTypes)
              ? hpData.roomTypes.map((rt: any) => ({
                  id: rt.id || rt.key || "",
                  name: rt.name || roomTypeLabel(rt.key)
                }))
              : []
          };
        }
        setHotelProfile(hp);

        // 2) Tüm talepleri çek, şehir/ilçe filtresini JS tarafında uygula
        const snapReq = await getDocs(collection(db, "requests"));
        const reqData: RequestItem[] = snapReq.docs
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
              roomsCount: v.roomsCount ?? 1,
              roomTypes: v.roomTypes ?? [],
              guestName:
                v.guestDisplayName ||
                v.contactName ||
                v.guestName ||
                "Misafir",
              guestId: v.guestId ?? null,
              createdAt: v.createdAt,
              responseDeadlineMinutes:
                v.responseDeadlineMinutes ?? 60,

              type: v.type,
              isGroup: v.isGroup ?? false,
              roomTypeCounts: v.roomTypeCounts ?? undefined,
              roomTypeRows: v.roomTypeRows ?? undefined,
              boardTypes: v.boardTypes ?? undefined,
              boardTypeNote: v.boardTypeNote ?? null,
              hotelFeaturePrefs: v.hotelFeaturePrefs ?? undefined,
              hotelFeatureNote: v.hotelFeatureNote ?? null,
              desiredStarRatings: v.desiredStarRatings ?? null,

              contactEmail: v.contactEmail ?? v.guestEmail ?? null,
              contactPhone: v.contactPhone ?? null,
              contactCompany: v.contactCompany ?? null,
              contactNote: v.contactNote ?? null
            } as RequestItem;
          })
          .filter((r) => {
            if (!hp?.city) return true;
            const cityMatches =
              (r.city || "")
                .toString()
                .toLocaleLowerCase("tr-TR") ===
              hp.city.toString().toLocaleLowerCase("tr-TR");

            if (!cityMatches) return false;

            if (!hp.district) return true;
            const distMatches =
              (r.district || "")
                .toString()
                .toLocaleLowerCase("tr-TR") ===
              hp.district.toString().toLocaleLowerCase("tr-TR");
            return distMatches;
          });

        reqData.sort((a, b) => {
          const ta = a.createdAt?.toMillis() ?? 0;
          const tb = b.createdAt?.toMillis() ?? 0;
          return ta - tb;
        });

        // 3) Bu otelin daha önce verdiği teklifler
        const snapOffers = await getDocs(
          query(
            collection(db, "offers"),
            where("hotelId", "==", profile.uid)
          )
        );
        const offerData: ExistingOffer[] = snapOffers.docs.map((d) => {
          const v = d.data() as any;
          return {
            id: d.id,
            requestId: v.requestId,
            hotelId: v.hotelId,
            totalPrice: v.totalPrice,
            currency: v.currency,
            mode: (v.mode as OfferMode) ?? "simple",
            commissionRate: (v.commissionRate as CommissionRate) ?? 10,
            status: v.status ?? "sent",
            note: v.note ?? null,
            roomBreakdown: v.roomBreakdown ?? [],
            cancellationPolicyType: v.cancellationPolicyType as
              | CancellationPolicyType
              | undefined,
            cancellationPolicyDays: v.cancellationPolicyDays ?? null,
            createdAt: v.createdAt
          };
        });

        // 4) Rezervasyona dönmüş talepler
        const snapBookings = await getDocs(collection(db, "bookings"));
        const accSet = new Set<string>();
        snapBookings.docs.forEach((d) => {
          const v = d.data() as any;
          if (v.requestId) accSet.add(v.requestId as string);
        });

        setRequests(reqData);
        setOffers(offerData);
        setAcceptedRequestIds(accSet);

        if (hp?.district) {
          setDistrictFilter(hp.district);
        }
      } catch (err) {
        console.error("Gelen talepler yüklenirken hata:", err);
        setError(
          "Gelen misafir talepleri yüklenirken bir hata oluştu."
        );
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [authLoading, profile, db]);

  // talepleri filtrele
  const filteredRequests = useMemo(() => {
    return requests.filter((r) => {
      if (isRequestExpired(r)) return false;
      if (acceptedRequestIds.has(r.id)) return false;

      if (districtFilter !== "all" && r.district !== districtFilter)
        return false;

      if (fromDate) {
        const ci = parseDate(r.checkIn);
        if (!ci || ci.toISOString().slice(0, 10) < fromDate) return false;
      }
      if (toDate) {
        const co = parseDate(r.checkOut);
        if (!co || co.toISOString().slice(0, 10) > toDate) return false;
      }

      const totalGuests = r.adults + (r.childrenCount ?? 0);
      const roomsCount = r.roomsCount ?? 1;

      if (minGuests) {
        if (totalGuests < Number(minGuests)) return false;
      }
      if (minRooms) {
        if (roomsCount < Number(minRooms)) return false;
      }

      return true;
    });
  }, [
    requests,
    districtFilter,
    fromDate,
    toDate,
    minGuests,
    minRooms,
    acceptedRequestIds
  ]);

  const distinctDistricts = useMemo(() => {
    const set = new Set<string>();
    requests.forEach((r) => {
      if (r.district) set.add(r.district);
    });
    return Array.from(set);
  }, [requests]);

  function findOfferForRequest(reqId: string): ExistingOffer | undefined {
    return offers.find((o) => o.requestId === reqId);
  }

  function canEditPrice(offer: ExistingOffer | undefined): boolean {
    if (!offer) return false;
    if (offer.status === "accepted" || offer.status === "rejected")
      return false;
    return offer.commissionRate === 10 || offer.commissionRate === 15;
  }

  function initRoomBreakdownForRequest(
    req: RequestItem,
    existing?: ExistingOffer
  ): RoomQuoteState[] {
    const roomsCount = req.roomsCount ?? 1;
    const nights = calculateNights(req);
    // ✅ requestFeatures kesin string[]
const requestFeatures: string[] =
  Array.isArray((req as any).featureKeys) && (req as any).featureKeys.length
    ? ((req as any).featureKeys as string[])
    : Array.isArray((req as any).hotelFeaturePrefs) && (req as any).hotelFeaturePrefs.length
    ? ((req as any).hotelFeaturePrefs as string[])
    : [];

// ✅ notesAll kesin string (boşsa "")
const notesAll: string = [
  (req as any).note,
  (req as any).notes,
  (req as any).generalNote,
  (req as any).contactNote,
  (req as any).locationNote,
  (req as any).boardTypeNote,
  (req as any).hotelFeatureNote,
  (req as any).extraFeaturesText,
  (req as any).flightNotes,
  (req as any).transferNotes,
  (req as any).activities,
  (req as any).requestNote
]
  .filter((x) => x !== undefined && x !== null && String(x).trim() !== "")
  .map((x) => String(x).trim())
  .join("\n\n");


    if (
      existing &&
      Array.isArray(existing.roomBreakdown) &&
      existing.roomBreakdown.length
    ) {
      return existing.roomBreakdown.map((rb) => ({
        roomTypeId: rb.roomTypeId || "",
        nightlyPrice:
          rb.nightlyPrice != null
            ? String(rb.nightlyPrice)
            : rb.totalPrice && nights
            ? String(Math.round(rb.totalPrice / nights))
            : ""
      }));
    }

    return Array.from({ length: roomsCount }, () => ({
      roomTypeId: "",
      nightlyPrice: ""
    }));
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
    const existing = findOfferForRequest(req.id);
    setOpenRequestId(req.id);
    setActionError(null);
    setActionMessage(null);

    if (existing) {
      setCurrency((existing.currency as any) || "TRY");
      setCommissionRate(existing.commissionRate);
      setNote(existing.note ?? "");
      setRoomBreakdown(initRoomBreakdownForRequest(req, existing));
      setOfferCancelType(
        existing.cancellationPolicyType ?? "non_refundable"
      );
      setOfferCancelDays(existing.cancellationPolicyDays ?? 3);
    } else {
      setCurrency("TRY");
      setCommissionRate(10);
      setNote("");
      setRoomBreakdown(initRoomBreakdownForRequest(req, undefined));
      setOfferCancelType("non_refundable");
      setOfferCancelDays(3);
    }
  }

  function resetForm() {
    setOpenRequestId(null);
    setRoomBreakdown([]);
    setNote("");
  }

  async function handleSubmitOffer(
    e: FormEvent,
    req: RequestItem
  ) {
    e.preventDefault();
    if (!profile || profile.role !== "hotel") return;

    const existing = findOfferForRequest(req.id);
    const mode: OfferMode =
      commissionRate === 15
        ? "negotiable"
        : commissionRate === 8
        ? "simple"
        : "refreshable";

    const nights = calculateNights(req);
    if (nights <= 0) {
      setActionError("Giriş ve çıkış tarihleri hatalı görünüyor.");
      return;
    }

    if (!roomBreakdown.length) {
      setActionError("En az bir oda için fiyat girmen gerekiyor.");
      return;
    }

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
        setActionError(
          `Oda ${i + 1} için hangi oda tipini vereceğini seçmelisin.`
        );
        return;
      }
      if (!nightly || nightly <= 0) {
        setActionError(
          `Oda ${i + 1} için geçerli bir gecelik fiyat gir.`
        );
        return;
      }
      const total = nightly * nights;
      const roomTypeName =
        hotelProfile?.roomTypes?.find((rt) => rt.id === rb.roomTypeId)
          ?.name || "Oda";

      breakdownToSave.push({
        roomTypeId: rb.roomTypeId,
        roomTypeName,
        nights,
        nightlyPrice: nightly,
        totalPrice: total
      });
    }

    const totalPrice = breakdownToSave.reduce(
      (sum, rb) => sum + rb.totalPrice,
      0
    );

    try {
      setSavingOffer(true);
      setActionError(null);
      setActionMessage(null);

      if (!existing) {
        await addDoc(collection(db, "offers"), {
          requestId: req.id,
          hotelId: profile.uid,
          hotelName: hotelProfile?.name || profile.displayName || null,
          totalPrice,
          currency,
          mode,
          commissionRate,
          note: note || null,
          roomBreakdown: breakdownToSave,
          cancellationPolicyType: offerCancelType,
          cancellationPolicyDays: offerCancelDays,
          status: "sent",
          createdAt: serverTimestamp(),
          priceHistory: [
  {
    actor: "hotel",
    kind: "initial",
    price: Number(totalPrice ?? 0),
    note: "İlk teklif",
    createdAt: serverTimestamp()
  }
],

        });

        // 🔔 bildirimler – ilk teklif
        await createNotification(
          db,
          req.guestId,
          "offer_created",
          {
            requestId: req.id,
            hotelId: profile.uid,
            hotelName:
              hotelProfile?.name || profile.displayName || null,
            totalPrice,
            currency,
            commissionRate,
            mode
          }
        );
        await createNotification(
          db,
          profile.uid,
          "offer_created_hotel",
          {
            requestId: req.id,
            totalPrice,
            currency,
            commissionRate,
            mode
          }
        );

        setActionMessage("Teklifin misafire gönderildi.");
      } else {
        if (!canEditPrice(existing)) {
          setActionError(
            "Bu talep için %8 komisyonlu tek teklif hakkını kullandın, fiyat artık düzenlenemez."
          );
          return;
        }

        const ref = doc(db, "offers", existing.id);
        await updateDoc(ref, {
          totalPrice,
          currency,
          note: note || existing.note || null,
          roomBreakdown: breakdownToSave,
          updatedAt: serverTimestamp()
        });

        // 🔔 bildirim – fiyat güncellendi
        await createNotification(
          db,
          req.guestId,
          "offer_updated",
          {
            requestId: req.id,
            hotelId: profile.uid,
            hotelName:
              hotelProfile?.name || profile.displayName || null,
            newTotalPrice: totalPrice,
            currency
          }
        );

        setActionMessage("Bu talep için verdiğin teklif güncellendi.");
      }

      // local state'i yenile
      const hotelId = profile.uid;
      const snapOffers = await getDocs(
        query(collection(db, "offers"), where("hotelId", "==", hotelId))
      );
      const offerData: ExistingOffer[] = snapOffers.docs.map((d) => {
        const v = d.data() as any;
        return {
          id: d.id,
          requestId: v.requestId,
          hotelId: v.hotelId,
          totalPrice: v.totalPrice,
          currency: v.currency,
          mode: (v.mode as OfferMode) ?? "simple",
          commissionRate: (v.commissionRate as CommissionRate) ?? 10,
          status: v.status ?? "sent",
          note: v.note ?? null,
          roomBreakdown: v.roomBreakdown ?? [],
          cancellationPolicyType: v.cancellationPolicyType as
            | CancellationPolicyType
            | undefined,
          cancellationPolicyDays: v.cancellationPolicyDays ?? null,
          createdAt: v.createdAt
        };
      });
      setOffers(offerData);
      resetForm();
    } catch (err) {
      console.error("Teklif kaydedilirken hata:", err);
      setActionError(
        "Teklif kaydedilirken bir hata oluştu. Lütfen tekrar dene."
      );
    } finally {
      setSavingOffer(false);
    }
  }

  function openRequestDetail(req: RequestItem) {
    setDetailRequest(req);
    setDetailOpen(true);
  }

  function closeRequestDetail() {
    setDetailOpen(false);
    setDetailRequest(null);
  }

  /* ------------------- RENDER ------------------- */

  return (
    <Protected allowedRoles={["hotel"]}>
      <div className="container-page space-y-6">
        {/* Başlık */}
        <section className="space-y-2">
          <h1 className="text-2xl font-semibold">
            Gelen misafir talepleri
          </h1>
          <p className="text-sm text-slate-300 max-w-3xl">
            Tüm misafir taleplerini liste halinde görürsün. Filtrele →
            İncele → komisyon modelini ve iptal politikanı seçerek teklif
            ver. Aynı talebe ikinci bir teklif yerine, komisyon oranına
            göre sadece fiyatı güncelleyebilirsin.
          </p>
          {hotelProfile?.city && (
            <p className="text-[0.75rem] text-slate-400">
              Şu an sadece{" "}
              <span className="font-semibold">
                {hotelProfile.city}
                {hotelProfile.district
                  ? ` / ${hotelProfile.district}`
                  : ""}
              </span>{" "}
              için açılmış talepleri görüyorsun.
            </p>
          )}
          {hotelProfile?.roomTypes &&
            hotelProfile.roomTypes.length === 0 && (
              <p className="text-[0.7rem] text-amber-300">
                Oda kırılımı için önce{" "}
                <span className="font-semibold">Otel profilim</span>{" "}
                sayfasından oda tiplerini tanımlaman önerilir.
              </p>
            )}
        </section>

        {/* Filtre paneli */}
        <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 text-xs shadow shadow-slate-950/40 space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-200">
                İlçe
              </label>
              <select
                value={districtFilter}
                onChange={(e) => setDistrictFilter(e.target.value)}
                className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
              >
                <option value="all">Tümü</option>
                {distinctDistricts.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-200">
                Giriş tarihi (ilk)
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
                Çıkış tarihi (son)
              </label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-200">
                Min. kişi / Min. oda
              </label>
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

        {loading && (
          <p className="text-sm text-slate-400">Talepler yükleniyor...</p>
        )}

        {error && (
          <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/40 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        {!loading && filteredRequests.length === 0 && (
          <p className="text-sm text-slate-400">
            Filtrelerine uyan aktif misafir talebi bulunamadı.
          </p>
        )}

        {/* Talepler listesi */}
        {filteredRequests.map((req) => {
          const totalGuests = req.adults + (req.childrenCount ?? 0);
          const roomsCount = req.roomsCount ?? 1;
          const nights = calculateNights(req);
          const deadlineInfo = computeDeadlineInfo(req);
          const existingOffer = findOfferForRequest(req.id);
          const offerEditable = canEditPrice(existingOffer);

          const created = req.createdAt?.toDate();
          const totalMs = (req.responseDeadlineMinutes ?? 0) * 60 * 1000 || 1;
          const now = new Date();
          const elapsed =
            created && totalMs
              ? Math.min(
                  totalMs,
                  Math.max(0, now.getTime() - created.getTime())
                )
              : 0;
          const progressRatio = totalMs ? elapsed / totalMs : 0;
          const progressPercent = Math.round(progressRatio * 100);

          let progressColor = "bg-emerald-500";
          if (progressRatio >= 0.75) progressColor = "bg-red-500";
          else if (progressRatio >= 0.5) progressColor = "bg-amber-400";

          const totalPriceForForm =
            openRequestId === req.id
              ? computeTotalPriceForOpenForm(req)
              : existingOffer?.totalPrice ?? 0;

          const isGroup = req.isGroup || req.type === "group";
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
  Array.isArray((req as any).featureKeys) && (req as any).featureKeys.length
    ? ((req as any).featureKeys as string[]).map((k) => FEATURE_LABEL[k] || k)
    : Array.isArray((req as any).hotelFeaturePrefs) && (req as any).hotelFeaturePrefs.length
    ? ((req as any).hotelFeaturePrefs as string[]).map((k) => FEATURE_LABEL[k] || k)
    : [];

// ✅ Misafirin tüm notlarını tek yerde topla (otel talebi + grup talebi + farklı isimler)
const notesAll = [
  (req as any).note,
  (req as any).notes,
  (req as any).generalNote,
  (req as any).contactNote,
  (req as any).locationNote,
  (req as any).boardTypeNote,
  (req as any).hotelFeatureNote,
  (req as any).extraFeaturesText,
  (req as any).flightNotes,
  (req as any).transferNotes,
  (req as any).activities,
  (req as any).requestNote
]
  .filter((x) => x !== undefined && x !== null && String(x).trim() !== "")
  .map((x) => String(x).trim())
  .join("\n\n");

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
                    {isGroup && (
                      <span className="inline-flex items-center rounded-full border border-amber-500/60 bg-amber-500/10 px-2 py-0.5 text-[0.65rem] text-amber-300">
                        Grup rezervasyonu
                      </span>
                    )}
                    
                  </p>
                  <p className="text-[0.75rem] text-slate-300">
                    Misafir: {maskName(req.guestName)}
                  </p>
                </div>

                

                <div className="space-y-1 text-slate-100">
                  <p className="text-[0.8rem]">
                    Giriş: {req.checkIn} – Çıkış: {req.checkOut}{" "}
                    <span className="text-[0.7rem] text-slate-400">
                      ({nights} gece)
                    </span>
                  </p>
                  <p className="text-[0.7rem] text-slate-400">
                    {totalGuests} kişi • {roomsCount} oda
                  </p>
                </div>

                <div className="space-y-1">
                  <p className="text-[0.75rem] text-slate-400">
                    Oda tipleri
                  </p>
                  <p className="text-[0.7rem] text-slate-200">
                    {req.roomTypes && req.roomTypes.length > 0
                      ? req.roomTypes.map(roomTypeLabel).join(", ")
                      : "Belirtilmemiş"}
                  </p>
                </div>

                <div className="space-y-1">
                  <p
                    className={`text-[0.75rem] font-semibold ${deadlineInfo.color}`}
                  >
                    {deadlineInfo.label}
                  </p>
                  <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full ${progressColor}`}
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1">
                  {existingOffer ? (
                    <span className="inline-flex items-center rounded-md border border-emerald-500/60 bg-emerald-500/10 px-3 py-1 text-[0.7rem] text-emerald-300">
                      Teklif verdin – {existingOffer.totalPrice}{" "}
                      {existingOffer.currency} • %
                      {existingOffer.commissionRate}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-md border border-slate-600 bg-slate-800/60 px-3 py-1 text-[0.7rem] text-slate-200">
                      Henüz teklif vermedin
                    </span>
                  )}

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
                      onClick={() =>
                        openRequestId === req.id
                          ? resetForm()
                          : openFormForRequest(req)
                      }
                      className="rounded-md bg-emerald-500 text-slate-950 px-3 py-1 text-[0.7rem] font-semibold hover:bg-emerald-400"
                    >
                      {openRequestId === req.id
                        ? "Formu gizle"
                        : existingOffer
                        ? offerEditable
                          ? "Fiyatı düzenle"
                          : "Teklif detayı"
                        : "Teklif ver"}
                    </button>
                  </div>
                </div>
              </div>

              {/* Teklif formu */}
              {openRequestId === req.id && (
                <div className="border-t border-slate-800 bg-slate-950 px-4 py-4 text-[0.75rem]">
                  <form
                    onSubmit={(e) => handleSubmitOffer(e, req)}
                    className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/95 p-3"
                  >
                    {(() => {
                      const existingOffer = findOfferForRequest(req.id);
                      if (existingOffer) {
                        return (
                          <p className="text-slate-300 mb-1">
                            Bu talep için daha önce{" "}
                            <span className="font-semibold">
                              {existingOffer.totalPrice}{" "}
                              {existingOffer.currency}
                            </span>{" "}
                            tutarında{" "}
                            <span className="font-semibold">
                              %{existingOffer.commissionRate} komisyonlu
                            </span>{" "}
                            teklif verdin. Bu formda sadece oda bazlı
                            fiyatları ve notu güncelleyebilirsin. Komisyon ve
                            iptal politikası değiştirilemez.
                          </p>
                        );
                      }
                      return (
                        <p className="text-slate-300 mb-1">
                          Bu talep için{" "}
                          <span className="font-semibold">
                            {roomsCount} oda / {nights} gece
                          </span>{" "}
                          için oda bazlı fiyat gir. Seçtiğin{" "}
                          <span className="font-semibold">
                            komisyon oranı
                          </span>{" "}
                          ve{" "}
                          <span className="font-semibold">
                            iptal politikası
                          </span>{" "}
                          bu teklife özel kaydedilecektir.
                        </p>
                      );
                    })()}

                    {/* Oda satırları */}
                    <div className="space-y-2">
                      {roomBreakdown.map((rb, index) => {
                        const nightly = Number(rb.nightlyPrice) || 0;
                        const rowTotal = nightly * nights;
                        const existingOffer = findOfferForRequest(req.id);

                        return (
                          <div
                            key={index}
                            className="grid md:grid-cols-[1.5fr_1fr_1.4fr] gap-2 rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2"
                          >
                            <div className="space-y-1">
                              <label className="text-slate-200">
                                Oda {index + 1} – verilecek oda tipi
                              </label>
                              <select
                                value={rb.roomTypeId}
                                onChange={(e) =>
                                  handleRoomTypeChange(
                                    index,
                                    e.target.value
                                  )
                                }
                                disabled={!!existingOffer}
                                className="w-full rounded-md bg-slate-950 border border-slate-700 px-3 py-2 text-xs disabled:opacity-70"
                              >
                                <option value="">Oda tipi seç</option>
                                {hotelProfile?.roomTypes?.map((rt) => (
                                  <option key={rt.id} value={rt.id}>
                                    {rt.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-1">
                              <label className="text-slate-200">
                                Gecelik fiyat ({currency})
                              </label>
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                value={rb.nightlyPrice}
                                onChange={(e) =>
                                  handleNightlyChange(
                                    index,
                                    e.target.value
                                  )
                                }
                                placeholder="Örn: 1000"
                                className="w-full rounded-md bg-slate-950 border border-slate-700 px-3 py-2 text-xs"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-slate-200">
                                Bu oda için toplam
                              </label>
                              <div className="text-[0.75rem] text-slate-100">
                                {nights} gece ×{" "}
                                {nightly.toLocaleString("tr-TR")}{" "}
                                {currency} ={" "}
                                <span className="font-semibold text-emerald-300">
                                  {rowTotal.toLocaleString("tr-TR")}{" "}
                                  {currency}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Para birimi + komisyon + iptal politikası */}
                    <div className="grid md:grid-cols-3 gap-3 mt-2">
                      <div className="space-y-1">
                        <label className="text-slate-200">
                          Para birimi
                        </label>
                        <select
                          value={currency}
                          onChange={(e) =>
                            setCurrency(e.target.value as any)
                          }
                          className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                        >
                          <option value="TRY">TRY</option>
                          <option value="USD">USD</option>
                          <option value="EUR">EUR</option>
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-slate-200">
                          Komisyon oranı
                        </label>
                        <div className="flex gap-2">
                          {[8, 10, 15].map((rate) => {
                            const existing = findOfferForRequest(req.id);
                            const disabled =
                              !!existing &&
                              existing.commissionRate !==
                                (rate as CommissionRate);
                            return (
                              <button
                                key={rate}
                                type="button"
                                disabled={disabled}
                                onClick={() =>
                                  setCommissionRate(
                                    rate as CommissionRate
                                  )
                                }
                                className={`flex-1 rounded-md border px-2 py-1 text-[0.7rem] ${
                                  commissionRate === rate
                                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                                    : "border-slate-600 text-slate-200 hover:border-emerald-400"
                                } ${
                                  disabled
                                    ? "opacity-50 cursor-not-allowed"
                                    : ""
                                }`}
                              >
                                %{rate}
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-[0.65rem] text-slate-500 mt-0.5">
                          %8: tek teklif hakkı • %10: fiyat düzenleme •
                          %15: fiyat düzenleme + pazarlık.
                        </p>
                      </div>

                      <div className="space-y-1">
                        <label className="text-slate-200">
                          İptal politikası
                        </label>
                        {(() => {
                          const existing = findOfferForRequest(req.id);
                          const readonly = !!existing;
                          return (
                            <div className="space-y-1">
                              <label className="flex items-center gap-2 text-[0.7rem] text-slate-200">
                                <input
                                  type="radio"
                                  name={`cancel-${req.id}`}
                                  disabled={readonly}
                                  checked={
                                    offerCancelType === "non_refundable"
                                  }
                                  onChange={() =>
                                    setOfferCancelType(
                                      "non_refundable"
                                    )
                                  }
                                />
                                İptal edilemez
                              </label>
                              <label className="flex items-center gap-2 text-[0.7rem] text-slate-200">
                                <input
                                  type="radio"
                                  name={`cancel-${req.id}`}
                                  disabled={readonly}
                                  checked={
                                    offerCancelType === "flexible"
                                  }
                                  onChange={() =>
                                    setOfferCancelType("flexible")
                                  }
                                />
                                Her zaman ücretsiz iptal
                              </label>
                              <label className="flex items-center gap-2 text-[0.7rem] text-slate-200">
                                <input
                                  type="radio"
                                  name={`cancel-${req.id}`}
                                  disabled={readonly}
                                  checked={
                                    offerCancelType ===
                                    "until_days_before"
                                  }
                                  onChange={() =>
                                    setOfferCancelType(
                                      "until_days_before"
                                    )
                                  }
                                />
                                Girişten{" "}
                                <input
                                  type="number"
                                  min={1}
                                  max={30}
                                  disabled={
                                    readonly ||
                                    offerCancelType !==
                                      "until_days_before"
                                  }
                                  value={offerCancelDays ?? 3}
                                  onChange={(e) =>
                                    setOfferCancelDays(
                                      Number(e.target.value) || 1
                                    )
                                  }
                                  className="w-12 rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-[0.7rem]"
                                />{" "}
                                gün önceye kadar ücretsiz iptal
                              </label>
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    {/* Misafire not */}
                    <div className="space-y-1">
                      <label className="text-slate-200">
                        Misafire not
                      </label>
                      <textarea
                        rows={2}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Örn: Fiyat sadece bu tarihler için geçerlidir, girişte upgrade imkanı vardır vb."
                        className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs resize-none"
                      />
                    </div>

                    {/* Toplam fiyat ve butonlar */}
                    <div className="flex flex-wrap items-center justify-between gap-2 mt-1">
                      <div className="space-y-1">
                        <p className="text-[0.75rem] text-slate-200">
                          Bu talep için hesaplanan toplam fiyat:{" "}
                          <span className="font-semibold text-emerald-300">
                            {totalPriceForForm.toLocaleString("tr-TR")}{" "}
                            {currency}
                          </span>
                        </p>
                        <p className="text-[0.7rem] text-slate-500">
                          Misafir önce sadece toplam fiyatı görecek; detay
                          ekranında oda oda gecelik ve toplam fiyat
                          kırılımı görüntülenecek. Komisyon ve iptal
                          politikası ilk teklifte belirlenir, sonradan
                          değiştirilemez.
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
                          disabled={savingOffer}
                          className="rounded-md bg-emerald-500 text-slate-950 px-3 py-1 text-[0.7rem] font-semibold hover:bg-emerald-400 disabled:opacity-60"
                        >
                          {savingOffer
                            ? "Kaydediliyor..."
                            : findOfferForRequest(req.id)
                            ? "Teklifi güncelle"
                            : "Teklif gönder"}
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
              )}
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
            onClose={closeRequestDetail}
          />
        )}
      </div>
    </Protected>
  );
}
/* ----------------------- TALEP DETAY MODAL (GÜNCEL) ----------------------- */

import {onSnapshot } from "firebase/firestore";

/** ---------------------------
 *  RequestDetailModal (HOTEL)
 *  - Talep: requests/{id} live
 *  - Teklif: offers/{id} live (varsa)
 *  - Otel profil/oda: users/{hotelId} live (varsa)
 *  - KVKK: accepted olana kadar maskeli
 *  - Timeline: TL/% fark rozetli
 * --------------------------- */
export function RequestDetailModal({
  req,
  offer,
  onClose
}: {
  req: any; // RequestItem
  offer?: any; // ExistingOffer
  onClose: () => void;
}) {
  const db = getFirestoreDb();

  // ✅ canlı talep + canlı teklif + canlı otel profili
  const [liveReq, setLiveReq] = useState<any>(req);
  const [liveOffer, setLiveOffer] = useState<any | null>(offer ?? null);
  const [liveHotel, setLiveHotel] = useState<any | null>(null);

  const [reqLoading, setReqLoading] = useState(true);
  const [offerLoading, setOfferLoading] = useState(false);
  const [hotelLoading, setHotelLoading] = useState(false);

  // oda modal
  const [roomModalOpen, setRoomModalOpen] = useState(false);
  const [activeRoomProfile, setActiveRoomProfile] = useState<any | null>(null);

  /* ---------------- Helpers ---------------- */

  function safeStr(v: any, fb = "—") {
    if (v === null || v === undefined) return fb;
    const s = String(v).trim();
    return s.length ? s : fb;
  }

  function safeNum(v: any, d = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  }

  function money(n: any, currency: string) {
    const val = safeNum(n, 0);
    return `${val.toLocaleString("tr-TR")} ${currency || "TRY"}`;
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

  function toTR(ts: any) {
    try {
      if (!ts) return "";
      if (typeof ts?.toDate === "function") return ts.toDate().toLocaleString("tr-TR");
      const d = new Date(ts);
      return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("tr-TR");
    } catch {
      return "";
    }
  }

  function pctChange(prev: number, next: number) {
    if (!Number.isFinite(prev) || prev <= 0) return null;
    const pct = ((next - prev) / prev) * 100;
    return Math.round(pct * 10) / 10; // 1 ondalık
  }

  function deltaTone(delta: number) {
    if (delta > 0) return "border-red-500/35 bg-red-500/10 text-red-200";
    if (delta < 0) return "border-emerald-500/35 bg-emerald-500/10 text-emerald-200";
    return "border-slate-700 bg-slate-950/60 text-slate-200";
  }

  // dot-path pick
  function pick(obj: any, keys: string[], fallback: any = null) {
    for (const k of keys) {
      const parts = k.split(".").filter(Boolean);
      let cur = obj;
      for (const p of parts) cur = cur?.[p];
      if (cur !== undefined && cur !== null && String(cur).trim() !== "") return cur;
    }
    return fallback;
  }

  // KVKK maskeleme
  function maskName(name?: string | null): string {
    if (!name) return "Misafir";
    const parts = String(name).split(" ").filter(Boolean);
    return parts.map((p) => p[0] + "*".repeat(Math.max(2, p.length - 1))).join(" ");
  }
  function maskCompany(name?: string | null): string {
    if (!name) return "—";
    const s = String(name).trim();
    if (!s) return "—";
    return s[0] + "*".repeat(Math.max(4, s.length - 1));
  }
  function maskEmail(email?: string | null): string {
    if (!email) return "—";
    const [user, domain] = String(email).split("@");
    if (!domain) return "—";
    const [dn, ext] = domain.split(".");
    const mu = (user?.[0] || "*") + "*".repeat(Math.max(3, (user || "").length - 1));
    const md = (dn?.[0] || "*") + "*".repeat(Math.max(3, (dn || "").length - 1));
    return `${mu}@${md}${ext ? "." + ext : ""}`;
  }
  function maskPhone(phone?: string | null): string {
    if (!phone) return "—";
    const s = String(phone);
    const digits = s.replace(/\D/g, "");
    if (digits.length < 4) return "—";
    const last2 = digits.slice(-2);
    const prefix = s.slice(0, 4); // +90 gibi
    return `${prefix} ***** ${last2}`;
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

  // label map’leri
  const BOARD_LABEL: Record<string, string> = {
    RO: "Sadece oda (RO)",
    BB: "Oda + Kahvaltı (BB)",
    HB: "Yarım pansiyon (HB)",
    FB: "Tam pansiyon (FB)",
    AI: "Her şey dahil (AI)",
    UAI: "Ultra her şey dahil (UAI)"
  };

  const ACCOM_LABEL: Record<string, string> = {
    hotel: "Otel",
    boutique: "Butik otel",
    motel: "Motel",
    pension: "Pansiyon",
    apartHotel: "Apart otel",
    apartment: "Daire / Apart",
    bungalow: "Bungalov",
    holidayVillage: "Tatil köyü / Resort",
    hostel: "Hostel"
  };

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

  // roomTypeLabel (senin sistemindeki key’lere göre)
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
        return type ? String(type) : "Fark etmez";
    }
  }

  function cancellationPolicyLabelForOffer(type?: any, days?: number) {
    const t = type ?? "non_refundable";
    const d = days ?? 3;
    if (t === "non_refundable") return "İptal edilemez / iade yok.";
    if (t === "flexible") return "Giriş tarihine kadar ücretsiz iptal.";
    if (t === "until_days_before") return `Giriş tarihinden ${d} gün öncesine kadar ücretsiz iptal.`;
    return "Belirtilmemiş";
  }

  // ---------------- Firestore LIVE ----------------

  // 1) request live (tam doc)
  useEffect(() => {
    const reqId = req?.id || req?.requestId || null;
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

    return () => {
      try {
        unsub();
      } catch {}
    };
  }, [db, req?.id, req?.requestId]);

  // 2) offer live (varsa)
  useEffect(() => {
    const offerId = offer?.id || offer?.offerId || null;
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

    return () => {
      try {
        unsub();
      } catch {}
    };
  }, [db, offer?.id, offer?.offerId]);

  // 3) hotel profile live (roomTypes için)
  useEffect(() => {
    const hid = (offer as any)?.hotelId || (liveOffer as any)?.hotelId || null;
    if (!hid) {
      setHotelLoading(false);
      return;
    }

    setHotelLoading(true);
    const unsub = onSnapshot(
      doc(db, "users", hid),
      (snap) => {
        if (snap.exists()) setLiveHotel({ id: snap.id, ...(snap.data() as any) });
        else setLiveHotel(null);
        setHotelLoading(false);
      },
      () => setHotelLoading(false)
    );

    return () => {
      try {
        unsub();
      } catch {}
    };
  }, [db, (offer as any)?.hotelId, (liveOffer as any)?.hotelId]);

  const reqAny: any = liveReq || {};
  const offerAny: any = liveOffer || offer || null;

  // KVKK unlock kuralı: accepted olunca aç
  const isUnlocked = offerAny ? String(offerAny.status || "") === "accepted" : false;

  // ---------------- Request normalize ----------------
  const nights = useMemo(() => {
    try {
      const ci = pick(reqAny, ["checkIn"], null);
      const co = pick(reqAny, ["checkOut"], null);
      if (!ci || !co) return 1;
      const d1 = new Date(ci);
      const d2 = new Date(co);
      const diff = Math.floor((d2.setHours(0, 0, 0, 0) - d1.setHours(0, 0, 0, 0)) / 86400000);
      return diff > 0 ? diff : 1;
    } catch {
      return 1;
    }
  }, [reqAny]);

  const adults = safeNum(pick(reqAny, ["adults"], 0), 0);
  const childrenCount = safeNum(pick(reqAny, ["childrenCount"], 0), 0);
  const totalGuests = adults + childrenCount;
  const roomsCount = safeNum(pick(reqAny, ["roomsCount"], 1), 1);
  const childrenAges: number[] = Array.isArray(reqAny?.childrenAges) ? reqAny.childrenAges : [];

  const isGroup = !!(reqAny.isGroup || reqAny.type === "group");

  const starsText =
    Array.isArray(reqAny?.desiredStarRatings) && reqAny.desiredStarRatings.length
      ? reqAny.desiredStarRatings.map((s: any) => `${s}★`).join(", ")
      : (reqAny.starRating ? `${reqAny.starRating}★` : null);

  const requestBoardText =
    (reqAny as any).boardType
      ? BOARD_LABEL[String((reqAny as any).boardType)] || String((reqAny as any).boardType)
      : Array.isArray(reqAny.boardTypes) && reqAny.boardTypes.length
      ? reqAny.boardTypes.map((b: any) => BOARD_LABEL[b] || b).join(", ")
      : null;

  const requestAccomText =
    (reqAny as any).accommodationType
      ? ACCOM_LABEL[String((reqAny as any).accommodationType)] || String((reqAny as any).accommodationType)
      : ((reqAny as any).hotelType ? (ACCOM_LABEL[String((reqAny as any).hotelType)] || String((reqAny as any).hotelType)) : null);

  const requestFeatures =
    Array.isArray((reqAny as any).featureKeys) && (reqAny as any).featureKeys.length
      ? ((reqAny as any).featureKeys as string[]).map((k) => FEATURE_LABEL[k] || k)
      : Array.isArray(reqAny.hotelFeaturePrefs) && reqAny.hotelFeaturePrefs.length
      ? reqAny.hotelFeaturePrefs.map((k: any) => FEATURE_LABEL[k] || k)
      : [];

  const requestFeatureNote =
    (reqAny as any).extraFeaturesText ||
    reqAny.hotelFeatureNote ||
    (reqAny as any).locationNote ||
    reqAny.boardTypeNote ||
    null;
    // ✅ notesAll her zaman string olsun (TS hatası bitiyor)
const notesAll: string = String(
  (req as any).notes ||
  (req as any).note ||
  (req as any).generalNote ||
  (req as any).contactNote ||
  (req as any).locationNote ||
  (req as any).boardTypeNote ||
  (req as any).hotelFeatureNote ||
  (req as any).extraFeaturesText ||
  (req as any).flightNotes ||
  (req as any).transferNotes ||
  (req as any).activities ||
  ""
).trim();


  const nearMe = Boolean((reqAny as any).nearMe);
  const nearMeKm = (reqAny as any).nearMeKm ?? null;

  const responseText = (() => {
    const mins = reqAny.responseDeadlineMinutes ?? null;
    const amt = (reqAny as any).responseTimeAmount ?? null;
    const unit = (reqAny as any).responseTimeUnit ?? null;
    if (amt && unit) return `${amt} ${unit === "minutes" ? "dakika" : unit === "hours" ? "saat" : "gün"}`;
    if (mins) return `${mins} dakika`;
    return null;
  })();

  // oda talepleri
  const guestWantsRoomsText = (() => {
    const rows = Array.isArray(reqAny.roomTypeRows) ? reqAny.roomTypeRows : [];
    const counts = reqAny.roomTypeCounts && typeof reqAny.roomTypeCounts === "object" ? reqAny.roomTypeCounts : null;
    const types = Array.isArray(reqAny.roomTypes) ? reqAny.roomTypes : [];

    if (rows.length) return rows.map((r: any) => `${roomTypeLabel(r?.typeKey)}: ${safeNum(r?.count, 1)}`).join(" • ");
    if (counts) return Object.entries(counts).map(([k, v]: any) => `${roomTypeLabel(k)}: ${v}`).join(" • ");
    if (types.length) return types.map((t: any) => roomTypeLabel(t)).join(", ");
    return "Farketmez";
  })();

  // ---------------- Offer normalize ----------------
  const offerCurrency = offerAny?.currency ?? "TRY";
  const offerTotalPrice = safeNum(offerAny?.totalPrice, 0);
  const offerNote = offerAny?.note ?? null;

  const cancelText = offerAny
    ? cancellationPolicyLabelForOffer(offerAny.cancellationPolicyType, offerAny.cancellationPolicyDays ?? undefined)
    : null;

  const roomBreakdown = offerAny && Array.isArray(offerAny.roomBreakdown) ? offerAny.roomBreakdown : [];

  // otel room types (profil)
  const hotelRoomTypes = useMemo(() => {
    const hp = (liveHotel as any)?.hotelProfile ?? {};
    const rt = hp.roomTypes ?? hp.rooms ?? hp.roomCatalog ?? hp.roomTypeCatalog ?? [];
    return Array.isArray(rt) ? rt : [];
  }, [liveHotel]);

  function findRoomProfile(roomTypeId?: string | null, roomTypeName?: string | null) {
    if (!roomTypeId && !roomTypeName) return null;
    if (roomTypeId) {
      const hit = hotelRoomTypes.find((r: any) => r?.id === roomTypeId);
      if (hit) return hit;
    }
    if (roomTypeName) {
      const hit = hotelRoomTypes.find(
        (r: any) => String(r?.name || r?.title || "").toLowerCase() === String(roomTypeName).toLowerCase()
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

  const hotelOffersRoomsText = (() => {
    if (!roomBreakdown.length) return "Oda kırılımı yok";
    return roomBreakdown.map((rb: any) => rb?.roomTypeName || rb?.roomTypeId || "Oda").join(", ");
  })();

  const roomsMatchText =
    guestWantsRoomsText === hotelOffersRoomsText ? "Eşleşiyor" : "Farklı olabilir";

  // ---------------- Timeline (priceHistory + TL/% rozet) ----------------
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
        actor: (h?.actor === "guest" ? "guest" : "hotel") as "hotel" | "guest",
        kind: (h?.kind || (h?.actor === "guest" ? "counter" : "update")) as any,
        price: Number.isFinite(Number(h?.price)) ? Number(h.price) : null,
        note: String(h?.note ?? ""),
        createdAt: h?.createdAt ?? null
      }))
      .sort((a: any, b: any) => toMillis(a?.createdAt) - toMillis(b?.createdAt));

    const out: TimelineItem[] = [];
    const nowPrice = Number.isFinite(Number(offerAny.totalPrice)) ? Number(offerAny.totalPrice) : null;

    const hasAccepted = String(offerAny.status || "") === "accepted";
    const hasRejected = String(offerAny.status || "") === "rejected";

    if (sorted.length > 0) {
      const hasInitial = sorted.some((x: any) => x.actor === "hotel" && x.kind === "initial" && x.price && x.price > 0);
      if (!hasInitial) {
        out.push({
          actor: "system",
          kind: "info",
          price: null,
          note: "Başlangıç (initial) kaydı yok. Otel initial yazmadığı için ilk fiyat bilinmiyor.",
          createdAt: offerAny.createdAt ?? null
        });
      }

      for (const h of sorted) {
        out.push({
          actor: h.actor,
          kind: h.kind === "initial" ? "initial" : h.kind === "counter" ? "counter" : "update",
          price: h.price,
          note:
            h.note ||
            (h.kind === "initial" ? "İlk teklif" : h.kind === "counter" ? "Misafir karşı teklif" : "Fiyat güncellendi"),
          createdAt: h.createdAt
        });
      }

      // current canlı satırı (history ile aynıysa ekleme)
      const lastHistPrice = [...out].reverse().find((x) => typeof x.price === "number" && (x.price as number) > 0)?.price ?? null;
      if (nowPrice && (!lastHistPrice || lastHistPrice !== nowPrice)) {
        out.push({
          actor: "system",
          kind: "current",
          price: nowPrice,
          note: "Güncel fiyat (canlı)",
          createdAt: offerAny.updatedAt ?? null
        });
      }

      if (hasAccepted) {
        out.push({ actor: "system", kind: "accepted", price: nowPrice ?? lastHistPrice, note: "Kabul edildi", createdAt: offerAny.acceptedAt ?? null });
      }
      if (hasRejected) {
        out.push({ actor: "system", kind: "rejected", price: nowPrice ?? lastHistPrice, note: "Reddedildi", createdAt: offerAny.rejectedAt ?? null });
      }

      return out;
    }

    // history yoksa: tek fiyat
    if (nowPrice && nowPrice > 0) {
      out.push({ actor: "hotel", kind: "initial", price: nowPrice, note: "Tek fiyat (priceHistory yok)", createdAt: offerAny.createdAt ?? null });
      return out;
    }

    out.push({ actor: "system", kind: "info", price: null, note: "Fiyat bilgisi bulunamadı.", createdAt: offerAny.createdAt ?? null });
    return out;
  }, [offerAny]);

  // initial gerçek (header için)
  const initialPrice = useMemo(() => {
    if (!offerAny) return null;
    const rawHist = Array.isArray(offerAny.priceHistory) ? offerAny.priceHistory : [];
    const sorted = rawHist.slice().sort((a: any, b: any) => toMillis(a?.createdAt) - toMillis(b?.createdAt));
    const init = sorted.find((h: any) => h?.actor === "hotel" && h?.kind === "initial" && Number(h?.price) > 0);
    return init ? Number(init.price) : null;
  }, [offerAny]);

  const currentPrice = offerAny ? safeNum(offerAny.totalPrice, 0) : 0;

  const overallDelta = useMemo(() => {
    if (!initialPrice || initialPrice <= 0) return null;
    return currentPrice - initialPrice;
  }, [initialPrice, currentPrice]);

  const overallPct = useMemo(() => {
    if (!initialPrice || initialPrice <= 0) return null;
    return pctChange(initialPrice, currentPrice);
  }, [initialPrice, currentPrice]);

  // KVKK iletişim alanları (request içinde farklı isimler olabilir)
  const contactName = pick(reqAny, ["contactName", "guestName", "contact.name", "createdByName"], null);
  const contactEmail = pick(reqAny, ["contactEmail", "guestEmail", "contact.email", "email", "createdByEmail"], null);
  const contactPhone = pick(reqAny, ["contactPhone", "guestPhone", "contact.phone", "createdByPhone"], null);
  const contactCompany = pick(reqAny, ["contactCompany", "company"], null);

  const nameToShow = isUnlocked ? safeStr(contactName, "Misafir") : maskName(contactName);
  const emailToShow = isUnlocked ? safeStr(contactEmail) : maskEmail(contactEmail);
  const phoneToShow = isUnlocked ? safeStr(contactPhone) : maskPhone(contactPhone);
  const companyToShow = isUnlocked ? safeStr(contactCompany) : maskCompany(contactCompany);

  // JSON kopyala
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
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />

      <div className="relative mt-10 w-full max-w-5xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-xl shadow-slate-950/60 max-h-[86vh] overflow-y-auto text-[0.8rem] space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-slate-100">Talep detayı</h2>

              {isGroup ? (
                <span className="inline-flex items-center rounded-full border border-amber-500/60 bg-amber-500/10 px-2.5 py-0.5 text-[0.7rem] text-amber-300">
                  Grup talebi
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full border border-sky-500/60 bg-sky-500/10 px-2.5 py-0.5 text-[0.7rem] text-sky-300">
                  Otel talebi
                </span>
              )}

              <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900 px-2.5 py-0.5 text-[0.7rem] text-slate-300">
                KVKK: Kimlik gizli
              </span>

              {reqLoading ? (
                <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[0.7rem] text-slate-200">
                  Talep okunuyor…
                </span>
              ) : null}

              {offerLoading ? (
                <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[0.7rem] text-slate-200">
                  Teklif güncelleniyor…
                </span>
              ) : null}
            </div>

            <p className="text-[0.75rem] text-slate-400">
              Misafir: <span className="text-slate-200 font-semibold">{maskName(pick(reqAny, ["guestName"], "Misafir"))}</span>
              <span className="text-slate-500"> (rezervasyon onaylanana kadar maskeli)</span>
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-[0.75rem] text-slate-200 hover:border-emerald-400 transition"
          >
            Kapat ✕
          </button>
        </div>

        {/* Üst Özet Kartları */}
        <div className="grid md:grid-cols-3 gap-3">
          {/* Konaklama */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 space-y-1">
            <p className="text-[0.7rem] text-slate-400">Konaklama</p>
            <p className="text-slate-100 font-semibold">
              {safeStr(reqAny.city)}
              {reqAny.district ? ` / ${reqAny.district}` : ""}
            </p>
            <p className="text-[0.75rem] text-slate-300">
              {safeStr(reqAny.checkIn)} → {safeStr(reqAny.checkOut)}{" "}
              <span className="text-slate-400">• {nights} gece</span>
            </p>

            {nearMe && (
              <p className="text-[0.7rem] text-emerald-300">
                Yakınımda ara: <span className="font-semibold">{nearMeKm ?? 10} km</span>
              </p>
            )}
          </div>

          {/* Kişi & Oda */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 space-y-1">
            <p className="text-[0.7rem] text-slate-400">Kişi & Oda</p>
            <p className="text-slate-100 font-semibold">
              {totalGuests} kişi <span className="text-slate-400">•</span> {roomsCount} oda
            </p>
            <p className="text-[0.75rem] text-slate-300">
              Yetişkin: <span className="font-semibold">{adults}</span> • Çocuk:{" "}
              <span className="font-semibold">{childrenCount}</span>
            </p>

            {(childrenCount ?? 0) > 0 && childrenAges.length > 0 && (
              <p className="text-[0.75rem] text-slate-300">
                Çocuk yaşları: <span className="text-slate-100 font-semibold">{childrenAges.join(", ")}</span>
              </p>
            )}
          </div>

          {/* Tercihler */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 space-y-1">
            <p className="text-[0.7rem] text-slate-400">Tercihler</p>

            {requestAccomText && (
              <p className="text-[0.75rem] text-slate-300">
                Tesis türü: <span className="text-slate-100 font-semibold">{requestAccomText}</span>
              </p>
            )}

            {requestBoardText && (
              <p className="text-[0.75rem] text-slate-300">
                Konaklama tipi: <span className="text-slate-100 font-semibold">{requestBoardText}</span>
              </p>
            )}

            {starsText && (
              <p className="text-[0.75rem] text-slate-300">
                Yıldız: <span className="text-amber-300 font-semibold">{starsText}</span>
              </p>
            )}

            {responseText && (
              <p className="text-[0.75rem] text-slate-300">
                Cevap süresi: <span className="text-slate-100 font-semibold">{responseText}</span>
              </p>
            )}
          </div>
        </div>

        {/* Oda tipi tercihleri */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[0.75rem] text-slate-200 font-semibold">Oda talepleri</p>
            <span className="text-[0.7rem] text-slate-400">(teklif verirken kontrol)</span>
          </div>

          {isGroup && Array.isArray(reqAny.roomTypeRows) && reqAny.roomTypeRows.length > 0 ? (
            <div className="grid md:grid-cols-2 gap-2">
              {reqAny.roomTypeRows.map((row: any, idx: number) => (
                <div key={idx} className="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2">
                  <p className="text-slate-100 font-semibold">{roomTypeLabel(row.typeKey)}</p>
                  <p className="text-[0.75rem] text-slate-300">
                    Adet: <span className="font-semibold">{row.count}</span>
                  </p>
                </div>
              ))}
            </div>
          ) : Array.isArray(reqAny.roomTypes) && reqAny.roomTypes.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {reqAny.roomTypes.map((t: any, idx: number) => (
                <span
                  key={idx}
                  className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-[0.7rem] text-slate-200"
                >
                  {roomTypeLabel(t)}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[0.75rem] text-slate-400">Oda tipi tercihi belirtilmemiş.</p>
          )}
        </div>

        {/* Özellikler + Notlar */}
        <div className="grid md:grid-cols-2 gap-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
            <p className="text-[0.75rem] text-slate-200 font-semibold">Otel özellik istekleri</p>

            {requestFeatures.length > 0 ? (
              <div className="flex flex-wrap gap-2">
              {requestFeatures.map((f: string, idx: number) => (
  <span
    key={`${f}-${idx}`}
    className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[0.7rem] text-emerald-200"
  >
    {f}
  </span>
))}

              </div>
            ) : (
              <p className="text-[0.75rem] text-slate-400">Özellik seçilmemiş.</p>
            )}

            {requestFeatureNote ? (
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                <p className="text-[0.7rem] text-slate-400">Ek özellik / Konum notu</p>
                <p className="text-[0.75rem] text-slate-200 whitespace-pre-wrap">{String(requestFeatureNote)}</p>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
            <p className="text-[0.75rem] text-slate-200 font-semibold">Misafirin notları (tam)</p>
          {notesAll.trim().length > 0 ? (
  <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
    <p className="text-[0.75rem] text-slate-200 whitespace-pre-wrap">{notesAll}</p>
  </div>
) : (
  <p className="text-[0.75rem] text-slate-400">Not yok.</p>
)}


          </div>
        </div>

        {/* KVKK İletişim (maskeli / unlocked) */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[0.75rem] text-slate-200 font-semibold">İletişim bilgileri</p>
            <span className="text-[0.7rem] text-slate-400">{isUnlocked ? "Rezervasyon sonrası açık" : "Rezervasyona kadar maskeli"}</span>
          </div>

          <div className="grid md:grid-cols-2 gap-2">
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
              <p className="text-[0.7rem] text-slate-400">Ad soyad</p>
              <p className="text-[0.8rem] text-slate-100 font-semibold">{nameToShow}</p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
              <p className="text-[0.7rem] text-slate-400">Firma / kurum</p>
              <p className="text-[0.8rem] text-slate-100 font-semibold">{companyToShow}</p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
              <p className="text-[0.7rem] text-slate-400">E-posta</p>
              <p className="text-[0.8rem] text-slate-100 font-semibold">{emailToShow}</p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
              <p className="text-[0.7rem] text-slate-400">Telefon</p>
              <p className="text-[0.8rem] text-slate-100 font-semibold">{phoneToShow}</p>
            </div>
          </div>

          <p className="text-[0.7rem] text-slate-500">
            KVKK gereği bu bilgiler rezervasyon onaylanana kadar gizlenir. Rezervasyon oluştuğunda otel & misafir “Rezervasyonlar” ekranında tam bilgileri görür.
          </p>
        </div>

        {/* ✅ Bu talep için verdiğin teklif (varsa) */}
        {offerAny ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[0.85rem] text-slate-100 font-semibold">Bu talep için verdiğin teklif</p>
                <p className="text-[0.75rem] text-slate-400">
                  Durum: <span className="text-slate-200 font-semibold">{safeStr(offerAny.status, "sent")}</span>
                  {offerAny.createdAt ? <> • Gönderim: <span className="text-slate-200">{toTR(offerAny.createdAt)}</span></> : null}
                  {offerAny.updatedAt ? <> • Güncelleme: <span className="text-slate-200">{toTR(offerAny.updatedAt)}</span></> : null}
                </p>
              </div>

              <div className="text-right">
                <p className="text-[0.7rem] text-slate-400">Toplam</p>
                <p className="text-emerald-300 font-extrabold text-base">{money(offerTotalPrice, offerCurrency)}</p>
                {initialPrice != null ? (
                  <p className="text-[0.72rem] text-slate-400 mt-1">
                    Başlangıç: <span className="text-slate-200 font-semibold">{money(initialPrice, offerCurrency)}</span>
                  </p>
                ) : (
                  <p className="text-[0.72rem] text-amber-200 mt-1">Başlangıç: initial yok (bilinmiyor)</p>
                )}

                {overallDelta != null && overallPct != null ? (
                  <p className={`text-[0.72rem] mt-1 ${overallDelta <= 0 ? "text-emerald-200" : "text-red-200"}`}>
                    {overallDelta <= 0 ? "İndirim" : "Artış"}:{" "}
                    <span className="font-semibold">
                      {overallDelta > 0 ? "+" : ""}
                      {Math.round(overallDelta).toLocaleString("tr-TR")} {offerCurrency}
                    </span>{" "}
                    <span className="opacity-90">({overallPct > 0 ? "+" : ""}{overallPct}%)</span>
                  </p>
                ) : null}
              </div>
            </div>

            {cancelText ? (
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                <p className="text-[0.7rem] text-slate-400">İptal politikası</p>
                <p className="text-[0.75rem] text-slate-200">{cancelText}</p>
              </div>
            ) : null}

            {offerNote ? (
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                <p className="text-[0.7rem] text-slate-400">Misafire not</p>
                <p className="text-[0.75rem] text-slate-200 whitespace-pre-wrap">{String(offerNote)}</p>
              </div>
            ) : null}

            {/* Oda kırılımı (teklif) */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
              <p className="text-[0.7rem] text-slate-400">Oda kırılımı (teklif) — tıkla, oda detayını aç</p>

              {roomBreakdown.length ? (
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  {roomBreakdown.map((rb: any, idx: number) => {
                    const roomLabel = safeStr(rb?.roomTypeName || rb?.name || "Oda");
                    const n = safeNum(rb?.nights, nights);
                    const nightly = safeNum(rb?.nightlyPrice, 0);
                    const total = safeNum(rb?.totalPrice, nightly * n);

                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => openRoomModal(rb)}
                        className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 hover:bg-white/[0.03] text-left"
                        title="Oda detayını aç"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-slate-100 font-semibold flex items-center gap-2">
                              {roomLabel}
                              <span className="text-slate-400 text-[0.75rem]">↗</span>
                            </p>
                            <p className="text-[0.75rem] text-slate-400">
                              {n} gece × {nightly.toLocaleString("tr-TR")} {offerCurrency}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-[0.7rem] text-slate-400">Toplam</p>
                            <p className="text-emerald-300 font-extrabold">{money(total, offerCurrency)}</p>
                            <p className="text-[0.7rem] text-slate-500">Detay ▶</p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[0.75rem] text-slate-400 mt-2">Bu teklifte oda kırılımı yok.</p>
              )}
            </div>

            {/* Fiyat geçmişi / pazarlık (TL/% rozet) */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[0.75rem] text-slate-200 font-semibold">Fiyat geçmişi / pazarlık</p>
                <span className="text-[0.7rem] text-slate-400">Adım: {timeline.length}</span>
              </div>

              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {timeline.map((h: TimelineItem, i: number) => {
                  // prev price
                  let prev: number | null = null;
                  for (let j = i - 1; j >= 0; j--) {
                    const p = timeline[j]?.price;
                    if (typeof p === "number" && p > 0) { prev = p; break; }
                  }
                  const cur = typeof h.price === "number" ? h.price : null;

                  const canDelta = prev != null && cur != null && prev > 0 && cur > 0;
                  const delta = canDelta ? (cur! - prev!) : null;
                  const pct = canDelta ? pctChange(prev!, cur!) : null;

                  const deltaLabel =
                    delta == null || delta === 0 ? "" : `${delta > 0 ? "+" : ""}${Math.round(delta).toLocaleString("tr-TR")} ${offerCurrency}`;
                  const pctLabel =
                    pct == null || pct === 0 ? "" : `${pct > 0 ? "+" : ""}${pct}%`;

                  const actorLabel = h.actor === "hotel" ? "Otel" : h.actor === "guest" ? "Misafir" : "Sistem";
                  const kindLabel =
                    h.kind === "initial" ? "İlk fiyat" :
                    h.kind === "update" ? "Güncelleme" :
                    h.kind === "counter" ? "Karşı teklif" :
                    h.kind === "current" ? "Güncel" :
                    h.kind === "accepted" ? "Kabul" :
                    h.kind === "rejected" ? "Ret" : "Bilgi";

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
                            <span className="text-slate-100 font-semibold">{kindLabel}</span>
                          </div>
                          {toTR(h.createdAt) ? <div className="text-[0.7rem] text-slate-500">{toTR(h.createdAt)}</div> : null}
                          <div className="text-[0.75rem] text-slate-300 whitespace-pre-wrap">{h.note || "—"}</div>
                        </div>

                        <div className="text-right space-y-2">
                          <span className="inline-flex items-center rounded-md border border-sky-500/35 bg-sky-500/10 px-2 py-1 text-[0.72rem] text-sky-200">
                            {cur != null ? money(cur, offerCurrency) : "—"}
                          </span>

                          <div className="flex justify-end gap-2 flex-wrap">
                            {deltaLabel ? (
                              <span className={`inline-flex items-center rounded-md border px-2 py-1 text-[0.72rem] ${deltaTone(delta!)}`}>
                                {deltaLabel}
                              </span>
                            ) : null}
                            {pctLabel ? (
                              <span className={`inline-flex items-center rounded-md border px-2 py-1 text-[0.72rem] ${deltaTone(delta!)}`}>
                                {pctLabel}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}

        {/* DB FULL alanları */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[0.8rem] text-slate-100 font-semibold">Misafir talebi (DB’deki tüm bilgiler)</p>
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
              Kopyala
            </button>
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            {[
              { k: "Şehir", v: reqAny.city },
              { k: "İlçe", v: reqAny.district },
              { k: "Check-in", v: reqAny.checkIn },
              { k: "Check-out", v: reqAny.checkOut },
              { k: "Yetişkin", v: reqAny.adults },
              { k: "Çocuk", v: reqAny.childrenCount },
              { k: "Çocuk yaşları", v: reqAny.childrenAges },
              { k: "Oda sayısı", v: reqAny.roomsCount },
              { k: "Board/Plan", v: requestBoardText || reqAny.boardTypes || reqAny.boardType },
              { k: "Tesis türü", v: requestAccomText || (reqAny as any).accommodationType || (reqAny as any).hotelType },
              { k: "Yıldız", v: starsText },
              { k: "İstenen özellikler", v: requestFeatures.length ? requestFeatures.join(" • ") : "—" },
              { k: "Ek özellik notu", v: requestFeatureNote },
              { k: "Yakınımda", v: nearMe ? `Açık (${nearMeKm ?? 10} km)` : "Kapalı" }
            ].map((it) => (
              <div key={it.k} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-[0.72rem] text-slate-400">{it.k}</p>
                <pre className="text-slate-100 text-sm mt-1 whitespace-pre-wrap">{renderValue(it.v)}</pre>
              </div>
            ))}
          </div>
          

          <details className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
            <summary className="cursor-pointer text-[0.8rem] text-slate-200 font-semibold">Tüm alanları aç (JSON)</summary>
            <pre className="mt-3 whitespace-pre-wrap text-[0.72rem] text-slate-300 overflow-x-auto">{prettyReqJson}</pre>
          </details>
        </div>

        {/* Footer */}
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

      {/* ROOM MODAL */}
      {roomModalOpen && activeRoomProfile ? (
        <RoomProfileModal room={activeRoomProfile} onClose={closeRoomModal} />
      ) : null}
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

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/70">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />

      <div className="relative mt-12 w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-2xl max-h-[85vh] overflow-y-auto space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-extrabold text-slate-100">{name}</h3>
            <p className="text-[0.75rem] text-slate-400 mt-1">
              Kapasite: <span className="text-slate-200">{String(maxAdults)}</span> yetişkin
              {" "}• Çocuk: <span className="text-slate-200">{String(maxChildren)}</span>
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
      </div>
    </div>
  );
}
