// app/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

type Role = "guest" | "hotel" | "agency" | "admin";
type FeedTone = "emerald" | "amber" | "sky" | "pink" | "slate";
type FeedType =
  | "request"
  | "offer"
  | "counter"
  | "accept"
  | "package"
  | "agencyOffer"
  | "message"
  | "update"
  | "payment"
  | "deadline";

type FeedItem = {
  id: string;
  type: FeedType;
  tone: FeedTone;
  title: string;
  subtitle: string;
  badge: string;
  amount?: string;
  timeAgo: string;
};

function pick<T>(arr: T[], seed: number) {
  return arr[seed % arr.length];
}
function fmtTL(n: number) {
  return `${n.toLocaleString("tr-TR")} TL`;
}
function agoFromMinutes(m: number) {
  if (m < 1) return "şimdi";
  if (m < 60) return `${m} dk önce`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h < 24) return r ? `${h} sa ${r} dk önce` : `${h} sa önce`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d} gün ${rh} sa önce` : `${d} gün önce`;
}
function shuffle<T>(arr: T[], seed = 42) {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function badgeTone(type: FeedType): FeedTone {
  if (type === "request") return "emerald";
  if (type === "offer") return "amber";
  if (type === "counter") return "pink";
  if (type === "update") return "sky";
  if (type === "accept") return "emerald";
  if (type === "package") return "slate";
  if (type === "agencyOffer") return "sky";
  if (type === "payment") return "emerald";
  if (type === "deadline") return "amber";
  return "slate";
}

function iconFor(type: FeedType) {
  if (type === "request") return "🎒";
  if (type === "offer") return "🏨";
  if (type === "counter") return "💬";
  if (type === "update") return "🔁";
  if (type === "accept") return "✅";
  if (type === "payment") return "💳";
  if (type === "package") return "🧳";
  if (type === "agencyOffer") return "🧾";
  if (type === "deadline") return "⏱️";
  return "💡";
}

function buildFeed(): FeedItem[] {
  const cities = [
    "Antalya","İstanbul","Trabzon","Rize","Muğla","İzmir","Kapadokya","Bursa","Ankara","Fethiye",
    "Alanya","Kaş","Bodrum","Marmaris","Uzungöl","Sapanca","Datça","Alaçatı","Kemer","Side",
    "Eskişehir","Gaziantep","Mardin","Samsun","Amasra","Bozcaada","Çanakkale","Urla","Kuşadası","Pamukkale"
  ];
  const districts = [
    "Konyaaltı","Beşiktaş","Ortahisar","Kaş","Çeşme","Nilüfer","Çankaya","Ardeşen","Artuklu","Göreme",
    "Kadıköy","Muratpaşa","Sarıyer","Osmangazi","Ataşehir","Beyoğlu","Bodrum Merkez","Akyaka","Kalkan",
    "Ürgüp","Seferihisar","Konak","Atakum","İlkadım"
  ];
  const board = ["RO", "BB", "HB", "FB", "AI", "UAI"];
  const features = [
    "Havuz","Merkez","Deniz","Spa","Otopark","Aile","Manzara","Ücretsiz iptal","VIP transfer","Şehir turu",
    "Erken giriş","Geç çıkış","Sessiz oda","Suit upgrade","Çocuk dostu"
  ];
  const pkgBits = ["Otel", "Transfer", "Tur", "Rehber", "Sigorta", "Uçak bileti"];
  const dealBadges = ["%8 Standart", "%10 Yenilenebilir", "%15 Pazarlıklı"];
  const msgSnippets = [
    "“Geç giriş mümkün mü?” → “Evet, not aldık ✅”",
    "“Bebek yatağı ekler misiniz?” → “Hazır ✅”",
    "“Deniz manzarası var mı?” → “Uygun oda seçildi ✅”",
    "“İptal şartı nedir?” → “48 saate kadar ücretsiz ✅”",
    "“Transfer tek yön olsun” → “Tamamlandı ✅”",
    "“Fatura şirket adına” → “Bilgiler alındı ✅”",
    "“Sessiz oda” → “Üst kat ayrıldı ✅”"
  ];

  const out: FeedItem[] = [];
  for (let i = 0; i < 260; i++) {
    const city = pick(cities, i * 7 + 3);
    const district = pick(districts, i * 5 + 1);
    const b = pick(board, i * 13 + 6);
    const feat1 = pick(features, i * 17 + 1);
    const feat2 = pick(features, i * 19 + 2);

    const nights = 1 + (i % 7);
    const adults = 1 + (i % 4);
    const kids = i % 6 === 0 ? 1 : i % 11 === 0 ? 2 : 0;

    const base = 4200 + (i % 11) * 980 + nights * 880 + adults * 540 + kids * 310;
    const offer = Math.round(base * (1.05 + ((i % 3) * 0.02)));
    const counter = Math.round(offer * (0.92 + (i % 5) * 0.01));
    const updated = Math.round(offer * (0.98 + (i % 4) * 0.01));
    const accepted = Math.round(counter * (1 + ((i % 2) * 0.01)));
    const pkgOffer = Math.round(base * (1.22 + (i % 4) * 0.02));

    const timeAgo = agoFromMinutes(1 + (i * 9) % 1440);
    const modeBadge = pick(dealBadges, i * 3 + 2);

    const kind: FeedType =
      i % 10 === 0 ? "request" :
      i % 10 === 1 ? "offer" :
      i % 10 === 2 ? "counter" :
      i % 10 === 3 ? "update" :
      i % 10 === 4 ? "payment" :
      i % 10 === 5 ? "accept" :
      i % 10 === 6 ? "package" :
      i % 10 === 7 ? "agencyOffer" :
      i % 10 === 8 ? "deadline" :
      "message";

    const titleBase = `${iconFor(kind)} ${city} / ${district}`;

    if (kind === "request") {
      out.push({
        id: `f-${i}`,
        type: kind,
        tone: badgeTone(kind),
        title: `${titleBase} • Talep açıldı`,
        subtitle: `${nights} gece • ${adults} yetişkin${kids ? ` • ${kids} çocuk` : ""} • ${feat1} • ${b}`,
        badge: "Talep",
        timeAgo
      });
    } else if (kind === "offer") {
      out.push({
        id: `f-${i}`,
        type: kind,
        tone: badgeTone(kind),
        title: `🏨 Otel teklifi geldi`,
        subtitle: `${city} • ${b} • ${feat1} • ${feat2}`,
        badge: modeBadge,
        amount: fmtTL(offer),
        timeAgo
      });
    } else if (kind === "counter") {
      out.push({
        id: `f-${i}`,
        type: kind,
        tone: badgeTone(kind),
        title: `💬 Pazarlık açıldı`,
        subtitle: `${city} • Misafir ${fmtTL(counter)} teklif etti`,
        badge: "Karşı teklif",
        amount: fmtTL(counter),
        timeAgo
      });
    } else if (kind === "update") {
      out.push({
        id: `f-${i}`,
        type: kind,
        tone: badgeTone(kind),
        title: `🔁 Otel güncelledi`,
        subtitle: `${city} • Yeni fiyat • ${feat2}`,
        badge: "Güncelleme",
        amount: fmtTL(updated),
        timeAgo
      });
    } else if (kind === "payment") {
      out.push({
        id: `f-${i}`,
        type: kind,
        tone: badgeTone(kind),
        title: `💳 Ödeme adımı`,
        subtitle: `${city} • Onay bekliyor / tamamlandı`,
        badge: "Ödeme",
        amount: fmtTL(accepted),
        timeAgo
      });
    } else if (kind === "accept") {
      out.push({
        id: `f-${i}`,
        type: kind,
        tone: badgeTone(kind),
        title: `✅ Rezervasyon onaylandı`,
        subtitle: `${city} • ${nights} gece • ${b}`,
        badge: "Rezervasyon",
        amount: fmtTL(accepted),
        timeAgo
      });
    } else if (kind === "package") {
      const bits = Array.from({ length: 3 + (i % 3) }, (_, k) => pick(pkgBits, i * 7 + k));
      const uniq = Array.from(new Set(bits));
      out.push({
        id: `f-${i}`,
        type: kind,
        tone: badgeTone(kind),
        title: `🧳 Paket talebi`,
        subtitle: `${city} • ${nights} gece • ${uniq.join(" + ")} • ${adults + kids} kişi`,
        badge: "Paket",
        timeAgo
      });
    } else if (kind === "agencyOffer") {
      out.push({
        id: `f-${i}`,
        type: kind,
        tone: badgeTone(kind),
        title: `🧳 Acenta paketi fiyatladı`,
        subtitle: `${city} • Otel + Transfer + Tur`,
        badge: "Teklif",
        amount: fmtTL(pkgOffer),
        timeAgo
      });
    } else if (kind === "deadline") {
      const mins = 15 + (i % 55);
      out.push({
        id: `f-${i}`,
        type: kind,
        tone: badgeTone(kind),
        title: `⏱️ Süre`,
        subtitle: `Teklif penceresi açık • ${mins} dk içinde yanıt`,
        badge: "Cevap süresi",
        timeAgo
      });
    } else {
      out.push({
        id: `f-${i}`,
        type: kind,
        tone: badgeTone(kind),
        title: `💡 Not`,
        subtitle: pick(msgSnippets, i * 9 + 1),
        badge: "Mesaj",
        timeAgo
      });
    }
  }

  return shuffle(out, 20251219);
}

function Badge({ tone, children }: { tone: FeedTone; children: React.ReactNode }) {
  const cls =
    tone === "emerald"
      ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-100"
      : tone === "amber"
      ? "border-amber-300/25 bg-amber-400/10 text-amber-100"
      : tone === "sky"
      ? "border-sky-300/25 bg-sky-400/10 text-sky-100"
      : tone === "pink"
      ? "border-pink-300/25 bg-pink-400/10 text-pink-100"
      : "border-white/10 bg-white/5 text-slate-200";

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.65rem] ${cls}`}>
      {children}
    </span>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[0.7rem] text-slate-200">
      {children}
    </span>
  );
}

