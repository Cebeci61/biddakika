"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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

/** ✅ Feed’i büyüttüm: tekrar hissi azalır, “canlı” daha gerçek görünür */
function buildFeed(): FeedItem[] {
  const cities = [
    "Antalya","İstanbul","Trabzon","Rize","Muğla","İzmir","Kapadokya","Bursa","Ankara","Fethiye",
    "Alanya","Kaş","Bodrum","Marmaris","Uzungöl","Sapanca","Datça","Alaçatı","Kemer","Side",
    "Eskişehir","Gaziantep","Mardin","Samsun","Amasra","Bozcaada","Çanakkale","Urla","Kuşadası","Pamukkale",
    "Adana","Mersin","Hatay","Şanlıurfa","Van","Erzurum","Kars","Sivas","Kayseri","Konya","Balıkesir","Aydın","Denizli","Manisa"
  ];

  const districts = [
    "Konyaaltı","Beşiktaş","Ortahisar","Kaş","Çeşme","Nilüfer","Çankaya","Ardeşen","Artuklu","Göreme",
    "Kadıköy","Muratpaşa","Sarıyer","Osmangazi","Ataşehir","Beyoğlu","Bodrum Merkez","Akyaka","Kalkan",
    "Ürgüp","Seferihisar","Konak","Atakum","İlkadım","Tarsus","İskenderun","Haliliye","Edremit","Çankaya","Meram","Selçuklu"
  ];

  const board = ["RO", "BB", "HB", "FB", "AI", "UAI"];

  const features = [
    "Havuz","Merkez","Deniz","Spa","Otopark","Aile","Manzara","Ücretsiz iptal","VIP transfer","Şehir turu",
    "Erken giriş","Geç çıkış","Sessiz oda","Suit upgrade","Çocuk dostu","Özel plaj","Servis aracı","Oyun alanı","Şömine","Butik konsept"
  ];

  const pkgBits = ["Otel", "Transfer", "Tur", "Rehber", "Sigorta", "Uçak bileti", "Rent a Car", "VIP araç", "Tekne turu"];
  const dealBadges = ["%8 Standart", "%10 Yenilenebilir", "%15 Pazarlıklı", "Son oda", "Flash indirim"];
  const msgSnippets = [
    "“Geç giriş mümkün mü?” → “Evet, not aldık ✅”",
    "“Bebek yatağı ekler misiniz?” → “Hazır ✅”",
    "“Deniz manzarası var mı?” → “Uygun oda seçildi ✅”",
    "“İptal şartı nedir?” → “48 saate kadar ücretsiz ✅”",
    "“Transfer tek yön olsun” → “Tamamlandı ✅”",
    "“Fatura şirket adına” → “Bilgiler alındı ✅”",
    "“Sessiz oda” → “Üst kat ayrıldı ✅”",
    "“Aile odası kaldı mı?” → “Son 2 oda ✅”",
    "“Otopark ücretsiz mi?” → “Evet ✅”"
  ];

  const out: FeedItem[] = [];
  for (let i = 0; i < 420; i++) {
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
      const bits = Array.from({ length: 3 + (i % 4) }, (_, k) => pick(pkgBits, i * 7 + k));
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
      const mins = 15 + (i % 75);
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

function StatCard({
  label,
  value,
  hint,
  tone
}: {
  label: string;
  value: string;
  hint: string;
  tone: "e" | "s" | "p" | "a";
}) {
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

function HeatDot({ left, top, tone }: { left: string; top: string; tone: "e" | "s" | "p" | "a" }) {
  const cls =
    tone === "e" ? "bg-emerald-300/80 shadow-[0_0_46px_rgba(16,185,129,0.55)]" :
    tone === "s" ? "bg-sky-300/80 shadow-[0_0_46px_rgba(56,189,248,0.55)]" :
    tone === "p" ? "bg-pink-300/80 shadow-[0_0_46px_rgba(244,114,182,0.55)]" :
    "bg-amber-300/80 shadow-[0_0_46px_rgba(251,191,36,0.55)]";

  return (
    <span className={`absolute h-2.5 w-2.5 rounded-full ${cls}`} style={{ left, top }} />
  );
}

/** ✅ Türkiye haritası simülasyonu: dış kaynak yok, tamamen CSS + hot-spot */
function TurkeyMap({
  tick,
  onPickCity
}: {
  tick: number;
  onPickCity: (city: string, tone: "e" | "s" | "p" | "a") => void;
}) {
  const points = useMemo(() => {
    const base = [
      { city: "İstanbul", left: "22%", top: "30%", tone: "s" as const },
      { city: "Ankara", left: "45%", top: "36%", tone: "a" as const },
      { city: "İzmir", left: "14%", top: "44%", tone: "p" as const },
      { city: "Antalya", left: "28%", top: "62%", tone: "e" as const },
      { city: "Trabzon", left: "72%", top: "30%", tone: "s" as const },
      { city: "Gaziantep", left: "66%", top: "66%", tone: "a" as const },
      { city: "Van", left: "86%", top: "52%", tone: "p" as const },
      { city: "Bursa", left: "26%", top: "34%", tone: "e" as const },
      { city: "Samsun", left: "58%", top: "30%", tone: "a" as const }
    ];

    // dinamik nokta
    base.push({
      city: "Canlı",
      left: `${30 + (tick % 55)}%`,
      top: `${28 + (tick % 35)}%`,
      tone: tick % 2 === 0 ? ("e" as const) : ("s" as const)
    });

    return base;
  }, [tick]);

  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 backdrop-blur p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">Türkiye canlı harita</p>
          <p className="text-[0.75rem] text-slate-300">
            Şehre tıkla → canlı yoğunluk panelini gör
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[0.7rem] text-white">
          <span className="relative inline-flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-300" />
          </span>
          LIVE
        </span>
      </div>

      <div className="relative mt-3 overflow-hidden rounded-xl border border-white/10 bg-slate-950/60 h-[220px] sm:h-[260px]">
        <div className="absolute inset-0 opacity-[0.15] [background-image:radial-gradient(rgba(255,255,255,0.7)_1px,transparent_1px)] [background-size:18px_18px]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.10),transparent_55%)]" />

        {/* Siluet blob */}
        <div
          className="absolute left-1/2 top-1/2 h-[190px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-[999px] bg-white/5"
          style={{
            clipPath:
              "polygon(6% 52%, 10% 40%, 16% 35%, 22% 28%, 31% 24%, 41% 26%, 52% 22%, 63% 25%, 71% 32%, 80% 35%, 90% 42%, 96% 52%, 92% 64%, 82% 72%, 70% 73%, 60% 70%, 49% 74%, 37% 72%, 26% 70%, 15% 63%)"
          }}
        />

        {/* tıklanabilir noktalar */}
        {points.map((p, idx) => (
          <button
            key={`${p.city}-${idx}`}
            type="button"
            onClick={() => onPickCity(p.city, p.tone)}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: p.left, top: p.top }}
            aria-label={`${p.city} yoğunluk`}
            title={`${p.city} yoğunluk`}
          >
            <span className="relative block">
              <HeatDot left="50%" top="50%" tone={p.tone} />
              <span className="absolute left-1/2 top-[16px] -translate-x-1/2 whitespace-nowrap text-[0.65rem] text-slate-300">
                {p.city}
              </span>
            </span>
          </button>
        ))}

        {/* legend */}
        <div className="absolute bottom-2 left-2 flex flex-wrap gap-2 text-[0.7rem] text-slate-200">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1">
            <span className="h-2 w-2 rounded-full bg-emerald-300/80" /> talep
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1">
            <span className="h-2 w-2 rounded-full bg-sky-300/80" /> teklif
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1">
            <span className="h-2 w-2 rounded-full bg-pink-300/80" /> paket
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1">
            <span className="h-2 w-2 rounded-full bg-amber-300/80" /> ödeme
          </span>
        </div>
      </div>
    </div>
  );
}


