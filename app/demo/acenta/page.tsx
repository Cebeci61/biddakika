// app/demo/acenta/page.tsx
"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

/** -------------------- TYPES -------------------- */

type DemoReqType = "hotel" | "group" | "package";
type DealModel = "%8" | "%10" | "%15";
type TransferType = "none" | "oneway" | "round";

type DemoRequest = {
  id: string;
  type: DemoReqType;

  country: string;
  city: string;
  district?: string;

  checkIn: string; // YYYY-MM-DD
  checkOut: string;
  nights: number;

  adults: number;
  children: number;
  rooms: number;

  board?: "RO" | "BB" | "HB" | "FB" | "AI" | "UAI";
  star?: 3 | 4 | 5 | null;

  features: string[];

  responseWindowMin: number;
  demandScore: number;

  note: string;
  dealModel: DealModel;

  // Agency-specific preview fields (package-style thinking)
  wantsTransfer: boolean;
  transferType: TransferType;
  wantsTours: boolean;
  tourCount: number;
  wantsCar: boolean;
  carType?: "eco" | "standard" | "suv" | "vip" | "van";
  extras: string[];
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
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function buildDemoRequests(count = 85, seed = 20251222): DemoRequest[] {
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
    { country: "🇫🇷 Fransa", city: "Paris", districts: ["Montmartre", "Le Marais"] },
    { country: "🇸🇦 KSA", city: "Riyadh", districts: ["Olaya", "Diplomatic Quarter"] }
  ];

  const boards: DemoRequest["board"][] = ["RO", "BB", "HB", "FB", "AI", "UAI"];
  const feats = ["Havuz", "Spa", "Otopark", "Merkez", "Deniz", "Manzara", "Ücretsiz iptal", "Sessiz oda", "VIP transfer", "Aile", "Çocuk dostu"];
  const extras = ["Rehber", "Sigorta", "Özel tur", "Müze kart", "Tekne turu", "Akşam etkinliği", "VIP karşılama", "Erken check-in"];
  const notes = [
    "Turu sabah erken başlatmak istiyoruz.",
    "VIP araç olursa fiyat daha yüksek olabilir.",
    "Çocuklar için aktivite önerisi lazım.",
    "Uçuş saatine göre transfer planlansın.",
    "Otelde sessiz oda + manzara mümkünse.",
    "Fatura şirket adına kesilsin.",
    "Kısa sürede teklif bekliyoruz."
  ];
  const responseWindows = [30, 45, 60, 90, 120, 180, 240];

  const carTypes: NonNullable<DemoRequest["carType"]>[] = ["eco", "standard", "suv", "vip", "van"];

  const out: DemoRequest[] = [];

  for (let i = 0; i < count; i++) {
    // agency demo: package ağırlıklı + araya hotel/group da karışsın
    const type: DemoReqType = i % 2 === 0 ? "package" : i % 7 === 0 ? "group" : "hotel";

    const useIntl = type === "package" && rnd() > 0.55;
    const loc = useIntl ? pick(intl, i * 7) : pick(trCities, i * 5);

    const country = useIntl ? (loc as any).country : "🇹🇷 Türkiye";
    const city = String((loc as any).city);
    const district = pick((loc as any).districts, i * 9);

    const startInDays = 1 + Math.floor(rnd() * 40);
    const nights = 2 + Math.floor(rnd() * (type === "group" ? 6 : 9));
    const checkIn = addDaysISO(base, startInDays);
    const checkOut = addDaysISO(base, startInDays + nights);

    const adults = type === "group" ? 12 + Math.floor(rnd() * 60) : 1 + Math.floor(rnd() * 4);
    const children = type === "group" ? Math.floor(rnd() * 20) : (rnd() > 0.55 ? 1 + Math.floor(rnd() * 2) : 0);
    const rooms = type === "group" ? Math.max(6, Math.floor((adults + children) / 2)) : 1 + (rnd() > 0.7 ? 1 : 0);

    const board = pick(boards, i * 11);
    const star = (rnd() > 0.68 ? 5 : rnd() > 0.42 ? 4 : rnd() > 0.18 ? 3 : null) as any;

    const featureSet = Array.from(new Set([
      pick(feats, i * 3),
      pick(feats, i * 5 + 1),
      rnd() > 0.55 ? pick(feats, i * 7 + 2) : "",
      rnd() > 0.68 ? pick(feats, i * 9 + 3) : ""
    ].filter(Boolean)));

    const demandScore = clamp(Math.floor(35 + rnd() * 65), 0, 100);
    const responseWindowMin = pick(responseWindows, i * 7);

    const dealModel: DealModel = demandScore >= 80 ? "%15" : demandScore >= 60 ? "%10" : "%8";

    const wantsTransfer = type === "package" ? rnd() > 0.25 : rnd() > 0.55;
    const transferType: TransferType = !wantsTransfer ? "none" : (rnd() > 0.55 ? "round" : "oneway");

    const wantsTours = type === "package" ? rnd() > 0.35 : rnd() > 0.7;
    const tourCount = wantsTours ? 1 + Math.floor(rnd() * 4) : 0;

    const wantsCar = type === "package" ? rnd() > 0.55 : rnd() > 0.8;
    const carType = wantsCar ? pick(carTypes, i * 13) : undefined;

    const extrasPick = Array.from(new Set([
      rnd() > 0.35 ? pick(extras, i * 2) : "",
      rnd() > 0.55 ? pick(extras, i * 4 + 1) : "",
      rnd() > 0.75 ? pick(extras, i * 6 + 2) : ""
    ].filter(Boolean)));

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
      dealModel,
      wantsTransfer,
      transferType,
      wantsTours,
      tourCount,
      wantsCar,
      carType,
      extras: extrasPick
    });
  }

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
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}
function carLabel(c?: DemoRequest["carType"]) {
  if (!c) return "—";
  if (c === "eco") return "Ekonomik";
  if (c === "standard") return "Standart";
  if (c === "suv") return "SUV / Jeep";
  if (c === "vip") return "VIP";
  return "Minivan";
}
function transferLabel(t: TransferType) {
  if (t === "none") return "Yok";
  if (t === "oneway") return "Tek yön";
  return "Çift yön";
}

