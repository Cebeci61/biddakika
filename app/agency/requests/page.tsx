"use client";

import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { Protected } from "@/components/Protected";
import { useAuth } from "@/context/AuthContext";
import { getFirestoreDb } from "@/lib/firebase/client";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where
} from "firebase/firestore";
import { useRouter } from "next/navigation";

/* ---------------- TYPES ---------------- */

type OfferMode = "simple" | "refreshable" | "negotiable";
type PaymentMethod = "card3d" | "payAtHotel";
type CommissionRate = 8 | 10 | 15;
type RequestType = "standard" | "group";

type RequestItem = {
  id: string;
  guestId: string;

  createdByRole?: "guest" | "agency" | "admin" | "hotel";
  agencyId?: string | null;
  agencyDiscountRate?: number | null;

  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;

  city: string;
  district?: string | null;

  checkIn: string;
  checkOut: string;

  adults: number;
  childrenCount?: number;
  childrenAges?: number[];
  roomsCount?: number;
  roomTypes?: string[];

  responseDeadlineMinutes?: number;
  createdAt?: Timestamp;
  status?: string | null;

  type?: RequestType | string;
  isGroup?: boolean;
};

type OfferItem = {
  id: string;
  requestId: string;

  hotelId: string;
  hotelName?: string | null;

  totalPrice: number;
  currency: string;

  mode: OfferMode;
  commissionRate: CommissionRate;

  note?: string | null;
  status: string; // sent | accepted | rejected | countered | ...
  createdAt?: Timestamp;

  // pazarlık (opsiyonel alanlar - varsa kullanır)
  guestCounterPrice?: number | null;
};

type PackageRequest = {
  id: string;
  createdByRole: "guest" | "agency";
  createdById: string;
  createdByName?: string | null;

  title?: string | null;
  city: string;
  district?: string | null;
  dateFrom: string;
  dateTo: string;
  paxAdults: number;
  paxChildren?: number;

  status?: "open" | "expired" | "accepted";
  createdAt?: Timestamp;
};

type HotelProfileLite = {
  id: string;
  displayName?: string | null;
  email?: string | null;
  website?: string | null;
  hotelProfile?: any; // senin projede hotelProfile objesi var, detayda esnek okuyoruz
};

/* ---------------- HELPERS ---------------- */

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
  return Math.floor(ms / 86400000);
}

function calcNights(ci?: string, co?: string) {
  const a = parseDate(ci);
  const b = parseDate(co);
  if (!a || !b) return 1;
  const d = diffInDays(b, a);
  return d > 0 ? d : 1;
}

function agencyPrice(price: number, discountRate = 5) {
  const p = Number(price || 0);
  if (p <= 0) return 0;
  return Math.round(p * (1 - discountRate / 100));
}

function paymentMethodText(method: string) {
  if (method === "card3d") return "3D Secure kart";
  if (method === "payAtHotel") return "Otelde ödeme";
  return method;
}

function modeText(m: OfferMode) {
  if (m === "simple") return "Standart teklif";
  if (m === "refreshable") return "Yenilenebilir teklif";
  return "Pazarlıklı teklif";
}

function computeDeadline(req: RequestItem) {
  const created = req.createdAt?.toDate?.();
  const minutes = req.responseDeadlineMinutes ?? 0;
  if (!created || !minutes) return { label: "—", color: "text-slate-300", ratio: 0 };

  const totalMs = minutes * 60 * 1000;
  const now = Date.now();
  const end = created.getTime() + totalMs;
  const left = end - now;

  if (left <= 0) return { label: "Süre doldu", color: "text-red-300", ratio: 1 };

  const ratio = Math.min(1, Math.max(0, (now - created.getTime()) / totalMs));
  const totalSec = Math.floor(left / 1000);
  const minsLeft = Math.floor(totalSec / 60);
  const secsLeft = totalSec % 60;

  const label = `${minsLeft} dk ${secsLeft} sn`;
  const color =
    left < 15 * 60 * 1000 ? "text-red-300" : left < 60 * 60 * 1000 ? "text-amber-300" : "text-emerald-300";

  return { label, color, ratio };
}