export default function HomePage() {
  const router = useRouter();
  const { profile, loading } = useAuth() as any;

  const feed = useMemo(() => buildFeed(), []);
  const loopFeed = useMemo(() => [...feed, ...feed], [feed]);

  // ✅ daha stabil “live”
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => (t + 1) % 999999), 4200);
    {/* ✅ Sağ üst canlı toastlar */}
<div className="fixed right-4 top-20 z-[60] space-y-2 w-[320px] max-w-[86vw]">
  {toasts.map((t) => (
    <div
      key={t.id}
      className={`rounded-2xl border px-4 py-3 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur ${toneCls(t.tone)}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{t.title}</p>
          <p className="text-[0.8rem] opacity-90 mt-0.5">{t.desc}</p>
        </div>
        <button
          type="button"
          onClick={() => setToasts((p) => p.filter((x) => x.id !== t.id))}
          className="rounded-xl border border-white/10 bg-black/10 px-2 py-1 text-[0.75rem] text-white/80 hover:text-white"
        >
          ✕
        </button>
      </div>
    </div>
  ))}
</div>

    return () => window.clearInterval(id);
  }, []);

  const loggedIn = !!profile;
  const role = (profile?.role ?? "guest") as Role;

  const panelHref =
    role === "hotel" ? "/hotel/dashboard" :
    role === "agency" ? "/agency/requests" :
    role === "admin" ? "/admin" :
    "/dashboard/guest";

  // ✅ sayılar daha “premium” dursun diye geniş aralık
  const liveOnline = 210 + (tick % 120);
  const lastHourReq = 380 + (tick % 260);
  const lastHourOffers = 980 + (tick % 420);
  const lastHourBookings = 120 + (tick % 140);

  const ticker = useMemo(() => {
    const msgs = [
      "Yeni talep açıldı → oteller eşleşti",
      "Otel fiyat verdi → misafire özel teklif",
      "Pazarlık başladı → fiyat güncellendi",
      "Paket talebi → acentalar fiyatlıyor",
      "Rezervasyon → ödeme adımı",
      "Transfer / tur eklendi → paket tamamlanıyor",
      "Son oda uyarısı → hızlı karar avantaj sağlar",
      "Yenilenebilir teklif → fiyat tekrar düştü",
      "Otel mesajı → talebin notları onaylandı"
    ];
    return pick(msgs, tick);
  }, [tick]);
  type ToastTone = "e" | "s" | "p" | "a";
type ToastItem = { id: string; tone: ToastTone; title: string; desc: string; createdAt: number };

function toneCls(t: ToastTone) {
  if (t === "e") return "border-emerald-400/25 bg-emerald-500/10 text-emerald-100";
  if (t === "s") return "border-sky-400/25 bg-sky-500/10 text-sky-100";
  if (t === "p") return "border-pink-400/25 bg-pink-500/10 text-pink-100";
  return "border-amber-300/25 bg-amber-500/10 text-amber-100";
}

function hashNum(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

// ✅ şehir paneli
const [cityPanel, setCityPanel] = useState<{ city: string; tone: ToastTone } | null>(null);

// ✅ toast feed
const [toasts, setToasts] = useState<ToastItem[]>([]);

// ✅ canlı toast üret
useEffect(() => {
  const cities = ["İstanbul","Ankara","İzmir","Antalya","Trabzon","Gaziantep","Van","Bursa","Samsun","Mardin","Muğla","Rize","Alanya","Bodrum"];
  const msgs = [
    { t: "e" as const, title: "Yeni talep", desc: "Talep açıldı → oteller eşleşti" },
    { t: "s" as const, title: "Yeni teklif", desc: "Otel fiyat verdi → misafire özel" },
    { t: "p" as const, title: "Paket akışı", desc: "Paket talebi → acentalar fiyatlıyor" },
    { t: "a" as const, title: "Ödeme adımı", desc: "Rezervasyon → ödeme aşaması" },
    { t: "s" as const, title: "Güncelleme", desc: "Yenilenebilir teklif → fiyat tekrar düştü" },
    { t: "p" as const, title: "Pazarlık", desc: "Karşı teklif gönderildi → otel yanıtlıyor" }
  ];

  const id = window.setInterval(() => {
    const city = pick(cities, Date.now());
    const m = pick(msgs, Date.now() + 7);
    const toast: ToastItem = {
      id: `t-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      tone: m.t,
      title: `${city} • ${m.title}`,
      desc: m.desc,
      createdAt: Date.now()
    };

    setToasts((prev) => [toast, ...prev].slice(0, 4));

    // 5 sn sonra otomatik sil
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== toast.id));
    }, 5200);
  }, 2200); // ✅ okunabilir: çok hızlı değil

  return () => window.clearInterval(id);
}, []);


  // ✅ marquee okunabilirlik: hover / touch ile pause hissi
  const feedRef = useRef<HTMLDivElement | null>(null);

  return (
    <div className="pb-24">
      {/* ✅ Background - sayfanın tamamı */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(16,185,129,0.12),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_left,rgba(56,189,248,0.12),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_right,rgba(244,114,182,0.12),transparent_55%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(2,6,23,0.15),rgba(2,6,23,1))]" />
        <div className="absolute inset-0 opacity-[0.06] [background-image:linear-gradient(to_right,rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:84px_84px]" />
        <div className="absolute -top-32 left-1/2 h-[560px] w-[860px] -translate-x-1/2 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute top-48 -left-40 h-[540px] w-[640px] rounded-full bg-sky-500/10 blur-3xl" />
        <div className="absolute bottom-0 -right-56 h-[620px] w-[760px] rounded-full bg-pink-500/10 blur-3xl" />
      </div>

      {/* ✅ NAV ile boşluk kapatma: artık container-page yerine max-w-7xl kullan */}
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 space-y-10">
        {/* ✅ Ticker (navdan hemen sonra, boşluk minimum) */}
        <div className="pt-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[0.85rem] text-slate-200">
                <span className="relative inline-flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-300" />
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

        {/* ✅ HERO (daha geniş, daha premium, dar değil) */}
        <section className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] items-start">
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <Pill>⚡ Talep → Teklif → Pazarlık → Rezervasyon</Pill>
              <Pill>Kapalı devre</Pill>
              <Pill>Parite yok</Pill>
              <Pill>Stok yok</Pill>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.05] text-white">
              Misafir <span className="text-emerald-300">talep açar.</span>
              <br />
              Oteller <span className="text-sky-300">teklif verir.</span>
              <br />
              Acentalar <span className="text-pink-300">paket satar.</span>
            </h1>

            {/* ✅ profesyonel anlatım (amatör değil) */}
            <p className="text-slate-200/90 max-w-3xl text-sm sm:text-base leading-relaxed">
              Biddakika; konaklamayı <b>tek talep</b> ile başlatır. Oteller yalnızca o talebe özel fiyat gönderir,
              pazarlık varsa sistem kayıt altına alır. Acenta ise konaklama + transfer + tur bileşenlerini paketleyip
              satışa dönüştürür. <span className="text-white">Süreç hızlı, şeffaf ve ölçülebilirdir.</span>
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

            {/* ✅ Premium güven barı */}
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
              <div className="grid gap-3 sm:grid-cols-3 text-[0.8rem] text-slate-200">
                <div className="rounded-xl border border-white/10 bg-black/10 p-3">
                  <p className="font-semibold text-white">🔒 Kapalı devre teklif</p>
                  <p className="text-slate-300 mt-1">Genel liste fiyatı değil, talebine özel fiyat.</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/10 p-3">
                  <p className="font-semibold text-white">🧾 İzlenebilir pazarlık</p>
                  <p className="text-slate-300 mt-1">Güncellemeler ve karşı teklifler kayıtlı.</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/10 p-3">
                  <p className="font-semibold text-white">✅ Voucher / kanıt</p>
                  <p className="text-slate-300 mt-1">Rezervasyon sonrası elinde belge olur.</p>
                </div>
              </div>
            </div>

            {/* ✅ Türkiye haritası */}
