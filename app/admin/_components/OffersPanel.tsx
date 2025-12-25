"use client";

import { useEffect, useMemo, useState } from "react";
import { COLLECTIONS, tsToDate } from "./firestoreAdmin";
import { useRealtimeList } from "./useAdminRealtime";
import { doc, getDoc, getFirestore, updateDoc } from "firebase/firestore";

/** OFFER FIELD MAP */
const FIELD_MAP = {
  createdAt: "createdAt",
  city: "city",
  district: "district",
  requestId: "requestId",
  currency: "currency",
  guestName: "guestName",

  // provider
  providerType: "providerType",
  providerName: "providerName",
  hotelId: "hotelId",
  hotelName: "hotelName",
  agencyId: "agencyId",
  agencyName: "agencyName",

  // history
  priceHistory: "priceHistory",
  timeline: "timeline",

  // visibility
  isHidden: "isHidden",
} as const;

/** REQUEST FIELD MAP */
const REQUEST_MAP = {
  createdAt: "createdAt",
  city: "city",
  district: "district",
  date: "date",
  time: "time",
  notes: "notes",
  checkIn: "checkIn",
  checkOut: "checkOut",
  adults: "adults",
  childrenCount: "childrenCount",
  roomsCount: "roomsCount",
  roomType: "roomType",
} as const;

/** USER FIELD MAP */
const USER_MAP = {
  displayName: "displayName",
  email: "email",
  phone: "phone",
  city: "city",
  district: "district",
  isActive: "isActive",
} as const;

