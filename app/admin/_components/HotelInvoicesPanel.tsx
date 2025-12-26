"use client";

import { useMemo, useState } from "react";
import { COLLECTIONS, tsToDate } from "./firestoreAdmin";
import { useRealtimeList } from "./useAdminRealtime";
import { doc, getFirestore, setDoc, updateDoc } from "firebase/firestore";

type AnyObj = Record<string, any>;

const PAGE_SIZE = 20;

// bookings alanları (senin booking örneğine göre)
const BK = {
  createdAt: "createdAt",
  hotelId: "hotelId",
  hotelName: "hotelName",
  currency: "currency",
  totalPrice: "totalPrice",
  status: "status",

  // komisyon alanları varsa kullanırız (yoksa fallback rate)
  commissionRate: "commissionRate",
  commissionAmount: "commissionAmount",
} as const;

// users alanları
const USR = {
  role: "role",
  displayName: "displayName",
  email: "email",
  phone: "phone",
  city: "city",
  district: "district",
  isActive: "isActive",
} as const;

// invoice doc alanları
const INV = {
  hotelId: "hotelId",
  month: "month",
  totalRevenue: "totalRevenue",
  commissionAmount: "commissionAmount",
  bookingCount: "bookingCount",
  dueDate: "dueDate",
  paid: "paid",
  paidAt: "paidAt",
  paidBy: "paidBy",
  note: "note",
} as const;

// dispute doc alanları
const DSP = {
  hotelId: "hotelId",
  month: "month",
  invoiceId: "invoiceId",
  status: "status",
  title: "title",
  message: "message",
  adminReply: "adminReply",
  createdAt: "createdAt",
} as const;

// fallback: booking içinde komisyon yoksa yüzde kaç varsayılan?
// ✅ Burayı "otel profilinden" çekmek istersen sonraki adımda bağlarız.
const FALLBACK_COMMISSION_RATE = 10; // %

function num(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function moneyTry(v: number) {
  const n = Math.round((num(v) || 0) * 100) / 100;
  return `₺${n.toLocaleString("tr-TR")}`;
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
  // month: YYYY-MM -> due: next month 7th
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m, 7); // month is 1-based; Date month is 0-based, so (m) = next month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-07`;
}
function isOverdue(dueDateStr: string, paid: boolean) {
  if (paid) return false;
  const due = new Date(dueDateStr);
  if (isNaN(due.getTime())) return false;
  return new Date().getTime() > due.getTime();
}

// booking komisyonunu DB’den çek
function getCommissionFromBooking(b: AnyObj) {
  const amountRaw = b?.[BK.commissionAmount];
  const amount = Number(amountRaw);
  if (Number.isFinite(amount) && amount >= 0) return amount;

  const rateRaw = b?.[BK.commissionRate];
  const rate = Number(rateRaw);
  const total = Number(b?.[BK.totalPrice] ?? 0);

  if (Number.isFinite(rate) && rate >= 0 && Number.isFinite(total) && total >= 0) {
    return (total * rate) / 100;
  }

  // fallback
  return (total * FALLBACK_COMMISSION_RATE) / 100;
}