<PremiumTurkeyLiveMap
  tick={tick}
  onRequireAuth={() => router.push("/auth/register")}
/>

{/* ✅ Şehir paneli */}
{cityPanel && (
  <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-4">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-sm font-semibold text-white">
          {cityPanel.city} • canlı panel
        </p>
        <p className="text-[0.75rem] text-slate-300">
          (simülasyon) talep / teklif / paket / rezervasyon yoğunluğu
        </p>
      </div>
      <button
        type="button"
        onClick={() => setCityPanel(null)}
        className="rounded-xl border border-white/10 bg-black/10 px-3 py-2 text-[0.75rem] text-slate-200 hover:bg-white/5"
      >
        Kapat ✕
      </button>
    </div>

    {(() => {
      const h = hashNum(cityPanel.city);
      const req = 120 + (h % 280) + (tick % 40);
      const off = 260 + (h % 420) + (tick % 60);
      const pkg = 40 + (h % 110) + (tick % 18);
      const bok = 25 + (h % 90) + (tick % 12);

      return (
        <div className="grid gap-3 sm:grid-cols-4 mt-4">
          <div className="rounded-2xl border border-white/10 bg-black/10 p-3">
            <p className="text-[0.7rem] text-slate-400">Talep</p>
            <p className="text-lg font-extrabold text-white">{req}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/10 p-3">
            <p className="text-[0.7rem] text-slate-400">Teklif</p>
            <p className="text-lg font-extrabold text-white">{off}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/10 p-3">
            <p className="text-[0.7rem] text-slate-400">Paket</p>
            <p className="text-lg font-extrabold text-white">{pkg}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/10 p-3">
            <p className="text-[0.7rem] text-slate-400">Rezervasyon</p>
            <p className="text-lg font-extrabold text-white">{bok}</p>
          </div>
        </div>
      );
    })()}

    <div className="mt-4 rounded-xl border border-white/10 bg-black/10 p-3 text-[0.8rem] text-slate-200">
      ✅ Bu şehirde “kapalı devre teklif” daha hızlı çalışır. <b className="text-white">Kayıt olup</b> panelden takip edebilirsin.
    </div>
  </div>
)}

          </div>

          {/* ✅ LIVE FEED (daha geniş, okunabilir, yavaş) */}
          <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur shadow-[0_30px_120px_rgba(0,0,0,0.55)] overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-xs font-semibold text-white">Anlık akış</p>
                <p className="text-[0.7rem] text-slate-300">okunabilir • yavaş • gerçek his</p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/10 px-3 py-1 text-[0.7rem] text-white">
                <span className="relative inline-flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-300" />
                </span>
                LIVE
              </span>
            </div>

            <div
              ref={feedRef}
              className="relative h-[520px] sm:h-[560px] overflow-hidden"
            >
              <div className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-slate-950/70 to-transparent z-10" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-slate-950/70 to-transparent z-10" />

              {/* ✅ Daha yavaş: 210s -> 320s */}
