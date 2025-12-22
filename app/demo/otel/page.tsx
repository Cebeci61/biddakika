// app/demo/otel/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

/** -------------------- TYPES -------------------- */

type DemoReqType = "hotel" | "group" | "package";
type DealModel = "%8" | "%10" | "%15";

type DemoRequest = {
  id: string;
  type: DemoReqType;

  country: string;
  city: string;
  district?: string;

  checkIn: string;  // YYYY-MM-DD
  checkOut: string; // YYYY-MM-DD
  nights: number;

  adults: number;
  children: number;
  rooms: number;

  board?: "RO" | "BB" | "HB" | "FB" | "AI" | "UAI";
  star?: 3 | 4 | 5 | null;

  features: string[];

  responseWindowMin: number; // 30,45,60,90,120...
  demandScore: number; // 0-100

  note: string;

  // hotel side: suggested model
  dealModel: DealModel;
};

/** -------------------- DEMO DATA BUILDER -------------------- */

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function toISO(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function addDaysISO(base: Date, days: number) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return toISO(d);
}
function pick<T>(arr: T[], seed: number) {
  return arr[seed % arr.length];
}
function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}
function seededRnd(seed0: number) {
  let s = seed0;
  return () => {
    // deterministic-ish
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function buildDemoRequests(count = 70, seed = 20251222): DemoRequest[] {
  const rnd = seededRnd(seed);
  const base = new Date();

  const trCities = [
    { city: "İstanbul", districts: ["Beşiktaş", "Şişli", "Kadıköy", "Üsküdar", "Fatih", "Beyoğlu", "Sarıyer", "Ataşehir"] },
    { city: "Ankara", districts: ["Çankaya", "Keçiören", "Yenimahalle", "Etimesgut", "Mamak"] },
    { city: "İzmir", districts: ["Konak", "Karşıyaka", "Bornova", "Buca", "Çeşme", "Alsancak"] },
    { city: "Antalya", districts: ["Muratpaşa", "Konyaaltı", "Lara", "Alanya", "Kemer", "Belek"] },
    { city: "Trabzon", districts: ["Ortahisar", "Akçaabat", "Yomra", "Sürmene", "Of"] },
    { city: "Muğla", districts: ["Bodrum", "Marmaris", "Fethiye", "Datça"] },
    { city: "Rize", districts: ["Ardeşen", "Çamlıhemşin"] },
    { city: "Bursa", districts: ["Nilüfer", "Osmangazi"] },
    { city: "Mardin", districts: ["Artuklu"] },
    { city: "Samsun", districts: ["Atakum", "İlkadım"] }
  ];

  const intl = [
    { country: "🇦🇪 BAE", city: "Dubai", districts: ["Marina", "Downtown", "JBR"] },
    { country: "🇬🇧 UK", city: "London", districts: ["Soho", "Kensington", "City"] },
    { country: "🇩🇪 Almanya", city: "Berlin", districts: ["Mitte", "Kreuzberg"] },
    { country: "🇫🇷 Fransa", city: "Paris", districts: ["Montmartre", "Le Marais"] }
  ];

  const boards: DemoRequest["board"][] = ["RO", "BB", "HB", "FB", "AI", "UAI"];
  const feats = ["Havuz", "Spa", "Otopark", "Merkez", "Deniz", "Manzara", "Ücretsiz iptal", "Sessiz oda", "VIP transfer", "Aile", "Çocuk dostu"];
  const notes = [
    "Sessiz oda olsun, üst kat tercih.",
    "Geç giriş yapacağız (23:30 sonrası).",
    "Bebek yatağı rica ediyoruz.",
    "Deniz manzarası olursa harika olur.",
    "Ücretsiz iptal önemli.",
    "Araçla geleceğiz, otopark şart.",
    "Havuz + spa öncelikli.",
    "Merkeze yakın olsun, yürüyerek ulaşım."
  ];
  const responseWindows = [30, 45, 60, 90, 120, 180, 240];

  const out: DemoRequest[] = [];

  for (let i = 0; i < count; i++) {
    const type: DemoReqType = i % 5 === 0 ? "group" : i % 3 === 0 ? "package" : "hotel";

    const useIntl = type === "package" && rnd() > 0.65;
    const loc = useIntl ? pick(intl, i * 7) : pick(trCities, i * 5);

    const country = useIntl ? (loc as any).country : "🇹🇷 Türkiye";
    const city = String((loc as any).city);
    const district = pick((loc as any).districts, i * 9);

    const startInDays = 1 + Math.floor(rnd() * 30);
    const nights = 1 + Math.floor(rnd() * (type === "group" ? 5 : 7));
    const checkIn = addDaysISO(base, startInDays);
    const checkOut = addDaysISO(base, startInDays + nights);

    const adults = type === "group" ? 10 + Math.floor(rnd() * 55) : 1 + Math.floor(rnd() * 4);
    const children = type === "group" ? Math.floor(rnd() * 15) : (rnd() > 0.65 ? 1 + Math.floor(rnd() * 2) : 0);
    const rooms = type === "group" ? Math.max(5, Math.floor((adults + children) / 2)) : 1 + (rnd() > 0.75 ? 1 : 0);

    const board = pick(boards, i * 11);
    const star = (rnd() > 0.72 ? 5 : rnd() > 0.45 ? 4 : rnd() > 0.2 ? 3 : null) as any;

    const featureSet = Array.from(new Set([
      pick(feats, i * 3),
      pick(feats, i * 5 + 1),
      rnd() > 0.6 ? pick(feats, i * 7 + 2) : "",
      rnd() > 0.7 ? pick(feats, i * 9 + 3) : ""
    ].filter(Boolean)));

    const demandScore = clamp(Math.floor(40 + rnd() * 60), 0, 100);
    const responseWindowMin = pick(responseWindows, i * 7);

    const dealModel: DealModel = demandScore >= 80 ? "%15" : demandScore >= 60 ? "%10" : "%8";

    out.push({
      id: `demo-${type}-${i}-${Math.floor(rnd() * 9999)}`,
      type,
      country,
      city,
      
      checkIn,
      checkOut,
      nights,
      adults,
      children,
      rooms,
      board,
      star,
      features: featureSet,
      responseWindowMin,
      demandScore,
      note: pick(notes, i * 13),
      dealModel
    });
  }

  // newest first feeling
  return out.reverse();
}

/** -------------------- UI HELPERS -------------------- */

function typeLabel(t: DemoReqType) {
  if (t === "hotel") return "Otel talebi";
  if (t === "group") return "Grup talebi";
  return "Paket talebi";
}
function typeBadge(t: DemoReqType) {
  if (t === "hotel") return "border-emerald-400/25 bg-emerald-500/10 text-emerald-200";
  if (t === "group") return "border-amber-400/25 bg-amber-500/10 text-amber-200";
  return "border-sky-400/25 bg-sky-500/10 text-sky-200";
}
function demandTone(score: number) {
  if (score >= 85) return "text-pink-200";
  if (score >= 65) return "text-amber-200";
  return "text-emerald-200";
}
function dealBadge(model: DealModel) {
  if (model === "%15") return "border-pink-400/25 bg-pink-500/10 text-pink-200";
  if (model === "%10") return "border-amber-400/25 bg-amber-500/10 text-amber-200";
  return "border-emerald-400/25 bg-emerald-500/10 text-emerald-200";
}

function fmtDateTR(iso: string) {
  // ISO -> gg.aa.yyyy
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

/** -------------------- PAGE -------------------- */

export default function DemoHotelInboxPage() {
  const router = useRouter();

  // demo data
  const data = useMemo(() => buildDemoRequests(85, 20251222), []);

  // filters
  const [q, setQ] = useState("");
  const [typeF, setTypeF] = useState<"all" | DemoReqType>("all");
  const [cityF, setCityF] = useState<string>("all");
  const [boardF, setBoardF] = useState<string>("all");
  const [starF, setStarF] = useState<"all" | "3" | "4" | "5">("all");
  const [sortKey, setSortKey] = useState<"demand_desc" | "date_asc" | "rooms_desc" | "response_asc">("demand_desc");

  // auth gate modal (demo)
  const [authModal, setAuthModal] = useState<{ open: boolean; action: string; req?: DemoRequest }>(() => ({
    open: false,
    action: "",
    req: undefined
  }));

  // show count
  const [showCount, setShowCount] = useState(24);

  // cities for filter
  const cities = useMemo(() => {
    const s = new Set<string>();
    data.forEach((r) => s.add(r.city));
    return Array.from(s).sort((a, b) => a.localeCompare(b, "tr"));
  }, [data]);

  const boards = ["RO", "BB", "HB", "FB", "AI", "UAI"];

  const filtered = useMemo(() => {
    const queryText = q.trim().toLowerCase();

    let list = data.filter((r) => {
      // hotel side demo: show all types but can filter
      if (typeF !== "all" && r.type !== typeF) return false;

      if (cityF !== "all" && r.city !== cityF) return false;
      if (boardF !== "all" && (r.board ?? "") !== boardF) return false;
      if (starF !== "all" && String(r.star ?? "") !== starF) return false;

      if (queryText) {
        const hay = [
          r.city,
          r.district ?? "",
          r.country,
          r.note,
          r.type,
          r.board ?? "",
          r.star ? `${r.star}` : "",
          r.features.join(" "),
          r.checkIn,
          r.checkOut
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(queryText)) return false;
      }

      return true;
    });

    list.sort((a, b) => {
      if (sortKey === "demand_desc") return b.demandScore - a.demandScore;
      if (sortKey === "rooms_desc") return b.rooms - a.rooms;
      if (sortKey === "response_asc") return a.responseWindowMin - b.responseWindowMin;
      // date_asc: earliest checkIn first
      return a.checkIn.localeCompare(b.checkIn);
    });

    return list;
  }, [data, q, typeF, cityF, boardF, starF, sortKey]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const hot = filtered.filter((x) => x.demandScore >= 80).length;
    const group = filtered.filter((x) => x.type === "group").length;
    const pkg = filtered.filter((x) => x.type === "package").length;
    return { total, hot, group, pkg };
  }, [filtered]);

  function needAuth(action: string, req?: DemoRequest) {
    setAuthModal({ open: true, action, req });
  }

  return (
    <div className="container-page pb-24">
      {/* Premium bg */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(16,185,129,0.10),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_left,rgba(56,189,248,0.10),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_right,rgba(244,114,182,0.10),transparent_55%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(2,6,23,0.15),rgba(2,6,23,1))]" />
        <div className="absolute inset-0 opacity-[0.06] [background-image:linear-gradient(to_right,rgba(255,255,255,0.10)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.10)_1px,transparent_1px)] [background-size:78px_78px]" />
      </div>

      {/* Header */}
      <section className="pt-6 md:pt-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[0.7rem] text-slate-200">
              🏨 Otel paneli (demo) • 50+ talep
            </div>
            <h1 className="text-2xl md:text-3xl font-semibold text-white">
              Gelen talepler
            </h1>
            <p className="text-sm text-slate-300 max-w-2xl">
              Bu ekran, otelin gerçek paneline birebir benzer. <b>Teklif vermek / mesaj atmak</b> için giriş gerekir.
              Ama önce piyasayı gör, talep kalitesini ölç, sonra kayıt ol.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 w-full lg:w-auto">
            <MiniStat title="Toplam" value={`${stats.total}`} tone="e" />
            <MiniStat title="Sıcak" value={`${stats.hot}`} tone="p" />
            <MiniStat title="Grup" value={`${stats.group}`} tone="a" />
            <MiniStat title="Paket" value={`${stats.pkg}`} tone="s" />
          </div>
        </div>

        {/* Control bar */}
        <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-3 md:p-4 shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
          <div className="grid gap-3 md:grid-cols-12 items-end">
            <div className="md:col-span-4 space-y-1">
              <label className="text-[0.7rem] text-slate-300">Arama</label>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="şehir, ilçe, özellik, not, tarih..."
                className="w-full rounded-xl bg-slate-950/30 border border-white/10 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
              />
            </div>

            <div className="md:col-span-2 space-y-1">
              <label className="text-[0.7rem] text-slate-300">Tür</label>
              <select
                value={typeF}
                onChange={(e) => setTypeF(e.target.value as any)}
                className="w-full rounded-xl bg-slate-950/30 border border-white/10 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
              >
                <option value="all">Hepsi</option>
                <option value="hotel">Otel</option>
                <option value="group">Grup</option>
                <option value="package">Paket</option>
              </select>
            </div>

            <div className="md:col-span-2 space-y-1">
              <label className="text-[0.7rem] text-slate-300">Şehir</label>
              <select
                value={cityF}
                onChange={(e) => setCityF(e.target.value)}
                className="w-full rounded-xl bg-slate-950/30 border border-white/10 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
              >
                <option value="all">Hepsi</option>
                {cities.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2 space-y-1">
              <label className="text-[0.7rem] text-slate-300">Board</label>
              <select
                value={boardF}
                onChange={(e) => setBoardF(e.target.value)}
                className="w-full rounded-xl bg-slate-950/30 border border-white/10 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
              >
                <option value="all">Hepsi</option>
                {boards.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2 space-y-1">
              <label className="text-[0.7rem] text-slate-300">Yıldız</label>
              <select
                value={starF}
                onChange={(e) => setStarF(e.target.value as any)}
                className="w-full rounded-xl bg-slate-950/30 border border-white/10 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
              >
                <option value="all">Hepsi</option>
                <option value="5">5★</option>
                <option value="4">4★</option>
                <option value="3">3★</option>
              </select>
            </div>

            <div className="md:col-span-6 flex flex-wrap items-center gap-2">
              <span className="text-[0.75rem] text-slate-400">Sırala</span>
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as any)}
                className="rounded-xl bg-slate-950/30 border border-white/10 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
              >
                <option value="demand_desc">Yoğunluk (yüksek→düşük)</option>
                <option value="date_asc">Giriş tarihi (yakın→uzak)</option>
                <option value="rooms_desc">Oda sayısı (çok→az)</option>
                <option value="response_asc">Cevap süresi (kısa→uzun)</option>
              </select>

              <button
                type="button"
                onClick={() => {
                  setQ("");
                  setTypeF("all");
                  setCityF("all");
                  setBoardF("all");
                  setStarF("all");
                  setSortKey("demand_desc");
                  setShowCount(24);
                }}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 hover:bg-white/10"
              >
                Temizle
              </button>
            </div>

            <div className="md:col-span-6 flex items-center justify-between">
              <p className="text-[0.75rem] text-slate-400">
                Sonuç: <span className="text-white font-semibold">{filtered.length}</span>
              </p>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowCount((v) => Math.min(v + 12, filtered.length))}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 hover:bg-white/10 disabled:opacity-50"
                  disabled={showCount >= filtered.length}
                >
                  Daha fazla
                </button>
                <button
                  type="button"
                  onClick={() => setShowCount(24)}
                  className="rounded-xl border border-white/10 bg-white/0 px-3 py-2 text-sm text-slate-100 hover:bg-white/5"
                >
                  Başa dön
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* List */}
      <section className="mt-5 grid gap-3 md:grid-cols-2">
        {filtered.slice(0, showCount).map((r) => {
          const childrenN = Number(r.children ?? 0);
          const roomsN = Number(r.rooms ?? 1);
          const starText = r.star ? `${r.star}★` : "—";

          const featuresPreview = (r.features ?? []).slice(0, 4).join(" • ");
          const extraCount = Math.max(0, (r.features?.length ?? 0) - 4);

          return (
            <div
              key={r.id}
              className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-4 shadow-[0_18px_60px_rgba(0,0,0,0.30)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[0.72rem] ${typeBadge(r.type)}`}>
                      {typeLabel(r.type)}
                    </span>
                    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[0.72rem] ${dealBadge(r.dealModel)}`}>
                      model: {r.dealModel}
                    </span>
                  </div>

                  <p className="text-slate-100 font-semibold truncate">
                    {r.country !== "🇹🇷 Türkiye" ? `${r.country} • ` : ""}
                    {r.city}{r.district ? ` / ${r.district}` : ""} • {fmtDateTR(r.checkIn)} → {fmtDateTR(r.checkOut)}
                    <span className="text-slate-400"> ({r.nights} gece)</span>
                  </p>

                  {/* ✅ FIXED: JSX template hataları yok */}
                  <p className="text-[0.82rem] text-slate-300">
                    <span>{r.adults} yetişkin</span>
                    {childrenN > 0 ? <span> • {childrenN} çocuk</span> : null}
                    <span> • {roomsN} oda</span>
                    {r.board ? <span> • {r.board}</span> : null}
                    {r.star ? <span> • {starText}</span> : null}
                  </p>

                  <p className="text-[0.75rem] text-slate-400">
                    Özellikler:{" "}
                    <span className="text-slate-200">
                      {featuresPreview || "—"}
                      {extraCount > 0 ? ` • +${extraCount}` : ""}
                    </span>
                  </p>

                  <p className="text-[0.75rem] text-slate-400">
                    Cevap penceresi:{" "}
                    <span className="text-emerald-200 font-semibold">{r.responseWindowMin} dk</span>
                    {" • "}
                    Yoğunluk:{" "}
                    <span className={`font-semibold ${demandTone(r.demandScore)}`}>{r.demandScore}/100</span>
                  </p>

                  <p className="text-[0.75rem] text-slate-400">
                    Not: <span className="text-slate-200">{r.note}</span>
                  </p>
                </div>

                <div className="flex flex-col gap-2 min-w-[160px]">
                  <button
                    type="button"
                    onClick={() => needAuth("Teklif ver", r)}
                    className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
                  >
                    Teklif ver
                  </button>
                  <button
                    type="button"
                    onClick={() => needAuth("Detay", r)}
                    className="rounded-xl border border-white/10 bg-white/0 px-4 py-2 text-sm text-slate-100 hover:bg-white/5"
                  >
                    Detay
                  </button>
                  <button
                    type="button"
                    onClick={() => needAuth("Mesaj", r)}
                    className="rounded-xl border border-white/10 bg-white/0 px-4 py-2 text-sm text-slate-100 hover:bg-white/5"
                  >
                    Mesaj
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </section>

      {/* bottom CTA */}
      <section className="mt-6 rounded-2xl border border-white/10 bg-gradient-to-r from-emerald-500/12 via-sky-500/8 to-pink-500/8 p-5 backdrop-blur flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <p className="text-white font-semibold">Bu sadece demo.</p>
          <p className="text-sm text-slate-200/85">
            Gerçek panelde: filtreler + pazarlık + teklif güncelleme + rezervasyon akışı + raporlar var.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => router.push("/auth/register")}
            className="rounded-full bg-emerald-500 px-5 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
          >
            Otel olarak kayıt ol
          </button>
          <button
            onClick={() => router.push("/auth/login")}
            className="rounded-full border border-white/10 bg-white/0 px-5 py-2 text-sm font-semibold text-white hover:bg-white/5"
          >
            Giriş yap
          </button>
        </div>
      </section>

      {/* Auth modal */}
      {authModal.open && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-950/90 backdrop-blur p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-white font-semibold">Bu işlem için giriş gerekli</p>
                <p className="text-sm text-slate-300">
                  <span className="text-emerald-200 font-semibold">{authModal.action}</span> yapmak için otel hesabınla giriş yapmalısın.
                </p>
              </div>
              <button
                onClick={() => setAuthModal({ open: false, action: "", req: undefined })}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
              >
                ✕
              </button>
            </div>

            {authModal.req ? (
              <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-[0.75rem] text-slate-300">Seçili talep</p>
                <p className="text-sm text-white font-semibold">
                  {authModal.req.city}{authModal.req.district ? ` / ${authModal.req.district}` : ""} • {fmtDateTR(authModal.req.checkIn)} → {fmtDateTR(authModal.req.checkOut)}
                </p>
                <p className="text-[0.75rem] text-slate-300">
                  {authModal.req.adults} yetişkin{authModal.req.children ? ` • ${authModal.req.children} çocuk` : ""} • {authModal.req.rooms} oda
                </p>
              </div>
            ) : null}

            <div className="mt-4 grid gap-2">
              <button
                onClick={() => router.push("/auth/login")}
                className="w-full rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
              >
                Giriş yap
              </button>
              <button
                onClick={() => router.push("/auth/register")}
                className="w-full rounded-xl border border-white/10 bg-white/0 px-4 py-3 text-sm font-semibold text-white hover:bg-white/5"
              >
                Kayıt ol
              </button>
              <button
                onClick={() => setAuthModal({ open: false, action: "", req: undefined })}
                className="w-full rounded-xl border border-white/10 bg-white/0 px-4 py-3 text-sm text-slate-200 hover:bg-white/5"
              >
                Şimdilik sadece izle
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** -------------------- SMALL UI -------------------- */

function MiniStat({ title, value, tone }: { title: string; value: string; tone: "e" | "s" | "p" | "a" }) {
  const ring =
    tone === "e" ? "ring-emerald-400/15" :
    tone === "s" ? "ring-sky-400/15" :
    tone === "p" ? "ring-pink-400/15" :
    "ring-amber-300/15";

  return (
    <div className={`rounded-2xl border border-white/10 bg-white/5 px-3 py-2 ring-1 ${ring}`}>
      <p className="text-[0.65rem] text-slate-400">{title}</p>
      <p className="text-sm font-extrabold text-white">{value}</p>
    </div>
  );
}