function StatCard({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: "e" | "s" | "p" | "a" }) {
  const ring =
    tone === "e" ? "ring-emerald-400/15" :
    tone === "s" ? "ring-sky-400/15" :
    tone === "p" ? "ring-pink-400/15" :
    "ring-amber-300/15";

  return (
    <div className={`rounded-2xl border border-white/10 bg-white/5 px-4 py-3 ring-1 ${ring} shadow-[0_18px_60px_rgba(0,0,0,0.35)]`}>
      <p className="text-[0.7rem] text-slate-400">{label}</p>
      <p className="mt-0.5 text-lg font-extrabold text-white">{value}</p>
      <p className="mt-1 text-[0.7rem] text-slate-400">{hint}</p>
    </div>
  );
}

function HeatDot({ left, top, tone }: { left: string; top: string; tone: "e" | "s" | "p" }) {
  const cls =
    tone === "e" ? "bg-emerald-300/70 shadow-[0_0_40px_rgba(16,185,129,0.45)]" :
    tone === "s" ? "bg-sky-300/70 shadow-[0_0_40px_rgba(56,189,248,0.45)]" :
    "bg-pink-300/70 shadow-[0_0_40px_rgba(244,114,182,0.45)]";
  return (
    <span
      className={`absolute h-2.5 w-2.5 rounded-full ${cls}`}
      style={{ left, top }}
    />
  );
}