export default function HotelInvoicesPanel() {
  const { rows: users } = useRealtimeList<any>(COLLECTIONS.users, { createdAtField: "createdAt", take: 5000 });
  const { rows: bookings } = useRealtimeList<any>(COLLECTIONS.bookings, { createdAtField: BK.createdAt, take: 5000 });

  // bu iki koleksiyonu firestoreAdmin.ts içine ekle:
  // hotelInvoices: "hotelInvoices"
  // commissionDisputes: "commissionDisputes"
  const { rows: invoices } = useRealtimeList<any>("hotelInvoices", { createdAtField: "createdAt", take: 5000 });
  const { rows: disputes } = useRealtimeList<any>("commissionDisputes", { createdAtField: DSP.createdAt, take: 5000 });

  const [month, setMonth] = useState(() => monthKey(new Date())); // default: bu ay
  const [q, setQ] = useState("");
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [page, setPage] = useState(1);

  // Oteller listesi
  const hotels = useMemo(() => {
    return users
      .filter((u) => String(u?.[USR.role] ?? "") === "hotel" && u?.[USR.isActive] !== false)
      .map((u) => ({
        id: u.id,
        name: String(u?.[USR.displayName] ?? "-"),
        email: String(u?.[USR.email] ?? "-"),
        phone: String(u?.[USR.phone] ?? "-"),
        city: String(u?.[USR.city] ?? "-"),
        district: String(u?.[USR.district] ?? ""),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "tr"));
  }, [users]);

  // O ayın bookinglerini otel bazlı grupla
  const computed = useMemo(() => {
    const map: Record<string, { revenue: number; commission: number; count: number }> = {};

    for (const b of bookings) {
      const hid = String(b?.[BK.hotelId] ?? "");
      if (!hid) continue;

      const at = tsToDate(b?.[BK.createdAt]);
      if (!at) continue;

      const mk = monthKey(at);
      if (mk !== month) continue;

      const total = num(b?.[BK.totalPrice]);
      const com = getCommissionFromBooking(b);

      if (!map[hid]) map[hid] = { revenue: 0, commission: 0, count: 0 };
      map[hid].revenue += total;
      map[hid].commission += com;
      map[hid].count += 1;
    }

    return map;
  }, [bookings, month]);

  // invoice index: hotelId+month -> invoice
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

  // disputes index: invoiceId -> list
  const disputesByInvoice = useMemo(() => {
    const m: Record<string, AnyObj[]> = {};
    for (const d of disputes) {
      const invoiceId = String(d?.[DSP.invoiceId] ?? "");
      if (!invoiceId) continue;
      (m[invoiceId] ||= []).push(d);
    }
    return m;
  }, [disputes]);

  const rows = useMemo(() => {
    const due = nextMonthDueDate(month);

    const base = hotels.map((h) => {
      const calc = computed[h.id] ?? { revenue: 0, commission: 0, count: 0 };
      const invId = `${h.id}_${month}`;
      const inv = invoiceById[invId];

      const paid = Boolean(inv?.[INV.paid]);
      const overdue = isOverdue(String(inv?.[INV.dueDate] ?? due), paid);

      const dsps = disputesByInvoice[invId] ?? [];
      const openDisputes = dsps.filter((x) => String(x?.[DSP.status] ?? "open") === "open").length;

      return {
        ...h,
        invoiceId: invId,
        month,
        dueDate: String(inv?.[INV.dueDate] ?? due),
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
  }, [hotels, computed, invoiceById, disputesByInvoice, q, onlyOverdue, month]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return rows.slice(start, start + PAGE_SIZE);
  }, [rows, safePage]);

  async function ensureInvoiceDoc(row: any) {
    const db = getFirestore();
    const ref = doc(db, "hotelInvoices", row.invoiceId);

    // doc yoksa create (merge true ile güvenli)
    await setDoc(
      ref,
      {
        [INV.hotelId]: row.id,
        [INV.month]: row.month,
        [INV.totalRevenue]: row.revenue,
        [INV.commissionAmount]: row.commission,
        [INV.bookingCount]: row.bookingCount,
        [INV.dueDate]: row.dueDate,
        [INV.paid]: row.paid ?? false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      { merge: true }
    );
  }

  async function togglePaid(row: any) {
    const db = getFirestore();
    await ensureInvoiceDoc(row);
    await updateDoc(doc(db, "hotelInvoices", row.invoiceId), {
      [INV.paid]: !row.paid,
      [INV.paidAt]: !row.paid ? new Date() : null,
      updatedAt: new Date(),
    } as any);
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
          <table className="min-w-[1400px] w-full text-sm">
            <thead className="bg-white/[0.03] text-slate-300">
              <tr>
                <th className="p-3 text-left">Ödendi</th>
                <th className="p-3 text-left">Otel</th>
                <th className="p-3 text-left">İletişim</th>
                <th className="p-3 text-left">Konum</th>
                <th className="p-3 text-left">Dönem</th>
                <th className="p-3 text-left">Rez</th>
                <th className="p-3 text-left">Ciro</th>
                <th className="p-3 text-left">Komisyon</th>
                <th className="p-3 text-left">Son Ödeme</th>
                <th className="p-3 text-left">İtiraz</th>
                <th className="p-3 text-right">İşlem</th>
              </tr>
            </thead>

            <tbody>
              {pageRows.map((r) => (
                <tr key={r.invoiceId} className={["border-t border-white/10 hover:bg-white/[0.03]", r.overdue ? "bg-rose-500/5" : ""].join(" ")}>
                  <td className="p-3">
                    <span className={r.paid ? badge("ok") : r.overdue ? badge("bad") : badge("warn")}>
                      {r.paid ? "Ödendi" : r.overdue ? "Gecikti" : "Bekliyor"}
                    </span>
                  </td>

                  <td className="p-3">
                    <div className="font-semibold">{r.name}</div>
                    <div className="text-xs text-slate-400">{r.invoiceId}</div>
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
                  <td className="p-3">{r.dueDate}</td>

                  <td className="p-3">
                    {r.openDisputes > 0 ? <span className={badge("bad")}>{r.openDisputes} açık</span> : <span className="text-slate-400">-</span>}
                  </td>

                  <td className="p-3">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => togglePaid(r)}
                        className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs hover:bg-white/[0.06]"
                      >
                        {r.paid ? "İptal Et" : "Ödendi İşaretle"}
                      </button>
                      <button
                        onClick={async () => {
                          // burada ileride "detay modal" ekleyebiliriz: booking listesi + itiraz listesi
                          alert("Bir sonraki adım: fatura detay modalı (rezervasyonlar + itirazlar).");
                        }}
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
                  <td colSpan={11} className="p-8 text-center text-slate-400">Kayıt yok.</td>
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
    </div>
  );
}