<div className="marquee animate-[marquee_320s_linear_infinite]">
                {loopFeed.map((x, idx) => (
                  <div key={`${x.id}-${idx}`} className="px-4 py-3 border-b border-white/5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
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
        {/* UX How it works (kurumsal dil) */}
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
                <li><b>1)</b> Talep aç → tarih/kişi/istek/süre</li>
                <li><b>2)</b> Teklifleri kıyasla → filtrele → pazarlık opsiyonel</li>
                <li><b>3)</b> Seç → ödeme → voucher</li>
              </ol>
              <div className="mt-4 rounded-xl border border-white/10 bg-black/10 p-3 text-[0.72rem] text-slate-200/80">
                Amaç: <b className="text-white">en iyi fiyat + en hızlı karar</b>.
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
                <li><b>2)</b> Otel + transfer + tur kırılımı fiyatla</li>
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
              “Kapalı devre teklif” modeliyle doğru fiyatı bulmak artık 1 ekranda.
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

        {/* ✅ FOOTER (Destek / Bilgi / Hakkımızda) */}
        <footer className="mt-10 rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-6">
          <div className="grid gap-6 md:grid-cols-4">
            <div className="space-y-2">
              <p className="text-white font-semibold">Biddakika</p>
              <p className="text-[0.8rem] text-slate-300">
                Talep → teklif → pazarlık → rezervasyon akışını tek ekrana indiren yeni nesil konaklama altyapısı.
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-white font-semibold">Destek</p>
              <ul className="text-[0.8rem] text-slate-300 space-y-1">
                <li>• Canlı destek (yakında)</li>
                <li>• SSS</li>
                <li>• İletişim</li>
              </ul>
            </div>

            <div className="space-y-2">
              <p className="text-white font-semibold">Bilgi</p>
              <ul className="text-[0.8rem] text-slate-300 space-y-1">
                <li>• Güvenlik & KVKK</li>
                <li>• Mesafeli satış</li>
                <li>• İptal politikası</li>
              </ul>
            </div>

            <div className="space-y-2">
              <p className="text-white font-semibold">Katıl</p>
              <p className="text-[0.8rem] text-slate-300">
                Otelsen satışa, acentaysan pakete, misafirsan en iyi fiyata daha hızlı ulaş.
              </p>
              <div className="flex gap-2 pt-1">
                <Link href="/auth/register" className="rounded-full bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400">
                  Kayıt ol
                </Link>
                <Link href="/auth/login" className="rounded-full border border-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/5">
                  Giriş
                </Link>
              </div>
            </div>
          </div>

          <div className="mt-6 border-t border-white/10 pt-4 text-[0.75rem] text-slate-400 flex flex-wrap justify-between gap-2">
            <span>© {new Date().getFullYear()} Biddakika • Tüm hakları saklıdır.</span>
            <span>Versiyon: MVP • “Kapalı devre teklif”</span>
          </div>
        </footer>

        {/* Global styles */}
        <style jsx global>{`
          @keyframes marquee {
            0% { transform: translateY(0); }
            100% { transform: translateY(-50%); }
          }
          .marquee:hover {
            animation-play-state: paused;
          }
        `}</style>
      </div>
    </div>
  );
}
// ✅ PREMIUM TÜRKİYE CANLI HARİTASI (20+ şehir + ilçe)
// app/page.tsx içine ekle (HomePage altında veya helper’ların altına)

