"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Protected } from "@/components/Protected";
import { useAuth } from "@/context/AuthContext";
import { getFirestoreDb } from "@/lib/firebase/client";
import {
  collection,
  doc,
  getDocs,
  query,
  Timestamp,
  updateDoc,
  where
} from "firebase/firestore";

type IncludeKey = "hotel" | "transfer" | "tour" | "guide" | "insurance";

type PackageRequest = {
  id: string;

  createdByRole: "guest" | "agency";
  createdById: string;
  createdByName?: string | null;
  createdByPhone?: string | null;

  title?: string | null;

  city: string;
  district?: string | null;

  dateFrom: string;
  dateTo: string;
  nights?: number;

  paxAdults: number;
  paxChildren?: number;
  childrenAges?: number[];

  boardTypes?: string[];
  hotelCategoryPref?: string[];

  include?: Partial<Record<IncludeKey, boolean>>;

  budgetMin?: number | null;
  budgetMax?: number | null;

  responseDeadlineMinutes?: number | null;
  notes?: string | null;

  status?: "open" | "expired" | "accepted" | "cancelled";
  createdAt?: Timestamp;
};

type PackageOffer = {
  id: string;
  requestId: string;

  agencyId: string;
  agencyName?: string | null;

  totalPrice: number;
  currency: string;

  breakdown?: {
    hotel?: number;
    transfer?: number;
    tours?: number;
    other?: number;
  };

  packageDetails?: {
    hotelName?: string;
    roomType?: string;
    boardType?: string;
    transferType?: string;
    tourPlan?: string[];
    guideIncluded?: boolean;
  };

  note?: string | null;

  status?: "sent" | "updated" | "withdrawn" | "accepted" | "rejected";
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

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

function calcNights(from?: string, to?: string) {
  const a = parseDate(from);
  const b = parseDate(to);
  if (!a || !b) return 1;
  const d = diffInDays(b, a);
  return d > 0 ? d : 1;
}

function includesLabel(include?: Partial<Record<IncludeKey, boolean>>) {
  const inc = include || {};
  const on: string[] = [];
  if (inc.hotel) on.push("Otel");
  if (inc.transfer) on.push("Transfer");
  if (inc.tour) on.push("Tur");
  if (inc.guide) on.push("Rehber");
  if (inc.insurance) on.push("Sigorta");
  return on.length ? on.join(" • ") : "—";
}

function statusBadgeCls(status?: string) {
  const s = status || "sent";
  if (s === "accepted") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  if (s === "rejected") return "border-red-500/40 bg-red-500/10 text-red-200";
  if (s === "withdrawn") return "border-slate-600 bg-slate-900/60 text-slate-200";
  if (s === "updated") return "border-sky-500/40 bg-sky-500/10 text-sky-200";
  return "border-amber-500/40 bg-amber-500/10 text-amber-200";
}

function confirmUI(msg: string) {
  if (typeof window === "undefined") return true;
  return window.confirm(msg);
}

function toMoney(n: any) {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? v : 0;
}
export default function AgencyPackageOffersPage() {
  const { profile, loading: authLoading } = useAuth() as any;
  const db = getFirestoreDb();

  const [loading, setLoading] = useState(true);
  const [pageErr, setPageErr] = useState<string | null>(null);

  const [offers, setOffers] = useState<PackageOffer[]>([]);
  const [reqMap, setReqMap] = useState<Record<string, PackageRequest>>({});

  // filters
  const [qText, setQText] = useState("");
  const [cityF, setCityF] = useState("all");
  const [dateFromF, setDateFromF] = useState("");
  const [dateToF, setDateToF] = useState("");
  const [includeF, setIncludeF] = useState<"all" | IncludeKey>("all");
  const [statusF, setStatusF] = useState<"all" | NonNullable<PackageOffer["status"]>>("all");
  const [minOfferF, setMinOfferF] = useState("");
  const [maxOfferF, setMaxOfferF] = useState("");
  const [sortKey, setSortKey] = useState<"new" | "price" | "date">("new");

  // drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeOffer, setActiveOffer] = useState<PackageOffer | null>(null);

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
        // ✅ INDEX İSTEMESİN DİYE orderBy YOK
        const qOff = query(
          collection(db, "packageOffers"),
          where("agencyId", "==", profile.uid)
        );
        const snapOff = await getDocs(qOff);

        const offList: PackageOffer[] = snapOff.docs.map((d) => {
          const v = d.data() as any;
          return {
            id: d.id,
            requestId: v.requestId,
            agencyId: v.agencyId,
            agencyName: v.agencyName ?? null,
            totalPrice: Number(v.totalPrice ?? 0),
            currency: v.currency ?? "TRY",
            breakdown: v.breakdown ?? {},
            packageDetails: v.packageDetails ?? {},
            note: v.note ?? null,
            status: v.status ?? "sent",
            createdAt: v.createdAt,
            updatedAt: v.updatedAt
          };
        });

        // request id set
        const requestIds = Array.from(new Set(offList.map((o) => o.requestId).filter(Boolean)));

        // requests -> map
        const map: Record<string, PackageRequest> = {};
        if (requestIds.length) {
          const snapReq = await getDocs(collection(db, "packageRequests"));
          snapReq.docs.forEach((d) => {
            if (!requestIds.includes(d.id)) return;
            const v = d.data() as any;
            map[d.id] = {
              id: d.id,
              createdByRole: v.createdByRole ?? "guest",
              createdById: v.createdById ?? v.createdBy ?? v.guestId ?? "",
              createdByName: v.createdByName ?? null,
              createdByPhone: v.createdByPhone ?? null,
              title: v.title ?? null,
              city: v.city ?? "",
              district: v.district ?? null,
              dateFrom: v.dateFrom ?? v.checkIn ?? "",
              dateTo: v.dateTo ?? v.checkOut ?? "",
              nights: v.nights ?? null,
              paxAdults: Number(v.paxAdults ?? v.adults ?? 0),
              paxChildren: Number(v.paxChildren ?? v.childrenCount ?? 0),
              childrenAges: Array.isArray(v.childrenAges) ? v.childrenAges : [],
              boardTypes: Array.isArray(v.boardTypes) ? v.boardTypes : [],
              hotelCategoryPref: Array.isArray(v.hotelCategoryPref) ? v.hotelCategoryPref : [],
              include: v.include ?? {},
              budgetMin: v.budgetMin ?? null,
              budgetMax: v.budgetMax ?? null,
              responseDeadlineMinutes: v.responseDeadlineMinutes ?? null,
              notes: v.notes ?? v.generalNote ?? null,
              status: v.status ?? "open",
              createdAt: v.createdAt
            };
          });
        }

        setOffers(offList);
        setReqMap(map);
      } catch (e: any) {
        console.error(e);
        setPageErr(e?.message || "Teklifler yüklenirken hata oluştu.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [authLoading, profile, db]);

  const cityOptions = useMemo(() => {
    const s = new Set<string>();
    Object.values(reqMap).forEach((r) => r.city && s.add(r.city));
    return ["all", ...Array.from(s)];
  }, [reqMap]);

  const filtered = useMemo(() => {
    let list = [...offers];

    // status filter
    if (statusF !== "all") list = list.filter((o) => (o.status ?? "sent") === statusF);

    // min/max offer
    const minO = minOfferF.trim() ? Number(minOfferF) : null;
    const maxO = maxOfferF.trim() ? Number(maxOfferF) : null;
    if (minO != null && !Number.isNaN(minO)) list = list.filter((o) => Number(o.totalPrice ?? 0) >= minO);
    if (maxO != null && !Number.isNaN(maxO)) list = list.filter((o) => Number(o.totalPrice ?? 0) <= maxO);

    // city filter
    if (cityF !== "all") list = list.filter((o) => (reqMap[o.requestId]?.city ?? "") === cityF);

    // include filter
    if (includeF !== "all") list = list.filter((o) => !!reqMap[o.requestId]?.include?.[includeF]);

    // date range based on request dateFrom/dateTo
    const f = parseDate(dateFromF);
    if (f) {
      list = list.filter((o) => {
        const d = parseDate(reqMap[o.requestId]?.dateFrom);
        if (!d) return false;
        return normalized(d).getTime() >= normalized(f).getTime();
      });
    }
    const t = parseDate(dateToF);
    if (t) {
      list = list.filter((o) => {
        const d = parseDate(reqMap[o.requestId]?.dateTo);
        if (!d) return false;
        return normalized(d).getTime() <= normalized(t).getTime();
      });
    }

    // search
    const q = qText.trim().toLowerCase();
    if (q) {
      list = list.filter((o) => {
        const r = reqMap[o.requestId];
        const hay = [
          o.id,
          o.requestId,
          o.agencyName,
          o.note,
          o.packageDetails?.hotelName,
          o.packageDetails?.roomType,
          r?.title,
          r?.city,
          r?.district,
          r?.notes,
          r?.createdByName
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }

    // ✅ client-side sort (index yok)
    list.sort((a, b) => {
      if (sortKey === "new") {
        const ta = a.updatedAt?.toMillis?.() ?? a.createdAt?.toMillis?.() ?? 0;
        const tb = b.updatedAt?.toMillis?.() ?? b.createdAt?.toMillis?.() ?? 0;
        return tb - ta;
      }
      if (sortKey === "price") return Number(a.totalPrice ?? 0) - Number(b.totalPrice ?? 0);
      if (sortKey === "date") {
        const da = parseDate(reqMap[a.requestId]?.dateFrom)?.getTime() ?? Infinity;
        const dbb = parseDate(reqMap[b.requestId]?.dateFrom)?.getTime() ?? Infinity;
        return da - dbb;
      }
      return 0;
    });

    return list;
  }, [offers, reqMap, qText, cityF, dateFromF, dateToF, includeF, statusF, minOfferF, maxOfferF, sortKey]);

  function openDrawer(o: PackageOffer) {
    setActiveOffer(o);
    setDrawerOpen(true);
  }
  function closeDrawer() {
    setDrawerOpen(false);
    setActiveOffer(null);
  }

  async function withdrawOffer(o: PackageOffer) {
    if (!confirmUI("Bu teklifi geri çekmek istediğine emin misin?")) return;
    try {
      await updateDoc(doc(db, "packageOffers", o.id), {
        status: "withdrawn",
        updatedAt: Timestamp.fromDate(new Date())
      } as any);

      setOffers((prev) =>
        prev.map((x) => (x.id === o.id ? { ...x, status: "withdrawn", updatedAt: Timestamp.fromDate(new Date()) } : x))
      );
    } catch (e) {
      console.error(e);
      alert("Teklif geri çekilemedi.");
    }
  }

  return (
    <Protected allowedRoles={["agency"]}>
      <div className="container-page space-y-6">
        <section className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-100">Verdiğim Paket Tekliflerim</h1>
          <p className="text-sm text-slate-300 max-w-3xl">
            Burada gönderdiğin/güncellediğin tüm paket tekliflerini görürsün. Detaya girip teklifi kopyalayabilir, güncelleyebilir veya geri çekebilirsin.
            <span className="text-slate-400"> (Bu sürüm index istemez, sıralama client-side yapılır.)</span>
          </p>
        </section>

        {pageErr && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-200 text-sm">
            {pageErr}
          </div>
        )}

        {/* Filters */}
        <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow shadow-slate-950/40 space-y-3">
          <div className="grid gap-3 md:grid-cols-12 items-end">
            <div className="md:col-span-4 space-y-1">
              <label className="text-[0.7rem] text-slate-300">Arama</label>
              <input value={qText} onChange={(e) => setQText(e.target.value)} className="input" placeholder="şehir, başlık, not, otel..." />
            </div>

            <div className="md:col-span-2 space-y-1">
              <label className="text-[0.7rem] text-slate-300">Şehir</label>
              <select value={cityF} onChange={(e) => setCityF(e.target.value)} className="input">
                {cityOptions.map((c) => (
                  <option key={c} value={c}>
                    {c === "all" ? "Hepsi" : c}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2 space-y-1">
              <label className="text-[0.7rem] text-slate-300">Başlangıç (min)</label>
              <input type="date" value={dateFromF} onChange={(e) => setDateFromF(e.target.value)} className="input" />
            </div>

            <div className="md:col-span-2 space-y-1">
              <label className="text-[0.7rem] text-slate-300">Bitiş (max)</label>
              <input type="date" value={dateToF} onChange={(e) => setDateToF(e.target.value)} className="input" />
            </div>

            <div className="md:col-span-1 space-y-1">
              <label className="text-[0.7rem] text-slate-300">Min</label>
              <input value={minOfferF} onChange={(e) => setMinOfferF(e.target.value)} className="input" placeholder="₺" />
            </div>

            <div className="md:col-span-1 space-y-1">
              <label className="text-[0.7rem] text-slate-300">Max</label>
              <input value={maxOfferF} onChange={(e) => setMaxOfferF(e.target.value)} className="input" placeholder="₺" />
            </div>

            <div className="md:col-span-3 space-y-1">
              <label className="text-[0.7rem] text-slate-300">İçerik</label>
              <select value={includeF} onChange={(e) => setIncludeF(e.target.value as any)} className="input">
                <option value="all">Hepsi</option>
                <option value="hotel">Otel</option>
                <option value="transfer">Transfer</option>
                <option value="tour">Tur</option>
                <option value="guide">Rehber</option>
                <option value="insurance">Sigorta</option>
              </select>
            </div>

            <div className="md:col-span-3 space-y-1">
              <label className="text-[0.7rem] text-slate-300">Durum</label>
              <select value={statusF} onChange={(e) => setStatusF(e.target.value as any)} className="input">
                <option value="all">Hepsi</option>
                <option value="sent">Gönderildi</option>
                <option value="updated">Güncellendi</option>
                <option value="withdrawn">Geri çekildi</option>
                <option value="accepted">Kabul edildi</option>
                <option value="rejected">Reddedildi</option>
              </select>
            </div>

            <div className="md:col-span-2 space-y-1">
              <label className="text-[0.7rem] text-slate-300">Sırala</label>
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value as any)} className="input">
                <option value="new">Yeni → Eski</option>
                <option value="price">Fiyata göre</option>
                <option value="date">Tarihe göre</option>
              </select>
            </div>

            <div className="md:col-span-12 flex items-center justify-between">
              <span className="text-[0.75rem] text-slate-400">
                Sonuç: <span className="text-slate-100 font-semibold">{filtered.length}</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setQText("");
                  setCityF("all");
                  setDateFromF("");
                  setDateToF("");
                  setIncludeF("all");
                  setStatusF("all");
                  setMinOfferF("");
                  setMaxOfferF("");
                  setSortKey("new");
                }}
                className="rounded-md border border-slate-700 px-3 py-2 text-[0.75rem] text-slate-200 hover:border-slate-500"
              >
                Temizle
              </button>
            </div>
          </div>
        </section>

        {loading && <p className="text-sm text-slate-400">Yükleniyor...</p>}

        {!loading && filtered.length === 0 && <p className="text-sm text-slate-400">Henüz bir paket teklifi yok.</p>}

        {!loading && filtered.length > 0 && (
          <section className="space-y-3">
            {filtered.map((o) => {
              const r = reqMap[o.requestId];
              const nights = r?.nights ?? calcNights(r?.dateFrom, r?.dateTo);
              const pax = (r?.paxAdults ?? 0) + (r?.paxChildren ?? 0);

              const total = Number(o.totalPrice ?? 0);
              const createdStr = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString("tr-TR") : "—";
              const updatedStr = o.updatedAt?.toDate ? o.updatedAt.toDate().toLocaleString("tr-TR") : "—";

              return (
                <div key={o.id} className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow shadow-slate-950/40">
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.65rem] ${statusBadgeCls(o.status)}`}>
                          {o.status || "sent"}
                        </span>
                        <span className="text-[0.7rem] text-slate-500">OfferID: {o.id}</span>
                        <span className="text-[0.7rem] text-slate-500">ReqID: {o.requestId}</span>
                      </div>

                      <div className="text-slate-100 font-semibold">
                        {safeStr(r?.title, r ? `${r.city}${r.district ? " / " + r.district : ""} paket talebi` : "Talep bulunamadı")}
                      </div>

                      {r && (
                        <>
                          <div className="text-[0.8rem] text-slate-300">
                            {r.city}{r.district ? ` / ${r.district}` : ""} • {r.dateFrom} – {r.dateTo} • {nights} gece
                          </div>
                          <div className="text-[0.75rem] text-slate-400">
                            {pax} kişi • İçerik: {includesLabel(r.include)}
                          </div>
                        </>
                      )}

                      <div className="text-[0.7rem] text-slate-500">Gönderim: {createdStr} • Güncelleme: {updatedStr}</div>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <div className="text-right">
                        <div className="text-[0.7rem] text-slate-400">Teklifin</div>
                        <div className="text-emerald-300 font-extrabold text-lg">
                          {total.toLocaleString("tr-TR")} {o.currency}
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => openDrawer(o)}
                          className="rounded-md bg-sky-500 text-white px-4 py-2 text-[0.8rem] font-semibold hover:bg-sky-400"
                        >
                          Detay
                        </button>

                        {o.status !== "withdrawn" && (
                          <button
                            type="button"
                            onClick={() => withdrawOffer(o)}
                            className="rounded-md border border-red-500/60 bg-red-500/10 px-4 py-2 text-[0.8rem] font-semibold text-red-200 hover:bg-red-500/15"
                          >
                            Geri çek
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {o.note && (
                    <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-[0.75rem] text-slate-300">
                      <span className="text-slate-400">Not:</span> {o.note}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        )}

        {drawerOpen && activeOffer && (
          <OfferDetailDrawer
            offer={activeOffer}
            req={reqMap[activeOffer.requestId]}
            onClose={closeDrawer}
          />
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
function OfferDetailDrawer({
  offer,
  req,
  onClose
}: {
  offer: PackageOffer;
  req?: PackageRequest;
  onClose: () => void;
}) {
  const breakdown = offer.breakdown || {};
  const pd = offer.packageDetails || {};
  const nights = req?.nights ?? calcNights(req?.dateFrom, req?.dateTo);
  const pax = req ? req.paxAdults + (req.paxChildren ?? 0) : 0;

  const textToCopy = useMemo(() => {
    const lines: string[] = [];
    lines.push("Biddakika • Paket Teklifi");
    lines.push(`Teklif ID: ${offer.id}`);
    lines.push(`Talep ID: ${offer.requestId}`);
    lines.push(`Durum: ${offer.status || "sent"}`);
    lines.push("");
    if (req) {
      lines.push(`Talep: ${safeStr(req.title, `${req.city} paketi`)}`);
      lines.push(`Konum: ${req.city}${req.district ? " / " + req.district : ""}`);
      lines.push(`Tarih: ${req.dateFrom} – ${req.dateTo} (${nights} gece)`);
      lines.push(`Kişi: ${pax} (Y:${req.paxAdults} • Ç:${req.paxChildren ?? 0})`);
      lines.push(`İçerik: ${includesLabel(req.include)}`);
      if (req.notes) lines.push(`Talep notu: ${req.notes}`);
      lines.push("");
    }
    lines.push(`Toplam: ${offer.totalPrice} ${offer.currency}`);
    lines.push(
      `Kırılım: Otel=${toMoney(breakdown.hotel)}, Transfer=${toMoney(breakdown.transfer)}, Tur=${toMoney(
        breakdown.tours
      )}, Diğer=${toMoney(breakdown.other)}`
    );
    lines.push("");
    if (pd.hotelName) lines.push(`Otel adı: ${pd.hotelName}`);
    if (pd.roomType) lines.push(`Oda tipi: ${pd.roomType}`);
    if (pd.boardType) lines.push(`Konaklama tipi: ${pd.boardType}`);
    if (pd.transferType) lines.push(`Transfer tipi: ${pd.transferType}`);
    if (pd.tourPlan?.length) lines.push(`Tur planı:\n- ${pd.tourPlan.join("\n- ")}`);
    if (pd.guideIncluded != null) lines.push(`Rehber: ${pd.guideIncluded ? "Dahil" : "Dahil değil"}`);
    if (offer.note) lines.push(`Teklif notu: ${offer.note}`);
    return lines.join("\n");
  }, [offer, req, nights, pax, breakdown, pd]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(textToCopy);
      alert("Teklif metni kopyalandı.");
    } catch {
      alert("Kopyalanamadı.");
    }
  }

  return (
    <div className="fixed inset-0 z-[95]">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-[600px] border-l border-slate-800 bg-slate-950/95 shadow-2xl overflow-y-auto">
        <div className="p-4 border-b border-slate-800 flex items-start justify-between gap-3">
          <div>
            <p className="text-[0.7rem] text-slate-400">Teklif detayı</p>
            <h2 className="text-base font-semibold text-slate-100">
              {req ? safeStr(req.title, `${req.city} paketi`) : "Talep bulunamadı"}
            </h2>
            <p className="text-[0.75rem] text-slate-400">
              {offer.totalPrice.toLocaleString("tr-TR")} {offer.currency} • {offer.status || "sent"}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 hover:border-emerald-400"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Offer summary */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-slate-100 font-semibold">Toplam fiyat</div>
              <div className="text-emerald-300 font-extrabold text-lg">
                {offer.totalPrice.toLocaleString("tr-TR")} {offer.currency}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[0.85rem]">
              <Mini label="Otel" value={toMoney(breakdown.hotel).toLocaleString("tr-TR")} />
              <Mini label="Transfer" value={toMoney(breakdown.transfer).toLocaleString("tr-TR")} />
              <Mini label="Turlar" value={toMoney(breakdown.tours).toLocaleString("tr-TR")} />
              <Mini label="Diğer" value={toMoney(breakdown.other).toLocaleString("tr-TR")} />
            </div>

            {offer.note && (
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-[0.85rem] text-slate-200">
                <span className="text-slate-400">Teklif notu:</span> {offer.note}
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleCopy}
                className="rounded-md border border-slate-700 px-4 py-2 text-[0.8rem] text-slate-200 hover:border-slate-500"
              >
                Metni kopyala
              </button>
            </div>
          </div>

          {/* Package details */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-2">
            <p className="text-[0.75rem] text-slate-400">Paket detayları</p>

            <div className="grid gap-2 md:grid-cols-2">
              <Mini label="Otel adı" value={safeStr(pd.hotelName)} />
              <Mini label="Oda tipi" value={safeStr(pd.roomType)} />
              <Mini label="Konaklama tipi" value={safeStr(pd.boardType)} />
              <Mini label="Transfer tipi" value={safeStr(pd.transferType)} />
            </div>

            <Mini label="Rehber" value={pd.guideIncluded ? "Dahil" : "Dahil değil"} />

            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <p className="text-[0.7rem] text-slate-400">Tur planı</p>
              <p className="text-slate-100 whitespace-pre-wrap">
                {pd.tourPlan?.length ? pd.tourPlan.join("\n") : "—"}
              </p>
            </div>
          </div>

          {/* Request snapshot */}
          {req && (
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-1">
              <p className="text-[0.75rem] text-slate-400">Talep özeti</p>
              <p className="text-slate-100 font-semibold">
                {req.city}{req.district ? ` / ${req.district}` : ""} • {req.dateFrom} – {req.dateTo} • {nights} gece
              </p>
              <p className="text-[0.8rem] text-slate-300">{pax} kişi • {includesLabel(req.include)}</p>
              {req.notes && <p className="text-[0.8rem] text-slate-300">Not: {req.notes}</p>}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-emerald-500 text-slate-950 px-4 py-2 text-[0.85rem] font-semibold hover:bg-emerald-400"
            >
              Kapat
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <p className="text-[0.7rem] text-slate-400">{label}</p>
      <p className="text-slate-100 font-semibold mt-1 whitespace-pre-wrap">{value}</p>
    </div>
  );
}
