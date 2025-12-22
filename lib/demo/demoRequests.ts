// lib/demo/demoRequests.ts
export type DemoReqType = "hotel" | "group" | "package";

export type DealModel = "%8" | "%10" | "%15";

export type TransferType = "oneway" | "round";

export type CarType = "eco" | "suv" | "vip" | "van";

export type DemoRequest = {
  id: string;
  type: DemoReqType;

  country: string;     // HER ZAMAN string
  city: string;        // HER ZAMAN string
  district: string;    // ✅ HATA BURADAYDI -> HER ZAMAN string

  checkIn: string;     // YYYY-MM-DD
  checkOut: string;    // YYYY-MM-DD
  nights: number;

  adults: number;
  children: number;
  rooms: number;

  board?: string;      // RO/BB/HB/FB/AI/UAI
  star?: number | null;

  features: string[];
  responseWindowMin: number;
  demandScore: number; // 0..100
  note?: string;

  // paket için ekstra
  wantsTransfer?: boolean;
  transferType?: TransferType;

  wantsTours?: boolean;
  tourCount?: number;

  wantsCar?: boolean;
  carType?: CarType;

  extras?: string[];

  dealModel?: DealModel;
};

type Loc = { city: string; district: string; country: string };

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(base: Date, addDays: number) {
  const d = new Date(base);
  d.setDate(d.getDate() + addDays);
  return d.toISOString().slice(0, 10);
}

function pick<T>(arr: readonly T[], seed: number) {
  return arr[seed % arr.length];
}