function confirmUI(msg: string) {
  if (typeof window === "undefined") return true;
  return window.confirm(msg);
}
export default function AgencyRequestsPage() {
  const { profile, loading: authLoading } = useAuth() as any;
  const db = getFirestoreDb();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [pageErr, setPageErr] = useState<string | null>(null);
  const [pageMsg, setPageMsg] = useState<string | null>(null);

  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [offers, setOffers] = useState<OfferItem[]>([]);
  const [pkgRequests, setPkgRequests] = useState<PackageRequest[]>([]);

  // filters
  const [typeFilter, setTypeFilter] = useState<"all" | "hotel" | "group" | "package">("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [qText, setQText] = useState("");

  // expand/collapse
  const [openReqId, setOpenReqId] = useState<string | null>(null);

  // detail modal
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailReq, setDetailReq] = useState<RequestItem | null>(null);

  // hotel detail modal
  const [hotelOpen, setHotelOpen] = useState(false);
  const [hotelLoading, setHotelLoading] = useState(false);
  const [hotelErr, setHotelErr] = useState<string | null>(null);
  const [hotelData, setHotelData] = useState<HotelProfileLite | null>(null);

  // payment modal
  const [payOpen, setPayOpen] = useState(false);
  const [payOffer, setPayOffer] = useState<OfferItem | null>(null);
  const [payReq, setPayReq] = useState<RequestItem | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("payAtHotel");

  // 3D sim
  const [threeDSOpen, setThreeDSOpen] = useState(false);
  const [cardName, setCardName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvc, setCardCvc] = useState("");

  // negotiable counter (1 defa)
  const [counterOpen, setCounterOpen] = useState(false);
  const [counterOffer, setCounterOffer] = useState<OfferItem | null>(null);
  const [counterReq, setCounterReq] = useState<RequestItem | null>(null);
  const [counterValue, setCounterValue] = useState<string>("");
  const [counterSaving, setCounterSaving] = useState(false);

  // selected offer per request (kabul ettim -> ödeme)
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (authLoading) return;
      if (!profile || profile.role !== "agency") {
        setLoading(false);
        return;
      }

      setLoading(true);
      setPageErr(null);

      try {
        // 1) acentanın hotel/grup talepleri -> requests
        const qReq = query(
          collection(db, "requests"),
          where("guestId", "==", profile.uid),
          where("createdByRole", "==", "agency")
        );
        const snapReq = await getDocs(qReq);

        const reqList: RequestItem[] = snapReq.docs.map((d) => {
          const v = d.data() as any;
          return {
            id: d.id,
            guestId: v.guestId,

            createdByRole: v.createdByRole ?? "agency",
            agencyId: v.agencyId ?? null,
            agencyDiscountRate: v.agencyDiscountRate ?? 5,

            customerName: v.customerName ?? v.contactName ?? null,
            customerPhone: v.customerPhone ?? v.contactPhone ?? null,
            customerEmail: v.customerEmail ?? v.contactEmail ?? null,

            city: v.city ?? "",
            district: v.district ?? null,

            checkIn: v.checkIn ?? "",
            checkOut: v.checkOut ?? "",

            adults: Number(v.adults ?? 0),
            childrenCount: Number(v.childrenCount ?? 0),
            childrenAges: Array.isArray(v.childrenAges) ? v.childrenAges : [],
            roomsCount: Number(v.roomsCount ?? 1),
            roomTypes: Array.isArray(v.roomTypes) ? v.roomTypes : [],

            responseDeadlineMinutes: v.responseDeadlineMinutes ?? 60,
            createdAt: v.createdAt,
            status: v.status ?? "open",

            type: v.type ?? "standard",
            isGroup: v.isGroup ?? (v.type === "group")
          };
        });

        // 2) bu requestId'lere ait otel teklifleri
        const reqIds = new Set(reqList.map((r) => r.id));
        const snapOff = await getDocs(collection(db, "offers"));
        const offList: OfferItem[] = snapOff.docs
          .map((d) => {
            const v = d.data() as any;
            return {
              id: d.id,
              requestId: v.requestId,
              hotelId: v.hotelId,
              hotelName: v.hotelName ?? null,
              totalPrice: Number(v.totalPrice ?? 0),
              currency: v.currency ?? "TRY",
              mode: v.mode ?? "simple",
              commissionRate: (v.commissionRate ?? 8) as CommissionRate,
              note: v.note ?? null,
              status: v.status ?? "sent",
              createdAt: v.createdAt,
              guestCounterPrice: v.guestCounterPrice ?? null
            } as OfferItem;
          })
          .filter((o) => reqIds.has(o.requestId));

        // 3) acentanın paket talepleri (packageRequests) -> %5 uygulanmaz (bu ekran sadece listeler)
        const qPkg = query(
          collection(db, "packageRequests"),
          where("createdByRole", "==", "agency"),
          where("createdById", "==", profile.uid)
        );
        const snapPkg = await getDocs(qPkg);

        const pkgList: PackageRequest[] = snapPkg.docs.map((d) => {
          const v = d.data() as any;
          return {
            id: d.id,
            createdByRole: v.createdByRole ?? "agency",
            createdById: v.createdById ?? profile.uid,
            createdByName: v.createdByName ?? null,
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

        reqList.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
        pkgList.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));

        setRequests(reqList);
        setOffers(offList);
        setPkgRequests(pkgList);
      } catch (e: any) {
        console.error(e);
        setPageErr(e?.message || "Acenta talepleri yüklenemedi.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [authLoading, profile, db]);

  const cityOptions = useMemo(() => {
    const s = new Set<string>();
    requests.forEach((r) => r.city && s.add(r.city));
    pkgRequests.forEach((p) => p.city && s.add(p.city));
    return ["all", ...Array.from(s)];
  }, [requests, pkgRequests]);

  const offersByRequest = useMemo(() => {
    const map: Record<string, OfferItem[]> = {};
    offers.forEach((o) => {
      map[o.requestId] = map[o.requestId] || [];
      map[o.requestId].push(o);
    });
    Object.values(map).forEach((arr) =>
      arr.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))
    );
    return map;
  }, [offers]);

  const filteredHotelGroup = useMemo(() => {
    let list = [...requests];

    const q = qText.trim().toLowerCase();
    if (q) {
      list = list.filter((r) => {
        const hay = [r.id, r.city, r.district, r.customerName, r.customerPhone, r.customerEmail]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }

    if (cityFilter !== "all") list = list.filter((r) => r.city === cityFilter);

    if (typeFilter === "hotel") list = list.filter((r) => !(r.isGroup || r.type === "group"));
    if (typeFilter === "group") list = list.filter((r) => !!(r.isGroup || r.type === "group"));
    if (typeFilter === "package") return [];

    return list;
  }, [requests, qText, cityFilter, typeFilter]);

  const filteredPackages = useMemo(() => {
    if (typeFilter !== "all" && typeFilter !== "package") return [];
    let list = [...pkgRequests];

    const q = qText.trim().toLowerCase();
    if (q) {
      list = list.filter((p) => {
        const hay = [p.id, p.title, p.city, p.district].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      });
    }

    if (cityFilter !== "all") list = list.filter((p) => p.city === cityFilter);

    return list;
  }, [pkgRequests, qText, cityFilter, typeFilter]);

  function openReqDetail(r: RequestItem) {
    setDetailReq(r);
    setDetailOpen(true);
  }
  function closeReqDetail() {
    setDetailOpen(false);
    setDetailReq(null);
  }

  async function openHotelDetail(hotelId: string) {
    setHotelErr(null);
    setHotelLoading(true);
    setHotelOpen(true);
    setHotelData(null);

    try {
      const snap = await getDoc(doc(db, "users", hotelId));
      if (!snap.exists()) {
        setHotelErr("Otel profili bulunamadı.");
        return;
      }
      const v = snap.data() as any;
      setHotelData({
        id: hotelId,
        displayName: v.displayName ?? v.hotelProfile?.hotelName ?? null,
        email: v.email ?? null,
        website: v.website ?? v.hotelProfile?.website ?? null,
        hotelProfile: v.hotelProfile ?? null
      });
    } catch (e: any) {
      console.error(e);
      setHotelErr("Otel profili okunamadı.");
    } finally {
      setHotelLoading(false);
    }
  }
  function closeHotelDetail() {
    setHotelOpen(false);
    setHotelErr(null);
    setHotelData(null);
  }

  function selectOffer(reqId: string, offerId: string) {
    setPageMsg(null);
    setPageErr(null);
    setSelectedOfferId(offerId);
    setOpenReqId(reqId);
    setPageMsg("Teklif seçildi. Ödemeye ilerleyerek rezervasyonu tamamlayabilirsin.");
  }

  function cancelSelection() {
    if (!confirmUI("Seçimi kaldırmak istiyor musun?")) return;
    setSelectedOfferId(null);
    setPageMsg("Seçim kaldırıldı.");
  }

  function openPayment(r: RequestItem, o: OfferItem) {
    setPayReq(r);
    setPayOffer(o);
    setPaymentMethod("payAtHotel");
    setPayOpen(true);
    setThreeDSOpen(false);
  }
  function closePayment() {
    setPayOpen(false);
    setPayReq(null);
    setPayOffer(null);
    setThreeDSOpen(false);
  }

  async function handleRejectOffer(o: OfferItem) {
    if (!confirmUI("Bu teklifi reddetmek istediğine emin misin?")) return;
    try {
      await updateDoc(doc(db, "offers", o.id), { status: "rejected", rejectedAt: serverTimestamp() });
      setOffers((prev) => prev.map((x) => (x.id === o.id ? { ...x, status: "rejected" } : x)));
      setPageMsg("Teklif reddedildi.");
    } catch (e) {
      console.error(e);
      setPageErr("Teklif reddedilemedi.");
    }
  }

  function canCounter(o: OfferItem) {
    if (o.mode !== "negotiable") return false;
    if (o.status !== "sent" && o.status !== "countered") return false;
    if (o.guestCounterPrice && o.guestCounterPrice > 0) return false; // 1 defa
    return true;
  }

  function openCounter(r: RequestItem, o: OfferItem) {
    if (!canCounter(o)) return;
    setCounterReq(r);
    setCounterOffer(o);
    setCounterValue(String(o.totalPrice || ""));
    setCounterOpen(true);
  }

  function closeCounter() {
    setCounterOpen(false);
    setCounterReq(null);
    setCounterOffer(null);
    setCounterValue("");
    setCounterSaving(false);
  }

  async function submitCounter(e: FormEvent) {
    e.preventDefault();
    if (!counterReq || !counterOffer) return;

    const value = Number(counterValue);
    if (Number.isNaN(value) || value <= 0) {
      setPageErr("Geçerli bir karşı teklif gir.");
      return;
    }

    try {
      setCounterSaving(true);
      await updateDoc(doc(db, "offers", counterOffer.id), {
        guestCounterPrice: value,
        status: "countered",
        guestCounterAt: serverTimestamp()
      });

      setOffers((prev) =>
        prev.map((x) => (x.id === counterOffer.id ? { ...x, guestCounterPrice: value, status: "countered" } : x))
      );
      setPageMsg("Karşı teklif gönderildi. Otel yeni fiyata göre karar verecek.");
      closeCounter();
    } catch (e) {
      console.error(e);
      setPageErr("Karşı teklif gönderilemedi.");
      setCounterSaving(false);
    }
  }

  async function createBooking(finalPaymentMethod: PaymentMethod) {
    if (!profile?.uid || !payReq || !payOffer) return;

    const req = payReq;
    const offer = payOffer;

    // ✅ %5 sadece otel/grup (agency request)
    const discountRate = req.createdByRole === "agency" ? req.agencyDiscountRate ?? 5 : 0;
    const agencyTotal = agencyPrice(offer.totalPrice, discountRate);

    await addDoc(collection(db, "bookings"), {
      offerId: offer.id,
      requestId: req.id,

      guestId: profile.uid,
      hotelId: offer.hotelId,
      hotelName: offer.hotelName ?? null,

      city: req.city,
      district: req.district ?? null,
      checkIn: req.checkIn,
      checkOut: req.checkOut,

      adults: req.adults,
      childrenCount: req.childrenCount ?? 0,
      childrenAges: req.childrenAges ?? [],
      roomsCount: req.roomsCount ?? 1,
      roomTypes: req.roomTypes ?? [],

      // ✅ acenta fiyatı (discounted)
      totalPrice: agencyTotal,
      currency: offer.currency,

      // audit
      originalHotelOfferPrice: offer.totalPrice,
      agencyDiscountRate: discountRate,

      paymentMethod: finalPaymentMethod,
      paymentStatus: finalPaymentMethod === "card3d" ? "paid" : "payAtHotel",

      status: "active",
      createdAt: serverTimestamp(),

      // müşteri bilgileri
      customerName: req.customerName ?? null,
      customerPhone: req.customerPhone ?? null,
      customerEmail: req.customerEmail ?? null,

      createdByRole: "agency"
    });

    await updateDoc(doc(db, "offers", offer.id), { status: "accepted", acceptedAt: serverTimestamp() });

    closePayment();
    setSelectedOfferId(null);
    router.push("/agency/bookings");
  }

  async function handlePaymentConfirm() {
    if (!payReq || !payOffer) return;

    if (paymentMethod === "card3d") {
      if (!cardName || !cardNumber || !cardExpiry || !cardCvc) {
        alert("3D için kart bilgilerini doldur.");
        return;
      }
      setThreeDSOpen(true);
      return;
    }

    await createBooking("payAtHotel");
  }
  return (
    <Protected allowedRoles={["agency"]}>
      <div className="container-page space-y-6">
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold text-slate-100">Acenta Taleplerim</h1>
            <div className="flex gap-2 flex-wrap">
              <span className="pill pill-sky">Otel/Grup: %5 otomatik</span>
              <span className="pill pill-indigo">Paket: %5 yok</span>
            </div>
          </div>

          <p className="text-sm text-slate-300 max-w-4xl">
            Burada açtığın <b>otel/grup/paket</b> taleplerini görürsün. Otel tekliflerinde
            “<b>Otel fiyatı / Senin kullanacağın fiyat</b>” net gösterilir. Pazarlıklı tekliflerde 1 defa karşı teklif yapabilirsin.
          </p>
        </section>

        {(pageErr || pageMsg) && (
          <section className="space-y-2">
            {pageErr && <div className="alert alert-red">{pageErr}</div>}
            {pageMsg && <div className="alert alert-emerald">{pageMsg}</div>}
          </section>
        )}

        {/* Filters */}
        <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow shadow-slate-950/40 space-y-3">
          <div className="grid gap-3 md:grid-cols-12 items-end">
            <div className="md:col-span-5 space-y-1">
              <label className="text-[0.7rem] text-slate-300">Arama</label>
              <input value={qText} onChange={(e) => setQText(e.target.value)} className="input" placeholder="şehir, müşteri, id..." />
            </div>

            <div className="md:col-span-3 space-y-1">
              <label className="text-[0.7rem] text-slate-300">Tür</label>
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)} className="input">
                <option value="all">Hepsi</option>
                <option value="hotel">Otel</option>
                <option value="group">Grup</option>
                <option value="package">Paket</option>
              </select>
            </div>

            <div className="md:col-span-3 space-y-1">
              <label className="text-[0.7rem] text-slate-300">Şehir</label>
              <select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)} className="input">
                {cityOptions.map((c) => (
                  <option key={c} value={c}>
                    {c === "all" ? "Hepsi" : c}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-1 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setTypeFilter("all");
                  setCityFilter("all");
                  setQText("");
                }}
                className="btn-ghost"
              >
                Temizle
              </button>
            </div>
          </div>
        </section>

        {loading && <p className="text-sm text-slate-400">Yükleniyor...</p>}

        {!loading && filteredHotelGroup.length === 0 && filteredPackages.length === 0 && (
          <p className="text-sm text-slate-400">Henüz bir talebin yok.</p>
        )}

        {/* Hotel + Group Requests */}
        {!loading && filteredHotelGroup.length > 0 && (
          <section className="space-y-4">
            {filteredHotelGroup.map((r) => {
              const isGroup = !!(r.isGroup || r.type === "group");
              const deadline = computeDeadline(r);
              const nights = calcNights(r.checkIn, r.checkOut);
              const pax = r.adults + (r.childrenCount ?? 0);

              const list = offersByRequest[r.id] ?? [];
              const discountRate = r.createdByRole === "agency" ? r.agencyDiscountRate ?? 5 : 0;

              const expanded = openReqId === r.id;

              return (
                <div key={r.id} className="card overflow-hidden">
                  {/* header */}
                  <div className="bg-slate-900/90 px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-slate-100 font-semibold">
                          {r.city}
                          {r.district ? ` / ${r.district}` : ""} • {r.checkIn} – {r.checkOut} • {nights} gece
                        </span>

                        <span className="pill pill-sky">ACENTA TALEBİ</span>
                        <span className="pill pill-emerald">%{discountRate} düşük gösterim</span>

                        {isGroup && <span className="pill pill-amber">Grup</span>}
                      </div>

                      <div className="text-[0.75rem] text-slate-300">
                        Müşteri: <span className="text-slate-100 font-semibold">{safeStr(r.customerName)}</span>
                        {r.customerPhone ? ` • ${r.customerPhone}` : ""} • {pax} kişi • {r.roomsCount ?? 1} oda
                      </div>
                    </div>

                    <div className="flex items-center gap-2 justify-end">
                      <div className={`text-[0.8rem] font-semibold ${deadline.color}`}>{deadline.label}</div>
                      <button onClick={() => openReqDetail(r)} type="button" className="btn-soft">
                        Detay
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => setOpenReqId((prev) => (prev === r.id ? null : r.id))}
                      >
                        {expanded ? "Kapat" : `Teklifler (${list.length})`}
                      </button>
                    </div>
                  </div>

                  {/* offers */}
                  {expanded && (
                    <div className="px-4 py-4 space-y-3">
                      {list.length === 0 ? (
                        <div className="text-sm text-slate-400">Bu talebe henüz teklif gelmedi.</div>
                      ) : (
                        <div className="rounded-2xl border border-slate-800 overflow-hidden">
                          <div className="hidden md:grid grid-cols-[1.7fr_1.1fr_1.3fr_1.2fr_auto] bg-slate-900 px-4 py-2 text-[0.75rem] font-semibold text-slate-100">
                            <div>Otel</div>
                            <div>Otel fiyatı</div>
                            <div>Senin fiyatın</div>
                            <div>Durum</div>
                            <div className="text-right">İşlemler</div>
                          </div>

                          {list.map((o) => {
                            const agencyShown = agencyPrice(o.totalPrice, discountRate);
                            const isSelected = selectedOfferId === o.id;

                            return (
                              <div key={o.id} className="border-t border-slate-800 px-4 py-3 grid md:grid-cols-[1.7fr_1.1fr_1.3fr_1.2fr_auto] gap-2 items-center">
                                <div className="text-slate-100">
                                  <div className="font-semibold flex items-center gap-2">
                                    <span>{o.hotelName || "Otel"}</span>
                                    <button
                                      type="button"
                                      onClick={() => openHotelDetail(o.hotelId)}
                                      className="text-[0.7rem] text-sky-300 hover:underline"
                                    >
                                      otel detayı
                                    </button>
                                  </div>
                                  <div className="text-[0.7rem] text-slate-400">
                                    {modeText(o.mode)} • %{o.commissionRate}
                                  </div>
                                  {o.note && <div className="text-[0.7rem] text-slate-400">Not: {o.note}</div>}
                                  {o.guestCounterPrice ? (
                                    <div className="text-[0.7rem] text-amber-300">
                                      Gönderdiğin karşı teklif: {o.guestCounterPrice} {o.currency}
                                    </div>
                                  ) : null}
                                </div>

                                <div className="text-slate-100">
                                  <div className="font-semibold">{Number(o.totalPrice).toLocaleString("tr-TR")} {o.currency}</div>
                                  <div className="text-[0.7rem] text-slate-500">Otelin teklifi</div>
                                </div>

                                <div className="text-slate-100">
                                  <div className="font-extrabold text-emerald-300">{agencyShown.toLocaleString("tr-TR")} {o.currency}</div>
                                  <div className="text-[0.7rem] text-slate-500">Senin kullanacağın</div>
                                </div>

                                <div className="space-y-1">
                                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.7rem] ${
                                    o.status === "accepted"
                                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                                      : o.status === "rejected"
                                      ? "border-red-500/40 bg-red-500/10 text-red-200"
                                      : o.status === "countered"
                                      ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                                      : "border-slate-700 bg-slate-900 text-slate-200"
                                  }`}>
                                    {o.status}
                                  </span>
                                </div>

                                <div className="flex justify-end gap-2 flex-wrap">
                                  {!isSelected ? (
                                    <button
                                      type="button"
                                      onClick={() => selectOffer(r.id, o.id)}
                                      className="btn-outline-emerald"
                                    >
                                      Kabul et
                                    </button>
                                  ) : (
                                    <button type="button" onClick={cancelSelection} className="btn-outline-slate">
                                      Vazgeç
                                    </button>
                                  )}

                                  <button type="button" onClick={() => handleRejectOffer(o)} className="btn-outline-red">
                                    Reddet
                                  </button>

                                  {canCounter(o) && (
                                    <button type="button" onClick={() => openCounter(r, o)} className="btn-outline-amber">
                                      Pazarlık yap
                                    </button>
                                  )}

                                  <button
                                    type="button"
                                    onClick={() => openPayment(r, o)}
                                    className="btn-primary"
                                  >
                                    Ödemeye ilerle
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        )}

        {/* Package Requests (list only for now) */}
        {!loading && filteredPackages.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-lg font-semibold text-slate-100">Paket taleplerin</h2>
              <span className="pill pill-indigo">%5 uygulanmaz</span>
            </div>

            {filteredPackages.map((p) => {
              const pax = p.paxAdults + (p.paxChildren ?? 0);
              const created = p.createdAt?.toDate?.().toLocaleString("tr-TR") ?? "—";

              return (
                <div key={p.id} className="card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="pill pill-indigo">Paket</span>
                        <span className="text-[0.7rem] text-slate-500">#{p.id}</span>
                      </div>

                      <div className="text-slate-100 font-semibold">
                        {safeStr(p.title, `${p.city}${p.district ? " / " + p.district : ""} Paket Talebi`)}
                      </div>

                      <div className="text-[0.75rem] text-slate-300">
                        {p.city}{p.district ? ` / ${p.district}` : ""} • {p.dateFrom} – {p.dateTo} • {pax} kişi
                      </div>
                      <div className="text-[0.7rem] text-slate-500">Oluşturma: {created}</div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn-soft"
                        onClick={() => router.push(`/agency/packages/inbox?mine=${p.id}`)}
                      >
                        Teklifleri gör
                      </button>
                      <button
                        type="button"
                        className="btn-outline-slate"
                        onClick={() => router.push(`/agency/requests/package/new?clone=${p.id}`)}
                      >
                        Kopyala
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {/* --- Request Detail Modal --- */}
       {detailOpen && detailReq && (
  <RequestDetailModalAdvanced
    req={detailReq}
    onClose={closeReqDetail}
  />
)}


        {/* --- Hotel Detail Modal --- */}
        {hotelOpen && (
          <div className="fixed inset-0 z-[90] bg-black/60 flex items-start justify-center">
            <div className="absolute inset-0" onClick={closeHotelDetail} />
            <div className="relative mt-14 w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-xl max-h-[85vh] overflow-y-auto space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-100">Otel detayı</h2>
                  <p className="text-[0.75rem] text-slate-400">Profil özeti</p>
                </div>
                <button onClick={closeHotelDetail} className="btn-ghost">Kapat ✕</button>
              </div>

              {hotelLoading && <p className="text-sm text-slate-400">Yükleniyor...</p>}
              {hotelErr && <div className="alert alert-red">{hotelErr}</div>}

              {!hotelLoading && hotelData && (
                <div className="space-y-3">
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                    <p className="text-slate-100 font-semibold text-lg">{safeStr(hotelData.displayName, "Otel")}</p>
                    <p className="text-sm text-slate-300">{safeStr(hotelData.email)}</p>
                    {hotelData.website ? (
                      <p className="text-sm text-sky-300">
                        <a href={hotelData.website} target="_blank" rel="noreferrer" className="hover:underline">
                          Web sitesi
                        </a>
                      </p>
                    ) : null}
                  </div>

                  {hotelData.hotelProfile?.address && (
                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                      <p className="text-[0.75rem] text-slate-400">Adres</p>
                      <p className="text-slate-100">{hotelData.hotelProfile.address}</p>
                    </div>
                  )}

                  {Array.isArray(hotelData.hotelProfile?.imageUrls) && hotelData.hotelProfile.imageUrls.length > 0 && (
                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                      <p className="text-[0.75rem] text-slate-400 mb-2">Görseller</p>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {hotelData.hotelProfile.imageUrls.slice(0, 6).map((url: string, i: number) => (
                          <img key={i} src={url} className="rounded-lg border border-slate-800 object-cover w-full h-28" />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* --- Counter Modal --- */}
        {counterOpen && counterReq && counterOffer && (
          <div className="fixed inset-0 z-[90] bg-black/70 flex items-start justify-center">
            <div className="absolute inset-0" onClick={closeCounter} />
            <div className="relative mt-20 w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-100">Pazarlık / Karşı teklif</h3>
                <button onClick={closeCounter} className="text-[0.75rem] text-slate-400 hover:text-slate-200">✕</button>
              </div>

              <p className="text-[0.75rem] text-slate-300">
                Bu teklif <b>pazarlıklı</b>. Sadece <b>1 defa</b> karşı teklif gönderebilirsin.
              </p>

              <form onSubmit={submitCounter} className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-200">Karşı teklifin</label>
                  <input className="input" value={counterValue} onChange={(e) => setCounterValue(e.target.value)} type="number" min={0} />
                </div>

                <div className="flex justify-end gap-2">
                  <button type="button" onClick={closeCounter} className="btn-outline-slate">Vazgeç</button>
                  <button disabled={counterSaving} type="submit" className="btn-outline-amber">
                    {counterSaving ? "Gönderiliyor..." : "Gönder"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* --- Payment Modal --- */}
        {payOpen && payReq && payOffer && (
          <div className="fixed inset-0 z-[90] bg-black/70 flex items-start justify-center">
            <div className="absolute inset-0" onClick={closePayment} />
            <div className="relative mt-20 w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-xl space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-100">Ödeme yöntemini seç</h2>
                <button onClick={closePayment} className="text-[0.75rem] text-slate-400 hover:text-slate-200">✕</button>
              </div>

              {(() => {
                const discountRate = payReq.agencyDiscountRate ?? 5;
                const shown = agencyPrice(payOffer.totalPrice, discountRate);
                return (
                  <p className="text-[0.8rem] text-slate-300">
                    Otel fiyatı <b>{Number(payOffer.totalPrice).toLocaleString("tr-TR")} {payOffer.currency}</b> •
                    Senin fiyatın <b className="text-emerald-300">{shown.toLocaleString("tr-TR")} {payOffer.currency}</b>
                  </p>
                );
              })()}

              <div className="space-y-2 text-xs">
                <label className="flex items-start gap-2">
                  <input type="radio" checked={paymentMethod === "payAtHotel"} onChange={() => setPaymentMethod("payAtHotel")} className="mt-1" />
                  <div>
                    <div className="text-slate-100 font-semibold">💵 Otelde ödeme</div>
                    <div className="text-slate-400">Rezervasyon oluşturulur, ödeme girişte alınır.</div>
                  </div>
                </label>

                <label className="flex items-start gap-2">
                  <input type="radio" checked={paymentMethod === "card3d"} onChange={() => setPaymentMethod("card3d")} className="mt-1" />
                  <div>
                    <div className="text-slate-100 font-semibold">💳 3D Secure</div>
                    <div className="text-slate-400">Simülasyon. Onaylayınca “paid” olur.</div>
                  </div>
                </label>
              </div>

              {paymentMethod === "card3d" && (
                <div className="grid gap-3 md:grid-cols-2">
                  <input className="input" placeholder="Kart Ad Soyad" value={cardName} onChange={(e) => setCardName(e.target.value)} />
                  <input className="input" placeholder="Kart No" value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} />
                  <input className="input" placeholder="AA/YY" value={cardExpiry} onChange={(e) => setCardExpiry(e.target.value)} />
                  <input className="input" placeholder="CVC" value={cardCvc} onChange={(e) => setCardCvc(e.target.value)} />
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button onClick={closePayment} className="btn-outline-slate">İptal</button>
                <button onClick={handlePaymentConfirm} className="btn-primary">Rezervasyonu tamamla</button>
              </div>
            </div>

            {threeDSOpen && (
              <div className="fixed inset-0 z-[99] bg-black/70 flex items-center justify-center">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/95 p-5 w-full max-w-md space-y-3 shadow-xl">
                  <h3 className="text-sm font-semibold text-slate-100">Banka 3D doğrulama</h3>
                  <p className="text-[0.75rem] text-slate-300">
                    MVP simülasyon. “Onayla” dersen ödeme başarılı sayılır ve rezervasyon oluşturulur.
                  </p>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setThreeDSOpen(false)} className="btn-outline-slate">Vazgeç</button>
                    <button onClick={() => createBooking("card3d")} className="btn-primary">Onayla</button>
                  </div>
                </div>
              </div>
            )}
          </div>
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
            font-size: 0.9rem;
          }
          .input:focus { border-color: rgba(52, 211, 153, 0.8); }

          .card {
            border-radius: 1rem;
            border: 1px solid rgba(51, 65, 85, 1);
            background: rgba(2, 6, 23, 0.65);
            box-shadow: 0 16px 44px rgba(0,0,0,0.28);
          }

          .pill{
            display:inline-flex;align-items:center;
            border-radius:999px;padding:6px 10px;
            font-size:12px;font-weight:900;
            border:1px solid rgba(255,255,255,0.10);
            background: rgba(15,23,42,0.55);
            color:#e5e7eb;
          }
          .pill-sky{ border-color: rgba(56,189,248,0.35); background: rgba(56,189,248,0.12); color: rgba(186,230,253,1); }
          .pill-emerald{ border-color: rgba(16,185,129,0.35); background: rgba(16,185,129,0.10); color: rgba(167,243,208,1); }
          .pill-indigo{ border-color: rgba(99,102,241,0.35); background: rgba(99,102,241,0.12); color: rgba(199,210,254,1); }
          .pill-amber{ border-color: rgba(245,158,11,0.35); background: rgba(245,158,11,0.12); color: rgba(253,230,138,1); }

          .alert {
            border-radius: 0.9rem;
            padding: 0.8rem 1rem;
            border: 1px solid;
            font-size: 0.9rem;
          }
          .alert-red { border-color: rgba(239,68,68,0.35); background: rgba(239,68,68,0.10); color: rgba(254,202,202,1); }
          .alert-emerald { border-color: rgba(16,185,129,0.35); background: rgba(16,185,129,0.10); color: rgba(167,243,208,1); }

          .btn-primary{
            border-radius: 0.8rem;
            background: rgba(16,185,129,1);
            color: rgba(2,6,23,1);
            padding: 0.55rem 0.9rem;
            font-weight: 900;
            font-size: 0.85rem;
          }
          .btn-primary:hover{ filter: brightness(1.05); }

          .btn-soft{
            border-radius: 0.8rem;
            border: 1px solid rgba(56,189,248,0.35);
            background: rgba(56,189,248,0.10);
            color: rgba(186,230,253,1);
            padding: 0.55rem 0.9rem;
            font-weight: 800;
            font-size: 0.85rem;
          }

          .btn-ghost{
            border-radius: 0.8rem;
            border: 1px solid rgba(51,65,85,1);
            background: rgba(15,23,42,0.55);
            color: rgba(226,232,240,0.95);
            padding: 0.55rem 0.9rem;
            font-weight: 800;
            font-size: 0.85rem;
          }
          .btn-ghost:hover{ border-color: rgba(16,185,129,0.55); }

          .btn-outline-emerald{
            border-radius: 0.8rem;
            border: 1px solid rgba(16,185,129,0.45);
            background: rgba(16,185,129,0.10);
            color: rgba(167,243,208,1);
            padding: 0.55rem 0.9rem;
            font-weight: 900;
            font-size: 0.85rem;
          }
          .btn-outline-slate{
            border-radius: 0.8rem;
            border: 1px solid rgba(51,65,85,1);
            background: rgba(15,23,42,0.35);
            color: rgba(226,232,240,0.9);
            padding: 0.55rem 0.9rem;
            font-weight: 800;
            font-size: 0.85rem;
          }
          .btn-outline-red{
            border-radius: 0.8rem;
            border: 1px solid rgba(239,68,68,0.45);
            background: rgba(239,68,68,0.10);
            color: rgba(254,202,202,1);
            padding: 0.55rem 0.9rem;
            font-weight: 900;
            font-size: 0.85rem;
          }
          .btn-outline-amber{
            border-radius: 0.8rem;
            border: 1px solid rgba(245,158,11,0.45);
            background: rgba(245,158,11,0.10);
            color: rgba(253,230,138,1);
            padding: 0.55rem 0.9rem;
            font-weight: 900;
            font-size: 0.85rem;
          }
        `}</style>
      </div>
    </Protected>
  );
}
function RequestDetailModalAdvanced({
  req,
  onClose
}: {
  req: any;
  onClose: () => void;
}) {
  const isGroup = !!(req?.isGroup || req?.type === "group");
  const discountRate = req?.createdByRole === "agency" ? (req?.agencyDiscountRate ?? 5) : 0;
  const nights = calcNights(req?.checkIn, req?.checkOut);
  const totalGuests = Number(req?.adults ?? 0) + Number(req?.childrenCount ?? 0);

  const createdStr = req?.createdAt?.toDate ? req.createdAt.toDate().toLocaleString("tr-TR") : "—";

  const mapQuery = `${req?.city ?? ""} ${req?.district ?? ""}`.trim();
  const mapsUrl = mapQuery
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`
    : null;

  const roomTypes = Array.isArray(req?.roomTypes) ? req.roomTypes : [];
  const childrenAges = Array.isArray(req?.childrenAges) ? req.childrenAges : [];

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/70">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />

      <div className="relative mt-10 w-full max-w-4xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-2xl shadow-black/60 max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm md:text-base font-semibold text-slate-100">Talep detayı</h2>
              <span className="text-[0.7rem] text-slate-500">#{req?.id ?? "—"}</span>

              {req?.createdByRole === "agency" && (
                <span className="inline-flex items-center rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[0.65rem] text-sky-200">
                  ACENTA TALEBİ
                </span>
              )}

              {isGroup && (
                <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[0.65rem] text-amber-200">
                  Grup talebi
                </span>
              )}

              {discountRate ? (
                <span className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[0.65rem] text-emerald-200">
                  %{discountRate} düşük gösterim
                </span>
              ) : null}
            </div>

            <p className="text-[0.75rem] text-slate-400">
              Oluşturma: <span className="text-slate-200">{createdStr}</span>
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs text-slate-200 hover:border-emerald-400 transition"
          >
            Kapat ✕
          </button>
        </div>

        {/* Quick cards */}
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
            <p className="text-[0.7rem] text-slate-400">Konum</p>
            <p className="text-slate-100 font-semibold">
              {safeStr(req?.city)}
              {req?.district ? ` / ${req?.district}` : ""}
            </p>
            {mapsUrl && (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[0.7rem] text-sky-300 hover:underline"
              >
                Haritada aç →
              </a>
            )}
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
            <p className="text-[0.7rem] text-slate-400">Tarih</p>
            <p className="text-slate-100 font-semibold">
              {safeStr(req?.checkIn)} – {safeStr(req?.checkOut)}
            </p>
            <p className="text-[0.75rem] text-slate-300">{nights} gece</p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
            <p className="text-[0.7rem] text-slate-400">Kişi / Oda</p>
            <p className="text-slate-100 font-semibold">{totalGuests} kişi</p>
            <p className="text-[0.75rem] text-slate-300">{Number(req?.roomsCount ?? 1)} oda</p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
            <p className="text-[0.7rem] text-slate-400">Çocuk yaşları</p>
            {childrenAges.length ? (
              <p className="text-slate-100 font-semibold">{childrenAges.join(", ")}</p>
            ) : (
              <p className="text-slate-400">—</p>
            )}
          </div>
        </div>

        {/* Body grid */}
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {/* Customer */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
            <p className="text-[0.75rem] text-slate-400">Müşteri</p>

            <div className="grid gap-2 md:grid-cols-2">
              <div>
                <p className="text-[0.65rem] text-slate-500">Ad Soyad</p>
                <p className="text-slate-100 font-semibold">{safeStr(req?.customerName)}</p>
              </div>

              <div>
                <p className="text-[0.65rem] text-slate-500">E-posta</p>
                <p className="text-slate-100">{safeStr(req?.customerEmail)}</p>
              </div>

              <div>
                <p className="text-[0.65rem] text-slate-500">Telefon</p>
                <p className="text-slate-100">{safeStr(req?.customerPhone)}</p>
              </div>

              <div>
                <p className="text-[0.65rem] text-slate-500">İkinci Telefon</p>
                <p className="text-slate-100">{safeStr(req?.contactPhone2 || req?.customerPhone2)}</p>
              </div>
            </div>
          </div>

          {/* Preferences */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
            <p className="text-[0.75rem] text-slate-400">Tercihler</p>

            <div className="space-y-2">
              <div>
                <p className="text-[0.65rem] text-slate-500">Oda tipleri</p>
                <p className="text-slate-100">
                  {roomTypes.length ? roomTypes.join(", ") : "—"}
                </p>
              </div>

              <div>
                <p className="text-[0.65rem] text-slate-500">Not</p>
                <p className="text-slate-100 whitespace-pre-wrap">
                  {safeStr(req?.generalNote || req?.note)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[0.7rem] text-slate-500">
            Bu detay ekranı acenta içi kayıt / karar verme için hazırlanmıştır.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-slate-500"
            >
              Kapat
            </button>
          </div>
        </div>
      </div>

      <style jsx global>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .fixed > .relative {
          animation: fadeInUp .16s ease-out both;
        }
      `}</style>
    </div>
  );
}
