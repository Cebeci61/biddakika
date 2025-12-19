"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Protected } from "@/components/Protected";
import { useAuth } from "@/context/AuthContext";
import { getFirestoreDb } from "@/lib/firebase/client";
import { collection, getDocs, query, where, Timestamp } from "firebase/firestore";

type PaymentMethod = "card3d" | "payAtHotel" | string;

type Booking = {
  id: string;

  guestId?: string | null; // agency uid
  createdByRole?: string | null;

  hotelId?: string | null;
  hotelName?: string | null;

  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;

  city?: string | null;
  district?: string | null;

  checkIn: string;  // YYYY-MM-DD
  checkOut: string; // YYYY-MM-DD

  adults?: number | null;
  childrenCount?: number | null;
  roomsCount?: number | null;

  // Acenta müşteriye sattığı fiyat
  totalPrice: number;
  currency: string;

  // Otelin verdiği fiyat (varsa)
  originalHotelOfferPrice?: number | null;
  agencyDiscountRate?: number | null;

  paymentMethod?: PaymentMethod;
  paymentStatus?: string;

  status: string; // active | cancelled | deleted vs
  createdAt?: Timestamp;
};

function safeStr(v: any, fallback = "—") {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s.length ? s : fallback;
}

function safeNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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

function calcNights(ci?: string | null, co?: string | null) {
  const a = parseDate(ci);
  const b = parseDate(co);
  if (!a || !b) return 1;
  const d = diffInDays(b, a);
  return d > 0 ? d : 1;
}

function isCancelled(b: Booking) {
  return b.status === "cancelled";
}

function monthNameTR(m: number) {
  const names = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"];
  return names[m] || "";
}

function paymentMethodText(method?: string) {
  if (method === "card3d") return "3D Secure kart";
  if (method === "payAtHotel") return "Otelde ödeme";
  return safeStr(method);
}