/** BOOKING FIELD MAP (senin gönderdiğin booking dokümanına göre) */
const BOOKING_MAP = {
  createdAt: "createdAt",
  status: "status",
  currency: "currency",
  city: "city",
  district: "district",
  checkIn: "checkIn",
  checkOut: "checkOut",
  adults: "adults",
  childrenCount: "childrenCount",
  totalPrice: "totalPrice",

  guestId: "guestId",
  guestName: "guestName",
  guestEmail: "guestEmail",
  guestPhone: "guestPhone",

  hotelId: "hotelId",
  hotelName: "hotelName",

  requestId: "requestId",
  offerId: "offerId",

  paymentMethod: "paymentMethod",
  paymentStatus: "paymentStatus",

  roomBreakdown: "roomBreakdown",
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

function discountPercent(initial?: number, last?: number) {
  if (!initial || !last || initial <= 0) return 0;
  const diff = initial - last;
  return Math.max(0, Math.round((diff / initial) * 100));
}

function badge(kind: "ok" | "bad" | "warn") {
  if (kind === "ok")
    return "rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-xs text-emerald-200";
  if (kind === "bad")
    return "rounded-lg border border-rose-400/30 bg-rose-400/10 px-2 py-1 text-xs text-rose-200";
  return "rounded-lg border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-xs text-amber-200";
}

/** priceHistory/timeline okur */
function readHistory(offer: AnyObj) {
  const ph = g(offer, FIELD_MAP.priceHistory);
  const tl = g(offer, FIELD_MAP.timeline);
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

  return { steps: normalized, initial, last };
}

function parseRequestStartDate(req: AnyObj | null): Date | null {
  if (!req) return null;
  const checkIn = g(req, REQUEST_MAP.checkIn);
  if (checkIn) {
    const d = new Date(String(checkIn));
    return isNaN(d.getTime()) ? null : d;
  }
  const date = g(req, REQUEST_MAP.date);
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

export default function OffersPanel() {
  // Offers realtime
  const { rows: offers, loading, error } = useRealtimeList<any>(COLLECTIONS.offers, {
    createdAtField: FIELD_MAP.createdAt,
    take: 5000,
  });

  // Bookings realtime (rezervasyona dönüşüm kontrolü için)
  const { rows: bookings } = useRealtimeList<any>(COLLECTIONS.bookings, {
    createdAtField: BOOKING_MAP.createdAt,
    take: 5000,
  });

  // Filters
  const [q, setQ] = useState("");
  const [onlyVisible, setOnlyVisible] = useState(false);
  const [cityFilter, setCityFilter] = useState("");
  const [districtFilter, setDistrictFilter] = useState("");
  const [page, setPage] = useState(1);

  // caches
  const [reqCache, setReqCache] = useState<Record<string, AnyObj | null>>({});
  const [userCache, setUserCache] = useState<Record<string, AnyObj | null>>({});

  // detail modal
  const [detailOffer, setDetailOffer] = useState<any | null>(null);
  const [detailReq, setDetailReq] = useState<any | null>(null);
  const [detailProvider, setDetailProvider] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  function getProviderUid(o: AnyObj) {
    const hid = String(g(o, FIELD_MAP.hotelId) ?? "");
    const aid = String(g(o, FIELD_MAP.agencyId) ?? "");
    return hid || aid || "";
  }
  function getProviderType(o: AnyObj) {
    const t = String(g(o, FIELD_MAP.providerType) ?? "").toLowerCase();
    if (t === "hotel" || t === "agency") return t;
    if (g(o, FIELD_MAP.hotelId)) return "hotel";
    if (g(o, FIELD_MAP.agencyId)) return "agency";
    return "";
  }

  // booking map: offerId -> booking
  const bookingByOfferId = useMemo(() => {
    const m: Record<string, AnyObj> = {};
    for (const b of bookings) {
      const oid = String(g(b, BOOKING_MAP.offerId) ?? "");
      if (oid) m[oid] = b;
    }
    return m;
  }, [bookings]);

  // cities/districts options (offer + request cache)
  const allCities = useMemo(() => {
    const set = new Set<string>();
    for (const o of offers) {
      const rid = String(g(o, FIELD_MAP.requestId) ?? "");
      const req = rid ? reqCache[rid] : null;
      const c = String(g(o, FIELD_MAP.city) ?? g(req || {}, REQUEST_MAP.city) ?? "").trim();
      if (c) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "tr"));
  }, [offers, reqCache]);

  const allDistricts = useMemo(() => {
    const set = new Set<string>();
    for (const o of offers) {
      const rid = String(g(o, FIELD_MAP.requestId) ?? "");
      const req = rid ? reqCache[rid] : null;

      const c = String(g(o, FIELD_MAP.city) ?? g(req || {}, REQUEST_MAP.city) ?? "").trim();
      const d = String(g(o, FIELD_MAP.district) ?? g(req || {}, REQUEST_MAP.district) ?? "").trim();

      if (cityFilter && c !== cityFilter) continue;
      if (d) set.add(d);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "tr"));
  }, [offers, reqCache, cityFilter]);

  const filtered = useMemo(() => {
    return offers.filter((o) => {
      const rid = String(g(o, FIELD_MAP.requestId) ?? "");
      const req = rid ? reqCache[rid] : null;

      const city = String(g(o, FIELD_MAP.city) ?? g(req || {}, REQUEST_MAP.city) ?? "").trim();
      const district = String(g(o, FIELD_MAP.district) ?? g(req || {}, REQUEST_MAP.district) ?? "").trim();

      const providerName = String(
        g(o, FIELD_MAP.providerName) ??
          g(o, getProviderType(o) === "hotel" ? FIELD_MAP.hotelName : FIELD_MAP.agencyName) ??
          ""
      );

      const guestName = String(g(o, FIELD_MAP.guestName) ?? "");
      const text = `${o.id} ${rid} ${city} ${district} ${providerName} ${guestName}`.toLowerCase();
      if (q && !text.includes(q.toLowerCase())) return false;

      const isHidden = Boolean(g(o, FIELD_MAP.isHidden));
      if (onlyVisible && isHidden) return false;

      if (cityFilter && city !== cityFilter) return false;
      if (districtFilter && district !== districtFilter) return false;

      return true;
    });
  }, [offers, q, onlyVisible, reqCache, cityFilter, districtFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  const pageRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

  // cache request + provider user for current page
  useEffect(() => {
    const db = getFirestore();

    const reqIds = Array.from(
      new Set(pageRows.map((o) => String(g(o, FIELD_MAP.requestId) ?? "")).filter(Boolean))
    ).filter((id) => reqCache[id] === undefined);

    const userIds = Array.from(new Set(pageRows.map((o) => getProviderUid(o)).filter(Boolean))).filter(
      (id) => userCache[id] === undefined
    );

    (async () => {
      if (reqIds.length) {
        const updates: Record<string, AnyObj | null> = {};
        await Promise.all(
          reqIds.map(async (rid) => {
            try {
              const snap = await getDoc(doc(db, COLLECTIONS.requests, rid));
              updates[rid] = snap.exists() ? { id: snap.id, ...snap.data() } : null;
            } catch {
              updates[rid] = null;
            }
          })
        );
        setReqCache((p) => ({ ...p, ...updates }));
      }

      if (userIds.length) {
        const updates: Record<string, AnyObj | null> = {};
        await Promise.all(
          userIds.map(async (uid) => {
            try {
              const snap = await getDoc(doc(db, COLLECTIONS.users, uid));
              updates[uid] = snap.exists() ? { id: snap.id, ...snap.data() } : null;
            } catch {
              updates[uid] = null;
            }
          })
        );
        setUserCache((p) => ({ ...p, ...updates }));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageRows]);

  async function toggleHide(id: string, currentHidden: boolean) {
    const db = getFirestore();
    await updateDoc(doc(db, COLLECTIONS.offers, id), {
      [FIELD_MAP.isHidden]: !currentHidden,
      updatedAt: new Date(),
    } as any);
  }

  async function openDetail(o: AnyObj) {
    const db = getFirestore();
    setDetailOffer(o);
    setDetailReq(null);
    setDetailProvider(null);
    setDetailLoading(true);

    try {
      const rid = String(g(o, FIELD_MAP.requestId) ?? "");
      const pid = getProviderUid(o);

      if (rid) {
        const snap = await getDoc(doc(db, COLLECTIONS.requests, rid));
        setDetailReq(snap.exists() ? { id: snap.id, ...snap.data() } : null);
      }
      if (pid) {
        const snap = await getDoc(doc(db, COLLECTIONS.users, pid));
        setDetailProvider(snap.exists() ? { id: snap.id, ...snap.data() } : null);
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
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Ara: teklif ID / talep ID / otel / misafir / il-ilçe…"
            className="md:col-span-5 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-2 text-sm outline-none focus:border-white/20"
          />

          <select
            value={cityFilter}
            onChange={(e) => {
              setCityFilter(e.target.value);
              setDistrictFilter("");
              setPage(1);
            }}
            className="md:col-span-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-white/20"
          >
            <option value="">Tüm iller</option>
            {allCities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            value={districtFilter}
            onChange={(e) => {
              setDistrictFilter(e.target.value);
              setPage(1);
            }}
            className="md:col-span-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-white/20"
          >
            <option value="">Tüm ilçeler</option>
            {allDistricts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>

          <label className="md:col-span-3 flex items-center gap-2 text-xs text-slate-200">
            <input
              type="checkbox"
              checked={onlyVisible}
              onChange={(e) => {
                setOnlyVisible(e.target.checked);
                setPage(1);
              }}
            />
            Sadece Misafire Görünenler
          </label>
        </div>

        <div className="mt-2 text-xs text-slate-400">
          {error ? <span className="text-rose-300">Hata: {error}</span> : null}
          <span> Sonuç: </span>
          <b className="text-slate-100">{filtered.length}</b>
          {loading ? <span className="ml-2">(yükleniyor…)</span> : null}
        </div>
      </div>

      {/* TABLE */}
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
        <div className="overflow-x-auto">
          <table className="min-w-[1550px] w-full text-sm">
            <thead className="bg-white/[0.03] text-slate-300">
              <tr>
                <th className="p-3 text-left">Teklif</th>
                <th className="p-3 text-left">Talep</th>
                <th className="p-3 text-left">İl / İlçe</th>
                <th className="p-3 text-left">İlan Tarihi</th>
                <th className="p-3 text-left">Kalan</th>
                <th className="p-3 text-left">Veren</th>
                <th className="p-3 text-left">Başlangıç</th>
                <th className="p-3 text-left">Son</th>
                <th className="p-3 text-left">% İndirim</th>
                <th className="p-3 text-left">Rezervasyon</th>
                <th className="p-3 text-left">Durum</th>
                <th className="p-3 text-right">İşlem</th>
              </tr>
            </thead>

            <tbody>
              {pageRows.map((o) => {
                const rid = String(g(o, FIELD_MAP.requestId) ?? "-");
                const req = rid !== "-" ? reqCache[rid] : null;

                const city = String(g(o, FIELD_MAP.city) ?? g(req || {}, REQUEST_MAP.city) ?? "-");
                const district = String(g(o, FIELD_MAP.district) ?? g(req || {}, REQUEST_MAP.district) ?? "-");

                const providerUid = getProviderUid(o);
                const providerUser = providerUid ? userCache[providerUid] : null;
                const providerType = getProviderType(o);
                const providerName =
                  String(
                    g(o, FIELD_MAP.providerName) ??
                      g(o, providerType === "hotel" ? FIELD_MAP.hotelName : FIELD_MAP.agencyName) ??
                      g(providerUser || {}, USER_MAP.displayName) ??
                      "-"
                  );

                const currency = String(g(o, FIELD_MAP.currency) ?? "TRY");
                const isHidden = Boolean(g(o, FIELD_MAP.isHidden));
                const createdAt = tsToDate(g(o, FIELD_MAP.createdAt));

                const { initial, last } = readHistory(o);
                const disc = discountPercent(initial, last);

                const startDate = parseRequestStartDate(req || null);
                const remaining = startDate ? diffDays(startDate) : null;

                const booking = bookingByOfferId[String(o.id)];
                const bookingPrice = booking ? Number(g(booking, BOOKING_MAP.totalPrice) ?? 0) : 0;

                return (
                  <tr key={o.id} className="border-t border-white/10 hover:bg-white/[0.03]">
                    <td className="p-3 font-semibold">{o.id}</td>
                    <td className="p-3">{rid}</td>

                    <td className="p-3">
                      {city}
                      {district && district !== "null" ? ` / ${district}` : ""}
                    </td>

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
                      <div className="font-semibold">{providerName}</div>
                      <div className="text-xs text-slate-400">{providerType === "hotel" ? "Otel" : providerType === "agency" ? "Acenta" : "-"}</div>
                    </td>

                    <td className="p-3">{money(initial, currency)}</td>
                    <td className="p-3 font-semibold">{money(last, currency)}</td>
                    <td className="p-3">{disc ? `%${disc}` : "-"}</td>

                    <td className="p-3">
                      {booking ? (
                        <span className={badge("ok")}>
                          Alındı: {money(bookingPrice, String(g(booking, BOOKING_MAP.currency) ?? currency))}
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>

                    <td className="p-3">
                      <span className={isHidden ? badge("bad") : badge("ok")}>
                        {isHidden ? "Gizli" : "Görünür"}
                      </span>
                    </td>

                    <td className="p-3">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => openDetail(o)}
                          className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs hover:bg-white/[0.06]"
                        >
                          Detay
                        </button>
                        <button
                          onClick={() => toggleHide(o.id, isHidden)}
                          className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs hover:bg-white/[0.06]"
                        >
                          {isHidden ? "Göster" : "Gizle"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={12} className="p-8 text-center text-slate-400">
                    Kayıt yok.
                  </td>
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
      {detailOffer && (
        <OfferUltraDetailModal
          offer={detailOffer}
          request={detailReq}
          provider={detailProvider}
          providerUid={getProviderUid(detailOffer)}
          booking={bookingByOfferId[String(detailOffer.id)] ?? null}
          allOffersSameRequest={offers.filter((x) => String(g(x, FIELD_MAP.requestId) ?? "") === String(g(detailOffer, FIELD_MAP.requestId) ?? ""))}
          loading={detailLoading}
          onClose={() => {
            setDetailOffer(null);
            setDetailReq(null);
            setDetailProvider(null);
          }}
          onToggleHide={toggleHide}
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

/** ✅ Ultra Detay: talep + bu ilana verilen tüm teklifler + rezervasyon dönüşümü + iletişim */
function OfferUltraDetailModal({
  offer,
  request,
  provider,
  providerUid,
  booking,
  allOffersSameRequest,
  loading,
  onClose,
  onToggleHide,
}: {
  offer: AnyObj;
  request: AnyObj | null;
  provider: AnyObj | null;
  providerUid: string;
  booking: AnyObj | null;
  allOffersSameRequest: AnyObj[];
  loading: boolean;
  onClose: () => void;
  onToggleHide: (id: string, currentHidden: boolean) => Promise<void>;
}) {
  const currency = String(g(offer, FIELD_MAP.currency) ?? "TRY");
  const isHidden = Boolean(g(offer, FIELD_MAP.isHidden));
  const offerCreatedAt = tsToDate(g(offer, FIELD_MAP.createdAt));

  const { steps, initial, last } = readHistory(offer);
  const disc = discountPercent(initial, last);

  const startDate = parseRequestStartDate(request);
  const remaining = startDate ? diffDays(startDate) : null;

  // Booking info if converted
  const bookingAt = booking ? tsToDate(g(booking, BOOKING_MAP.createdAt)) : null;
  const bookingTotal = booking ? Number(g(booking, BOOKING_MAP.totalPrice) ?? 0) : 0;
  const bookingCurrency = booking ? String(g(booking, BOOKING_MAP.currency) ?? currency) : currency;

  // Request details
  const reqCity = request ? String(g(request, REQUEST_MAP.city) ?? "-") : "-";
  const reqDistrict = request ? String(g(request, REQUEST_MAP.district) ?? "") : "";
  const reqNotes = request ? String(g(request, REQUEST_MAP.notes) ?? "-") : "-";
  const reqCheckIn = request ? String(g(request, REQUEST_MAP.checkIn) ?? g(request, REQUEST_MAP.date) ?? "-") : "-";
  const reqCheckOut = request ? String(g(request, REQUEST_MAP.checkOut) ?? "-") : "-";
  const reqAdults = request ? String(g(request, REQUEST_MAP.adults) ?? "-") : "-";
  const reqChildren = request ? String(g(request, REQUEST_MAP.childrenCount) ?? "-") : "-";
  const reqRoomType = request ? String(g(request, REQUEST_MAP.roomType) ?? "-") : "-";
  const reqTime = request ? String(g(request, REQUEST_MAP.time) ?? "") : "";

  // Provider details
  const provName = provider ? String(g(provider, USER_MAP.displayName) ?? "-") : (String(g(offer, FIELD_MAP.providerName) ?? "-"));
  const provEmail = provider ? String(g(provider, USER_MAP.email) ?? "-") : "-";
  const provPhone = provider ? String(g(provider, USER_MAP.phone) ?? "Eksik") : "Eksik";
  const provLoc =
    provider
      ? `${String(g(provider, USER_MAP.city) ?? "-")}${g(provider, USER_MAP.district) ? ` / ${String(g(provider, USER_MAP.district))}` : ""}`
      : "-";

  // “Bu ilana kim hangi otel kaç verdi?” tablosu
  const competition = useMemo(() => {
    return allOffersSameRequest
      .map((o) => {
        const c = String(g(o, FIELD_MAP.currency) ?? "TRY");
        const hid = Boolean(g(o, FIELD_MAP.isHidden));
        const { initial, last } = readHistory(o);
        const disc = discountPercent(initial, last);
        const pid = String(g(o, FIELD_MAP.hotelName) ?? g(o, FIELD_MAP.agencyName) ?? g(o, FIELD_MAP.providerName) ?? "-");
        const at = tsToDate(g(o, FIELD_MAP.createdAt));
        return { id: o.id, provider: pid, initial, last, disc, hidden: hid, currency: c, at };
      })
      .sort((a, b) => (b.last || 0) - (a.last || 0));
  }, [allOffersSameRequest]);

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 p-4 md:p-10">
      <div className="mx-auto max-w-6xl overflow-hidden rounded-2xl border border-white/10 bg-[#070A12]">
        <div className="flex flex-col gap-3 border-b border-white/10 p-4 md:flex-row md:items-center md:justify-between md:p-6">
          <div>
            <div className="text-xs text-slate-400">İlan / Teklif Detayı</div>
            <div className="mt-1 text-lg font-semibold">
              Teklif: <span className="text-slate-200">{offer.id}</span>
            </div>
            <div className="mt-1 text-xs text-slate-400">
              İlan Tarihi: <span className="text-slate-200">{offerCreatedAt ? offerCreatedAt.toLocaleString("tr-TR") : "-"}</span> •
              Başlangıç: <span className="text-slate-200">{money(initial, currency)}</span> •
              Son: <span className="text-slate-200">{money(last, currency)}</span>
              {disc ? <span className="ml-2 text-emerald-200">(%{disc} indirim)</span> : null}
              {remaining != null ? (
                <span className="ml-2 text-slate-300">
                  • Kalan:{" "}
                  <span className={remaining <= 3 ? "text-rose-200" : remaining <= 7 ? "text-amber-200" : "text-emerald-200"}>
                    {remaining < 0 ? "Geçti" : `${remaining} gün`}
                  </span>
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onToggleHide(offer.id, isHidden)}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm hover:bg-white/[0.06]"
            >
              {isHidden ? "Teklifi Göster" : "Teklifi Gizle"}
            </button>

            <button
              onClick={onClose}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm hover:bg-white/[0.06]"
            >
              Kapat
            </button>
          </div>
        </div>

        <div className="p-4 md:p-6 grid gap-3 md:grid-cols-2">
          <Box title="Talebin Tüm Detayları">
            {loading ? (
              <div className="text-sm text-slate-300">Yükleniyor…</div>
            ) : !request ? (
              <div className="text-sm text-slate-300">Talep bulunamadı.</div>
            ) : (
              <div className="space-y-1 text-sm text-slate-200">
                <div><b>Konum:</b> {reqCity}{reqDistrict ? ` / ${reqDistrict}` : ""}</div>
                <div><b>Check-in / Tarih:</b> {reqCheckIn}{reqTime ? ` • ${reqTime}` : ""}</div>
                <div><b>Check-out:</b> {reqCheckOut}</div>
                <div><b>Yetişkin / Çocuk:</b> {reqAdults} / {reqChildren}</div>
                <div><b>Oda Tipi:</b> {reqRoomType}</div>
                <div><b>Not:</b> {reqNotes}</div>
              </div>
            )}
          </Box>

          <Box title="Veren (Otel/Acenta) Bilgileri">
            <div className="space-y-1 text-sm text-slate-200">
              <div><b>Ad:</b> {provName}</div>
              <div><b>Email:</b> {provEmail}</div>
              <div><b>Telefon:</b> {provPhone}</div>
              <div><b>Konum:</b> {provLoc}</div>
              <div className="mt-2 text-xs text-slate-400">UID: {providerUid || "-"}</div>
            </div>
          </Box>

          <Box title="Rezervasyon Dönüşümü">
            {!booking ? (
              <div className="text-sm text-slate-300">Bu teklif henüz rezervasyona dönüşmemiş.</div>
            ) : (
              <div className="space-y-1 text-sm text-slate-200">
                <div><b>Rezervasyon Tarihi:</b> {bookingAt ? bookingAt.toLocaleString("tr-TR") : "-"}</div>
                <div><b>Kim aldı:</b> {String(g(booking, BOOKING_MAP.guestName) ?? "-")}</div>
                <div><b>Email:</b> {String(g(booking, BOOKING_MAP.guestEmail) ?? "-")}</div>
                <div><b>Telefon:</b> {String(g(booking, BOOKING_MAP.guestPhone) ?? "-")}</div>
                <div><b>Tutar:</b> {money(bookingTotal, bookingCurrency)}</div>
                <div><b>Ödeme:</b> {String(g(booking, BOOKING_MAP.paymentMethod) ?? "-")} / {String(g(booking, BOOKING_MAP.paymentStatus) ?? "-")}</div>
              </div>
            )}
          </Box>

          <Box title="Fiyat Düzenlemeleri (Revizeler)">
            {steps.length === 0 ? (
              <div className="text-sm text-slate-300">Fiyat geçmişi yok.</div>
            ) : (
              <div className="max-h-[420px] overflow-auto space-y-2 pr-1">
                {steps.map((s, i) => (
                  <div key={i} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-sm font-semibold">
                        {String(s.kind).toUpperCase()} • {String(s.actor).toUpperCase()}
                      </div>
                      <div className="text-xs text-slate-400">{s.at ? s.at.toLocaleString("tr-TR") : "-"}</div>
                    </div>
                    <div className="mt-1 text-lg font-semibold">{money(s.price, currency)}</div>
                  </div>
                ))}
              </div>
            )}
          </Box>

          <Box title="Bu İlana Gelen Tüm Teklifler">
            {competition.length === 0 ? (
              <div className="text-sm text-slate-300">Kayıt yok.</div>
            ) : (
              <div className="max-h-[420px] overflow-auto space-y-2 pr-1">
                {competition.map((c) => (
                  <div key={c.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">{c.provider}</div>
                        <div className="text-xs text-slate-400">
                          Baş: {money(c.initial, c.currency)} • Son: {money(c.last, c.currency)} • {c.disc ? `%${c.disc}` : "-"}
                        </div>
                        <div className="mt-1">
                          {c.hidden ? <span className={badge("bad")}>Gizli</span> : <span className={badge("ok")}>Görünür</span>}
                        </div>
                      </div>
                      <div className="text-xs text-slate-500">{c.at ? c.at.toLocaleString("tr-TR") : "-"}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Box>
        </div>
      </div>
    </div>
  );
}