/** -------------------- PAGE -------------------- */

export default function DemoAgencyInboxPage() {
  const router = useRouter();

  const data = useMemo(() => buildDemoRequests(95, 20251222), []);

  // Agency cares: package + group more important; show all but allow filtering
  const [q, setQ] = useState("");
  const [typeF, setTypeF] = useState<"all" | DemoReqType>("all");
  const [countryF, setCountryF] = useState<string>("all");
  const [cityF, setCityF] = useState<string>("all");
  const [transferF, setTransferF] = useState<"all" | "yes" | "no">("all");
  const [carF, setCarF] = useState<"all" | "yes" | "no">("all");
  const [sortKey, setSortKey] = useState<"demand_desc" | "date_asc" | "pax_desc" | "response_asc">("demand_desc");

  const [authModal, setAuthModal] = useState<{ open: boolean; action: string; req?: DemoRequest }>(() => ({
    open: false,
    action: "",
    req: undefined
  }));

  const [showCount, setShowCount] = useState(24);

  const countries = useMemo(() => {
    const s = new Set<string>();
    data.forEach((r) => s.add(r.country));
    return Array.from(s);
  }, [data]);

  const cities = useMemo(() => {
    const s = new Set<string>();
    data.forEach((r) => s.add(r.city));
    return Array.from(s).sort((a, b) => a.localeCompare(b, "tr"));
  }, [data]);

  const filtered = useMemo(() => {
    const queryText = q.trim().toLowerCase();

    let list = data.filter((r) => {
      if (typeF !== "all" && r.type !== typeF) return false;
      if (countryF !== "all" && r.country !== countryF) return false;
      if (cityF !== "all" && r.city !== cityF) return false;

      if (transferF !== "all") {
        const has = r.wantsTransfer;
        if (transferF === "yes" && !has) return false;
        if (transferF === "no" && has) return false;
      }

      if (carF !== "all") {
        const has = r.wantsCar;
        if (carF === "yes" && !has) return false;
        if (carF === "no" && has) return false;
      }

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
          r.extras.join(" "),
          r.wantsTransfer ? "transfer" : "",
          r.wantsTours ? "tur" : "",
          r.wantsCar ? "arac" : "",
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
      if (sortKey === "pax_desc") return (b.adults + b.children) - (a.adults + a.children);
      if (sortKey === "response_asc") return a.responseWindowMin - b.responseWindowMin;
      return a.checkIn.localeCompare(b.checkIn);
    });

    return list;
  }, [data, q, typeF, countryF, cityF, transferF, carF, sortKey]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const intl = filtered.filter((x) => x.country !== "🇹🇷 Türkiye").length;
    const pkg = filtered.filter((x) => x.type === "package").length;
    const grp = filtered.filter((x) => x.type === "group").length;
    const hot = filtered.filter((x) => x.demandScore >= 80).length;
    return { total, intl, pkg, grp, hot };
  }, [filtered]);

  function needAuth(action: string, req?: DemoRequest) {
    setAuthModal({ open: true, action, req });
  }

  return (
    <div className="container-page pb-24">
      {/* Premium bg */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(56,189,248,0.10),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_left,rgba(16,185,129,0.08),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_right,rgba(244,114,182,0.08),transparent_55%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(2,6,23,0.15),rgba(2,6,23,1))]" />
        <div className="absolute inset-0 opacity-[0.06] [background-image:linear-gradient(to_right,rgba(255,255,255,0.10)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.10)_1px,transparent_1px)] [background-size:78px_78px]" />
      </div>

      {/* Header */}
      <section className="pt-6 md:pt-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[0.7rem] text-slate-200">
              🧳 Acenta paneli (demo) • 50+ paket/grup
            </div>
            <h1 className="text-2xl md:text-3xl font-semibold text-white">
              Paket talepleri & gelen ihtiyaçlar
            </h1>
            <p className="text-sm text-slate-300 max-w-2xl">
              Bu ekran acenta için: <b>otel + transfer + tur + araç</b> kırılımını hızlı görürsün.
              Teklif oluşturmak için giriş gerekir.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 w-full lg:w-auto">
            <MiniStat title="Toplam" value={`${stats.total}`} tone="e" />
            <MiniStat title="Yurtdışı" value={`${stats.intl}`} tone="s" />
            <MiniStat title="Paket" value={`${stats.pkg}`} tone="s" />
            <MiniStat title="Grup" value={`${stats.grp}`} tone="a" />
            <MiniStat title="Sıcak" value={`${stats.hot}`} tone="p" />
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
                placeholder="ülke, şehir, extra, tur, transfer, not..."
                className="w-full rounded-xl bg-slate-950/30 border border-white/10 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400"
              />
            </div>

            <div className="md:col-span-2 space-y-1">
              <label className="text-[0.7rem] text-slate-300">Tür</label>
              <select
                value={typeF}
                onChange={(e) => setTypeF(e.target.value as any)}
                className="w-full rounded-xl bg-slate-950/30 border border-white/10 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400"
              >
                <option value="all">Hepsi</option>
                <option value="package">Paket</option>
                <option value="group">Grup</option>
                <option value="hotel">Otel</option>
              </select>
            </div>

            <div className="md:col-span-2 space-y-1">
              <label className="text-[0.7rem] text-slate-300">Ülke</label>
              <select
                value={countryF}
                onChange={(e) => setCountryF(e.target.value)}
                className="w-full rounded-xl bg-slate-950/30 border border-white/10 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400"
              >
                <option value="all">Hepsi</option>
                {countries.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2 space-y-1">
              <label className="text-[0.7rem] text-slate-300">Şehir</label>
              <select
                value={cityF}
                onChange={(e) => setCityF(e.target.value)}
                className="w-full rounded-xl bg-slate-950/30 border border-white/10 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400"
              >
                <option value="all">Hepsi</option>
                {cities.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-1 space-y-1">
              <label className="text-[0.7rem] text-slate-300">Transfer</label>
              <select
                value={transferF}
                onChange={(e) => setTransferF(e.target.value as any)}
                className="w-full rounded-xl bg-slate-950/30 border border-white/10 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400"
              >
                <option value="all">Hepsi</option>
                <option value="yes">Var</option>
                <option value="no">Yok</option>
              </select>
            </div>

            <div className="md:col-span-1 space-y-1">
              <label className="text-[0.7rem] text-slate-300">Araç</label>
              <select
                value={carF}
                onChange={(e) => setCarF(e.target.value as any)}
                className="w-full rounded-xl bg-slate-950/30 border border-white/10 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400"
              >
                <option value="all">Hepsi</option>
                <option value="yes">Var</option>
                <option value="no">Yok</option>
              </select>
            </div>

            <div className="md:col-span-6 flex flex-wrap items-center gap-2">
              <span className="text-[0.75rem] text-slate-400">Sırala</span>
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as any)}
                className="rounded-xl bg-slate-950/30 border border-white/10 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400"
              >
                <option value="demand_desc">Yoğunluk (yüksek→düşük)</option>
                <option value="date_asc">Giriş tarihi (yakın→uzak)</option>
                <option value="pax_desc">Kişi (çok→az)</option>
                <option value="response_asc">Cevap süresi (kısa→uzun)</option>
              </select>

              <button
                type="button"
                onClick={() => {
                  setQ("");
                  setTypeF("all");
                  setCountryF("all");
                  setCityF("all");
                  setTransferF("all");
                  setCarF("all");
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
          const pax = r.adults + r.children;

          const featuresPreview = (r.features ?? []).slice(0, 4).join(" • ");
          const extraFeat = Math.max(0, (r.features?.length ?? 0) - 4);

          const extrasPreview = (r.extras ?? []).slice(0, 3).join(" • ");
          const extraExtras = Math.max(0, (r.extras?.length ?? 0) - 3);

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
                    <span className="inline-flex items-center rounded-full border border-white/10 bg-black/10 px-3 py-1 text-[0.72rem] text-slate-200">
                      👥 {pax} kişi
                    </span>
                  </div>

                  <p className="text-slate-100 font-semibold truncate">
                    {r.country !== "🇹🇷 Türkiye" ? `${r.country} • ` : ""}
                    {r.city}{r.district ? ` / ${r.district}` : ""} • {fmtDateTR(r.checkIn)} → {fmtDateTR(r.checkOut)}
                    <span className="text-slate-400"> ({r.nights} gece)</span>
                  </p>

                  {/* ✅ template hatası yok */}
                  <p className="text-[0.82rem] text-slate-300">
                    <span>{r.adults} yetişkin</span>
                    {childrenN > 0 ? <span> • {childrenN} çocuk</span> : null}
                    <span> • {roomsN} oda</span>
                    {r.board ? <span> • {r.board}</span> : null}
                    {r.star ? <span> • {starText}</span> : null}
                  </p>

                  <p className="text-[0.75rem] text-slate-400">
                    Paket içeriği:{" "}
                    <span className="text-slate-200">
                      {r.wantsTransfer ? `Transfer (${transferLabel(r.transferType)})` : "Transfer yok"}
                      {" • "}
                      {r.wantsTours ? `${r.tourCount} tur` : "Tur yok"}
                      {" • "}
                      {r.wantsCar ? `Araç (${carLabel(r.carType)})` : "Araç yok"}
                    </span>
                  </p>

                  <p className="text-[0.75rem] text-slate-400">
                    Özellikler:{" "}
                    <span className="text-slate-200">
                      {featuresPreview || "—"}
                      {extraFeat > 0 ? ` • +${extraFeat}` : ""}
                    </span>
                  </p>

                  <p className="text-[0.75rem] text-slate-400">
                    Ekstralar:{" "}
                    <span className="text-slate-200">
                      {extrasPreview || "—"}
                      {extraExtras > 0 ? ` • +${extraExtras}` : ""}
                    </span>
                  </p>

                  <p className="text-[0.75rem] text-slate-400">
                    Cevap penceresi:{" "}
                    <span className="text-sky-200 font-semibold">{r.responseWindowMin} dk</span>
                    {" • "}
                    Yoğunluk:{" "}
                    <span className={`font-semibold ${demandTone(r.demandScore)}`}>{r.demandScore}/100</span>
                  </p>

                  <p className="text-[0.75rem] text-slate-400">
                    Not: <span className="text-slate-200">{r.note}</span>
                  </p>
                </div>

                <div className="flex flex-col gap-2 min-w-[180px]">
                  <button
                    type="button"
                    onClick={() => needAuth("Paket teklifi oluştur", r)}
                    className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400"
                  >
                    Paket teklifi oluştur
                  </button>
                  <button
                    type="button"
                    onClick={() => needAuth("Detay / Kırılım", r)}
                    className="rounded-xl border border-white/10 bg-white/0 px-4 py-2 text-sm text-slate-100 hover:bg-white/5"
                  >
                    Detay / Kırılım
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
      <section className="mt-6 rounded-2xl border border-white/10 bg-gradient-to-r from-sky-500/14 via-emerald-500/8 to-pink-500/8 p-5 backdrop-blur flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <p className="text-white font-semibold">Acenta için gerçek iş burada başlıyor.</p>
          <p className="text-sm text-slate-200/85">
            Teklif kırılımı, maliyet kalemleri, kar marjı ve raporlar girişten sonra açılır.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => router.push("/auth/register")}
            className="rounded-full bg-sky-500 px-5 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400"
          >
            Acenta olarak kayıt ol
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
                  <span className="text-sky-200 font-semibold">{authModal.action}</span> yapmak için acenta hesabınla giriş yapmalısın.
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
                  Paket:{" "}
                  {authModal.req.wantsTransfer ? `Transfer(${transferLabel(authModal.req.transferType)})` : "Transfer yok"} •{" "}
                  {authModal.req.wantsTours ? `${authModal.req.tourCount} tur` : "Tur yok"} •{" "}
                  {authModal.req.wantsCar ? `Araç(${carLabel(authModal.req.carType)})` : "Araç yok"}
                </p>
              </div>
            ) : null}

            <div className="mt-4 grid gap-2">
              <button
                onClick={() => router.push("/auth/login")}
                className="w-full rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-sky-400"
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