export default function HomePage() {
  const router = useRouter();
  const { profile, loading } = useAuth() as any;

  const feed = useMemo(() => buildFeed(), []);
  const loopFeed = useMemo(() => [...feed, ...feed], [feed]);

  const [tick, setTick] = useState(0);
  useEffect(() => {
    // daha yavaş ritim
    const id = window.setInterval(() => setTick((t) => (t + 1) % 999999), 4200);
    return () => window.clearInterval(id);
  }, []);

  const loggedIn = !!profile;
  const role = (profile?.role ?? "guest") as Role;

  const panelHref =
    role === "hotel" ? "/hotel/dashboard" :
    role === "agency" ? "/agency/requests" :
    role === "admin" ? "/admin" :
    "/dashboard/guest";

  const liveOnline = 210 + (tick % 85);
  const lastHourReq = 380 + (tick % 180);
  const lastHourOffers = 980 + (tick % 260);
  const lastHourBookings = 120 + (tick % 60);

  const ticker = useMemo(() => {
    const msgs = [
      "Yeni talep açıldı → oteller eşleşti",
      "Otel fiyat verdi → misafire özel teklif",
      "Pazarlık başladı → fiyat güncellendi",
      "Paket talebi → acentalar fiyatlıyor",
      "Rezervasyon → ödeme adımı",
      "Transfer/ tur eklendi → paket tamamlanıyor"
    ];
    return pick(msgs, tick);
  }, [tick]);

  return (
    <div className="container-page space-y-16 pb-24">
      {/* Background */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(16,185,129,0.10),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_left,rgba(56,189,248,0.10),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_right,rgba(244,114,182,0.10),transparent_55%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(2,6,23,0.2),rgba(2,6,23,1))]" />
        <div className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(to_right,rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:72px_72px]" />
        <div className="absolute -top-32 left-1/2 h-[560px] w-[860px] -translate-x-1/2 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute top-48 -left-40 h-[540px] w-[640px] rounded-full bg-sky-500/10 blur-3xl" />
        <div className="absolute bottom-0 -right-56 h-[620px] w-[760px] rounded-full bg-pink-500/10 blur-3xl" />
      </div>

      {/* Ticker */}
      <div className="pt-6">
        <div className="mx-auto max-w-6xl rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[0.8rem] text-slate-200">
              <span className="relative inline-flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-300"></span>
              </span>
              <span className="font-semibold text-white">Canlı:</span>
              <span className="text-slate-300">{ticker}</span>
            </div>

            {!loading && !loggedIn ? (
              <div className="flex flex-wrap items-center gap-2">
                <Link href="/auth/login" className="rounded-full border border-white/10 bg-white/0 px-4 py-2 text-xs text-slate-100 hover:bg-white/5">
                  Giriş yap
                </Link>
                <Link href="/auth/register" className="rounded-full bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400">
                  Kayıt ol
                </Link>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => router.push(panelHref)}
                className="rounded-full bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
              >
                Panele git →
              </button>
            )}
          </div>
        </div>
      </div>

      {/* HERO */}
      <section className="grid gap-10 md:grid-cols-[minmax(0,1.65fr)_minmax(0,0.95fr)] items-center pt-4">
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <Pill>⚡ Talep → Teklif → Pazarlık → Rezervasyon</Pill>
            <Pill>Kapalı devre</Pill>
            <Pill>Parite yok</Pill>
            <Pill>Stok yok</Pill>
          </div>

          <h1 className="text-4xl md:text-6xl font-semibold tracking-tight leading-[1.03] text-white">
            Misafir <span className="text-emerald-300">talep açar.</span>
            <br />
            Oteller <span className="text-sky-300">teklif verir.</span>
            <br />
            Acentalar <span className="text-pink-300">paket satar.</span>
          </h1>

          <p className="text-slate-200/90 max-w-2xl text-sm md:text-base leading-relaxed">
            Biddakika; talep açmayı tek forma indirir, otellerin sadece o talebe özel fiyat vermesini sağlar.
            Pazarlıkla netleşen fiyatı acenta paketler ve satışa çevirir.
            <span className="text-white"> Hızlı, şeffaf ve ölçülebilir.</span>
          </p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard tone="e" label="Anlık aktif" value={`${liveOnline}`} hint="şu an panelde" />
            <StatCard tone="s" label="Son 1 saat talep" value={`${lastHourReq}`} hint="talep açıldı" />
            <StatCard tone="a" label="Son 1 saat teklif" value={`${lastHourOffers}`} hint="fiyat geldi" />
            <StatCard tone="p" label="Son 1 saat rezervasyon" value={`${lastHourBookings}`} hint="onaylandı" />
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            {!loading && !loggedIn ? (
              <>
                <Link
                  href="/auth/register"
                  className="inline-flex items-center justify-center rounded-full bg-emerald-500 px-7 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 hover:bg-emerald-400"
                >
                  Kayıt ol
                </Link>
                <Link
                  href="/auth/login"
                  className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/0 px-7 py-3 text-sm font-semibold text-white hover:bg-white/5"
                >
                  Giriş yap →
                </Link>
                <button
                  type="button"
                  onClick={() => router.push("/otel-talebi")}
                  className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 px-7 py-3 text-sm font-semibold text-white hover:bg-white/10"
                >
                  Kayıt olmadan otel talebi aç
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => router.push(panelHref)}
                className="inline-flex items-center justify-center rounded-full bg-emerald-500 px-7 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
              >
                Panele git →
              </button>
            )}
          </div>

          {/* Fake Heat Map */}
          <div className="mt-2 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">Canlı yoğunluk haritası</p>
                <p className="text-[0.75rem] text-slate-300">talep / teklif / paket akışı (görsel)</p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/10 px-3 py-1 text-[0.7rem] text-white">
                <span className="h-2 w-2 rounded-full bg-emerald-300" />
                sıcak noktalar
              </span>
            </div>

            <div className="relative mt-3 h-[140px] overflow-hidden rounded-xl border border-white/10 bg-slate-950/60">
              {/* Soft map grid */}
              <div className="absolute inset-0 opacity-[0.12] [background-image:radial-gradient(rgba(255,255,255,0.5)_1px,transparent_1px)] [background-size:16px_16px]" />
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.08),transparent_55%)]" />

              {/* Hot spots */}
              <HeatDot left="18%" top="58%" tone="e" />
              <HeatDot left="26%" top="42%" tone="s" />
              <HeatDot left="38%" top="64%" tone="p" />
              <HeatDot left="52%" top="40%" tone="e" />
              <HeatDot left="64%" top="56%" tone="s" />
              <HeatDot left="76%" top="46%" tone="p" />
              <HeatDot left={`${30 + (tick % 40)}%`} top={`${35 + (tick % 25)}%`} tone={tick % 2 === 0 ? "e" : "s"} />

              {/* Legend */}
              <div className="absolute bottom-2 left-2 flex flex-wrap gap-2 text-[0.7rem] text-slate-200">
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/10 px-3 py-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-300/80" /> talep
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/10 px-3 py-1">
                  <span className="h-2 w-2 rounded-full bg-sky-300/80" /> teklif
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/10 px-3 py-1">
                  <span className="h-2 w-2 rounded-full bg-pink-300/80" /> paket
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* LIVE FEED */}
        <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur shadow-[0_30px_120px_rgba(0,0,0,0.55)] overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
            <div className="space-y-0.5">
              <p className="text-xs font-semibold text-white">Anlık akış</p>
              <p className="text-[0.7rem] text-slate-300">okunabilir • yavaş • gerçek his</p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/10 px-3 py-1 text-[0.7rem] text-white">
              <span className="relative inline-flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-300"></span>
              </span>
              LIVE
            </span>
          </div>

          <div className="relative h-[560px] overflow-hidden">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-slate-950/70 to-transparent z-10" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-slate-950/70 to-transparent z-10" />

            {/* Daha yavaş: 120s -> 210s */}
            <div className="marquee animate-[marquee_210s_linear_infinite]">
              {loopFeed.map((x, idx) => (
                <div key={`${x.id}-${idx}`} className="px-4 py-3 border-b border-white/5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      {/* Avatar (isim yok) */}
                      <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-black/10 text-base">
                        {iconFor(x.type)}
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-white">{x.title}</p>
                          <Badge tone={x.tone}>{x.badge}</Badge>
                        </div>
                        <p className="text-[0.75rem] text-slate-200/80">{x.subtitle}</p>
                        <p className="text-[0.65rem] text-slate-400">{x.timeAgo}</p>
                      </div>
                    </div>

                    {x.amount ? (
                      <div className="text-right">
                        <p className="text-[0.7rem] text-slate-400">tutar</p>
                        <p className="text-sm font-extrabold text-emerald-200">{x.amount}</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="px-4 py-3 border-t border-white/10">
            <p className="text-[0.72rem] text-slate-300">
              İpucu: Liste üzerine gelince akış durur (okunabilir).
            </p>
          </div>
        </div>
      </section>

      {/* UX How it works */}
      <section className="space-y-6">
        <h2 className="text-lg md:text-xl font-semibold text-white">
          Sistemi 30 saniyede anlayıp karar ver
        </h2>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white">🎒 Misafir</p>
              <Badge tone="emerald">Talep</Badge>
            </div>
            <ol className="mt-3 space-y-2 text-xs text-slate-200/85">
              <li><b>1)</b> Talep aç → tarih/kişi/istekler/süre</li>
              <li><b>2)</b> Teklifleri tek ekranda filtrele</li>
              <li><b>3)</b> Seç → ödeme → rezervasyon</li>
            </ol>
            <div className="mt-4 rounded-xl border border-white/10 bg-black/10 p-3 text-[0.72rem] text-slate-200/80">
              Amaç: <b className="text-white">hızlı karar + en iyi fiyat</b>.
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white">🏨 Otel</p>
              <Badge tone="amber">Teklif</Badge>
            </div>
            <ol className="mt-3 space-y-2 text-xs text-slate-200/85">
              <li><b>1)</b> Eşleşen talepleri gör</li>
              <li><b>2)</b> Model seç (%8/%10/%15)</li>
              <li><b>3)</b> Fiyat ver / güncelle / pazarlık</li>
            </ol>
            <div className="mt-4 rounded-xl border border-white/10 bg-black/10 p-3 text-[0.72rem] text-slate-200/80">
              Amaç: <b className="text-white">stok vermeden satış</b>.
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white">🧳 Acenta</p>
              <Badge tone="sky">Paket</Badge>
            </div>
            <ol className="mt-3 space-y-2 text-xs text-slate-200/85">
              <li><b>1)</b> Paket talebi al / oluştur</li>
              <li><b>2)</b> Otel+transfer+tur kırılımı fiyatla</li>
              <li><b>3)</b> Teklifi güncelle → satış</li>
            </ol>
            <div className="mt-4 rounded-xl border border-white/10 bg-black/10 p-3 text-[0.72rem] text-slate-200/80">
              Amaç: <b className="text-white">kârlılık + operasyon</b>.
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="rounded-2xl border border-white/10 bg-gradient-to-r from-emerald-500/15 via-sky-500/10 to-pink-500/10 px-6 py-6 md:px-8 md:py-7 flex flex-col md:flex-row md:items-center md:justify-between gap-4 backdrop-blur">
        <div>
          <h2 className="text-lg md:text-xl font-semibold text-white">
            Hazırsan başlayalım: talep aç → teklif topla → rezervasyon.
          </h2>
          <p className="text-xs md:text-sm text-slate-200/80 max-w-xl mt-1">
            Rolünü seçip kayıt olduğunda panelin otomatik açılır.
          </p>
        </div>

        {!loading && !loggedIn ? (
          <div className="flex flex-wrap gap-2">
            <Link href="/auth/register" className="rounded-full bg-emerald-500 px-6 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400">
              Kayıt ol
            </Link>
            <Link href="/auth/login" className="rounded-full border border-white/10 px-6 py-2.5 text-sm font-semibold text-white hover:bg-white/5">
              Giriş yap
            </Link>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => router.push(panelHref)}
            className="rounded-full bg-emerald-500 px-6 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
          >
            Panele git →
          </button>
        )}
      </section>

      <style jsx global>{`
        @keyframes marquee {
          0% { transform: translateY(0); }
          100% { transform: translateY(-50%); }
        }
        /* okunabilirlik: hover ile durdur */
        .marquee:hover {
          animation-play-state: paused;
        }
      `}</style>
    </div>
  );
}