// deterministic rnd
function makeRnd(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

const TR_LOCATIONS: readonly Loc[] = [
  { city: "İstanbul", district: "Beşiktaş", country: "Türkiye" },
  { city: "İstanbul", district: "Kadıköy", country: "Türkiye" },
  { city: "İstanbul", district: "Şişli", country: "Türkiye" },
  { city: "Ankara", district: "Çankaya", country: "Türkiye" },
  { city: "İzmir", district: "Çeşme", country: "Türkiye" },
  { city: "İzmir", district: "Konak", country: "Türkiye" },
  { city: "Antalya", district: "Konyaaltı", country: "Türkiye" },
  { city: "Antalya", district: "Alanya", country: "Türkiye" },
  { city: "Trabzon", district: "Ortahisar", country: "Türkiye" },
  { city: "Rize", district: "Ardeşen", country: "Türkiye" },
  { city: "Muğla", district: "Bodrum", country: "Türkiye" },
  { city: "Muğla", district: "Marmaris", country: "Türkiye" },
  { city: "Bursa", district: "Nilüfer", country: "Türkiye" },
  { city: "Samsun", district: "Atakum", country: "Türkiye" },
  { city: "Mardin", district: "Artuklu", country: "Türkiye" },
];

const INT_LOCATIONS: readonly Loc[] = [
  { city: "Dubai", district: "Marina", country: "BAE" },
  { city: "Baku", district: "Sabail", country: "Azerbaycan" },
  { city: "Tbilisi", district: "Old Town", country: "Gürcistan" },
  { city: "Doha", district: "West Bay", country: "Katar" },
];

const BOARDS = ["RO", "BB", "HB", "FB", "AI", "UAI"] as const;
const ACC_TYPES = ["hotel", "boutique", "apartHotel", "apartment", "bungalow", "holidayVillage", "hostel"] as const;

const FEATS = [
  "Havuz",
  "Spa",
  "Deniz",
  "Merkez",
  "Otopark",
  "Aile",
  "Manzara",
  "Ücretsiz iptal",
  "Sessiz oda",
  "VIP transfer",
  "Erken giriş",
  "Geç çıkış",
] as const;

const NOTES = [
  "Sessiz oda olsun, üst kat tercih.",
  "Geç giriş yapacağız (23:30 sonrası).",
  "Bebek yatağı rica ediyoruz.",
  "Deniz manzarası olursa harika olur.",
  "Ücretsiz iptal önemli.",
  "Araçla geleceğiz, otopark şart.",
  "Havuz + spa öncelikli.",
] as const;

const EXTRAS = [
  "Çocuk koltuğu",
  "Ek bagaj",
  "Hızlı check-in",
  "Balayı paketi",
  "Rehberli şehir turu",
  "VIP karşılama",
] as const;

const CAR_TYPES: readonly CarType[] = ["eco", "suv", "vip", "van"];

export function buildDemoRequests(count = 80, seed = 20251222): DemoRequest[] {
  const rnd = makeRnd(seed);
  const base = new Date(todayISO());
  const out: DemoRequest[] = [];

  for (let i = 0; i < count; i++) {
    const type: DemoReqType = i % 5 === 0 ? "group" : i % 3 === 0 ? "package" : "hotel";

    // paketlerde yurt dışı oranı daha yüksek
    const useIntl = type === "package" && rnd() > 0.65;

    const loc = useIntl ? pick(INT_LOCATIONS, i * 7 + 3) : pick(TR_LOCATIONS, i * 5 + 1);

    // ✅ district garanti olsun
    const city = String(loc?.city ?? "İstanbul");
    const district = String(loc?.district ?? "Merkez");
    const country = String(loc?.country ?? "Türkiye");

    const startInDays = 1 + Math.floor(rnd() * 30);
    const nights = type === "group" ? 2 + Math.floor(rnd() * 6) : 1 + Math.floor(rnd() * 6);

    const checkIn = addDaysISO(base, startInDays);
    const checkOut = addDaysISO(base, startInDays + nights);

    const adults = type === "group" ? 10 + Math.floor(rnd() * 55) : 1 + Math.floor(rnd() * 4);
    const children = type === "group" ? Math.floor(rnd() * 15) : (rnd() > 0.65 ? 1 + Math.floor(rnd() * 2) : 0);

    const rooms = type === "group"
      ? Math.max(5, Math.floor((adults + children) / 2))
      : (1 + (rnd() > 0.75 ? 1 : 0));

    const board = pick(BOARDS, i * 11 + 2);
    const star = rnd() > 0.72 ? 5 : rnd() > 0.45 ? 4 : rnd() > 0.22 ? 3 : null;

    const featureSet = Array.from(
      new Set<string>([
        pick(FEATS, i * 3 + 1),
        pick(FEATS, i * 5 + 2),
        rnd() > 0.65 ? pick(FEATS, i * 7 + 3) : "",
        rnd() > 0.75 ? pick(FEATS, i * 9 + 4) : "",
      ].filter(Boolean))
    );

    const demandScore = clamp(Math.floor(40 + rnd() * 60), 0, 100);
    const responseWindows = [30, 45, 60, 90, 120, 180, 240];
    const responseWindowMin = pick(responseWindows, i * 13 + 1);

    const dealModel: DealModel = demandScore >= 80 ? "%15" : demandScore >= 60 ? "%10" : "%8";

    // paket extras
    const wantsTransfer = type === "package" ? rnd() > 0.35 : false;
    const transferType: TransferType | undefined = wantsTransfer ? (rnd() > 0.55 ? "round" : "oneway") : undefined;

    const wantsTours = type === "package" ? rnd() > 0.35 : false;
    const tourCount = wantsTours ? 1 + Math.floor(rnd() * 3) : undefined;

    const wantsCar = type === "package" ? rnd() > 0.45 : false;
    const carType = wantsCar ? pick(CAR_TYPES, i * 17 + 4) : undefined;

    const extrasPick = type === "package"
      ? Array.from(new Set<string>([
          rnd() > 0.30 ? pick(EXTRAS, i * 2 + 1) : "",
          rnd() > 0.55 ? pick(EXTRAS, i * 4 + 2) : "",
          rnd() > 0.75 ? pick(EXTRAS, i * 6 + 3) : "",
        ].filter(Boolean)))
      : [];

    out.push({
      id: `demo-${type}-${i}-${Math.floor(rnd() * 9999)}`,
      type,
      country,
      city,
      district,
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
      note: pick(NOTES, i * 19 + 3),
      dealModel,

      wantsTransfer,
      transferType,
      wantsTours,
      tourCount,
      wantsCar,
      carType,
      extras: extrasPick,
    });
  }

  // newest-first hissi
  return out.reverse();
}