type MapKind = "talep" | "teklif" | "paket" | "odeme";
type MapCity = {
  key: string;
  name: string;
  kind: MapKind;
  left: number;   // 0..100
  top: number;    // 0..100
  districts: string[];
};

function pillCls(kind: MapKind) {
  if (kind === "talep") return "border-emerald-400/25 bg-emerald-500/10 text-emerald-100";
  if (kind === "teklif") return "border-sky-400/25 bg-sky-500/10 text-sky-100";
  if (kind === "paket") return "border-pink-400/25 bg-pink-500/10 text-pink-100";
  return "border-amber-300/25 bg-amber-500/10 text-amber-100";
}

function dotCls(kind: MapKind) {
  if (kind === "talep") return "bg-emerald-300/80 shadow-[0_0_40px_rgba(16,185,129,0.45)]";
  if (kind === "teklif") return "bg-sky-300/80 shadow-[0_0_40px_rgba(56,189,248,0.45)]";
  if (kind === "paket") return "bg-pink-300/80 shadow-[0_0_40px_rgba(244,114,182,0.45)]";
  return "bg-amber-300/80 shadow-[0_0_40px_rgba(245,158,11,0.45)]";
}

function makeCityStats(seed: number) {
  // daha “doğal” duran simülasyon
  const baseTalep = 240 + (seed % 140);
  const baseTeklif = 320 + (seed % 160);
  const basePaket = 40 + (seed % 55);
  const baseRez = 60 + (seed % 70);
  return { talep: baseTalep, teklif: baseTeklif, paket: basePaket, rezervasyon: baseRez };
}

