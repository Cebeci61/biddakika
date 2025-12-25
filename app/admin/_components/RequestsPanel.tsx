"use client";

import { useEffect, useMemo, useState } from "react";
import { COLLECTIONS, tsToDate } from "./firestoreAdmin";
import { useRealtimeList } from "./useAdminRealtime";
import { doc, getDoc, getFirestore, updateDoc } from "firebase/firestore";

/** Requests alanları (sende hem date/time hem checkIn/checkOut var olabilir) */
const REQ = {
  createdAt: "createdAt",
  city: "city",
  district: "district",

  date: "date",
  time: "time",

  checkIn: "checkIn",
  checkOut: "checkOut",

  adults: "adults",
  childrenCount: "childrenCount",
  roomsCount: "roomsCount",
  roomType: "roomType",
  notes: "notes",

  guestId: "guestId",
  createdById: "createdById",

  guestName: "guestName",
  guestPhone: "guestPhone",
  guestEmail: "guestEmail",

  status: "status", // active/passive
  adminOnly: "adminOnly",
} as const;

/** Offers alanları */
const OFF = {
  createdAt: "createdAt",
  requestId: "requestId",
  isHidden: "isHidden",
  currency: "currency",

  providerType: "providerType",
  providerName: "providerName",

  hotelId: "hotelId",
  hotelName: "hotelName",
  agencyId: "agencyId",
  agencyName: "agencyName",

  priceHistory: "priceHistory",
  timeline: "timeline",
  totalPrice: "totalPrice",
  price: "price",
} as const;

/** Bookings alanları (senin gönderdiğin örneğe göre) */
const BK = {
  createdAt: "createdAt",
  requestId: "requestId",
  offerId: "offerId",
  currency: "currency",
  totalPrice: "totalPrice",

  guestName: "guestName",
  guestEmail: "guestEmail",
  guestPhone: "guestPhone",

  hotelName: "hotelName",
  hotelId: "hotelId",

  paymentMethod: "paymentMethod",
  paymentStatus: "paymentStatus",

  status: "status",
} as const;

/** Users alanları (misafir bilgisi için) */
const USR = {
  displayName: "displayName",
  email: "email",
  phone: "phone",
  city: "city",
  district: "district",
} as const;

const PAGE_SIZE = 20;

type AnyObj = Record<string, any>;
const g = (o: AnyObj, k: string) => o?.[k];

function money(v: number, currency?: string) {
  const cur = (currency || "TRY").toUpperCase();
  const sym = cur === "USD" ? "$" : cur === "EUR" ? "€" : "₺";
  const n = Math.round((Number(v || 0) || 0) * 100) / 100;
  return `${sym}${n.toLocaleString("tr-TR")}`;
}

function badge(kind: "ok" | "bad" | "warn") {
  if (kind === "ok") return "rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-xs text-emerald-200";
  if (kind === "bad") return "rounded-lg border border-rose-400/30 bg-rose-400/10 px-2 py-1 text-xs text-rose-200";
  return "rounded-lg border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-xs text-amber-200";
}