/** Acenta kazancı = (otel fiyatı - acenta fiyatı). Otel fiyatı yoksa 0 */
function calcAgencyProfit(b: Booking) {
  if (isCancelled(b)) return 0;
  if (b.originalHotelOfferPrice == null) return 0;
  return Math.max(0, safeNum(b.originalHotelOfferPrice) - safeNum(b.totalPrice));
}
export default function AgencyAccountingPage() {
  const { profile, loading: authLoading } = useAuth() as any;
  const db = getFirestoreDb();

  const now = new Date();
  const [selectedYear, setSelectedYear] = useState<number>(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(now.getMonth()); // 0-11

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  // ✅ data load (index istemez)
  useEffect(() => {
    async function load() {
      if (authLoading) return;
      if (!profile || profile.role !== "agency") {
        setLoading(false);
        return;
      }

      setLoading(true);
      setPageError(null);

      try {
        const qBk = query(collection(db, "bookings"), where("guestId", "==", profile.uid));
        const snap = await getDocs(qBk);

        const list: Booking[] = snap.docs
          .map((d) => {
            const v = d.data() as any;
            return {
              id: d.id,
              guestId: v.guestId ?? null,
              createdByRole: v.createdByRole ?? null,

              hotelId: v.hotelId ?? null,
              hotelName: v.hotelName ?? null,

              customerName: v.customerName ?? null,
              customerPhone: v.customerPhone ?? null,
              customerEmail: v.customerEmail ?? null,

              city: v.city ?? null,
              district: v.district ?? null,

              checkIn: v.checkIn ?? "",
              checkOut: v.checkOut ?? "",

              adults: v.adults ?? null,
              childrenCount: v.childrenCount ?? null,
              roomsCount: v.roomsCount ?? null,

              totalPrice: safeNum(v.totalPrice),
              currency: v.currency ?? "TRY",

              originalHotelOfferPrice: v.originalHotelOfferPrice ?? null,
              agencyDiscountRate: v.agencyDiscountRate ?? null,

              paymentMethod: v.paymentMethod ?? null,
              paymentStatus: v.paymentStatus ?? null,

              status: v.status ?? "active",
              createdAt: v.createdAt
            } as Booking;
          })
          .filter((b) => b.status !== "deleted")
          .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));

        setBookings(list);
      } catch (e: any) {
        console.error(e);
        setPageError(e?.message || "Muhasebe verileri yüklenemedi.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [authLoading, profile, db]);

  // ✅ seçili ay: checkOut’a göre filtre
  const filtered = useMemo(() => {
    return bookings.filter((b) => {
      const out = parseDate(b.checkOut);
      if (!out) return false;
      return out.getFullYear() === selectedYear && out.getMonth() === selectedMonth;
    });
  }, [bookings, selectedYear, selectedMonth]);

  // ✅ toplamlar
  const totals = useMemo(() => {
    let netAgency = 0;  // acentanın müşteriye sattığı
    let grossHotel = 0; // otelin verdiği (varsa)
    let profit = 0;     // acenta kazancı

    filtered.forEach((b) => {
      if (isCancelled(b)) return;

      netAgency += safeNum(b.totalPrice);

      if (b.originalHotelOfferPrice != null) {
        grossHotel += safeNum(b.originalHotelOfferPrice);
      }

      profit += calcAgencyProfit(b);
    });

    return { netAgency, grossHotel, profit };
  }, [filtered]);
    // ✅ yıl içi 12 ay özet (seçili yıl)
  const yearMonthly = useMemo(() => {
    const arr = Array.from({ length: 12 }).map(() => ({
      net: 0,
      gross: 0,
      profit: 0
    }));

    bookings.forEach((b) => {
      if (isCancelled(b)) return;

      const out = parseDate(b.checkOut);
      if (!out) return;
      if (out.getFullYear() !== selectedYear) return;

      const m = out.getMonth();
      const net = safeNum(b.totalPrice);
      const gross = b.originalHotelOfferPrice != null ? safeNum(b.originalHotelOfferPrice) : 0;

      arr[m].net += net;
      if (b.originalHotelOfferPrice != null) arr[m].gross += gross;
      arr[m].profit += calcAgencyProfit(b);
    });

    return arr;
  }, [bookings, selectedYear]);

  // ✅ günlük kazanç (seçili ay)
  const dailyStats = useMemo(() => {
    const map: Record<number, { day: number; profit: number }> = {};

    filtered.forEach((b) => {
      if (isCancelled(b)) return;

      const out = parseDate(b.checkOut);
      if (!out) return;

      const day = out.getDate();
      if (!map[day]) map[day] = { day, profit: 0 };
      map[day].profit += calcAgencyProfit(b);
    });

    return Object.values(map).sort((a, b) => a.day - b.day);
  }, [filtered]);

  const maxDailyProfit = useMemo(() => {
    return dailyStats.reduce((m, d) => Math.max(m, d.profit), 0);
  }, [dailyStats]);

  const maxYearProfit = useMemo(() => {
    return yearMonthly.reduce((m, x) => Math.max(m, x.profit), 0);
  }, [yearMonthly]);


  const years = useMemo(() => {
    const y = new Date().getFullYear();
    return [y - 2, y - 1, y, y + 1, y + 2];
  }, []);

  const months = useMemo(() => Array.from({ length: 12 }).map((_, i) => i), []);

  function handlePrint() {
    if (typeof window === "undefined") return;
    window.print();
  }
  return (
    <Protected allowedRoles={["agency"]}>
      <div className="container-page space-y-6">
        <section className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-100">Faturalarım / Muhasebe (Acenta)</h1>
          <p className="text-sm text-slate-300 max-w-3xl">
            Seçtiğin ay için <b>çıkışı (checkOut)</b> olan rezervasyonlar listelenir.
            Acenta kazancı: <b>(Otel fiyatı − Acenta fiyatı)</b>. İptal rezervasyonlar hesaplara dahil edilmez.
          </p>
        </section>

        {/* Dönem + print */}
        <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 text-xs shadow shadow-slate-950/40 space-y-3 print:border-none print:shadow-none">
          <div className="grid gap-3 md:grid-cols-3 items-end">
            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-200">Yıl</label>
              <select className="input" value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))}>
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-200">Ay</label>
              <select className="input" value={selectedMonth} onChange={(e) => setSelectedMonth(Number(e.target.value))}>
                {months.map((m) => (
                  <option key={m} value={m}>{monthNameTR(m)}</option>
                ))}
              </select>
            </div>

            <div className="flex md:justify-end">
              <button
                type="button"
                onClick={handlePrint}
                className="rounded-md bg-slate-100 text-slate-900 px-4 py-2 text-[0.75rem] font-semibold hover:bg-white"
              >
                Bu ayın raporunu yazdır / PDF
              </button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <MiniCard label="Acenta satış toplamı (net)" value={`${totals.netAgency.toLocaleString("tr-TR")} ₺`} />
            <MiniCard label="Otel fiyat toplamı (brüt)" value={`${totals.grossHotel.toLocaleString("tr-TR")} ₺`} />
            <MiniCard label="Acenta kazancı" value={`${totals.profit.toLocaleString("tr-TR")} ₺`} highlight />
          </div>
        </section>

        {pageError && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-200 text-sm">
            {pageError}
          </div>
        )}

        {loading && <p className="text-sm text-slate-400">Yükleniyor...</p>}

        {!loading && filtered.length === 0 && (
          <p className="text-sm text-slate-400">Bu döneme ait rezervasyon bulunamadı.</p>
        )}

        {!loading && filtered.length > 0 && (
          <section className="rounded-2xl border border-slate-800 bg-slate-950/80 shadow shadow-slate-950/40 overflow-hidden print:border-none print:shadow-none">
            <div className="hidden md:grid grid-cols-[1.7fr_1.1fr_1.5fr_1.1fr] bg-slate-900 px-4 py-2 text-[0.75rem] font-semibold text-slate-100">
              <div>Müşteri / Otel</div>
              <div>Tarih</div>
              <div>Fiyatlar</div>
              <div className="text-right">Kazanç</div>
            </div>

            {filtered.map((b) => {
              const nights = calcNights(b.checkIn, b.checkOut);
              const out = parseDate(b.checkOut);
              const outStr = out ? out.toLocaleDateString("tr-TR") : "—";

              const net = safeNum(b.totalPrice);
              const gross = b.originalHotelOfferPrice != null ? safeNum(b.originalHotelOfferPrice) : null;
              const profit = calcAgencyProfit(b);

              return (
                <div key={b.id} className="border-t border-slate-800 px-4 py-3 grid md:grid-cols-[1.7fr_1.1fr_1.5fr_1.1fr] gap-2 items-center text-xs">
                  <div className="space-y-1">
                    <div className="text-slate-100 font-semibold">
                      {safeStr(b.customerName)} • {safeStr(b.hotelName)}
                      {isCancelled(b) && (
                        <span className="ml-2 inline-flex items-center rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[0.65rem] text-red-200">
                          İPTAL
                        </span>
                      )}
                    </div>
                    <div className="text-[0.75rem] text-slate-400">
                      {safeStr(b.city)}{b.district ? ` / ${b.district}` : ""} • Tel: {safeStr(b.customerPhone)}
                    </div>
                    <div className="text-[0.7rem] text-slate-500">RezNo: {b.id}</div>
                  </div>

                  <div className="space-y-1 text-slate-100">
                    <div>{b.checkIn} → {b.checkOut}</div>
                    <div className="text-[0.75rem] text-slate-400">
                      {nights} gece • Çıkış: {outStr}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-slate-100">
                      <span className="text-slate-400">Acenta:</span>{" "}
                      <span className="font-semibold text-emerald-300">{net.toLocaleString("tr-TR")} ₺</span>
                    </div>
                    <div className="text-slate-100">
                      <span className="text-slate-400">Otel:</span>{" "}
                      <span className="font-semibold">{gross != null ? `${gross.toLocaleString("tr-TR")} ₺` : "—"}</span>
                      {b.agencyDiscountRate != null && (
                        <span className="text-slate-500"> • %{b.agencyDiscountRate}</span>
                      )}
                    </div>
                    <div className="text-[0.75rem] text-slate-400">
                      {paymentMethodText(String(b.paymentMethod))} • {safeStr(b.paymentStatus)}
                    </div>
                  </div>

                  <div className="text-right space-y-1">
                    <div className={`font-extrabold ${profit > 0 ? "text-emerald-300" : "text-slate-400"}`}>
                      {profit > 0 ? `${profit.toLocaleString("tr-TR")} ₺` : "—"}
                    </div>
                    <div className="text-[0.7rem] text-slate-500">
                      {isCancelled(b) ? "İptal: 0" : (gross == null ? "Otel fiyatı yok" : "Acenta kazancı")}
                    </div>
                  </div>
                </div>
              );
            })}
          </section>
        )}
        {/* ✅ 12 ay tek bakış (seçili yıl) */}
        <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 text-xs shadow shadow-slate-950/40 print:hidden">
          <h2 className="text-sm font-semibold text-slate-100 mb-3">
            {selectedYear} • Ay ay kazanç
          </h2>

          <div className="grid gap-2">
            {yearMonthly.map((m, idx) => {
              const width = maxYearProfit > 0 ? Math.max(2, (m.profit / maxYearProfit) * 100) : 0;
              return (
                <div key={idx} className="flex items-center gap-3">
                  <div className="w-16 text-[0.75rem] text-slate-400">{monthNameTR(idx)}</div>

                  <div className="flex-1 h-3 rounded-full bg-slate-800 overflow-hidden">
                    <div className="h-full bg-emerald-500/80" style={{ width: `${width}%` }} />
                  </div>

                  <div className="w-28 text-right text-emerald-300 font-semibold">
                    {m.profit.toLocaleString("tr-TR")} ₺
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ✅ Günlük kazanç grafiği (seçili ay) */}
        {dailyStats.length > 0 && (
          <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 text-xs shadow shadow-slate-950/40 print:hidden">
            <h2 className="text-sm font-semibold text-slate-100 mb-2">Günlük kazanç grafiği</h2>
            <p className="text-[0.7rem] text-slate-400 mb-3">
              Bu alan sadece görüntü içindir, PDF çıktısına dahil edilmez.
            </p>

            <div className="space-y-1">
              {dailyStats.map((d) => {
                const width = maxDailyProfit > 0 ? Math.max(4, (d.profit / maxDailyProfit) * 100) : 0;
                return (
                  <div key={d.day} className="flex items-center gap-2 text-[0.7rem]">
                    <span className="w-8 text-right text-slate-400">{d.day}</span>
                    <div className="flex-1 h-3 rounded-full bg-slate-800 overflow-hidden">
                      <div className="h-full rounded-full bg-emerald-500/80" style={{ width: `${width}%` }} />
                    </div>
                    <span className="w-28 text-right text-slate-300">
                      {d.profit.toLocaleString("tr-TR")} ₺
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
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
        `}</style>
      </div>
    </Protected>
  );
}

function MiniCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border border-slate-800 bg-slate-950/60 p-3 ${highlight ? "ring-1 ring-emerald-500/25" : ""}`}>
      <p className="text-[0.7rem] text-slate-400">{label}</p>
      <p className={`mt-1 font-extrabold ${highlight ? "text-emerald-300" : "text-slate-100"}`}>{value}</p>
    </div>
  );
}