function PremiumTurkeyLiveMap({
  tick,
  onRequireAuth
}: {
  tick: number;
  onRequireAuth?: () => void;
}) {
  const cities: MapCity[] = [
    { key: "istanbul", name: "İstanbul", kind: "teklif", left: 22, top: 37, districts: ["Beşiktaş","Şişli","Kadıköy","Üsküdar","Beyoğlu","Ataşehir","Bakırköy"] },
    { key: "ankara", name: "Ankara", kind: "talep", left: 45, top: 43, districts: ["Çankaya","Keçiören","Yenimahalle","Etimesgut","Mamak","Sincan"] },
    { key: "izmir", name: "İzmir", kind: "paket", left: 13, top: 52, districts: ["Konak","Bornova","Karşıyaka","Çeşme","Seferihisar","Urla"] },
    { key: "antalya", name: "Antalya", kind: "talep", left: 28, top: 73, districts: ["Konyaaltı","Muratpaşa","Lara","Alanya","Kemer","Belek"] },
    { key: "bursa", name: "Bursa", kind: "teklif", left: 29, top: 43, districts: ["Nilüfer","Osmangazi","Yıldırım","Mudanya"] },
    { key: "adana", name: "Adana", kind: "odeme", left: 56, top: 76, districts: ["Seyhan","Yüreğir","Çukurova","Sarıçam"] },
    { key: "gaziantep", name: "Gaziantep", kind: "odeme", left: 67, top: 74, districts: ["Şahinbey","Şehitkamil"] },
    { key: "trabzon", name: "Trabzon", kind: "teklif", left: 77, top: 36, districts: ["Ortahisar","Akçaabat","Yomra","Sürmene","Of"] },
    { key: "rize", name: "Rize", kind: "talep", left: 82, top: 38, districts: ["Ardeşen","Çayeli","Pazar","Fındıklı"] },
    { key: "samsun", name: "Samsun", kind: "odeme", left: 65, top: 35, districts: ["Atakum","İlkadım","Canik"] },
    { key: "mugla", name: "Muğla", kind: "paket", left: 18, top: 70, districts: ["Bodrum","Marmaris","Fethiye","Datça","Ortaca"] },
    { key: "eskisehir", name: "Eskişehir", kind: "talep", left: 38, top: 46, districts: ["Tepebaşı","Odunpazarı"] },
    { key: "konya", name: "Konya", kind: "talep", left: 47, top: 60, districts: ["Selçuklu","Meram","Karatay"] },
    { key: "kayseri", name: "Kayseri", kind: "teklif", left: 59, top: 57, districts: ["Melikgazi","Kocasinan","Talas"] },
    { key: "nevsehir", name: "Nevşehir", kind: "paket", left: 56, top: 55, districts: ["Göreme","Ürgüp","Avanos"] },
    { key: "mardin", name: "Mardin", kind: "odeme", left: 80, top: 78, districts: ["Artuklu","Midyat"] },
    { key: "van", name: "Van", kind: "paket", left: 92, top: 56, districts: ["İpekyolu","Tuşba","Edremit"] },
    { key: "erzurum", name: "Erzurum", kind: "talep", left: 84, top: 48, districts: ["Yakutiye","Palandöken","Aziziye"] },
    { key: "canakkale", name: "Çanakkale", kind: "teklif", left: 12, top: 42, districts: ["Merkez","Bozcaada","Gökçeada"] },
    { key: "amasya", name: "Amasya", kind: "talep", left: 62, top: 41, districts: ["Merkez","Taşova"] }
  ];

  const [selectedKey, setSelectedKey] = React.useState<string>("istanbul");
  const [districtKey, setDistrictKey] = React.useState<string>(""); // seçili ilçe
  const [hoverKey, setHoverKey] = React.useState<string | null>(null);

  const selected = React.useMemo(
    () => cities.find((c) => c.key === selectedKey) ?? cities[0],
    [selectedKey]
  );

  const stats = React.useMemo(() => {
    // şehir bazlı seed: tick + key hash
    const seed = tick + selected.key.split("").reduce((s, ch) => s + ch.charCodeAt(0), 0);
    return makeCityStats(seed);
  }, [tick, selected.key]);

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-4 md:p-5 backdrop-blur shadow-[0_30px_120px_rgba(0,0,0,0.55)]">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm md:text-base font-semibold text-white">Türkiye canlı harita</p>
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-[0.7rem] text-emerald-100">
              <span className="relative inline-flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-300"></span>
              </span>
              LIVE
            </span>
          </div>
          <p className="text-[0.75rem] text-slate-300">
            Şehre tıkla → yoğunluk + ilçe listesi. (Simülasyon)
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className={`rounded-full border px-3 py-1 text-[0.7rem] ${pillCls("talep")}`}>talep</span>
          <span className={`rounded-full border px-3 py-1 text-[0.7rem] ${pillCls("teklif")}`}>teklif</span>
          <span className={`rounded-full border px-3 py-1 text-[0.7rem] ${pillCls("paket")}`}>paket</span>
          <span className={`rounded-full border px-3 py-1 text-[0.7rem] ${pillCls("odeme")}`}>ödeme</span>
        </div>
      </div>

      {/* map */}
      <div className="relative mt-4 overflow-hidden rounded-2xl border border-white/10 bg-slate-950/60">
        {/* background grid */}
        <div className="absolute inset-0 opacity-[0.10] [background-image:radial-gradient(rgba(255,255,255,0.45)_1px,transparent_1px)] [background-size:16px_16px]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.10),transparent_60%)]" />

        {/* turkey silhouette (simple) */}
        <svg viewBox="0 0 1000 420" className="absolute inset-0 h-full w-full opacity-[0.22]">
          <path
            d="M80 240 C120 170, 210 160, 320 175 C380 150, 460 150, 540 170 C640 140, 720 150, 800 190 C880 210, 920 250, 890 285 C850 330, 760 340, 680 322 C590 350, 520 345, 430 320 C320 350, 250 330, 180 300 C120 285, 70 270, 80 240 Z"
            fill="rgba(255,255,255,0.8)"
          />
        </svg>

        {/* dots */}
        <div className="relative h-[220px] md:h-[260px]">
          {cities.map((c) => {
            const isSel = c.key === selectedKey;
            const isHover = hoverKey === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onMouseEnter={() => setHoverKey(c.key)}
                onMouseLeave={() => setHoverKey(null)}
                onClick={() => {
                  setSelectedKey(c.key);
                  setDistrictKey("");
                }}
                className="absolute"
                style={{ left: `${c.left}%`, top: `${c.top}%` }}
              >
                <span
                  className={[
                    "relative block h-3.5 w-3.5 rounded-full",
                    dotCls(c.kind),
                    "transition-transform duration-200",
                    isSel ? "scale-[1.35]" : isHover ? "scale-[1.2]" : "scale-100"
                  ].join(" ")}
                />
                {/* halo */}
                <span
                  className={[
                    "pointer-events-none absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full",
                    isSel ? "opacity-100" : "opacity-0",
                    "transition-opacity duration-200",
                    c.kind === "talep"
                      ? "bg-emerald-400/10"
                      : c.kind === "teklif"
                      ? "bg-sky-400/10"
                      : c.kind === "paket"
                      ? "bg-pink-400/10"
                      : "bg-amber-400/10"
                  ].join(" ")}
                />
                {/* label */}
                <span
                  className={[
                    "absolute left-1/2 top-[16px] -translate-x-1/2 whitespace-nowrap rounded-full border px-2 py-0.5 text-[0.65rem]",
                    "border-white/10 bg-black/25 text-slate-200 backdrop-blur",
                    isSel || isHover ? "opacity-100" : "opacity-70"
                  ].join(" ")}
                >
                  {c.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* district chips */}
      <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-white">
              {selected.name} • canlı panel
            </p>
            <p className="text-[0.75rem] text-slate-300">
              İlçe seç → teklif kalitesi “daha hedefli” simüle edilir.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setDistrictKey("");
              setSelectedKey("istanbul");
            }}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[0.75rem] text-slate-200 hover:bg-white/10"
          >
            Sıfırla
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setDistrictKey("")}
            className={`rounded-full border px-3 py-1 text-[0.75rem] ${
              !districtKey ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border-white/10 bg-white/0 text-slate-200 hover:bg-white/5"
            }`}
          >
            Tüm ilçe
          </button>

          {selected.districts.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDistrictKey(d)}
              className={`rounded-full border px-3 py-1 text-[0.75rem] ${
                districtKey === d ? "border-sky-500/40 bg-sky-500/10 text-sky-200" : "border-white/10 bg-white/0 text-slate-200 hover:bg-white/5"
              }`}
            >
              {d}
            </button>
          ))}
        </div>

        {/* panel (aynı mantık) */}
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-slate-950/40 px-4 py-3">
            <p className="text-[0.7rem] text-slate-400">Talep</p>
            <p className="text-xl font-extrabold text-white">{stats.talep}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-950/40 px-4 py-3">
            <p className="text-[0.7rem] text-slate-400">Teklif</p>
            <p className="text-xl font-extrabold text-white">{stats.teklif}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-950/40 px-4 py-3">
            <p className="text-[0.7rem] text-slate-400">Paket</p>
            <p className="text-xl font-extrabold text-white">{stats.paket}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-950/40 px-4 py-3">
            <p className="text-[0.7rem] text-slate-400">Rezervasyon</p>
            <p className="text-xl font-extrabold text-white">{stats.rezervasyon}</p>
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-white/10 bg-black/10 px-3 py-2 text-[0.75rem] text-slate-200">
          ✅ <b className="text-white">{selected.name}</b>
          {districtKey ? (
            <>
              {" "} / <b className="text-white">{districtKey}</b>
              {" "}ilçesinde “kapalı devre teklif” daha hızlı çalışır. Teklifleri görmek için kayıt olman gerekir.
            </>
          ) : (
            <> şehrinde “kapalı devre teklif” daha hızlı çalışır. Teklifleri görmek için kayıt olman gerekir.</>
          )}
          {" "}
          <button
            type="button"
            onClick={() => onRequireAuth?.()}
            className="ml-2 underline underline-offset-2 text-emerald-200 hover:text-emerald-100"
          >
            Kayıt / Giriş
          </button>
        </div>
      </div>
    </div>
  );
}
