// app/hotel/accounting/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
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
  getDoc,
  addDoc,
  serverTimestamp
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

  checkIn: string;
  checkOut: string;

  adults?: number | null;
  childrenCount?: number | null;
  childrenAges?: number[] | null;

  roomsCount?: number | null;

  totalPrice: number;
  currency: string;

  paymentMethod: PaymentMethod | string;
  paymentStatus: string;

  status: string; // active | cancelled | completed vb.

  roomBreakdown?: RoomBreakdownItem[];

  commissionRate?: number | null; // booking’de varsa
  commissionLabel?: string | null; // booking’de varsa (opsiyonel)

  cancellationPolicyType?: CancellationPolicyType | null;
  cancellationPolicyDays?: number | null;
  cancellationPolicyLabel?: string | null;

  createdAt?: Timestamp;
}

interface OfferDoc {
  id: string;
  commissionRate?: number | null;        // teklifte verdiğin oran
  commissionLabel?: string | null;       // teklifte verdiğin tür
  roomBreakdown?: RoomBreakdownItem[];   // teklifte verdiğin oda kırılımı
}

interface InvoiceDoc {
  status?: "pending" | "paid";
  paidAt?: Timestamp | null;
}

interface DailyStat {
  day: number; // 1–31
  revenue: number;
  commission: number;
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

function bookingIsCancelled(b: Booking) {
  return b.status === "cancelled";
}

function paymentMethodText(method: string) {
  if (method === "card3d") return "3D Secure kart";
  if (method === "payAtHotel") return "Otelde ödeme";
  return method;
}

function monthNameTR(m: number) {
  const names = [
    "Ocak","Şubat","Mart","Nisan","Mayıs","Haziran",
    "Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"
  ];
  return names[m] || "";
}

/** Fatura dönemi: seçili ay; ödeme dönemi: sonraki ay 1–7 */
function computeInvoiceWarning(
  year: number,
  month: number,
  invoiceStatus: "pending" | "paid"
) {
  const now = new Date();
  const dueYear = month === 11 ? year + 1 : year;
  const dueMonth = month === 11 ? 0 : month + 1;

  const dueStart = new Date(dueYear, dueMonth, 1, 0, 0, 0);
  const dueEnd = new Date(dueYear, dueMonth, 7, 23, 59, 59);

  const nowMs = now.getTime();

  if (invoiceStatus === "paid") {
    return {
      color: "text-emerald-300 bg-emerald-500/10 border-emerald-500/40",
      text: "Bu döneme ait komisyon faturası ödendi."
    };
  }

  if (nowMs < dueStart.getTime()) {
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    if (nowMs >= dueStart.getTime() - sevenDaysMs) {
      return {
        color: "text-amber-300 bg-amber-500/10 border-amber-500/40",
        text: `Bu dönemin komisyon ödemesi yaklaşıyor. Ödeme dönemi: ${monthNameTR(dueMonth)} 1–7.`
      };
    }
    return {
      color: "text-slate-200 bg-slate-700/20 border-slate-600/60",
      text: `Bu dönemin komisyon ödemesi: ${monthNameTR(dueMonth)} 1–7.`
    };
  }

  if (nowMs >= dueStart.getTime() && nowMs <= dueEnd.getTime() && invoiceStatus === "pending") {
    return {
      color: "text-amber-300 bg-amber-500/10 border-amber-500/40",
      text: `Ödeme dönemindesiniz. Bu döneme ait komisyon henüz "ödendi" olarak işaretlenmemiş görünüyor.`
    };
  }

  if (nowMs > dueEnd.getTime() && invoiceStatus === "pending") {
    return {
      color: "text-red-300 bg-red-500/10 border-red-500/40",
      text: `Bu döneme ait komisyon "ödendi" değil. Lütfen Biddakika yönetimi ile iletişime geçin.`
    };
  }

  return { color: "text-slate-200 bg-slate-700/20 border-slate-600/60", text: "" };
}

function normalizeRoomBreakdown(rb: any, fallbackNights: number): RoomBreakdownItem[] {
  const arr = Array.isArray(rb) ? rb : [];
  return arr.map((x) => {
    const nights = x.nights ?? fallbackNights;
    const nightlyPrice = Number(x.nightlyPrice ?? 0);
    const totalPrice = x.totalPrice != null ? Number(x.totalPrice) : nightlyPrice * nights;
    return {
      roomTypeId: x.roomTypeId,
      roomTypeName: x.roomTypeName,
      nights,
      nightlyPrice,
      totalPrice
    };
  });
}

/** Sadece seçili ay içinde (veya o ayın ödeme döneminde) itiraz edilsin */
function isDisputeWindowOpen(selectedYear: number, selectedMonth: number) {
  const now = new Date();
  const sameMonth = now.getFullYear() === selectedYear && now.getMonth() === selectedMonth;
  // İstersen daha esnek: ödeme döneminde de açık kalsın:
  // const nextMonth = selectedMonth === 11 ? 0 : selectedMonth + 1;
  // const nextYear = selectedMonth === 11 ? selectedYear + 1 : selectedYear;
  // const inPaymentWindow = now.getFullYear()===nextYear && now.getMonth()===nextMonth && now.getDate()<=7;
  // return sameMonth || inPaymentWindow;
  return sameMonth;
}

export default function HotelAccountingPage() {
  const { profile, loading: authLoading } = useAuth();
  const db = getFirestoreDb();

  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth());