function parseStartDate(req: AnyObj): Date | null {
  const checkIn = g(req, REQ.checkIn);
  if (checkIn) {
    const d = new Date(String(checkIn));
    return isNaN(d.getTime()) ? null : d;
  }
  const date = g(req, REQ.date);
  if (date) {
    const d = new Date(String(date));
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function diffDays(target: Date) {
  const now = new Date();
  const ms = target.getTime() - now.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function readHistory(offer: AnyObj) {
  const ph = g(offer, OFF.priceHistory);
  const tl = g(offer, OFF.timeline);
  const arr: any[] = Array.isArray(ph) ? ph : Array.isArray(tl) ? tl : [];

  const normalized = arr
    .map((x) => ({
      kind: x?.kind ?? x?.type ?? "step",
      actor: x?.actor ?? x?.by ?? "provider",
      price: Number(x?.price ?? x?.amount ?? 0) || 0,
      at: tsToDate(x?.at ?? x?.createdAt ?? x?.time ?? null),
    }))
    .sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));

  const initial =
    normalized.find((x) => String(x.kind).toLowerCase() === "initial")?.price ??
    normalized[0]?.price ??
    0;
  const last = normalized[normalized.length - 1]?.price ?? initial;

  const disc = initial > 0 ? Math.max(0, Math.round(((initial - last) / initial) * 100)) : 0;
  return { steps: normalized, initial, last, disc };
}

export default function RequestsPanel() {
  // ✅ realtime sources
  const { rows: requests, loading: rl, error: re } = useRealtimeList<any>(COLLECTIONS.requests, {
    createdAtField: REQ.createdAt,
    take: 5000,
  });

  const { rows: offers } = useRealtimeList<any>(COLLECTIONS.offers, {
    createdAtField: OFF.createdAt,
    take: 5000,
  });

  const { rows: bookings } = useRealtimeList<any>(COLLECTIONS.bookings, {
    createdAtField: BK.createdAt,
    take: 5000,
  });

  // filters
  const [q, setQ] = useState("");
  const [city, setCity] = useState("");
  const [district, setDistrict] = useState("");
  const [onlyActive, setOnlyActive] = useState(false);
  const [onlyAdminOnly, setOnlyAdminOnly] = useState(false);
  const [page, setPage] = useState(1);

  // caches for guest user
  const [userCache, setUserCache] = useState<Record<string, AnyObj | null>>({});

  // detail modal
  const [selected, setSelected] = useState<any | null>(null);
  const [selectedGuest, setSelectedGuest] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const cities = useMemo(() => {
    const set = new Set<string>();
    for (const r of requests) {
      const c = String(g(r, REQ.city) ?? "").trim();
      if (c) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "tr"));
  }, [requests]);

  const districts = useMemo(() => {
    const set = new Set<string>();
    for (const r of requests) {
      const c = String(g(r, REQ.city) ?? "").trim();
      const d = String(g(r, REQ.district) ?? "").trim();
      if (city && c !== city) continue;
      if (d) set.add(d);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "tr"));
  }, [requests, city]);

  const filtered = useMemo(() => {
    return requests.filter((r) => {
      const txt = `${r.id} ${String(g(r, REQ.city) ?? "")} ${String(g(r, REQ.district) ?? "")} ${String(
        g(r, REQ.guestName) ?? ""
      )} ${String(g(r, REQ.guestPhone) ?? "")} ${String(g(r, REQ.notes) ?? "")}`.toLowerCase();

      if (q && !txt.includes(q.toLowerCase())) return false;

      const c = String(g(r, REQ.city) ?? "");
      const d = String(g(r, REQ.district) ?? "");

      if (city && c !== city) return false;
      if (district && d !== district) return false;

      const st = String(g(r, REQ.status) ?? "active");
      if (onlyActive && st !== "active") return false;

      const ao = Boolean(g(r, REQ.adminOnly));
      if (onlyAdminOnly && !ao) return false;

      return true;
    });
  }, [requests, q, city, district, onlyActive, onlyAdminOnly]);

  useEffect(() => setPage(1), [q, city, district, onlyActive, onlyAdminOnly]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  const pageRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

  // booking map: requestId -> booking (talep rezervasyona dönüştü mü?)
  const bookingByRequestId = useMemo(() => {
    const m: Record<string, AnyObj> = {};
    for (const b of bookings) {
      const rid = String(g(b, BK.requestId) ?? "");
      if (rid) m[rid] = b;
    }
    return m;
  }, [bookings]);

  // offers map: requestId -> offer[]
  const offersByRequestId = useMemo(() => {
    const m: Record<string, AnyObj[]> = {};
    for (const o of offers) {
      const rid = String(g(o, OFF.requestId) ?? "");
      if (!rid) continue;
      (m[rid] ||= []).push(o);
    }
    // sort newest first
    for (const rid of Object.keys(m)) {
      m[rid].sort((a, b) => (tsToDate(g(b, OFF.createdAt))?.getTime() ?? 0) - (tsToDate(g(a, OFF.createdAt))?.getTime() ?? 0));
    }
    return m;
  }, [offers]);

  async function toggleField(id: string, patch: AnyObj) {
    const db = getFirestore();
    await updateDoc(doc(db, COLLECTIONS.requests, id), { ...patch, updatedAt: new Date() } as any);
  }

  async function openDetail(req: AnyObj) {
    setSelected(req);
    setSelectedGuest(null);
    setDetailLoading(true);
    try {
      const db = getFirestore();
      const guestId = String(g(req, REQ.guestId) ?? g(req, REQ.createdById) ?? "");
      if (guestId) {
        if (userCache[guestId] !== undefined) {
          setSelectedGuest(userCache[guestId]);
        } else {
          const snap = await getDoc(doc(db, COLLECTIONS.users, guestId));
          const data = snap.exists() ? { id: snap.id, ...snap.data() } : null;
          setUserCache((p) => ({ ...p, [guestId]: data }));
          setSelectedGuest(data);
        }
      }
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* PRO FILTER BAR */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="grid gap-3 md:grid-cols-12">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ara: misafir / tel / not / il-ilçe…"
            className="md:col-span-5 rounded-2xl border border-white/10 bg-black/20 px-4 py-2 text-sm outline-none focus:border-white/20"
          />

          <select
            value={city}
            onChange={(e) => {
              setCity(e.target.value);
              setDistrict("");
            }}
            className="md:col-span-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-white/20"
          >
            <option value="">Tüm iller</option>
            {cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          <select
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            className="md:col-span-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-white/20"
          >
            <option value="">Tüm ilçeler</option>
            {districts.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>

          <label className="md:col-span-3 flex items-center gap-2 text-xs text-slate-200">
            <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
            Sadece Aktif
          </label>

          <label className="md:col-span-3 flex items-center gap-2 text-xs text-slate-200">
            <input type="checkbox" checked={onlyAdminOnly} onChange={(e) => setOnlyAdminOnly(e.target.checked)} />
            Sadece Admin
          </label>
        </div>

        <div className="mt-2 text-xs text-slate-400">
          {re ? <span className="text-rose-300">Hata: {String(re)}</span> : null}
          <span className="ml-0"> Sonuç: </span>
          <b className="text-slate-100">{filtered.length}</b>
          {rl ? <span className="ml-2">(yükleniyor…)</span> : null}
        </div>
      </div>

      {/* TABLE */}
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
        <div className="overflow-x-auto">
          <table className="min-w-[1400px] w-full text-sm">
            <thead className="bg-white/[0.03] text-slate-300">
              <tr>
                <th className="p-3 text-left">ID</th>
                <th className="p-3 text-left">İl/İlçe</th>
                <th className="p-3 text-left">Talep Tarihi</th>
                <th className="p-3 text-left">Kalan</th>
                <th className="p-3 text-left">Misafir</th>
                <th className="p-3 text-left">Not</th>
                <th className="p-3 text-left">Rezervasyon</th>
                <th className="p-3 text-left">Durum</th>
                <th className="p-3 text-right">İşlem</th>
              </tr>
            </thead>

            <tbody>
              {pageRows.map((r) => {
                const createdAt = tsToDate(g(r, REQ.createdAt));
                const c = String(g(r, REQ.city) ?? "-");
                const d = String(g(r, REQ.district) ?? "-");

                const guestName = String(g(r, REQ.guestName) ?? "-");
                const guestPhone = String(g(r, REQ.guestPhone) ?? "-");

                const start = parseStartDate(r);
                const remaining = start ? diffDays(start) : null;

                const booking = bookingByRequestId[String(r.id)];
                const booked = Boolean(booking);

                const statusVal = String(g(r, REQ.status) ?? "active");
                const adminOnlyVal = Boolean(g(r, REQ.adminOnly));

                return (
                  <tr key={r.id} className="border-t border-white/10 hover:bg-white/[0.03]">
                    <td className="p-3 font-semibold">{r.id}</td>
                    <td className="p-3">{c} / {d}</td>

                    <td className="p-3 text-xs text-slate-300">
                      {createdAt ? createdAt.toLocaleString("tr-TR") : "-"}
                    </td>

                    <td className="p-3">
                      {remaining == null ? (
                        <span className="text-slate-400">-</span>
                      ) : remaining < 0 ? (
                        <span className={badge("bad")}>Geçti</span>
                      ) : remaining <= 3 ? (
                        <span className={badge("bad")}>{remaining} gün</span>
                      ) : remaining <= 7 ? (
                        <span className={badge("warn")}>{remaining} gün</span>
                      ) : (
                        <span className={badge("ok")}>{remaining} gün</span>
                      )}
                    </td>

                    <td className="p-3">
                      <div className="font-semibold">{guestName}</div>
                      <div className="text-xs text-slate-400">{guestPhone}</div>
                    </td>

                    <td className="p-3 max-w-[320px] truncate text-slate-200">{String(g(r, REQ.notes) ?? "-")}</td>

                    <td className="p-3">
                      {booked ? (
                        <span className={badge("ok")}>
                          Alındı: {money(Number(g(booking, BK.totalPrice) ?? 0), String(g(booking, BK.currency) ?? "TRY"))}
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>

                    <td className="p-3">
                      <span className={badge(statusVal === "active" ? "ok" : "bad")}>
                        {statusVal === "active" ? "Aktif" : "Pasif"}
                      </span>
                      {adminOnlyVal ? <span className={"ml-2 " + badge("warn")}>Sadece Admin</span> : null}
                    </td>

                    <td className="p-3">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => openDetail(r)}
                          className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs hover:bg-white/[0.06]"
                        >
                          Detay
                        </button>
                        <button
                          onClick={() => toggleField(r.id, { [REQ.status]: statusVal === "active" ? "passive" : "active" })}
                          className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs hover:bg-white/[0.06]"
                        >
                          {statusVal === "active" ? "Pasife Al" : "Aktife Al"}
                        </button>
                        <button
                          onClick={() => toggleField(r.id, { [REQ.adminOnly]: !adminOnlyVal })}
                          className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs hover:bg-white/[0.06]"
                        >
                          {adminOnlyVal ? "Normal Yap" : "Sadece Admin"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-slate-400">Kayıt yok.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* PAGINATION */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 bg-white/[0.02] p-3">
          <div className="text-xs text-slate-400">
            Sayfa <b className="text-slate-100">{safePage}</b> / {totalPages} • Toplam:{" "}
            <b className="text-slate-100">{filtered.length}</b>
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

      {/* DETAIL MODAL */}
      {selected && (
        <RequestUltraDetailModal
          request={selected}
          guestUser={selectedGuest}
          offers={(offersByRequestId[String(selected.id)] ?? [])}
          booking={bookingByRequestId[String(selected.id)] ?? null}
          loading={detailLoading}
          onClose={() => { setSelected(null); setSelectedGuest(null); }}
        />
      )}
    </div>
  );
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-xs text-slate-400">{title}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function RequestUltraDetailModal({
  request,
  guestUser,
  offers,
  booking,
  loading,
  onClose,
}: {
  request: AnyObj;
  guestUser: AnyObj | null;
  offers: AnyObj[];
  booking: AnyObj | null;
  loading: boolean;
  onClose: () => void;
}) {
  const createdAt = tsToDate(g(request, REQ.createdAt));
  const city = String(g(request, REQ.city) ?? "-");
  const district = String(g(request, REQ.district) ?? "-");
  const notes = String(g(request, REQ.notes) ?? "-");
  const checkIn = String(g(request, REQ.checkIn) ?? g(request, REQ.date) ?? "-");
  const checkOut = String(g(request, REQ.checkOut) ?? "-");
  const adults = String(g(request, REQ.adults) ?? "-");
  const children = String(g(request, REQ.childrenCount) ?? "-");
  const roomType = String(g(request, REQ.roomType) ?? "-");
  const time = String(g(request, REQ.time) ?? "");

  // guest info fallback chain: user -> request -> booking
  const guestName = String(g(guestUser || {}, USR.displayName) ?? g(request, REQ.guestName) ?? "-");
  const guestEmail = String(g(guestUser || {}, USR.email) ?? g(request, REQ.guestEmail) ?? g(booking || {}, BK.guestEmail) ?? "-");
  const guestPhone = String(g(guestUser || {}, USR.phone) ?? g(request, REQ.guestPhone) ?? g(booking || {}, BK.guestPhone) ?? "Eksik");
  const guestLoc =
    guestUser
      ? `${String(g(guestUser, USR.city) ?? "-")}${g(guestUser, USR.district) ? ` / ${String(g(guestUser, USR.district))}` : ""}`
      : "-";

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 p-4 md:p-10">
      <div className="mx-auto max-w-6xl overflow-hidden rounded-2xl border border-white/10 bg-[#070A12]">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 p-4 md:p-6">
          <div>
            <div className="text-xs text-slate-400">Talep Detayı</div>
            <div className="mt-1 text-lg font-semibold">
              Talep: <span className="text-slate-200">{request.id}</span>
            </div>
            <div className="mt-1 text-xs text-slate-400">
              Oluşturma: <span className="text-slate-200">{createdAt ? createdAt.toLocaleString("tr-TR") : "-"}</span> •
              Konum: <span className="text-slate-200">{city} / {district}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm hover:bg-white/[0.06]"
          >
            Kapat
          </button>
        </div>

        <div className="p-4 md:p-6 grid gap-3 md:grid-cols-2">
          <Box title="Talebin Tüm Bilgileri">
            <div className="space-y-1 text-sm text-slate-200">
              <div><b>Check-in / Tarih:</b> {checkIn}{time ? ` • ${time}` : ""}</div>
              <div><b>Check-out:</b> {checkOut}</div>
              <div><b>Yetişkin / Çocuk:</b> {adults} / {children}</div>
              <div><b>Oda Tipi:</b> {roomType}</div>
              <div><b>Not:</b> {notes}</div>
            </div>
          </Box>

          <Box title="Misafir Bilgisi">
            {loading ? (
              <div className="text-sm text-slate-300">Yükleniyor…</div>
            ) : (
              <div className="space-y-1 text-sm text-slate-200">
                <div><b>Ad:</b> {guestName}</div>
                <div><b>Email:</b> {guestEmail}</div>
                <div><b>Telefon:</b> {guestPhone}</div>
                <div><b>Konum:</b> {guestLoc}</div>
              </div>
            )}
          </Box>

          <Box title="Rezervasyon Dönüşümü">
            {!booking ? (
              <div className="text-sm text-slate-300">Bu talep henüz rezervasyona dönüşmemiş.</div>
            ) : (
              <div className="space-y-1 text-sm text-slate-200">
                <div><b>Rezervasyon Tarihi:</b> {tsToDate(g(booking, BK.createdAt))?.toLocaleString("tr-TR") ?? "-"}</div>
                <div><b>Hangi otel:</b> {String(g(booking, BK.hotelName) ?? "-")}</div>
                <div><b>Tutar:</b> {money(Number(g(booking, BK.totalPrice) ?? 0), String(g(booking, BK.currency) ?? "TRY"))}</div>
                <div><b>Ödeme:</b> {String(g(booking, BK.paymentMethod) ?? "-")} / {String(g(booking, BK.paymentStatus) ?? "-")}</div>
              </div>
            )}
          </Box>

          <Box title={`Bu Talebe Gelen Teklifler (${offers.length})`}>
            {offers.length === 0 ? (
              <div className="text-sm text-slate-300">Teklif yok.</div>
            ) : (
              <div className="max-h-[420px] overflow-auto space-y-2 pr-1">
                {offers.map((o) => {
                  const created = tsToDate(g(o, OFF.createdAt));
                  const currency = String(g(o, OFF.currency) ?? "TRY");
                  const hidden = Boolean(g(o, OFF.isHidden));

                  const providerType = String(g(o, OFF.providerType) ?? "");
                  const providerName = String(
                    g(o, OFF.providerName) ??
                      g(o, OFF.hotelName) ??
                      g(o, OFF.agencyName) ??
                      "-"
                  );

                  const { initial, last, disc } = readHistory(o);

                  return (
                    <div key={o.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">{providerName}</div>
                          <div className="text-xs text-slate-400">
                            {providerType ? providerType : "-"} • Baş: {money(initial, currency)} • Son: {money(last, currency)} • {disc ? `%${disc}` : "-"}
                          </div>
                          <div className="mt-1">{hidden ? <span className={badge("bad")}>Gizli</span> : <span className={badge("ok")}>Görünür</span>}</div>
                        </div>
                        <div className="text-xs text-slate-500">{created ? created.toLocaleString("tr-TR") : "-"}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Box>
        </div>
      </div>
    </div>
  );
}
