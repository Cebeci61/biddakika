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
          createdAt: serverTimestamp()
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
function RequestDetailModal({
  req,
  offer,
  onClose
}: {
  req: RequestItem;
  offer?: ExistingOffer;
  onClose: () => void;
}) {
  const nights = calculateNights(req);
  const totalGuests = req.adults + (req.childrenCount ?? 0);
  const roomsCount = req.roomsCount ?? 1;
  const isGroup = req.isGroup || req.type === "group";

  const cancelText = offer
    ? cancellationPolicyLabelForOffer(
        offer.cancellationPolicyType,
        offer.cancellationPolicyDays ?? undefined
      )
    : null;

  // ---- label map’leri (misafir request/new sayfasındaki key’lerle uyumlu) ----
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

  const starsText =
    req.desiredStarRatings && req.desiredStarRatings.length > 0
      ? req.desiredStarRatings.map((s) => `${s}★`).join(", ")
      : null;

  // Misafir request/new ile group-request alan adları karışık olabiliyor:
  // - hotel talebinde: featureKeys + extraFeaturesText + locationNote + boardType + accommodationType
  // - grup talebinde: hotelFeaturePrefs + hotelFeatureNote + boardTypes + boardTypeNote
  const requestBoardText =
    (req as any).boardType
      ? BOARD_LABEL[String((req as any).boardType)] || String((req as any).boardType)
      : req.boardTypes && req.boardTypes.length > 0
      ? req.boardTypes.map((b) => BOARD_LABEL[b] || b).join(", ")
      : null;

  const requestAccomText =
    (req as any).accommodationType
      ? ACCOM_LABEL[String((req as any).accommodationType)] || String((req as any).accommodationType)
      : null;

  const requestFeatures =
    Array.isArray((req as any).featureKeys) && (req as any).featureKeys.length > 0
      ? ((req as any).featureKeys as string[]).map((k) => FEATURE_LABEL[k] || k)
      : req.hotelFeaturePrefs && req.hotelFeaturePrefs.length > 0
      ? req.hotelFeaturePrefs.map((k) => FEATURE_LABEL[k] || k)
      : [];

  const requestFeatureNote =
    (req as any).extraFeaturesText ||
    req.hotelFeatureNote ||
    (req as any).locationNote ||
    req.boardTypeNote ||
    null;

  const childrenAges: number[] =
    Array.isArray((req as any).childrenAges) ? (req as any).childrenAges : [];

  const nearMe = Boolean((req as any).nearMe);
  const nearMeKm = (req as any).nearMeKm ?? null;

  // Cevap süresi alanları (iki farklı model var)
  const responseText = (() => {
    const mins = req.responseDeadlineMinutes ?? null;
    const amt = (req as any).responseTimeAmount ?? null;
    const unit = (req as any).responseTimeUnit ?? null;

    if (amt && unit) return `${amt} ${unit === "minutes" ? "dakika" : unit === "hours" ? "saat" : "gün"}`;
    if (mins) return `${mins} dakika`;
    return null;
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />

      <div className="relative mt-10 w-full max-w-4xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-xl shadow-slate-950/60 max-h-[86vh] overflow-y-auto text-[0.8rem] space-y-4 animate-[fadeIn_.15s_ease-out]">
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
            </div>

            <p className="text-[0.75rem] text-slate-400">
              Misafir: <span className="text-slate-200 font-semibold">{maskName(req.guestName)}</span>
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
              {req.city}
              {req.district ? ` / ${req.district}` : ""}
            </p>
            <p className="text-[0.75rem] text-slate-300">
              {req.checkIn} → {req.checkOut}{" "}
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
              {totalGuests} kişi{" "}
              <span className="text-slate-400">•</span> {roomsCount} oda
            </p>
            <p className="text-[0.75rem] text-slate-300">
              Yetişkin: <span className="font-semibold">{req.adults}</span>{" "}
              {`•`} Çocuk: <span className="font-semibold">{req.childrenCount ?? 0}</span>
            </p>

            {(req.childrenCount ?? 0) > 0 && childrenAges.length > 0 && (
              <p className="text-[0.75rem] text-slate-300">
                Çocuk yaşları:{" "}
                <span className="text-slate-100 font-semibold">
                  {childrenAges.join(", ")}
                </span>
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
                Konaklama tipi:{" "}
                <span className="text-slate-100 font-semibold">{requestBoardText}</span>
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
            <span className="text-[0.7rem] text-slate-400">
              (otel teklif verirken kontrol için)
            </span>
          </div>

          {isGroup && req.roomTypeRows && req.roomTypeRows.length > 0 ? (
            <div className="grid md:grid-cols-2 gap-2">
              {req.roomTypeRows.map((row, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2"
                >
                  <p className="text-slate-100 font-semibold">
                    {roomTypeLabel(row.typeKey)}
                  </p>
                  <p className="text-[0.75rem] text-slate-300">
                    Adet: <span className="font-semibold">{row.count}</span>
                  </p>
                </div>
              ))}
            </div>
          ) : req.roomTypes && req.roomTypes.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {req.roomTypes.map((t, idx) => (
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
                {requestFeatures.map((f, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[0.7rem] text-emerald-200"
                  >
                    {f}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[0.75rem] text-slate-400">Özellik seçilmemiş.</p>
            )}

            {(req.hotelFeatureNote || (req as any).extraFeaturesText) && (
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                <p className="text-[0.7rem] text-slate-400">Ek özellik notu</p>
                <p className="text-[0.75rem] text-slate-200">
                  {String(req.hotelFeatureNote || (req as any).extraFeaturesText)}
                </p>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
            <p className="text-[0.75rem] text-slate-200 font-semibold">Misafirin notları</p>

            {(req.contactNote || req.boardTypeNote || (req as any).note || (req as any).locationNote) ? (
              <div className="space-y-2">
                {((req as any).note || null) && (
                  <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                    <p className="text-[0.7rem] text-slate-400">Genel not</p>
                    <p className="text-[0.75rem] text-slate-200">{String((req as any).note)}</p>
                  </div>
                )}

                {(req.contactNote || null) && (
                  <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                    <p className="text-[0.7rem] text-slate-400">İletişim notu</p>
                    <p className="text-[0.75rem] text-slate-200">{req.contactNote}</p>
                  </div>
                )}

                {((req as any).locationNote || null) && (
                  <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                    <p className="text-[0.7rem] text-slate-400">Konum beklentisi</p>
                    <p className="text-[0.75rem] text-slate-200">{String((req as any).locationNote)}</p>
                  </div>
                )}

                {(req.boardTypeNote || null) && (
                  <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                    <p className="text-[0.7rem] text-slate-400">Yeme-içme notu</p>
                    <p className="text-[0.75rem] text-slate-200">{req.boardTypeNote}</p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[0.75rem] text-slate-400">Not yok.</p>
            )}
          </div>
        </div>

        {/* KVKK İletişim (maskeli) */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[0.75rem] text-slate-200 font-semibold">İletişim bilgileri</p>
            <span className="text-[0.7rem] text-slate-400">Rezervasyona kadar maskeli</span>
          </div>

          <div className="grid md:grid-cols-2 gap-2">
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
              <p className="text-[0.7rem] text-slate-400">Ad soyad</p>
              <p className="text-[0.8rem] text-slate-100 font-semibold">{maskName(req.guestName)}</p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
              <p className="text-[0.7rem] text-slate-400">Firma / kurum</p>
              <p className="text-[0.8rem] text-slate-100 font-semibold">{maskCompany(req.contactCompany)}</p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
              <p className="text-[0.7rem] text-slate-400">E-posta</p>
              <p className="text-[0.8rem] text-slate-100 font-semibold">{maskEmail(req.contactEmail)}</p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
              <p className="text-[0.7rem] text-slate-400">Telefon</p>
              <p className="text-[0.8rem] text-slate-100 font-semibold">{maskPhone(req.contactPhone)}</p>
            </div>
          </div>

          <p className="text-[0.7rem] text-slate-500">
            KVKK gereği bu bilgiler rezervasyon onaylanana kadar gizlenir. Rezervasyon oluştuğunda,
            otel & misafir “Rezervasyonlar” ekranında tam bilgileri görür.
          </p>
        </div>

        {/* Bu otele ait teklif (varsa) */}
        {offer && (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[0.8rem] text-slate-100 font-semibold">Bu talep için verdiğin teklif</p>
              <span className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[0.7rem] text-emerald-300">
                {offer.totalPrice} {offer.currency} • %{offer.commissionRate}
              </span>
            </div>

            {cancelText && (
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                <p className="text-[0.7rem] text-slate-400">İptal politikası</p>
                <p className="text-[0.75rem] text-slate-200">{cancelText}</p>
              </div>
            )}

            {offer.note && (
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                <p className="text-[0.7rem] text-slate-400">Misafire not</p>
                <p className="text-[0.75rem] text-slate-200">{offer.note}</p>
              </div>
            )}

            {offer.roomBreakdown && offer.roomBreakdown.length > 0 && (
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                <p className="text-[0.7rem] text-slate-400">Oda kırılımı (teklif)</p>
                <div className="mt-2 space-y-1">
                  {offer.roomBreakdown.map((rb, idx) => (
                    <div key={idx} className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-slate-100 font-semibold">
                        Oda {idx + 1}: {rb.roomTypeName || "Oda"}
                      </span>
                      <span className="text-[0.75rem] text-slate-300">
                        {rb.nights ?? nights} gece × {Number(rb.nightlyPrice ?? 0).toLocaleString("tr-TR")}{" "}
                        {offer.currency}{" "}
                        <span className="text-slate-500">=</span>{" "}
                        <span className="text-emerald-300 font-semibold">
                          {Number(rb.totalPrice ?? 0).toLocaleString("tr-TR")} {offer.currency}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>

                <p className="text-[0.7rem] text-slate-500 mt-2">
                  Oda tipi değişiklikleri (KVKK + fiyat bütünlüğü nedeniyle) ilk tekliften sonra kilitlenir.
                </p>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-700 px-4 py-1.5 text-[0.75rem] text-slate-200 hover:border-emerald-400 transition"
          >
            Kapat
          </button>
        </div>
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