  // gün filtresi (aynı mantık korunuyor, ekstra kontrol)
  const [dayFrom, setDayFrom] = useState<number | "all">("all");
  const [dayTo, setDayTo] = useState<number | "all">("all");

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [offersMap, setOffersMap] = useState<Record<string, OfferDoc>>({});

  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  const [invoiceStatus, setInvoiceStatus] = useState<"pending" | "paid">("pending");
  const [invoiceLoading, setInvoiceLoading] = useState(false);

  // itiraz modal state
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeBooking, setDisputeBooking] = useState<Booking | null>(null);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeSending, setDisputeSending] = useState(false);
  const [disputeMsg, setDisputeMsg] = useState<string | null>(null);

  // -------------- BOOKINGLERİ YÜKLE + OFFER’LARI ÇEK --------------
  useEffect(() => {
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

        const data: Booking[] = snap.docs.map((d) => {
          const v = d.data() as any;
          return {
            id: d.id,
            offerId: v.offerId ?? null,
            requestId: v.requestId ?? null,
            hotelId: v.hotelId ?? null,
            hotelName: v.hotelName ?? null,

            guestId: v.guestId ?? null,
            guestName: v.guestName || v.guestDisplayName || v.contactName || "Misafir",

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
            commissionLabel: v.commissionLabel ?? v.commissionType ?? v.commissionNote ?? null,

            cancellationPolicyType: v.cancellationPolicyType ?? null,
            cancellationPolicyDays: v.cancellationPolicyDays ?? null,
            cancellationPolicyLabel: v.cancellationPolicyLabel ?? null,

            createdAt: v.createdAt
          };
        });

        data.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
        setBookings(data);

        // offerId’leri topla
        const offerIds = Array.from(new Set(data.map((b) => b.offerId).filter(Boolean) as string[]));
        const map: Record<string, OfferDoc> = {};

        // offer’ları tek tek çek (stabil ve doğru)
        await Promise.all(
          offerIds.map(async (id) => {
            try {
              const os = await getDoc(doc(db, "offers", id));
              if (!os.exists()) return;
              const v = os.data() as any;
              map[id] = {
                id,
                commissionRate: v.commissionRate ?? v.commission ?? null,
                commissionLabel: v.commissionLabel ?? v.commissionType ?? v.commissionNote ?? null,
                roomBreakdown: Array.isArray(v.roomBreakdown) ? v.roomBreakdown : (Array.isArray(v.rooms) ? v.rooms : [])
              };
            } catch {
              // ignore
            }
          })
        );

        setOffersMap(map);
      } catch (err) {
        console.error("Otel muhasebe verileri yüklenirken hata:", err);
        setPageError("Rezervasyonlar yüklenirken bir hata oluştu.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [authLoading, profile, db]);

  // -------------- İNVOICE DOKÜMANI --------------
  useEffect(() => {
    async function loadInvoice() {
      if (!profile || profile.role !== "hotel") return;

      setInvoiceLoading(true);
      try {
        const docId = `${profile.uid}_${selectedYear}_${selectedMonth}`;
        const ref = doc(db, "hotelInvoices", docId);
        const snap = await getDoc(ref);
        if (!snap.exists()) setInvoiceStatus("pending");
        else {
          const v = snap.data() as InvoiceDoc;
          setInvoiceStatus(v.status === "paid" ? "paid" : "pending");
        }
      } catch (err) {
        console.error("Fatura durumu okunurken hata:", err);
        setInvoiceStatus("pending");
      } finally {
        setInvoiceLoading(false);
      }
    }

    loadInvoice();
  }, [db, profile, selectedYear, selectedMonth]);

  // -------------- AYLIK (CHECKOUT) FİLTRE --------------
  const monthlyBookings = useMemo(() => {
    return bookings
      .filter((b) => {
        const out = parseDate(b.checkOut);
        if (!out) return false;
        return out.getFullYear() === selectedYear && out.getMonth() === selectedMonth;
      })
      .map((b) => {
        // eksikleri offer’dan tamamla
        const offer = b.offerId ? offersMap[b.offerId] : undefined;
        const commissionRate = b.commissionRate ?? offer?.commissionRate ?? null;
        const commissionLabel = b.commissionLabel ?? offer?.commissionLabel ?? null;

        const nights = (() => {
          const ci = parseDate(b.checkIn);
          const co = parseDate(b.checkOut);
          if (!ci || !co) return 1;
          const diff = Math.floor((normalized(co).getTime() - normalized(ci).getTime()) / (1000 * 60 * 60 * 24));
          return diff > 0 ? diff : 1;
        })();

        const rb =
          Array.isArray(b.roomBreakdown) && b.roomBreakdown.length
            ? normalizeRoomBreakdown(b.roomBreakdown, nights)
            : normalizeRoomBreakdown(offer?.roomBreakdown, nights);

        return {
          ...b,
          commissionRate,
          commissionLabel,
          roomBreakdown: rb
        } as Booking;
      });
  }, [bookings, offersMap, selectedYear, selectedMonth]);

  // Gün aralığı filtresi (opsiyonel)
  const filteredBookings = useMemo(() => {
    if (dayFrom === "all" && dayTo === "all") return monthlyBookings;
    return monthlyBookings.filter((b) => {
      const out = parseDate(b.checkOut);
      if (!out) return false;
      const d = out.getDate();
      if (dayFrom !== "all" && d < dayFrom) return false;
      if (dayTo !== "all" && d > dayTo) return false;
      return true;
    });
  }, [monthlyBookings, dayFrom, dayTo]);

  // AY TOPLAM
  const monthlyTotals = useMemo(() => {
    let revenue = 0;
    let commission = 0;

    filteredBookings.forEach((b) => {
      revenue += Number(b.totalPrice || 0);

      const rate = b.commissionRate ? Number(b.commissionRate) : 0;
      const comm = !bookingIsCancelled(b) && rate ? (Number(b.totalPrice || 0) * rate) / 100 : 0;
      commission += comm;
    });

    return { revenue, commission };
  }, [filteredBookings]);

  // YIL TOPLAM (seçili yılın tüm ayları)
  const yearlyTotals = useMemo(() => {
    let revenue = 0;
    let commission = 0;

    bookings.forEach((b0) => {
      const out = parseDate(b0.checkOut);
      if (!out) return;
      if (out.getFullYear() !== selectedYear) return;

      const offer = b0.offerId ? offersMap[b0.offerId] : undefined;
      const rate = (b0.commissionRate ?? offer?.commissionRate ?? 0) as number;

      revenue += Number(b0.totalPrice || 0);
      const comm = !bookingIsCancelled(b0) && rate ? (Number(b0.totalPrice || 0) * Number(rate)) / 100 : 0;
      commission += comm;
    });

    return { revenue, commission };
  }, [bookings, offersMap, selectedYear]);
  
    // ✅ YIL İÇİ 12 AY ÖZETİ (checkout ayına göre)
  const yearMonthlySummary = useMemo(() => {
    const months = Array.from({ length: 12 }).map((_, i) => i);

    const summary = months.map((m) => ({
      month: m,
      bookingCount: 0,
      revenue: 0,
      commission: 0
    }));

    bookings.forEach((b0) => {
      const out = parseDate(b0.checkOut);
      if (!out) return;
      if (out.getFullYear() !== selectedYear) return;

      const m = out.getMonth();
      const row = summary[m];

      row.bookingCount += 1;

      const total = Number(b0.totalPrice || 0);
      row.revenue += total;

      const offer = b0.offerId ? offersMap[b0.offerId] : undefined;
      const rate = Number(b0.commissionRate ?? offer?.commissionRate ?? 0);

      // iptal: komisyon 0 ama satır sayısı + gelir duruyor (senin istediğin gibi)
      const comm = !bookingIsCancelled(b0) && rate ? (total * rate) / 100 : 0;
      row.commission += comm;
    });

    return summary;
  }, [bookings, offersMap, selectedYear]);


  // Günlük komisyon grafiği (iptal=0 dahil)
  const dailyStats = useMemo<DailyStat[]>(() => {
    const map: Record<number, { revenue: number; commission: number }> = {};
    filteredBookings.forEach((b) => {
      const out = parseDate(b.checkOut);
      if (!out) return;
      const day = out.getDate();
      if (!map[day]) map[day] = { revenue: 0, commission: 0 };

      const total = Number(b.totalPrice || 0);
      const rate = b.commissionRate ? Number(b.commissionRate) : 0;
      const comm = !bookingIsCancelled(b) && rate ? (total * rate) / 100 : 0;

      map[day].revenue += total;
      map[day].commission += comm;
    });

    return Object.entries(map)
      .map(([k, v]) => ({ day: Number(k), revenue: v.revenue, commission: v.commission }))
      .sort((a, b) => a.day - b.day);
  }, [filteredBookings]);

  const maxDailyCommission = useMemo(
    () => dailyStats.reduce((max, d) => Math.max(max, d.commission), 0),
    [dailyStats]
  );

  const warning = computeInvoiceWarning(selectedYear, selectedMonth, invoiceStatus);

  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const arr: number[] = [];
    for (let y = currentYear - 2; y <= currentYear + 2; y++) arr.push(y);
    return arr;
  }, []);

  const months = Array.from({ length: 12 }).map((_, i) => i);

  function handlePrintInvoice() {
    if (typeof window === "undefined") return;
    window.print();
  }

  function openDispute(b: Booking) {
    setDisputeBooking(b);
    setDisputeReason("");
    setDisputeMsg(null);
    setDisputeOpen(true);
  }

  async function submitDispute() {
    if (!profile || !disputeBooking) return;
    const reason = disputeReason.trim();
    if (!reason) {
      setDisputeMsg("Lütfen itiraz sebebini yaz.");
      return;
    }
    try {
      setDisputeSending(true);
      setDisputeMsg(null);

      // sadece seçili ay içinde itiraz
      if (!isDisputeWindowOpen(selectedYear, selectedMonth)) {
        setDisputeMsg("Bu döneme ait itiraz süresi kapalı.");
        return;
      }

      await addDoc(collection(db, "commissionDisputes"), {
        hotelId: profile.uid,
        bookingId: disputeBooking.id,
        offerId: disputeBooking.offerId ?? null,
        requestId: disputeBooking.requestId ?? null,
        year: selectedYear,
        month: selectedMonth,
        reason,
        createdAt: serverTimestamp(),
        status: "open"
      });

      setDisputeMsg("İtiraz gönderildi. Yönetim inceleyecek.");
      setTimeout(() => {
        setDisputeOpen(false);
        setDisputeBooking(null);
      }, 900);
    } catch (e) {
      console.error("itiraz gönderme hatası:", e);
      setDisputeMsg("İtiraz gönderilirken hata oluştu.");
    } finally {
      setDisputeSending(false);
    }
  }

  // render aşağıda (KOD 2/3)
  return (
    <Protected allowedRoles={["hotel"]}>
      <div className="container-page space-y-6">
        {/* HEADER */}
        <section className="space-y-2">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-slate-100">Faturalarım / Muhasebe</h1>
              <p className="text-sm text-slate-300 max-w-3xl">
                Çıkış tarihi (check-out) seçili ay içinde olan rezervasyonlar bu döneme düşer. İptal edilenler listede kalır, komisyonu 0 yazılır.
              </p>
            </div>

            {/* Dip özet kartları */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 w-full md:w-auto">
              <Stat title="Ay Gelir" value={`${monthlyTotals.revenue.toLocaleString("tr-TR")} ₺`} />
              <Stat title="Ay Komisyon" value={`${monthlyTotals.commission.toLocaleString("tr-TR")} ₺`} strong />
              <Stat title="Yıl Gelir" value={`${yearlyTotals.revenue.toLocaleString("tr-TR")} ₺`} />
              <Stat title="Yıl Komisyon" value={`${yearlyTotals.commission.toLocaleString("tr-TR")} ₺`} strong />
            </div>
          </div>
        </section>

        {/* PERIOD + WARNING + PRINT */}
        <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 text-xs shadow shadow-slate-950/40 space-y-3">
          <div className="grid gap-3 md:grid-cols-12 items-end">
            <div className="md:col-span-2 space-y-1">
              <label className="text-[0.75rem] text-slate-200">Yıl</label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs outline-none focus:border-emerald-400 transition"
              >
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2 space-y-1">
              <label className="text-[0.75rem] text-slate-200">Ay</label>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs outline-none focus:border-emerald-400 transition"
              >
                {months.map((m) => (
                  <option key={m} value={m}>{monthNameTR(m)}</option>
                ))}
              </select>
            </div>

            {/* Gün filtresi (opsiyonel) */}
            <div className="md:col-span-3 space-y-1">
              <label className="text-[0.75rem] text-slate-200">Seçili gün aralığı</label>
              <div className="flex gap-2">
                <select
                  value={dayFrom}
                  onChange={(e) => setDayFrom(e.target.value === "all" ? "all" : Number(e.target.value))}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-2 text-xs outline-none focus:border-emerald-400 transition"
                >
                  <option value="all">Min</option>
                  {Array.from({ length: 31 }).map((_, i) => (
                    <option key={i + 1} value={i + 1}>{i + 1}</option>
                  ))}
                </select>

                <select
                  value={dayTo}
                  onChange={(e) => setDayTo(e.target.value === "all" ? "all" : Number(e.target.value))}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-2 text-xs outline-none focus:border-emerald-400 transition"
                >
                  <option value="all">Max</option>
                  {Array.from({ length: 31 }).map((_, i) => (
                    <option key={i + 1} value={i + 1}>{i + 1}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="md:col-span-3 space-y-1">
              <label className="text-[0.75rem] text-slate-200">Seçilen dönem</label>
              <p className="text-[0.9rem] text-slate-100 font-semibold">
                {monthNameTR(selectedMonth)} {selectedYear}
              </p>
              <p className="text-[0.72rem] text-slate-400">
                Bu dönem: çıkış tarihi {monthNameTR(selectedMonth)} {selectedYear} içinde olan rezervasyonlar.
              </p>
            </div>

            <div className="md:col-span-2 flex justify-end">
              <button
                type="button"
                onClick={handlePrintInvoice}
                className="rounded-md bg-slate-100 text-slate-900 px-4 py-2 text-[0.8rem] font-semibold hover:bg-white transition"
              >
                Bu ayı yazdır / PDF
              </button>
            </div>
          </div>

          <div className={`rounded-md border px-3 py-2 text-[0.8rem] ${warning.color}`}>
            {invoiceLoading ? "Fatura durumu yükleniyor..." : (warning.text || "Bu dönemin ödeme süreci yönetim panelinden takip edilir.")}
          </div>

          <div className="text-[0.72rem] text-slate-500">
            Sonuç: <span className="text-slate-200 font-semibold">{filteredBookings.length}</span> rezervasyon
          </div>
        </section>

        {pageError && (
          <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/40 rounded-md px-3 py-2">
            {pageError}
          </p>
        )}

        {loading && <p className="text-sm text-slate-400">Rezervasyonlar yükleniyor...</p>}

        {!loading && filteredBookings.length === 0 && (
          <p className="text-sm text-slate-400">Bu döneme ait rezervasyon bulunamadı.</p>
        )}

        {/* LIST */}
        {filteredBookings.length > 0 && (
          <section className="rounded-2xl border border-slate-800 bg-slate-950/80 shadow shadow-slate-950/40 overflow-hidden print:border-none print:shadow-none">
            <div className="hidden md:grid grid-cols-[1.6fr_1.6fr_1.4fr_1.2fr_1.2fr_auto] bg-slate-900 text-[0.75rem] font-semibold text-slate-100 px-4 py-3">
              <div>Misafir / Konum</div>
              <div>Tarih</div>
              <div>Ödeme</div>
              <div>Komisyon</div>
              <div>Oda kırılımı</div>
              <div className="text-right">İşlem</div>
            </div>

            {filteredBookings.map((b) => {
              const out = parseDate(b.checkOut);
              const rate = b.commissionRate ? Number(b.commissionRate) : 0;

              const commAmount =
                !bookingIsCancelled(b) && rate ? (Number(b.totalPrice || 0) * rate) / 100 : 0;

              const createdStr = b.createdAt ? b.createdAt.toDate().toLocaleString("tr-TR") : "—";
              const cancelled = bookingIsCancelled(b);

              const commissionLabel = safeStr((b as any).commissionLabel, "Komisyon");

              const rb = Array.isArray(b.roomBreakdown) ? b.roomBreakdown : [];
              const rbText =
                rb.length
                  ? `${rb.length} oda • ${rb.reduce((s, x) => s + Number(x.totalPrice || 0), 0).toLocaleString("tr-TR")} ${b.currency}`
                  : "—";

              const disputeAllowed = isDisputeWindowOpen(selectedYear, selectedMonth);

              return (
                <div key={b.id} className="border-t border-slate-800">
                  <div className="grid md:grid-cols-[1.6fr_1.6fr_1.4fr_1.2fr_1.2fr_auto] gap-3 px-4 py-4 items-start">
                    {/* Misafir */}
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <div className="text-slate-100 text-sm font-semibold">
                          {safeStr(b.guestName, "Misafir")}
                        </div>
                        {cancelled && (
                          <span className="inline-flex items-center rounded-md border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[0.7rem] text-red-300">
                            İPTAL
                          </span>
                        )}
                      </div>

                      <div className="text-[0.75rem] text-slate-300">
                        {safeStr(b.city)}{b.district ? ` / ${b.district}` : ""}
                      </div>

                      <div className="text-[0.7rem] text-slate-500">
                        Rez. No: <span className="text-slate-200">{b.id}</span>
                      </div>

                      <div className="text-[0.7rem] text-slate-500">
                        Oluşturma: {createdStr}
                      </div>
                    </div>

                    {/* Tarih */}
                    <div className="space-y-1">
                      <div className="text-[0.85rem] text-slate-100 font-semibold">
                        {b.checkIn} – {b.checkOut}
                      </div>
                      <div className="text-[0.75rem] text-slate-300">
                        {(b.adults ?? 0)} yetişkin
                        {b.childrenCount && b.childrenCount > 0 ? ` • ${b.childrenCount} çocuk` : ""} •{" "}
                        {b.roomsCount || 1} oda
                      </div>
                      <div className="text-[0.72rem] text-slate-500">
                        Bu satırın ayı: {out ? `${monthNameTR(out.getMonth())} ${out.getFullYear()}` : "—"}
                      </div>
                    </div>

                    {/* Ödeme */}
                    <div className="space-y-1">
                      <div className="text-[0.9rem] font-extrabold text-slate-100">
                        {Number(b.totalPrice || 0).toLocaleString("tr-TR")} {b.currency}
                      </div>
                      <div className="text-[0.72rem] text-slate-400">
                        Yöntem: <span className="text-slate-200">{paymentMethodText(String(b.paymentMethod))}</span>
                      </div>
                      <div className="text-[0.72rem] text-slate-400">
                        Durum: <span className="text-slate-200">{safeStr(b.paymentStatus)}</span>
                      </div>
                      {cancelled && (
                        <div className="text-[0.72rem] text-red-300">
                          İptal edildi: komisyon 0
                        </div>
                      )}
                    </div>

                    {/* Komisyon */}
                    <div className="space-y-1">
                      <div className="text-[0.85rem] text-slate-100 font-semibold">
                        %{rate || 0}
                      </div>
                      <div className="text-[0.72rem] text-slate-400">
                        Tür: <span className="text-slate-200">{commissionLabel}</span>
                      </div>
                      <div className="text-[0.85rem] font-extrabold text-emerald-300">
                        {commAmount ? `${commAmount.toLocaleString("tr-TR")} ${b.currency}` : "0"}
                      </div>
                      <div className="text-[0.7rem] text-slate-500">
                        (Toplam komisyon)
                      </div>
                    </div>

                    {/* Oda kırılımı */}
                    <div className="space-y-1">
                      <div className="text-[0.78rem] text-slate-200 font-semibold">{rbText}</div>
                      {rb.length > 0 ? (
                        <div className="text-[0.7rem] text-slate-500">
                          {rb.slice(0, 2).map((x, i) => (
                            <div key={i}>
                              {safeStr(x.roomTypeName, "Oda")} • {Number(x.nightlyPrice || 0).toLocaleString("tr-TR")} {b.currency}/gece
                            </div>
                          ))}
                          {rb.length > 2 ? <div>+{rb.length - 2} oda daha…</div> : null}
                        </div>
                      ) : (
                        <div className="text-[0.7rem] text-slate-500">Oda kırılımı kayıtlı değil.</div>
                      )}
                    </div>

                    {/* İşlem */}
                    <div className="flex flex-col items-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setDisputeBooking(b);
                          setDisputeReason("");
                          setDisputeMsg(null);
                          setDisputeOpen(true);
                        }}
                        disabled={!disputeAllowed}
                        className={`rounded-md px-3 py-2 text-[0.75rem] font-semibold transition ${
                          disputeAllowed
                            ? "border border-amber-500/50 text-amber-200 hover:bg-amber-500/10"
                            : "border border-slate-700 text-slate-500 cursor-not-allowed"
                        }`}
                        title={disputeAllowed ? "Bu ay içinde komisyona itiraz" : "İtiraz süresi kapalı"}
                      >
                        Komisyona itiraz
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {/* AY DIP TOPLAM */}
        {filteredBookings.length > 0 && (
          <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 text-xs shadow shadow-slate-950/40 space-y-1 print:border-none print:shadow-none">
            <p className="text-[0.8rem] text-slate-200">
              {monthNameTR(selectedMonth)} {selectedYear} dönemi dip toplam:
            </p>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
              <p className="text-[0.85rem] text-slate-300">
                Ay gelir: <span className="text-slate-100 font-semibold">{monthlyTotals.revenue.toLocaleString("tr-TR")} ₺</span>
              </p>
              <p className="text-[0.95rem] font-extrabold text-emerald-300">
                Ay komisyon: {monthlyTotals.commission.toLocaleString("tr-TR")} ₺
              </p>
            </div>
            <p className="text-[0.7rem] text-slate-500">
              Not: İptal edilenler satırda görünür, komisyonu 0 hesaplanır.
            </p>
          </section>
        )}
        {/* ✅ YIL İÇİ 12 AY PANELİ */}
        <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 text-xs shadow shadow-slate-950/40 space-y-3 print:hidden">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                {selectedYear} — Ay ay komisyon kontrolü
              </h2>
              <p className="text-[0.72rem] text-slate-400">
                Her satır: çıkış tarihi (check-out) o ayda olan rezervasyonların dip toplamıdır.
                İptaller listede görünür, komisyon 0 yazılır.
              </p>
            </div>

            <div className="text-right">
              <p className="text-[0.7rem] text-slate-400">Seçili ay</p>
              <p className="text-sm font-semibold text-emerald-300">
                {monthNameTR(selectedMonth)} {selectedYear}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 overflow-hidden">
            <div className="grid grid-cols-[1.1fr_1fr_1fr_1fr_auto] bg-slate-900 px-4 py-2 text-[0.75rem] font-semibold text-slate-100">
              <div>Ay</div>
              <div>Rezervasyon</div>
              <div>Ay Gelir</div>
              <div>Ay Komisyon</div>
              <div className="text-right">İşlem</div>
            </div>

            {yearMonthlySummary.map((row) => {
              const isActive = row.month === selectedMonth;

              return (
                <div
                  key={row.month}
                  className={`grid grid-cols-[1.1fr_1fr_1fr_1fr_auto] px-4 py-3 border-t border-slate-800 items-center transition cursor-pointer
                    ${isActive ? "bg-emerald-500/5" : "hover:bg-white/[0.02]"}`}
                  onClick={() => setSelectedMonth(row.month)}
                  title="Bu aya geç"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-slate-100 font-semibold">{monthNameTR(row.month)}</span>
                    {isActive && (
                      <span className="inline-flex items-center rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[0.7rem] text-emerald-300">
                        Seçili
                      </span>
                    )}
                  </div>

                  <div className="text-slate-200">
                    {row.bookingCount}
                    <span className="text-slate-500"> adet</span>
                  </div>

                  <div className="text-slate-200">
                    {row.revenue.toLocaleString("tr-TR")} ₺
                  </div>

                  <div className="text-emerald-300 font-semibold">
                    {row.commission.toLocaleString("tr-TR")} ₺
                  </div>

                  <div className="text-right">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedMonth(row.month);
                      }}
                      className={`rounded-md px-3 py-1.5 text-[0.75rem] font-semibold transition
                        ${isActive ? "bg-emerald-500 text-slate-950 hover:bg-emerald-400" : "border border-slate-700 text-slate-200 hover:border-slate-500"}`}
                    >
                      İncele
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* küçük dip toplam */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 pt-1">
            <p className="text-[0.75rem] text-slate-400">
              Yıl toplam gelir: <span className="text-slate-100 font-semibold">{yearlyTotals.revenue.toLocaleString("tr-TR")} ₺</span>
            </p>
            <p className="text-[0.85rem] font-extrabold text-emerald-300">
              Yıl toplam komisyon: {yearlyTotals.commission.toLocaleString("tr-TR")} ₺
            </p>
          </div>
        </section>

        {/* YIL DIP TOPLAM */}
        <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 text-xs shadow shadow-slate-950/40 space-y-1 print:border-none print:shadow-none">
          <p className="text-[0.8rem] text-slate-200">{selectedYear} yılı dip toplam:</p>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
            <p className="text-[0.85rem] text-slate-300">
              Yıl gelir: <span className="text-slate-100 font-semibold">{yearlyTotals.revenue.toLocaleString("tr-TR")} ₺</span>
            </p>
            <p className="text-[0.95rem] font-extrabold text-emerald-300">
              Yıl komisyon: {yearlyTotals.commission.toLocaleString("tr-TR")} ₺
            </p>
          </div>
        </section>

        {/* GÜNLÜK KOMİSYON GRAFİĞİ */}
        {dailyStats.length > 0 && (
          <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 text-xs shadow shadow-slate-950/40 space-y-3 print:hidden">
            <h2 className="text-sm font-semibold text-slate-100">Günlük komisyon grafiği</h2>
            <p className="text-[0.72rem] text-slate-400">
              Seçili aralık için gün gün komisyon (iptal=0 dahil). Yazdırma çıktısına dahil edilmez.
            </p>

            <div className="space-y-1">
              {dailyStats.map((d) => {
                const width = maxDailyCommission > 0 ? Math.max(4, (d.commission / maxDailyCommission) * 100) : 0;
                return (
                  <div key={d.day} className="flex items-center gap-2 text-[0.7rem]">
                    <span className="w-8 text-right text-slate-400">{d.day}</span>
                    <div className="flex-1 h-3 rounded-full bg-slate-800 overflow-hidden">
                      <div className="h-full rounded-full bg-emerald-500/80" style={{ width: `${width}%` }} />
                    </div>
                    <span className="w-28 text-right text-slate-300">{d.commission.toLocaleString("tr-TR")} ₺</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* İTİRAZ MODAL */}
        {disputeOpen && disputeBooking && (
          <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60">
            <div className="absolute inset-0" onClick={() => setDisputeOpen(false)} aria-hidden="true" />
            <div className="relative mt-14 w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-xl text-sm space-y-3 animate-[fadeIn_.18s_ease-out]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-100">Komisyona itiraz</h3>
                  <p className="text-[0.78rem] text-slate-400">
                    Rezervasyon No: <span className="text-slate-200 font-semibold">{disputeBooking.id}</span>
                  </p>
                </div>
                <button
                  onClick={() => setDisputeOpen(false)}
                  className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-[0.8rem] text-slate-300 hover:border-slate-500 transition"
                >
                  Kapat ✕
                </button>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-[0.8rem] text-slate-300">
                Bu itiraz sadece <span className="text-slate-100 font-semibold">{monthNameTR(selectedMonth)} {selectedYear}</span> dönemi için geçerlidir.
              </div>

              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">İtiraz sebebi</label>
                <textarea
                  rows={4}
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm resize-none outline-none focus:border-amber-400 transition"
                  placeholder="Örn: Oran yanlış uygulanmış / iptal kuralı / özel anlaşma vb."
                />
              </div>

              {disputeMsg && (
                <div className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-[0.8rem] text-slate-200">
                  {disputeMsg}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setDisputeOpen(false)}
                  className="rounded-md border border-slate-700 px-3 py-2 text-[0.8rem] text-slate-200 hover:border-slate-500 transition"
                >
                  Vazgeç
                </button>
                <button
                  onClick={submitDispute}
                  disabled={disputeSending || !isDisputeWindowOpen(selectedYear, selectedMonth)}
                  className="rounded-md bg-amber-400 text-slate-950 px-4 py-2 text-[0.8rem] font-semibold hover:bg-amber-300 disabled:opacity-60 transition"
                >
                  {disputeSending ? "Gönderiliyor..." : "İtirazı gönder"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* küçük anim keyframes */}
        <style jsx global>{`
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(6px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </div>
    </Protected>
  );
}

function Stat({ title, value, strong }: { title: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2">
      <p className="text-[0.65rem] text-slate-400">{title}</p>
      <p className={`text-sm font-semibold ${strong ? "text-emerald-300" : "text-slate-100"}`}>{value}</p>
    </div>
  );
}
// (Bu blok sadece “3. parça” şartın için. KOD 1 + KOD 2 birlikte zaten tam dosyadır.)
export {};
