"use client";

import { useMemo, useState } from "react";
import { tsToDate } from "./firestoreAdmin";
import { useRealtimeList } from "./useAdminRealtime";
import { doc, getFirestore, setDoc, updateDoc } from "firebase/firestore";
import { logActivity } from "./activityLog";

type AnyObj = Record<string, any>;
const g = (o: AnyObj, k: string) => o?.[k];

const PAGE_SIZE = 20;

// ====== Collections ======
const COL = {
  users: "users",
  bookings: "bookings",
  hotelInvoices: "hotelInvoices",
  commissionDisputes: "commissionDisputes",
} as const;

// ====== Users fields ======
const USR = {
  role: "role",
  displayName: "displayName",
  email: "email",
  phone: "phone",
  city: "city",
  district: "district",
  isActive: "isActive",
} as const;

// ====== Booking fields (senin örneğe göre) ======
const BK = {
  createdAt: "createdAt",
  checkIn: "checkIn",
  checkOut: "checkOut",
  city: "city",
  district: "district",
  currency: "currency",
  totalPrice: "totalPrice",
  status: "status",
  paymentMethod: "paymentMethod",
  paymentStatus: "paymentStatus",

  guestId: "guestId",
  guestName: "guestName",
  guestEmail: "guestEmail",
  guestPhone: "guestPhone",

  hotelId: "hotelId",
  hotelName: "hotelName",

  requestId: "requestId",
  offerId: "offerId",

  roomBreakdown: "roomBreakdown",

  // komisyon alanları varsa buradan okur
  commissionRate: "commissionRate",       // örn 8/10/15
  commissionAmount: "commissionAmount",   // TL
} as const;

// ====== Invoice fields ======
const INV = {
  hotelId: "hotelId",
  month: "month", // YYYY-MM
  totalRevenue: "totalRevenue",
  commissionAmount: "commissionAmount",
  bookingCount: "bookingCount",
  dueDate: "dueDate", // YYYY-MM-07 (takip eden ay)
  paid: "paid",
  paidAt: "paidAt",
  paidBy: "paidBy",
  note: "note",
  createdAt: "createdAt",
  updatedAt: "updatedAt",
} as const;

// ====== Dispute fields ======
const DSP = {
  hotelId: "hotelId",
  month: "month",
  invoiceId: "invoiceId",
  status: "status", // open/resolved/rejected
  title: "title",
  message: "message",
  adminReply: "adminReply",
  createdAt: "createdAt",
  updatedAt: "updatedAt",
} as const;

// Fallback: booking komisyon alanı yoksa (eski kayıtlar)
const FALLBACK_RATE = 10; // % — sadece fallback

