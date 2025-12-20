"use client";

import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Protected } from "@/components/Protected";
import { useAuth } from "@/context/AuthContext";
import { getFirestoreDb } from "@/lib/firebase/client";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";

/* ====================== TYPES ====================== */

type TransferType = "none" | "oneway" | "roundtrip";
type VehicleClass = "none" | "economy" | "sedan" | "suv" | "jeep" | "vip" | "minivan";
type HotelPref = "any" | "cityCenter" | "sea" | "nature" | "boutique" | "luxury";
type ResponseUnit = "minutes" | "hours" | "days";

type RoomTypePref = "any" | "standard" | "family" | "suite" | "deluxe";
type BoardPref = "any" | "RO" | "BB" | "HB" | "AI" | "UAI";

type PromoTone = "emerald" | "amber" | "pink" | "sky";
type PromoGroup =
  | "progress"
  | "cities"
  | "dates"
  | "pax"
  | "hotel"
  | "tour"
  | "car"
  | "transfer"
  | "flight"
  | "budget"
  | "notes"
  | "deadline";

/* ====================== SABİTLER ====================== */

const CITY_SUGGESTIONS = [
  "İstanbul", "Antalya", "İzmir", "Ankara", "Trabzon", "Rize", "Muğla", "Bursa",
  "Kapadokya", "Fethiye", "Bodrum", "Marmaris", "Alanya", "Kaş", "Uzungöl"
];

const ROOM_TYPE_PREFS: { key: RoomTypePref; label: string }[] = [
  { key: "any", label: "Farketmez" },
  { key: "standard", label: "Standart" },
  { key: "family", label: "Aile odası" },
  { key: "suite", label: "Suit" },
  { key: "deluxe", label: "Deluxe" }
];

const BOARD_PREFS: { key: BoardPref; label: string }[] = [
  { key: "any", label: "Farketmez" },
  { key: "RO", label: "Sadece oda (RO)" },
  { key: "BB", label: "Kahvaltı dahil (BB)" },
  { key: "HB", label: "Yarım pansiyon (HB)" },
  { key: "AI", label: "Her şey dahil (AI)" },
  { key: "UAI", label: "Ultra her şey dahil (UAI)" }
];

const VEHICLE_CLASS: { key: Exclude<VehicleClass, "none">; label: string }[] = [
  { key: "economy", label: "Ekonomik" },
  { key: "sedan", label: "Sedan" },
  { key: "suv", label: "SUV" },
  { key: "jeep", label: "Jeep" },
  { key: "minivan", label: "Minivan (7+)" },
  { key: "vip", label: "VIP" }
];

const HOTEL_PREFS: { key: HotelPref; label: string }[] = [
  { key: "any", label: "Farketmez" },
  { key: "cityCenter", label: "Merkez" },
  { key: "sea", label: "Deniz" },
  { key: "nature", label: "Doğa" },
  { key: "boutique", label: "Butik" },
  { key: "luxury", label: "Lüks" }
];

/* ====================== HELPERS ====================== */