function num(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function moneyTry(v: number) {
  const n = Math.round((num(v) || 0) * 100) / 100;
  return `₺${n.toLocaleString("tr-TR")}`;
}
function money(v: number, currency?: string) {
  const cur = (currency || "TRY").toUpperCase();
  const sym = cur === "USD" ? "$" : cur === "EUR" ? "€" : "₺";
  const n = Math.round((num(v) || 0) * 100) / 100;
  return `${sym}${n.toLocaleString("tr-TR")}`;
}
function badge(kind: "ok" | "bad" | "warn") {
  if (kind === "ok") return "rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-xs text-emerald-200";
  if (kind === "bad") return "rounded-lg border border-rose-400/30 bg-rose-400/10 px-2 py-1 text-xs text-rose-200";
  return "rounded-lg border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-xs text-amber-200";
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function nextMonthDueDate(month: string) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m, 7); // next month 7th
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-07`;
}
function isOverdue(dueDateStr: string, paid: boolean) {
  if (paid) return false;
  const due = new Date(dueDateStr);
  if (isNaN(due.getTime())) return false;
  return new Date().getTime() > due.getTime();
}

function getCommissionFromBooking(b: AnyObj) {
  const amountRaw = b?.[BK.commissionAmount];
  const amount = Number(amountRaw);
  if (Number.isFinite(amount) && amount >= 0) return { amount, rate: null as number | null };

  const rateRaw = b?.[BK.commissionRate];
  const rate = Number(rateRaw);
  const total = Number(b?.[BK.totalPrice] ?? 0);

  if (Number.isFinite(rate) && rate >= 0 && Number.isFinite(total) && total >= 0) {
    return { amount: (total * rate) / 100, rate };
  }

  // fallback
  return { amount: (total * FALLBACK_RATE) / 100, rate: FALLBACK_RATE };
}

export default function HotelInvoicesPanel() {
  const { rows: users } = useRealtimeList<any>(COL.users, { createdAtField: "createdAt", take: 5000 });
  const { rows: bookings } = useRealtimeList<any>(COL.bookings, { createdAtField: BK.createdAt, take: 5000 });
  const { rows: invoices } = useRealtimeList<any>(COL.hotelInvoices, { createdAtField: INV.createdAt, take: 5000 });
  const { rows: disputes } = useRealtimeList<any>(COL.commissionDisputes, { createdAtField: DSP.createdAt, take: 5000 });

  const [month, setMonth] = useState(() => monthKey(new Date())); // default current month
  const [q, setQ] = useState("");
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [page, setPage] = useState(1);

  // Modal
  const [hotelModal, setHotelModal] = useState<any | null>(null); // selected hotel row

  // hotels list
  const hotels = useMemo(() => {
    return users
      .filter((u) => String(u?.[USR.role] ?? "") === "hotel")
      .map((u) => ({
        id: u.id,
        name: String(u?.[USR.displayName] ?? "-"),
        email: String(u?.[USR.email] ?? "-"),
        phone: String(u?.[USR.phone] ?? "-"),
        city: String(u?.[USR.city] ?? "-"),
        district: String(u?.[USR.district] ?? ""),
        isActive: u?.[USR.isActive] !== false,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "tr"));
  }, [users]);

  // invoice index
  const invoiceById = useMemo(() => {
    const m: Record<string, AnyObj> = {};
    for (const inv of invoices) {
      const hid = String(inv?.[INV.hotelId] ?? "");
      const mo = String(inv?.[INV.month] ?? "");
      if (!hid || !mo) continue;
      m[`${hid}_${mo}`] = inv;
    }
    return m;
  }, [invoices]);

  // disputes index
  const disputesByInvoice = useMemo(() => {
    const m: Record<string, AnyObj[]> = {};
    for (const d of disputes) {
      const invoiceId = String(d?.[DSP.invoiceId] ?? "");
      if (!invoiceId) continue;
      (m[invoiceId] ||= []).push(d);
    }
    for (const k of Object.keys(m)) {
      m[k].sort((a, b) => (tsToDate(b?.[DSP.createdAt])?.getTime() ?? 0) - (tsToDate(a?.[DSP.createdAt])?.getTime() ?? 0));
    }
    return m;
  }, [disputes]);

  // computed monthly totals for selected month
  const computedMonth = useMemo(() => {
    const map: Record<string, { revenue: number; commission: number; count: number }> = {};
    for (const b of bookings) {
      const hid = String(b?.[BK.hotelId] ?? "");
      if (!hid) continue;

      const at = tsToDate(b?.[BK.createdAt]);
      if (!at) continue;

      const mk = monthKey(at);
      if (mk !== month) continue;

      const total = num(b?.[BK.totalPrice]);
      const com = getCommissionFromBooking(b).amount;

      if (!map[hid]) map[hid] = { revenue: 0, commission: 0, count: 0 };
      map[hid].revenue += total;
      map[hid].commission += com;
      map[hid].count += 1;
    }
    return map;
  }, [bookings, month]);

  // rows
  const rows = useMemo(() => {
    const due = nextMonthDueDate(month);

    const base = hotels
      .filter((h) => h.isActive) // pasif otelleri şimdilik gizle (istersen ayrı filtre ekleriz)
      .map((h) => {
        const calc = computedMonth[h.id] ?? { revenue: 0, commission: 0, count: 0 };
        const invId = `${h.id}_${month}`;
        const inv = invoiceById[invId];

        const paid = Boolean(inv?.[INV.paid]);
        const dueDate = String(inv?.[INV.dueDate] ?? due);
        const overdue = isOverdue(dueDate, paid);

        const dsps = disputesByInvoice[invId] ?? [];
        const openDisputes = dsps.filter((x) => String(x?.[DSP.status] ?? "open") === "open").length;

        return {
          ...h,
          invoiceId: invId,
          month,
          dueDate,
          bookingCount: Number(inv?.[INV.bookingCount] ?? calc.count),
          revenue: Number(inv?.[INV.totalRevenue] ?? calc.revenue),
          commission: Number(inv?.[INV.commissionAmount] ?? calc.commission),
          paid,
          overdue,
          openDisputes,
        };
      });

    return base.filter((r) => {
      const text = `${r.name} ${r.email} ${r.phone} ${r.city} ${r.district} ${r.invoiceId}`.toLowerCase();
      if (q && !text.includes(q.toLowerCase())) return false;
      if (onlyOverdue && !r.overdue) return false;
      return true;
    });
  }, [hotels, computedMonth, invoiceById, disputesByInvoice, q, onlyOverdue, month]);

  // pagination
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return rows.slice(start, start + PAGE_SIZE);
  }, [rows, safePage]);

  async function ensureInvoiceDoc(row: any) {
    const db = getFirestore();
    await setDoc(
      doc(db, COL.hotelInvoices, row.invoiceId),
      {
        [INV.hotelId]: row.id,
        [INV.month]: row.month,
        [INV.totalRevenue]: row.revenue,
        [INV.commissionAmount]: row.commission,
        [INV.bookingCount]: row.bookingCount,
        [INV.dueDate]: row.dueDate,
        [INV.paid]: row.paid ?? false,
        [INV.createdAt]: new Date(),
        [INV.updatedAt]: new Date(),
      },
      { merge: true }
    );
  }

  async function togglePaid(row: any) {
    const db = getFirestore();
    await ensureInvoiceDoc(row);
    await updateDoc(doc(db, COL.hotelInvoices, row.invoiceId), {
      [INV.paid]: !row.paid,
      [INV.paidAt]: !row.paid ? new Date() : null,
      [INV.updatedAt]: new Date(),
    } as any);
    await logActivity({
  type: "invoice_paid",
  actorRole: "admin",
  actorId: "admin",           // istersen auth uid’ye bağlarız
  actorName: "Admin",
  city: String(row.city ?? ""),
  district: String(row.district ?? ""),
  ref: { collection: "hotelInvoices", id: row.invoiceId },
  message: `${row.name} (${row.month}) fatura durumu güncellendi: ${!row.paid ? "ÖDENDİ" : "GERİ ALINDI"}`,
  meta: { paid: !row.paid, month: row.month, commission: row.commission, revenue: row.revenue },
});

  }
  

  return (
    <div className="space-y-4">
      {/* FILTER BAR */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="grid gap-3 md:grid-cols-12">
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="Ara: otel adı / email / telefon / şehir..."
            className="md:col-span-6 rounded-2xl border border-white/10 bg-black/20 px-4 py-2 text-sm outline-none focus:border-white/20"
          />

          <input
            value={month}
            onChange={(e) => { setMonth(e.target.value); setPage(1); }}
            placeholder="YYYY-MM"
            className="md:col-span-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-white/20"
          />

          <label className="md:col-span-4 flex items-center gap-2 text-xs text-slate-200">
            <input
              type="checkbox"
              checked={onlyOverdue}
              onChange={(e) => { setOnlyOverdue(e.target.checked); setPage(1); }}
            />
            Sadece gecikenler (7’si geçenler)
          </label>
        </div>

        <div className="mt-2 text-xs text-slate-400">
          Dönem: <b className="text-slate-100">{month}</b> • Ödeme penceresi: <b className="text-slate-100">takip eden ay 1–7</b> • Sonuç:{" "}
          <b className="text-slate-100">{rows.length}</b>
        </div>
      </div>

      {/* TABLE */}
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
        <div className="overflow-x-auto">
          <table className="min-w-[1450px] w-full text-sm">
            <thead className="bg-white/[0.03] text-slate-300">
              <tr>
                <th className="p-3 text-left">Durum</th>
                <th className="p-3 text-left">Otel</th>
                <th className="p-3 text-left">İletişim</th>
                <th className="p-3 text-left">Konum</th>
                <th className="p-3 text-left">Dönem</th>
                <th className="p-3 text-left">Rez</th>
                <th className="p-3 text-left">Ciro</th>
                <th className="p-3 text-left">Komisyon</th>
                <th className="p-3 text-left">Net</th>
                <th className="p-3 text-left">Son Ödeme</th>
                <th className="p-3 text-left">İtiraz</th>
                <th className="p-3 text-right">İşlem</th>
              </tr>
            </thead>

            <tbody>
              {pageRows.map((r) => (
                <tr
                  key={r.invoiceId}
                  className={[
                    "border-t border-white/10 hover:bg-white/[0.03]",
                    r.overdue ? "bg-rose-500/5" : "",
                  ].join(" ")}
                >
                  <td className="p-3">
                    <span className={r.paid ? badge("ok") : r.overdue ? badge("bad") : badge("warn")}>
                      {r.paid ? "Ödendi" : r.overdue ? "Gecikti" : "Bekliyor"}
                    </span>
                  </td>

                  <td className="p-3">
                    <button
                      onClick={() => setHotelModal(r)}
                      className="text-left"
                    >
                      <div className="font-semibold hover:underline">{r.name}</div>
                      <div className="text-xs text-slate-400">{r.invoiceId}</div>
                    </button>
                  </td>

                  <td className="p-3">
                    <div className="text-slate-200">{r.phone}</div>
                    <div className="text-xs text-slate-400">{r.email}</div>
                  </td>

                  <td className="p-3">
                    {r.city}{r.district ? ` / ${r.district}` : ""}
                  </td>

                  <td className="p-3">{r.month}</td>
                  <td className="p-3">{r.bookingCount}</td>
                  <td className="p-3">{moneyTry(r.revenue)}</td>
                  <td className="p-3 font-semibold">{moneyTry(r.commission)}</td>
                  <td className="p-3">{moneyTry(Math.max(0, r.revenue - r.commission))}</td>
                  <td className="p-3">{r.dueDate}</td>

                  <td className="p-3">
                    {r.openDisputes > 0 ? (
                      <span className={badge("bad")}>{r.openDisputes} açık</span>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </td>

                  <td className="p-3">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => togglePaid(r)}
                        className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs hover:bg-white/[0.06]"
                      >
                        {r.paid ? "Ödemeyi Geri Al" : "Ödendi İşaretle"}
                      </button>
                      <button
                        onClick={() => setHotelModal(r)}
                        className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs hover:bg-white/[0.06]"
                      >
                        Detay
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={12} className="p-8 text-center text-slate-400">Kayıt yok.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* PAGINATION */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 bg-white/[0.02] p-3">
          <div className="text-xs text-slate-400">
            Sayfa <b className="text-slate-100">{safePage}</b> / {totalPages} • Toplam:{" "}
            <b className="text-slate-100">{rows.length}</b>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setPage(1)}
              disabled={safePage === 1}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs disabled:opacity-40 hover:bg-white/[0.06]"
            >
              İlk
            </button>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs disabled:opacity-40 hover:bg-white/[0.06]"
            >
              Geri
            </button>
            {Array.from({ length: Math.min(totalPages, 12) }).map((_, i) => {
              const n = i + 1;
              return (
                <button
                  key={n}
                  onClick={() => setPage(n)}
                  className={[
                    "rounded-xl border px-3 py-2 text-xs",
                    n === safePage ? "border-white/20 bg-white/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]",
                  ].join(" ")}
                >
                  {n}
                </button>
              );
            })}
            {totalPages > 12 ? <span className="px-2 text-xs text-slate-400">…</span> : null}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs disabled:opacity-40 hover:bg-white/[0.06]"
            >
              İleri
            </button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={safePage === totalPages}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs disabled:opacity-40 hover:bg-white/[0.06]"
            >
              Son
            </button>
          </div>
        </div>
      </div>

      {/* HOTEL DETAIL MODAL */}
      {hotelModal && (
        <HotelLedgerModal
          hotelRow={hotelModal}
          allBookings={bookings}
          invoiceById={invoiceById}
          disputesByInvoice={disputesByInvoice}
          onClose={() => setHotelModal(null)}
          ensureInvoiceDoc={ensureInvoiceDoc}
          togglePaid={togglePaid}
        />
      )}
    </div>
  );
}

/** ===========================
 *  HOTEL LEDGER MODAL (AŞIRI PREMIUM)
 *  =========================== */
function HotelLedgerModal({
  hotelRow,
  allBookings,
  invoiceById,
  disputesByInvoice,
  onClose,
  ensureInvoiceDoc,
  togglePaid,
}: {
  hotelRow: any;
  allBookings: AnyObj[];
  invoiceById: Record<string, AnyObj>;
  disputesByInvoice: Record<string, AnyObj[]>;
  onClose: () => void;
  ensureInvoiceDoc: (row: any) => Promise<void>;
  togglePaid: (row: any) => Promise<void>;
}) {
  const hotelId = hotelRow.id;

  // Otelin tüm bookingleri
  const hotelBookings = useMemo(() => {
    return allBookings
      .filter((b) => String(b?.[BK.hotelId] ?? "") === hotelId)
      .sort((a, b) => (tsToDate(b?.[BK.createdAt])?.getTime() ?? 0) - (tsToDate(a?.[BK.createdAt])?.getTime() ?? 0));
  }, [allBookings, hotelId]);

  // Otelin tüm ayları
  const months = useMemo(() => {
    const set = new Set<string>();
    for (const b of hotelBookings) {
      const at = tsToDate(b?.[BK.createdAt]);
      if (!at) continue;
      set.add(monthKey(at));
    }
    return Array.from(set).sort((a, b) => (a < b ? 1 : -1)); // desc
  }, [hotelBookings]);

  const [activeMonth, setActiveMonth] = useState<string>(hotelRow.month);

  // O ayın booking listesi + totals
  const monthBookings = useMemo(() => {
    return hotelBookings.filter((b) => {
      const at = tsToDate(b?.[BK.createdAt]);
      if (!at) return false;
      return monthKey(at) === activeMonth;
    });
  }, [hotelBookings, activeMonth]);

  const monthTotals = useMemo(() => {
    let revenue = 0;
    let com = 0;
    let count = 0;

    for (const b of monthBookings) {
      const total = num(b?.[BK.totalPrice]);
      const c = getCommissionFromBooking(b).amount;
      revenue += total;
      com += c;
      count += 1;
    }

    return { revenue, com, count, net: Math.max(0, revenue - com) };
  }, [monthBookings]);

  const invoiceId = `${hotelId}_${activeMonth}`;
  const inv = invoiceById[invoiceId];

  const dueDate = String(inv?.[INV.dueDate] ?? nextMonthDueDate(activeMonth));
  const paid = Boolean(inv?.[INV.paid]);
  const overdue = isOverdue(dueDate, paid);

  const dsps = disputesByInvoice[invoiceId] ?? [];
  const openDsps = dsps.filter((d) => String(d?.[DSP.status] ?? "open") === "open").length;

  function printPdf() {
    // Tarayıcı yazdırma → PDF kaydet
    const hotelName = hotelRow.name;
    const html = `
      <html>
      <head>
        <meta charset="utf-8" />
        <title>${hotelName} - ${activeMonth} Fatura</title>
        <style>
          body{ font-family: Arial; padding:24px; }
          h1{ margin:0 0 8px; }
          .muted{ color:#666; font-size:12px; }
          table{ width:100%; border-collapse:collapse; margin-top:14px; }
          th,td{ border:1px solid #ddd; padding:8px; font-size:12px; text-align:left; }
          th{ background:#f6f6f6; }
          .right{ text-align:right; }
          .box{ margin-top:12px; padding:12px; border:1px solid #ddd; }
        </style>
      </head>
      <body>
        <h1>${hotelName} • ${activeMonth} Fatura / Rezervasyon Dökümü</h1>
        <div class="muted">Oluşturma: ${new Date().toLocaleString("tr-TR")} • Son ödeme: ${dueDate} • Durum: ${paid ? "Ödendi" : overdue ? "Gecikti" : "Bekliyor"}</div>

        <div class="box">
          <b>Özet</b><br/>
          Rezervasyon: ${monthTotals.count}<br/>
          Ciro: ${monthTotals.revenue.toLocaleString("tr-TR")} TL<br/>
          Komisyon: ${monthTotals.com.toLocaleString("tr-TR")} TL<br/>
          Net: ${monthTotals.net.toLocaleString("tr-TR")} TL
        </div>

        <table>
          <thead>
            <tr>
              <th>Tarih</th>
              <th>Misafir</th>
              <th>Check-in</th>
              <th>Check-out</th>
              <th>Ödeme</th>
              <th class="right">Tutar</th>
              <th class="right">Komisyon</th>
            </tr>
          </thead>
          <tbody>
            ${monthBookings
              .map((b) => {
                const at = tsToDate(b?.[BK.createdAt]);
                const guest = String(b?.[BK.guestName] ?? "-");
                const ci = String(b?.[BK.checkIn] ?? "-");
                const co = String(b?.[BK.checkOut] ?? "-");
                const pay = `${String(b?.[BK.paymentMethod] ?? "-")} / ${String(b?.[BK.paymentStatus] ?? "-")}`;
                const total = num(b?.[BK.totalPrice]);
                const com = getCommissionFromBooking(b).amount;
                return `<tr>
                  <td>${at ? at.toLocaleString("tr-TR") : "-"}</td>
                  <td>${guest}</td>
                  <td>${ci}</td>
                  <td>${co}</td>
                  <td>${pay}</td>
                  <td class="right">${total.toLocaleString("tr-TR")} TL</td>
                  <td class="right">${com.toLocaleString("tr-TR")} TL</td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </body>
      </html>
    `;
    const w = window.open("", "_blank");
    if (!w) return alert("Popup engellendi. Tarayıcıda popup'a izin ver.");
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/70 p-4 md:p-10">
      <div className="mx-auto max-w-6xl overflow-hidden rounded-2xl border border-white/10 bg-[#070A12]">
        <div className="flex flex-col gap-3 border-b border-white/10 p-4 md:flex-row md:items-center md:justify-between md:p-6">
          <div>
            <div className="text-xs text-slate-400">Otel Muhasebe Dosyası</div>
            <div className="mt-1 text-xl font-semibold">{hotelRow.name}</div>
            <div className="mt-1 text-xs text-slate-400">
              Dönem: <span className="text-slate-200">{activeMonth}</span> • Son ödeme:{" "}
              <span className="text-slate-200">{dueDate}</span> •{" "}
              {paid ? <span className="text-emerald-200">Ödendi</span> : overdue ? <span className="text-rose-200">Gecikti</span> : <span className="text-amber-200">Bekliyor</span>}
              {openDsps ? <span className="ml-2 text-rose-200">• {openDsps} açık itiraz</span> : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={async () => {
                // invoice doc yoksa yaz
                await ensureInvoiceDoc({ ...hotelRow, month: activeMonth, invoiceId });
                await togglePaid({ ...hotelRow, month: activeMonth, invoiceId, paid });
              }}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm hover:bg-white/[0.06]"
            >
              {paid ? "Ödemeyi Geri Al" : "Ödendi İşaretle"}
            </button>

            <button
              onClick={printPdf}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm hover:bg-white/[0.06]"
            >
              Yazdır / PDF
            </button>

            <button
              onClick={onClose}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm hover:bg-white/[0.06]"
            >
              Kapat
            </button>
          </div>
        </div>

        <div className="p-4 md:p-6 space-y-4">
          {/* Month selector + summary */}
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="text-xs text-slate-400">Ay Seç</div>
              <select
                value={activeMonth}
                onChange={(e) => setActiveMonth(e.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none"
              >
                {months.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <div className="mt-2 text-xs text-slate-400">
                Otelin tüm aylarını buradan gezebilirsin.
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="text-xs text-slate-400">Aylık Özet</div>
              <div className="mt-2 text-sm text-slate-200">Rez: <b>{monthTotals.count}</b></div>
              <div className="text-sm text-slate-200">Ciro: <b>{moneyTry(monthTotals.revenue)}</b></div>
              <div className="text-sm text-slate-200">Komisyon: <b>{moneyTry(monthTotals.com)}</b></div>
              <div className="mt-1 text-sm text-slate-200">Net: <b>{moneyTry(monthTotals.net)}</b></div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="text-xs text-slate-400">İletişim</div>
              <div className="mt-2 text-sm text-slate-200">{hotelRow.phone || "-"}</div>
              <div className="text-xs text-slate-400">{hotelRow.email || "-"}</div>
              <div className="mt-2 text-xs text-slate-400">
                Konum: {hotelRow.city || "-"}{hotelRow.district ? ` / ${hotelRow.district}` : ""}
              </div>
            </div>
          </div>

          {/* Monthly invoice list */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-sm font-semibold">Ay Ay Faturalar</div>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {months.map((m) => {
                const id = `${hotelId}_${m}`;
                const inv = invoiceById[id];
                const paid = Boolean(inv?.[INV.paid]);
                const due = String(inv?.[INV.dueDate] ?? nextMonthDueDate(m));
                const overdue = isOverdue(due, paid);

                // compute from bookings for quick view
                let rev = 0, com = 0, cnt = 0;
                for (const b of hotelBookings) {
                  const at = tsToDate(b?.[BK.createdAt]);
                  if (!at) continue;
                  if (monthKey(at) !== m) continue;
                  const total = num(b?.[BK.totalPrice]);
                  rev += total;
                  com += getCommissionFromBooking(b).amount;
                  cnt += 1;
                }

                return (
                  <button
                    key={m}
                    onClick={() => setActiveMonth(m)}
                    className={[
                      "rounded-2xl border p-3 text-left transition",
                      m === activeMonth ? "border-white/20 bg-white/10" : "border-white/10 bg-white/[0.02] hover:bg-white/[0.06]",
                      overdue ? "ring-1 ring-rose-400/30" : "",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">{m}</div>
                        <div className="mt-1 text-xs text-slate-300">
                          Rez: {cnt} • Ciro: {moneyTry(rev)} • Kom: {moneyTry(com)}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">Son ödeme: {due}</div>
                      </div>
                      <div>
                        <span className={paid ? badge("ok") : overdue ? badge("bad") : badge("warn")}>
                          {paid ? "Ödendi" : overdue ? "Gecikti" : "Bekliyor"}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bookings list */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="text-sm font-semibold">
                {activeMonth} Rezervasyonları
                <span className="ml-2 text-xs text-slate-400">({monthBookings.length} kayıt)</span>
              </div>
              <div className="text-xs text-slate-400">
                PDF için: “Yazdır / PDF” → tarayıcıdan PDF kaydet
              </div>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="min-w-[1200px] w-full text-sm">
                <thead className="text-slate-300">
                  <tr className="border-b border-white/10">
                    <th className="p-2 text-left">Tarih</th>
                    <th className="p-2 text-left">Misafir</th>
                    <th className="p-2 text-left">Konaklama</th>
                    <th className="p-2 text-left">Ödeme</th>
                    <th className="p-2 text-right">Tutar</th>
                    <th className="p-2 text-right">Komisyon</th>
                    <th className="p-2 text-right">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {monthBookings.map((b) => {
                    const at = tsToDate(b?.[BK.createdAt]);
                    const guest = String(b?.[BK.guestName] ?? "-");
                    const email = String(b?.[BK.guestEmail] ?? "-");
                    const phone = String(b?.[BK.guestPhone] ?? "-");
                    const ci = String(b?.[BK.checkIn] ?? "-");
                    const co = String(b?.[BK.checkOut] ?? "-");
                    const pay = `${String(b?.[BK.paymentMethod] ?? "-")} / ${String(b?.[BK.paymentStatus] ?? "-")}`;
                    const cur = String(b?.[BK.currency] ?? "TRY");
                    const total = num(b?.[BK.totalPrice]);
                    const com = getCommissionFromBooking(b).amount;
                    const net = Math.max(0, total - com);

                    return (
                      <tr key={String(b.id)} className="border-b border-white/10 hover:bg-white/[0.02]">
                        <td className="p-2 text-slate-200">{at ? at.toLocaleString("tr-TR") : "-"}</td>
                        <td className="p-2">
                          <div className="font-semibold">{guest}</div>
                          <div className="text-xs text-slate-400">{email} • {phone}</div>
                        </td>
                        <td className="p-2 text-slate-200">
                          {ci} → {co}
                        </td>
                        <td className="p-2 text-slate-200">{pay}</td>
                        <td className="p-2 text-right font-semibold">{money(total, cur)}</td>
                        <td className="p-2 text-right">{money(com, cur)}</td>
                        <td className="p-2 text-right">{money(net, cur)}</td>
                      </tr>
                    );
                  })}

                  {monthBookings.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-slate-400">Bu ay rezervasyon yok.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-3 text-xs text-slate-400">
              Komisyon hesabı: booking içinde <b>commissionAmount</b> veya <b>commissionRate</b> varsa onu kullanır.
              Yoksa fallback %{FALLBACK_RATE} ile hesaplar. (Eski kayıtları sonradan otomatik doldurabiliriz.)
            </div>
          </div>

          {/* Disputes */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-sm font-semibold">Komisyon İtirazları</div>
            <div className="mt-2 text-xs text-slate-400">
              Bu otelin seçili ayına ait itirazlar. (Otel panelinden dispute açınca burada görünür.)
            </div>

            <div className="mt-3 space-y-2">
              {dsps.length === 0 ? (
                <div className="text-sm text-slate-400">İtiraz yok.</div>
              ) : (
                dsps.map((d) => (
                  <div key={String(d.id)} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">{String(d?.[DSP.title] ?? "İtiraz")}</div>
                        <div className="mt-1 text-xs text-slate-400">
                          {tsToDate(d?.[DSP.createdAt])?.toLocaleString("tr-TR") ?? "-"} • Durum:{" "}
                          <b>{String(d?.[DSP.status] ?? "open")}</b>
                        </div>
                        <div className="mt-2 text-sm text-slate-200 whitespace-pre-wrap">
                          {String(d?.[DSP.message] ?? "-")}
                        </div>
                      </div>

                      <span className={String(d?.[DSP.status] ?? "open") === "open" ? badge("bad") : badge("ok")}>
                        {String(d?.[DSP.status] ?? "open")}
                      </span>
                    </div>

                    <div className="mt-3 text-xs text-slate-400">
                      Admin yanıt alanı (bir sonraki adım): adminReply + resolved butonlarını buraya ekliyoruz.
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