function cleanText(v: any) {
  return String(v ?? "").trim();
}
function digitsOnly(v: string) {
  return v.replace(/\D/g, "");
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
function toMinutes(amount: number, unit: ResponseUnit): number {
  if (unit === "minutes") return amount;
  if (unit === "hours") return amount * 60;
  return amount * 60 * 24;
}
function responseUnitLabelTR(unit: ResponseUnit) {
  if (unit === "minutes") return "dakika";
  if (unit === "hours") return "saat";
  return "gün";
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

/* ====================== PROMO ENGINE ====================== */

type PromoItem = {
  id: string;
  group: PromoGroup;
  tone: PromoTone;
  icon: string;
  title: string;
  desc: string;
};

function toneCls(t: PromoTone) {
  if (t === "emerald") return "border-emerald-400/30 bg-emerald-500/10 text-emerald-100";
  if (t === "amber") return "border-amber-400/30 bg-amber-500/10 text-amber-100";
  if (t === "pink") return "border-pink-400/30 bg-pink-500/10 text-pink-100";
  return "border-sky-400/30 bg-sky-500/10 text-sky-100";
}

function hashSeed(input: string) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}
function pick<T>(arr: T[], seed: number) {
  return arr[seed % arr.length];
}

function buildPromos(args: {
  tick: number;
  progress: number;
  cities: string[];
  dateFrom: string;
  dateTo: string;
  nights: number;
  paxAdults: number;
  paxChildren: number;
  roomsCount: number;
  roomTypePref: RoomTypePref;
  boardPref: BoardPref;
  hotelPref: HotelPref;
  wantTours: boolean;
  toursCount: number;
  wantCar: boolean;
  carClass: VehicleClass;
  licenseYear: number | null;
  transferType: TransferType;
  wantFlight: boolean;
  budgetMin: number | null;
  budgetMax: number | null;
  notes: string;
  responseAmount: number;
  responseUnit: ResponseUnit;
}) {
  const seed = hashSeed(
    [
      String(args.tick),
      String(args.progress),
      args.cities.join("|"),
      args.dateFrom,
      args.dateTo,
      String(args.nights),
      String(args.paxAdults),
      String(args.paxChildren),
      String(args.roomsCount),
      args.roomTypePref,
      args.boardPref,
      args.hotelPref,
      String(args.wantTours),
      String(args.toursCount),
      String(args.wantCar),
      args.carClass,
      String(args.licenseYear ?? ""),
      args.transferType,
      String(args.wantFlight),
      String(args.budgetMin ?? ""),
      String(args.budgetMax ?? ""),
      args.notes,
      String(args.responseAmount),
      args.responseUnit
    ].join("::")
  );

  const agencies = 18 + (seed % 31);
  const fastMin = 6 + (seed % 10);

  const out: PromoItem[] = [];

  // PROGRESS
  if (args.progress < 30) {
    out.push({
      id: "pr-1",
      group: "progress",
      tone: "sky",
      icon: "🧩",
      title: "Paket iskeleti kuruluyor",
      desc: "Şehir + tarih + kişi netleşince acenta çok daha hızlı teklif verir."
    });
  } else if (args.progress < 60) {
    out.push({
      id: "pr-2",
      group: "progress",
      tone: "amber",
      icon: "🔥",
      title: "%50+ oldu… paket şekilleniyor",
      desc: "Şu an doğru yoldasın. Birkaç detay daha gir → teklif kalitesi artar."
    });
  } else if (args.progress < 85) {
    out.push({
      id: "pr-3",
      group: "progress",
      tone: "emerald",
      icon: "✅",
      title: "Müthiş paket geliyor",
      desc: "Şu an acentanın planlaması için yeterince net bir talep oluştu."
    });
  } else {
    out.push({
      id: "pr-4",
      group: "progress",
      tone: "pink",
      icon: "🏆",
      title: "Premium paket talebi hazır",
      desc: "Bu seviyede talepler daha hızlı kapanır — teklifleri kaçırma."
    });
  }

  // CITIES
  if (!args.cities.length) {
    out.push({
      id: "ct-0",
      group: "cities",
      tone: "sky",
      icon: "📍",
      title: "Şehirleri yaz → acenta rotayı planlasın",
      desc: "Bu ekran “otel seçme” değil; “ihtiyaç bildirme” ekranı."
    });
  } else {
    out.push({
      id: "ct-1",
      group: "cities",
      tone: "emerald",
      icon: "🗺️",
      title: `${args.cities.join(" • ")} rotasında ${agencies}+ acenta`,
      desc: `İlk teklif dalgası genelde ${fastMin} dk içinde başlar.`
    });
  }

  // DATES
  if (!args.dateFrom || !args.dateTo) {
    out.push({
      id: "dt-0",
      group: "dates",
      tone: "sky",
      icon: "📅",
      title: "Tarih seç → gece/gün netleşsin",
      desc: "Tarih netliği paket maliyetini doğrudan belirler."
    });
  } else {
    out.push({
      id: "dt-1",
      group: "dates",
      tone: "amber",
      icon: "⏳",
      title: `${args.nights} gece / ${args.nights + 1} gün`,
      desc: "Konaklama gecesini ayrı ayarlayabilirsin. Acenta planı buna göre kurar."
    });
  }

  // PAX
  const pax = args.paxAdults + args.paxChildren;
  out.push({
    id: "px-1",
    group: "pax",
    tone: args.paxChildren > 0 ? "pink" : "emerald",
    icon: args.paxChildren > 0 ? "👨‍👩‍👧" : "👤",
    title: `${pax} kişi için paket tasarlanır`,
    desc: args.paxChildren > 0 ? "Çocuk yaşları girilirse oda planı doğru çıkar." : "Kişi sayısı net → teklif daha hızlı."
  });

  // HOTEL
  out.push({
    id: "ht-1",
    group: "hotel",
    tone: args.hotelPref === "luxury" ? "pink" : args.hotelPref === "any" ? "sky" : "amber",
    icon: "🏨",
    title: `Konaklama: ${args.hotelPref}`,
    desc: args.hotelPref === "any" ? "Farketmez dersen acenta en iyi fiyat/performansı seçer." : "Tercih yaparsan otel bandı netleşir."
  });

  // TOUR
  out.push({
    id: "tr-1",
    group: "tour",
    tone: args.wantTours ? "emerald" : "sky",
    icon: "🧭",
    title: args.wantTours ? `Tur istiyorum: ${Math.max(1, args.toursCount)} tur` : "Tur istemiyorsan aktivite tarzını yaz",
    desc: args.wantTours ? "Tur sayısı net → teklifleri kıyaslamak kolaylaşır." : "“Doğa / alışveriş / tarihi yer” gibi…"
  });

  // CAR
  out.push({
    id: "cr-1",
    group: "car",
    tone: args.wantCar ? (args.carClass === "vip" ? "pink" : "amber") : "sky",
    icon: "🚗",
    title: args.wantCar ? `Araç: ${args.carClass}` : "Araç istemiyorsan transfer daha kritik",
    desc: args.wantCar ? (args.licenseYear ? `Ehliyet yılı: ${args.licenseYear}` : "Ehliyet yılını yazarsan hızlı netleşir.") : "Araç yoksa transfer seçimi paket kalitesini artırır."
  });

  // TRANSFER
  out.push({
    id: "tf-1",
    group: "transfer",
    tone: args.transferType === "roundtrip" ? "emerald" : args.transferType === "oneway" ? "amber" : "sky",
    icon: "🚌",
    title:
      args.transferType === "none"
        ? "Transfer: İstemiyorum"
        : args.transferType === "oneway"
        ? "Transfer: Tek yön"
        : "Transfer: Çift yön",
    desc: "Transfer seçimi toplam fiyatı ciddi etkiler."
  });

  // FLIGHT
  out.push({
    id: "fl-1",
    group: "flight",
    tone: args.wantFlight ? "amber" : "sky",
    icon: "✈️",
    title: args.wantFlight ? "Uçak bileti dahil" : "Uçak bileti yok (opsiyonel)",
    desc: args.wantFlight ? "Şehir/rota ve saat beklentini yazarsan teklif netleşir." : "Uçak dahil değilse acenta otel+tur tarafını güçlendirir."
  });

  // BUDGET
  out.push({
    id: "bd-1",
    group: "budget",
    tone: args.budgetMax != null ? "amber" : "sky",
    icon: "💰",
    title: "Bütçe yazmak teklif kalitesini artırır",
    desc: args.budgetMax != null ? "Bütçe bandı net → acenta boşa teklif yazmaz." : "Bütçe boşsa: çok farklı paketler gelir."
  });

  // NOTES
  out.push({
    id: "nt-1",
    group: "notes",
    tone: "emerald",
    icon: "📝",
    title: "Notlar = paketin kalbi",
    desc: "Şoförlü/VIP/erken giriş/iptal şartı… aynı fiyatı bile değiştirir."
  });

  // DEADLINE
  const human = `${args.responseAmount} ${responseUnitLabelTR(args.responseUnit)}`;
  out.push({
    id: "dl-1",
    group: "deadline",
    tone: args.responseUnit === "minutes" ? "amber" : "emerald",
    icon: "⏱️",
    title: `Cevap süresi: ${human}`,
    desc: args.responseUnit === "minutes"
      ? "Kısa süre = hızlı ilk dalga."
      : args.responseUnit === "hours"
      ? "Orta süre = daha çok acenta."
      : "Uzun süre = maksimum seçenek."
  });

  // group by
  const by: Record<PromoGroup, PromoItem[]> = {
    progress: [],
    cities: [],
    dates: [],
    pax: [],
    hotel: [],
    tour: [],
    car: [],
    transfer: [],
    flight: [],
    budget: [],
    notes: [],
    deadline: []
  };
  out.forEach((x) => by[x.group].push(x));
  return by;
}

function PromoStrip({ items }: { items: PromoItem[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mt-2 grid gap-2">
      {items.map((it) => (
        <div
          key={it.id}
          className={`rounded-xl border px-3 py-2 text-[0.78rem] ${toneCls(it.tone)} bg-black/10`}
          style={{ animation: "promoIn .18s ease-out" }}
        >
          <div className="flex items-start gap-2">
            <div className="text-base leading-none">{it.icon}</div>
            <div className="min-w-0">
              <div className="font-semibold text-slate-50">{it.title}</div>
              <div className="text-[0.72rem] text-slate-200/85 mt-0.5">{it.desc}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div className="mt-1 text-[0.72rem] text-slate-400">{children}</div>;
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
      <p className="text-[0.65rem] text-slate-400">{label}</p>
      <p className="text-sm font-extrabold text-white">{value}</p>
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  const pct = clamp(Math.round(value), 0, 100);
  const barCls =
    pct >= 85 ? "bg-pink-400/80" : pct >= 60 ? "bg-emerald-400/80" : pct >= 30 ? "bg-amber-400/80" : "bg-sky-400/80";

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-center justify-between">
        <p className="text-[0.7rem] text-slate-300">Paket Kalitesi</p>
        <p className="text-[0.7rem] text-slate-200">
          <b className="text-white">{pct}%</b>
        </p>
      </div>
      <div className="mt-2 h-2 rounded-full bg-black/30 overflow-hidden">
        <div className={`h-full ${barCls}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 text-[0.7rem] text-slate-400">
        {pct < 30
          ? "İskelet kuruluyor… (şehir + tarih + kişi)"
          : pct < 60
          ? "Harika gidiyor… (%50 oldu, müthiş paket geliyor)"
          : pct < 85
          ? "Çok iyi… (tur/transfer/araç netleşiyor)"
          : "Premium seviye… (acentanın işi çok kolay, hızlı teklif gelir)"}
      </div>
    </div>
  );
}
export default function GuestPackageRequestNewPage() {
  const { profile, loading: authLoading } = useAuth() as any;
  const db = getFirestoreDb();
  const router = useRouter();

  // wizard focus
  const [activeStep, setActiveStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // core
  const [title, setTitle] = useState("");
  const [citiesText, setCitiesText] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const nights = useMemo(() => calcNights(dateFrom, dateTo), [dateFrom, dateTo]);

  // pax
  const [paxAdults, setPaxAdults] = useState(2);
  const [paxChildren, setPaxChildren] = useState(0);
  const [childrenAges, setChildrenAges] = useState<number[]>([]);

  // hotel
  const [hotelNights, setHotelNights] = useState<number>(nights);
  const [roomsCount, setRoomsCount] = useState(1);
  const [roomTypePref, setRoomTypePref] = useState<RoomTypePref>("any");
  const [boardPref, setBoardPref] = useState<BoardPref>("any");
  const [hotelPref, setHotelPref] = useState<HotelPref>("any");

  // tours
  const [wantTours, setWantTours] = useState(true);
  const [toursCount, setToursCount] = useState(2);
  const [activities, setActivities] = useState("");

  // car
  const [wantCar, setWantCar] = useState(false);
  const [vehicleClass, setVehicleClass] = useState<VehicleClass>("economy");
  const [driverCount, setDriverCount] = useState(1);
  const [licenseYear, setLicenseYear] = useState<number | "">("");
  const [carSeats, setCarSeats] = useState(5);
  const [rentalExtras, setRentalExtras] = useState("");

  // transfer
  const [transferType, setTransferType] = useState<TransferType>("roundtrip");
  const [transferNotes, setTransferNotes] = useState("");

  // flight
  const [wantFlight, setWantFlight] = useState(false);
  const [flightNotes, setFlightNotes] = useState("");

  // budget
  const [budgetMin, setBudgetMin] = useState<string>("");
  const [budgetMax, setBudgetMax] = useState<string>("");

  // notes
  const [specialNotes, setSpecialNotes] = useState("");

  // contact
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  // response time
  const [responseAmount, setResponseAmount] = useState(3);
  const [responseUnit, setResponseUnit] = useState<ResponseUnit>("hours");

  // ui
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okOpen, setOkOpen] = useState(false);
  const [okText, setOkText] = useState("");

  // tick
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => (t + 1) % 999999), 2600);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    setHotelNights(nights);
  }, [nights]);

  useEffect(() => {
    if (!authLoading && profile) {
      setContactName(profile.displayName || "");
      setContactEmail(profile.email || "");
    }
  }, [authLoading, profile]);

  function syncChildrenAges(n: number) {
    setPaxChildren(n);
    setChildrenAges((prev) => {
      const next = [...prev];
      while (next.length < n) next.push(6);
      while (next.length > n) next.pop();
      return next;
    });
  }

  const cities = useMemo(() => {
    const arr = citiesText
      .split(/,|\n/g)
      .map((x) => x.trim())
      .filter(Boolean);
    return Array.from(new Set(arr));
  }, [citiesText]);

  // progress score (0..100)
  const progress = useMemo(() => {
    let score = 0;

    // rota/tarih: 0..40
    if (cities.length >= 1) score += 12;
    if (cities.length >= 2) score += 6;
    if (dateFrom) score += 10;
    if (dateTo) score += 10;
    if (dateFrom && dateTo) score += 2;

    // pax/otel: 0..25
    if (paxAdults >= 1) score += 6;
    if (roomsCount >= 1) score += 4;
    if (paxChildren > 0) score += 3;
    if (paxChildren > 0 && childrenAges.length === paxChildren) score += 2;
    if (roomTypePref !== "any") score += 4;
    if (boardPref !== "any") score += 3;
    if (hotelPref !== "any") score += 3;

    // extras: 0..25
    if (wantTours) score += 6;
    if (wantTours && toursCount > 0) score += 4;
    if (activities.trim().length >= 10) score += 3;

    if (transferType !== "none") score += 4;
    if (transferNotes.trim().length >= 10) score += 2;

    if (wantCar) score += 4;
    if (wantCar && licenseYear !== "") score += 1;
    if (wantCar && rentalExtras.trim().length >= 10) score += 1;

    if (wantFlight) score += 3;
    if (wantFlight && flightNotes.trim().length >= 10) score += 2;

    // budget/notes: 0..10
    if (budgetMin.trim() || budgetMax.trim()) score += 5;
    if (specialNotes.trim().length >= 15) score += 5;

    return clamp(score, 0, 100);
  }, [
    cities.length,
    dateFrom,
    dateTo,
    paxAdults,
    paxChildren,
    childrenAges.length,
    roomsCount,
    roomTypePref,
    boardPref,
    hotelPref,
    wantTours,
    toursCount,
    activities,
    transferType,
    transferNotes,
    wantCar,
    licenseYear,
    rentalExtras,
    wantFlight,
    flightNotes,
    budgetMin,
    budgetMax,
    specialNotes
  ]);

  const bMin = useMemo(() => (budgetMin.trim() ? Number(budgetMin) : null), [budgetMin]);
  const bMax = useMemo(() => (budgetMax.trim() ? Number(budgetMax) : null), [budgetMax]);

  const responseDeadlineMinutes = useMemo(() => {
    const amt = Number(responseAmount) || 1;
    return toMinutes(amt, responseUnit);
  }, [responseAmount, responseUnit]);

  const promos = useMemo(() => {
    return buildPromos({
      tick,
      progress,
      cities,
      dateFrom,
      dateTo,
      nights,
      paxAdults,
      paxChildren,
      roomsCount,
      roomTypePref,
      boardPref,
      hotelPref,
      wantTours,
      toursCount,
      wantCar,
      carClass: wantCar ? vehicleClass : "none",
      licenseYear: licenseYear === "" ? null : Number(licenseYear),
      transferType,
      wantFlight,
      budgetMin: bMin,
      budgetMax: bMax,
      notes: specialNotes,
      responseAmount: Number(responseAmount) || 1,
      responseUnit
    });
  }, [
    tick,
    progress,
    cities,
    dateFrom,
    dateTo,
    nights,
    paxAdults,
    paxChildren,
    roomsCount,
    roomTypePref,
    boardPref,
    hotelPref,
    wantTours,
    toursCount,
    wantCar,
    vehicleClass,
    licenseYear,
    transferType,
    wantFlight,
    bMin,
    bMax,
    specialNotes,
    responseAmount,
    responseUnit
  ]);

  function rotate2<T>(items: T[]) {
    if (!items || items.length === 0) return [];
    if (items.length <= 2) return items;
    const start = tick % items.length;
    return [items[start], items[(start + 1) % items.length]];
  }

  const summary = useMemo(() => {
    const pax = paxAdults + paxChildren;
    const cityCount = cities.length;
    const hasBudget = !!(budgetMin.trim() || budgetMax.trim());

    return {
      cityCount,
      pax,
      nights,
      days: nights + 1,
      hotelNights,
      roomsCount,
      wantTours,
      toursCount: wantTours ? toursCount : 0,
      wantCar,
      vehicleClass: wantCar ? vehicleClass : "none",
      transferType,
      wantFlight,
      hasBudget
    };
  }, [
    paxAdults,
    paxChildren,
    cities.length,
    nights,
    hotelNights,
    roomsCount,
    wantTours,
    toursCount,
    wantCar,
    vehicleClass,
    transferType,
    wantFlight,
    budgetMin,
    budgetMax
  ]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);

    if (!profile?.uid) {
      setErr("Devam etmek için giriş yapmalısın.");
      return;
    }
    if (cities.length === 0) {
      setErr("Lütfen en az 1 şehir yaz (rota şehirleri).");
      return;
    }
    if (!dateFrom || !dateTo) {
      setErr("Lütfen başlangıç ve bitiş tarihini seç.");
      return;
    }
    if (paxAdults < 1) {
      setErr("Yetişkin sayısı en az 1 olmalı.");
      return;
    }
    if (!contactName.trim() || !digitsOnly(contactPhone).length) {
      setErr("İsim ve telefon zorunlu.");
      return;
    }
    if (bMin != null && Number.isNaN(bMin)) {
      setErr("Bütçe min sayısal olmalı.");
      return;
    }
    if (bMax != null && Number.isNaN(bMax)) {
      setErr("Bütçe max sayısal olmalı.");
      return;
    }
    if (bMin != null && bMax != null && bMin > bMax) {
      setErr("Bütçe min, bütçe max’tan büyük olamaz.");
      return;
    }

    try {
      setSaving(true);

      const payload = {
        createdByRole: "guest",
        createdById: profile.uid,
        createdByName: cleanText(profile.displayName) || cleanText(contactName) || "Misafir",
        createdByPhone: digitsOnly(contactPhone) ? cleanText(contactPhone) : null,

        title: cleanText(title) || null,

        cities,
        city: cities[0],
        district: null,

        dateFrom,
        dateTo,
        nights,
        days: nights + 1,

        paxAdults,
        paxChildren,
        childrenAges: paxChildren > 0 ? childrenAges : [],

        hotelNights: Number(hotelNights) || nights,
        roomsCount: Number(roomsCount) || 1,
        roomTypePref,
        boardPref,
        hotelPref,

        wantTours,
        toursCount: wantTours ? Math.max(0, Number(toursCount) || 0) : 0,
        activities: cleanText(activities) || null,

        wantCar,
        vehicleClass: wantCar ? vehicleClass : "none",
        driverCount: wantCar ? Math.max(1, Number(driverCount) || 1) : 0,
        licenseYear: wantCar && licenseYear !== "" ? Number(licenseYear) : null,
        carSeats: wantCar ? Math.max(2, Number(carSeats) || 5) : 0,
        rentalExtras: cleanText(rentalExtras) || null,

        transferType,
        transferNotes: cleanText(transferNotes) || null,

        wantFlight,
        flightNotes: cleanText(flightNotes) || null,

        budgetMin: bMin,
        budgetMax: bMax,

        notes: cleanText(specialNotes) || null,

        contact: {
          name: cleanText(contactName),
          phone: cleanText(contactPhone),
          email: cleanText(contactEmail) || null
        },

        responseDeadlineMinutes,
        responseTimeAmount: Number(responseAmount) || 1,
        responseTimeUnit: responseUnit,

        status: "open",
        createdAt: serverTimestamp(),

        // UI/UX için: kalite metriği
        qualityScore: progress
      };

      await addDoc(collection(db, "packageRequests"), payload);

      setOkText("Paket talebin gönderildi. Acentalar ihtiyaçlarına göre planı kurgulayıp teklif verecek.");
      setOkOpen(true);
    } catch (e: any) {
      console.error(e);
      setErr(e?.message || "Paket talebi kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }
  if (authLoading) {
    return (
      <Protected allowedRoles={["guest"]}>
        <div className="container-page">
          <p className="text-sm text-slate-400">Yükleniyor…</p>
        </div>
      </Protected>
    );
  }

  return (
    <Protected allowedRoles={["guest"]}>
      <div className="container-page max-w-6xl space-y-6 relative">
        {/* premium bg */}
        <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
          <div className="absolute -top-40 left-1/2 h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-emerald-500/10 blur-3xl" />
          <div className="absolute top-44 -left-40 h-[520px] w-[620px] rounded-full bg-sky-500/10 blur-3xl" />
          <div className="absolute bottom-0 -right-56 h-[620px] w-[760px] rounded-full bg-pink-500/10 blur-3xl" />
          <div className="absolute inset-0 bg-gradient-to-b from-slate-950/30 via-slate-950 to-slate-950" />
        </div>

        {/* success overlay */}
        {okOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="rounded-2xl border border-emerald-500/30 bg-slate-950/95 p-6 w-full max-w-md shadow-2xl space-y-3">
              <p className="text-emerald-300 font-semibold text-center text-lg">Premium talep gönderildi 🎉</p>
              <p className="text-[0.85rem] text-slate-200 text-center">{okText}</p>
              <p className="text-[0.75rem] text-slate-400 text-center">
                Teklifleri “Taleplerim” ekranında göreceksin. Beğendiğin teklifi seç → ödeme.
              </p>
              <div className="flex justify-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setOkOpen(false)}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-[0.8rem] text-slate-100 hover:bg-white/10"
                >
                  Burada kal
                </button>
                <button
                  type="button"
                  onClick={() => router.push("/guest/offers")}
                  className="rounded-xl bg-emerald-500 px-4 py-2 text-[0.8rem] font-semibold text-slate-950 hover:bg-emerald-400"
                >
                  Taleplerime git
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Header + Progress + Summary */}
        <div className="rounded-2xl border border-emerald-500/25 bg-gradient-to-r from-emerald-500/12 via-sky-500/5 to-slate-950 px-6 py-5 shadow-[0_30px_120px_rgba(0,0,0,0.45)]">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[0.7rem] text-slate-200">
                🧳 Paket Talebi → Acenta Teklifi → Seçim → Ödeme → Rezervasyon
              </div>

              <h1 className="text-2xl md:text-3xl font-semibold text-slate-100">Paket talebi oluştur</h1>
              <p className="text-sm text-slate-300 max-w-4xl">
                Sen sadece <b>ihtiyaçlarını</b> girersin. Acenta; otel/transfer/tur/araç planını kurar ve teklif verir.
                Bu sayfa “otel seçme” sayfası değildir.
              </p>

              <PromoStrip items={rotate2(promos.progress)} />
            </div>

            <div className="space-y-3 w-full lg:max-w-[420px]">
              <ProgressBar value={progress} />

              <div className="grid grid-cols-2 gap-2">
                <StatChip label="Şehir" value={`${summary.cityCount}`} />
                <StatChip label="Kişi" value={`${summary.pax}`} />
                <StatChip label="Gece" value={`${summary.nights}`} />
                <StatChip label="Oda" value={`${summary.roomsCount}`} />
                <StatChip label="Tur" value={summary.wantTours ? `${summary.toursCount}` : "Yok"} />
                <StatChip label="Araç" value={summary.wantCar ? `${summary.vehicleClass}` : "Yok"} />
                <StatChip label="Transfer" value={summary.transferType} />
                <StatChip label="Uçak" value={summary.wantFlight ? "Var" : "Yok"} />
              </div>
            </div>
          </div>
        </div>

        {err && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-200 text-sm">
            {err}
          </div>
        )}

        {/* Wizard Tabs */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <div className="flex flex-wrap gap-2">
            {(
              [
                { k: 1, t: "Rota & Tarih" },
                { k: 2, t: "Konaklama" },
                { k: 3, t: "Tur/Transfer" },
                { k: 4, t: "Araç/Uçak" },
                { k: 5, t: "Bütçe & Gönder" }
              ] as const
            ).map((s) => (
              <button
                key={s.k}
                type="button"
                onClick={() => setActiveStep(s.k)}
                className={`rounded-full border px-4 py-2 text-[0.75rem] transition ${
                  activeStep === s.k
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                    : "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
                }`}
              >
                {s.t}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* STEP 1 */}
          {activeStep === 1 && (
            <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5 shadow shadow-slate-950/40 space-y-3">
              <h2 className="text-sm font-semibold text-slate-100">1) Rota & Tarih</h2>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs text-slate-200">Paket başlığı (ops.)</label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Örn: Karadeniz 4 gece + 2 tur + araç"
                    className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100"
                  />
                  <Hint>Başlık yazarsan teklifleri listelerken daha hızlı bulursun.</Hint>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-200">Şehirler (rota)</label>
                  <textarea
                    value={citiesText}
                    onChange={(e) => setCitiesText(e.target.value)}
                    placeholder={`Örn:\nTrabzon\nRize\nArtvin\n\nveya\nAntalya, İstanbul`}
                    className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100 h-[96px]"
                  />
                  <Hint>Birden fazla şehir yazabilirsin. Acenta gün gün planı kurar.</Hint>

                  <div className="flex flex-wrap gap-2 mt-2">
                    {CITY_SUGGESTIONS.slice(0, 10).map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => {
                          const cur = citiesText.trim();
                          const next = cur ? `${cur}\n${c}` : c;
                          setCitiesText(next);
                        }}
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[0.7rem] text-slate-200 hover:bg-white/10"
                      >
                        + {c}
                      </button>
                    ))}
                  </div>

                  <PromoStrip items={rotate2(promos.cities)} />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs text-slate-200">Başlangıç</label>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-200">Bitiş</label>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
                <b className="text-emerald-200">Özet:</b> {nights} gece / {nights + 1} gün
              </div>

              <PromoStrip items={rotate2(promos.dates)} />

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setActiveStep(2)}
                  className="rounded-xl bg-emerald-500 px-5 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
                >
                  Devam →
                </button>
              </div>
            </section>
          )}

          {/* STEP 2 */}
          {activeStep === 2 && (
            <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5 shadow shadow-slate-950/40 space-y-3">
              <h2 className="text-sm font-semibold text-slate-100">2) Konaklama & Kişi</h2>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-200">Yetişkin</label>
                  <input
                    type="number"
                    min={1}
                    value={paxAdults}
                    onChange={(e) => setPaxAdults(Number(e.target.value || 1))}
                    placeholder="2"
                    className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-200">Çocuk</label>
                  <input
                    type="number"
                    min={0}
                    value={paxChildren}
                    onChange={(e) => syncChildrenAges(Number(e.target.value || 0))}
                    placeholder="0"
                    className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-200">Oda</label>
                  <input
                    type="number"
                    min={1}
                    value={roomsCount}
                    onChange={(e) => setRoomsCount(Number(e.target.value || 1))}
                    placeholder="1"
                    className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100"
                  />
                </div>
              </div>

              {paxChildren > 0 && (
                <div className="space-y-2">
                  <label className="text-xs text-slate-200">Çocuk yaşları</label>
                  <div className="flex flex-wrap gap-2">
                    {childrenAges.map((age, idx) => (
                      <div key={idx} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 flex items-center gap-2">
                        <span className="text-[0.7rem] text-slate-400">#{idx + 1}</span>
                        <input
                          type="number"
                          min={0}
                          max={17}
                          value={age}
                          onChange={(e) => {
                            const v = Number(e.target.value || 0);
                            setChildrenAges((prev) => prev.map((a, i) => (i === idx ? v : a)));
                          }}
                          className="w-20 rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-xs text-slate-100"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <PromoStrip items={rotate2(promos.pax)} />

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs text-slate-200">Konaklama gecesi</label>
                  <input
                    type="number"
                    min={1}
                    value={hotelNights}
                    onChange={(e) => setHotelNights(Number(e.target.value || 1))}
                    placeholder={`${nights}`}
                    className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100"
                  />
                  <Hint>Tur günleri farklı olabilir. Konaklama gecesini ayrı ayarlayabilirsin.</Hint>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-200">Konaklama konsepti</label>
                  <select
                    value={hotelPref}
                    onChange={(e) => setHotelPref(e.target.value as any)}
                    className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100"
                  >
                    {HOTEL_PREFS.map((h) => (
                      <option key={h.key} value={h.key}>{h.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <PromoStrip items={rotate2(promos.hotel)} />

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs text-slate-200">Oda tipi</label>
                  <select
                    value={roomTypePref}
                    onChange={(e) => setRoomTypePref(e.target.value as any)}
                    className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100"
                  >
                    {ROOM_TYPE_PREFS.map((r) => (
                      <option key={r.key} value={r.key}>{r.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-200">Yeme-içme</label>
                  <select
                    value={boardPref}
                    onChange={(e) => setBoardPref(e.target.value as any)}
                    className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100"
                  >
                    {BOARD_PREFS.map((b) => (
                      <option key={b.key} value={b.key}>{b.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-between">
                <button
                  type="button"
                  onClick={() => setActiveStep(1)}
                  className="rounded-xl border border-white/10 bg-white/5 px-5 py-2 text-sm text-slate-100 hover:bg-white/10"
                >
                  ← Geri
                </button>
                <button
                  type="button"
                  onClick={() => setActiveStep(3)}
                  className="rounded-xl bg-emerald-500 px-5 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
                >
                  Devam →
                </button>
              </div>
            </section>
          )}

          {/* STEP 3 */}
          {activeStep === 3 && (
            <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5 shadow shadow-slate-950/40 space-y-3">
              <h2 className="text-sm font-semibold text-slate-100">3) Tur & Transfer</h2>

              <label className="flex items-center gap-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={wantTours}
                  onChange={(e) => setWantTours(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                />
                Tur istiyorum
              </label>

              {wantTours && (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-200">Tur sayısı</label>
                    <input
                      type="number"
                      min={0}
                      value={toursCount}
                      onChange={(e) => setToursCount(Number(e.target.value || 0))}
                      placeholder="2"
                      className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-200">Aktivite / tur tarzı</label>
                    <textarea
                      value={activities}
                      onChange={(e) => setActivities(e.target.value)}
                      placeholder="Örn: doğa, yayla, tekne turu, tarihi yerler, alışveriş..."
                      className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100 h-[90px]"
                    />
                  </div>
                </div>
              )}

              <PromoStrip items={rotate2(promos.tour)} />

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs text-slate-200">Transfer</label>
                  <select
                    value={transferType}
                    onChange={(e) => setTransferType(e.target.value as any)}
                    className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100"
                  >
                    <option value="none">İstemiyorum</option>
                    <option value="oneway">Tek yön</option>
                    <option value="roundtrip">Çift yön</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-200">Transfer notu (ops.)</label>
                  <textarea
                    value={transferNotes}
                    onChange={(e) => setTransferNotes(e.target.value)}
                    placeholder="Örn: Trabzon Havalimanı → Otel / VIP olsun / saat aralığı..."
                    className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100 h-[90px]"
                  />
                </div>
              </div>

              <PromoStrip items={rotate2(promos.transfer)} />

              <div className="flex justify-between">
                <button
                  type="button"
                  onClick={() => setActiveStep(2)}
                  className="rounded-xl border border-white/10 bg-white/5 px-5 py-2 text-sm text-slate-100 hover:bg-white/10"
                >
                  ← Geri
                </button>
                <button
                  type="button"
                  onClick={() => setActiveStep(4)}
                  className="rounded-xl bg-emerald-500 px-5 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
                >
                  Devam →
                </button>
              </div>
            </section>
          )}

          {/* STEP 4 */}
          {activeStep === 4 && (
            <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5 shadow shadow-slate-950/40 space-y-3">
              <h2 className="text-sm font-semibold text-slate-100">4) Araç & Uçak</h2>

              <label className="flex items-center gap-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={wantCar}
                  onChange={(e) => setWantCar(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                />
                Araç istiyorum
              </label>

              {wantCar && (
                <>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="space-y-1">
                      <label className="text-xs text-slate-200">Araç tipi</label>
                      <select
                        value={vehicleClass}
                        onChange={(e) => setVehicleClass(e.target.value as any)}
                        className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100"
                      >
                        {VEHICLE_CLASS.map((v) => (
                          <option key={v.key} value={v.key}>{v.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-slate-200">Kapasite</label>
                      <input
                        type="number"
                        min={2}
                        value={carSeats}
                        onChange={(e) => setCarSeats(Number(e.target.value || 5))}
                        placeholder="5"
                        className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-slate-200">Sürücü sayısı</label>
                      <input
                        type="number"
                        min={1}
                        value={driverCount}
                        onChange={(e) => setDriverCount(Number(e.target.value || 1))}
                        placeholder="1"
                        className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100"
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs text-slate-200">Ehliyet yılı (ops.)</label>
                      <input
                        type="number"
                        min={1970}
                        max={new Date().getFullYear()}
                        value={licenseYear}
                        onChange={(e) => setLicenseYear(e.target.value ? Number(e.target.value) : "")}
                        placeholder="Örn: 2016"
                        className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-slate-200">Ekstra (ops.)</label>
                      <textarea
                        value={rentalExtras}
                        onChange={(e) => setRentalExtras(e.target.value)}
                        placeholder="Örn: bebek koltuğu, zincir, navigasyon, ek sigorta..."
                        className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100 h-[90px]"
                      />
                    </div>
                  </div>
                </>
              )}

              <PromoStrip items={rotate2(promos.car)} />

              <label className="flex items-center gap-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={wantFlight}
                  onChange={(e) => setWantFlight(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                />
                Uçak bileti dahil olsun
              </label>

              {wantFlight && (
                <textarea
                  value={flightNotes}
                  onChange={(e) => setFlightNotes(e.target.value)}
                  placeholder="Örn: İstanbul çıkışlı, sabah gidiş, akşam dönüş, yurt içi/yurt dışı..."
                  className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100 h-[90px]"
                />
              )}

              <PromoStrip items={rotate2(promos.flight)} />

              <div className="flex justify-between">
                <button
                  type="button"
                  onClick={() => setActiveStep(3)}
                  className="rounded-xl border border-white/10 bg-white/5 px-5 py-2 text-sm text-slate-100 hover:bg-white/10"
                >
                  ← Geri
                </button>
                <button
                  type="button"
                  onClick={() => setActiveStep(5)}
                  className="rounded-xl bg-emerald-500 px-5 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
                >
                  Devam →
                </button>
              </div>
            </section>
          )}

          {/* STEP 5 */}
          {activeStep === 5 && (
            <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5 shadow shadow-slate-950/40 space-y-3">
              <h2 className="text-sm font-semibold text-slate-100">5) Bütçe, Notlar, Cevap Süresi & Gönder</h2>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs text-slate-200">Bütçe Min (₺)</label>
                  <input
                    value={budgetMin}
                    onChange={(e) => setBudgetMin(e.target.value)}
                    placeholder="Örn: 25000"
                    className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-200">Bütçe Max (₺)</label>
                  <input
                    value={budgetMax}
                    onChange={(e) => setBudgetMax(e.target.value)}
                    placeholder="Örn: 45000"
                    className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100"
                  />
                </div>
              </div>

              <PromoStrip items={rotate2(promos.budget)} />

              <div className="space-y-1">
                <label className="text-xs text-slate-200">Özel istekler / şartlar</label>
                <textarea
                  value={specialNotes}
                  onChange={(e) => setSpecialNotes(e.target.value)}
                  placeholder="Örn: şoförlü araç, sigarasız oda, iptal şartı, ödeme tipi, detaylı fiyat kırılımı istiyorum..."
                  className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100 h-[120px]"
                />
              </div>

              <PromoStrip items={rotate2(promos.notes)} />

              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-200">Ad Soyad *</label>
                  <input
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="Örn: Yunus Emre"
                    className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-200">Telefon *</label>
                  <input
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder="Örn: +90 532 123 45 67"
                    className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-200">E-posta (ops.)</label>
                  <input
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="Örn: yunus@mail.com"
                    className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100"
                  />
                </div>
              </div>

              {/* Cevap süresi: dk/saat/gün + reklam */}
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-2">
                <p className="text-sm font-semibold text-slate-100">Acentaların cevap süresi</p>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-200">Süre miktarı</label>
                    <input
                      type="number"
                      min={1}
                      value={responseAmount}
                      onChange={(e) => setResponseAmount(Number(e.target.value || 1))}
                      placeholder="Örn: 3"
                      className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-slate-200">Birim</label>
                    <select
                      value={responseUnit}
                      onChange={(e) => setResponseUnit(e.target.value as any)}
                      className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100"
                    >
                      <option value="minutes">dakika</option>
                      <option value="hours">saat</option>
                      <option value="days">gün</option>
                    </select>
                  </div>
                </div>

                <div className="text-[0.75rem] text-slate-400">
                  Seçtiğin süre: <b className="text-slate-100">{responseAmount} {responseUnitLabelTR(responseUnit)}</b>
                  {" "}→ sistem bunu <b className="text-slate-100">{responseDeadlineMinutes} dakika</b> olarak kaydeder.
                </div>

                <PromoStrip items={rotate2(promos.deadline)} />
              </div>

              <div className="flex justify-between">
                <button
                  type="button"
                  onClick={() => setActiveStep(4)}
                  className="rounded-xl border border-white/10 bg-white/5 px-5 py-2 text-sm text-slate-100 hover:bg-white/10"
                >
                  ← Geri
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-emerald-500 px-6 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60 shadow-lg shadow-emerald-500/25"
                >
                  {saving ? "Gönderiliyor..." : "Paket talebini gönder"}
                </button>
              </div>
            </section>
          )}
        </form>

        <style jsx global>{`
          @keyframes promoIn {
            from { opacity: 0; transform: translateY(6px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </div>
    </Protected>
  );
}
