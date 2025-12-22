"use client";

import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Protected } from "@/components/Protected";
import { useAuth } from "@/context/AuthContext";
import { getFirestoreDb } from "@/lib/firebase/client";
import {
  addDoc,
  collection,
  getDocs,
  query,
  serverTimestamp,
  where
} from "firebase/firestore";

/** -------------------- TYPES -------------------- */

type BoardType = "RO" | "BB" | "HB" | "FB" | "AI" | "UAI";

type FeatureKey =
  | "pool"
  | "spa"
  | "parking"
  | "wifi"
  | "seaView"
  | "balcony"
  | "family"
  | "petFriendly"
  | "busParking"
  | "meetingRoom"
  | "bySea"
  | "closeToCenter"
  | "teamFriendly"
  | "allInclusiveFriendly";

type RoomTypeKey = "standard" | "family" | "suite" | "deluxe";

type PropertyTypeKey = "hotel" | "motel" | "apart" | "pension" | "hostel" | "villa";

type ResponseUnit = "minutes" | "hours" | "days";

interface RoomRowState {
  id: string;
  typeKey: RoomTypeKey;
  count: string; // string input
}

interface CityOption {
  name: string;
  districts: string[];
}

/** -------------------- SABİTLER -------------------- */

const ROOM_TYPE_OPTIONS: { key: RoomTypeKey; label: string }[] = [
  { key: "standard", label: "Standart oda (double / twin)" },
  { key: "family", label: "Aile odası" },
  { key: "suite", label: "Suit oda" },
  { key: "deluxe", label: "Deluxe oda" }
];

const BOARD_OPTIONS: { key: BoardType; label: string }[] = [
  { key: "RO", label: "Sadece oda (RO)" },
  { key: "BB", label: "Oda + Kahvaltı (BB)" },
  { key: "HB", label: "Yarım pansiyon (HB)" },
  { key: "FB", label: "Tam pansiyon (FB)" },
  { key: "AI", label: "Her şey dahil (AI)" },
  { key: "UAI", label: "Ultra her şey dahil (UAI)" }
];

const FEATURE_OPTIONS: { key: FeatureKey; label: string }[] = [
  { key: "pool", label: "Havuz" },
  { key: "spa", label: "Spa / Wellness" },
  { key: "parking", label: "Otopark" },
  { key: "busParking", label: "Otobüs park alanı" },
  { key: "meetingRoom", label: "Toplantı salonu" },
  { key: "wifi", label: "Ücretsiz Wi-Fi" },
  { key: "seaView", label: "Deniz manzarası" },
  { key: "bySea", label: "Denize sıfır / sahile yakın" },
  { key: "closeToCenter", label: "Şehir merkezine yakın" },
  { key: "balcony", label: "Balkon" },
  { key: "family", label: "Aile odaları" },
  { key: "teamFriendly", label: "Spor / takım kafilesine uygun" },
  { key: "allInclusiveFriendly", label: "Her şey dahil otel tercih" },
  { key: "petFriendly", label: "Evcil hayvan kabul edilir" }
];

const PROPERTY_TYPE_OPTIONS: { key: PropertyTypeKey; label: string }[] = [
  { key: "hotel", label: "Otel" },
  { key: "motel", label: "Motel" },
  { key: "apart", label: "Apart" },
  { key: "pension", label: "Pansiyon" },
  { key: "hostel", label: "Hostel" },
  { key: "villa", label: "Villa / Bungalov" }
];

const CITY_OPTIONS: CityOption[] = [
  {
    name: "Trabzon",
    districts: ["Ortahisar", "Akçaabat", "Yomra", "Sürmene", "Of", "Araklı"]
  },
  {
    name: "İstanbul",
    districts: ["Beşiktaş", "Şişli", "Fatih", "Kadıköy", "Üsküdar", "Bakırköy", "Beyoğlu"]
  },
  {
    name: "Antalya",
    districts: ["Konyaaltı", "Muratpaşa", "Alanya", "Kemer", "Side", "Belek"]
  },
  {
    name: "Ankara",
    districts: ["Çankaya", "Keçiören", "Yenimahalle", "Mamak", "Sincan", "Etimesgut"]
  }
];

const PHONE_CODES = [
  { code: "+90", label: "🇹🇷 Türkiye" },
  { code: "+994", label: "🇦🇿 Azerbaycan" },
  { code: "+7", label: "🇷🇺 Rusya / Kazakistan" },
  { code: "+971", label: "🇦🇪 BAE" },
  { code: "+966", label: "🇸🇦 Suudi Arabistan" },
  { code: "+974", label: "🇶🇦 Katar" },
  { code: "+965", label: "🇰🇼 Kuveyt" },
  { code: "+968", label: "🇴🇲 Umman" },
  { code: "+973", label: "🇧🇭 Bahreyn" },
  { code: "+964", label: "🇮🇶 Irak" }
];

/** -------------------- HELPERS -------------------- */

function cleanText(v: any) {
  return String(v ?? "").trim();
}
function digitsOnly(v: string) {
  return v.replace(/\D/g, "");
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function addDaysISO(startISO: string, days: number): string {
  const d = new Date(startISO);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function calculateNights(checkInISO: string, checkOutISO: string): number {
  const ci = new Date(checkInISO);
  const co = new Date(checkOutISO);
  const diffMs = co.getTime() - ci.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return diffDays > 0 ? diffDays : 1;
}
function toMinutes(amount: number, unit: ResponseUnit): number {
  if (unit === "minutes") return amount;
  if (unit === "hours") return amount * 60;
  return amount * 60 * 24;
}
function responseUnitLabelTR(unit: ResponseUnit): string {
  if (unit === "minutes") return "dakika";
  if (unit === "hours") return "saat";
  return "gün";
}

/** ----------- NOTIFICATION: otellere talep bildirimi (şehir/ilçe filtreli) ----------- */
async function notifyHotelsForNewRequest(args: {
  db: ReturnType<typeof getFirestoreDb>;
  requestId: string;
  city: string;
  district: string | null;
  checkIn: string;
  checkOut: string;
  adults: number;
  childrenCount: number;
  roomsCount: number;
}) {
  const { db, requestId, city, district, checkIn, checkOut, adults, childrenCount, roomsCount } = args;

  const usersCol = collection(db, "users");
  const notificationsCol = collection(db, "notifications");

  // Yeni şema: users.hotelProfile.city/district
  const q1 = district
    ? query(
        usersCol,
        where("role", "==", "hotel"),
        where("hotelProfile.city", "==", city),
        where("hotelProfile.district", "==", district)
      )
    : query(usersCol, where("role", "==", "hotel"), where("hotelProfile.city", "==", city));

  let snap = await getDocs(q1);

  // Fallback: eski şema users.city/district
  if (snap.empty) {
    const q2 = district
      ? query(usersCol, where("role", "==", "hotel"), where("city", "==", city), where("district", "==", district))
      : query(usersCol, where("role", "==", "hotel"), where("city", "==", city));
    snap = await getDocs(q2);
  }

  const base = {
    to: "",
    type: "new_request",
    payload: { requestId, city, district, checkIn, checkOut, adults, childrenCount, roomsCount },
    createdAt: serverTimestamp(),
    read: false
  };

  const promises: Promise<any>[] = [];
  snap.forEach((d) => promises.push(addDoc(notificationsCol, { ...base, to: d.id })));
  if (promises.length) await Promise.all(promises);
}

/** -------------------- REKLAM MOTORU (DAĞILMIŞ HAVUZLAR) -------------------- */

type CampaignTone = "emerald" | "amber" | "pink" | "sky";
type CampaignGroup =
  | "city"
  | "district"
  | "dates"
  | "rooms"
  | "roomRows"
  | "property"
  | "board"
  | "stars"
  | "features"
  | "company"
  | "deadline"
  | "phone";

type CampaignItem = {
  id: string;
  group: CampaignGroup;
  tone: CampaignTone;
  icon: string;
  title: string;
  desc: string;
};

function toneBadge(t: CampaignTone) {
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

function buildGroupCampaigns(args: {
  tick: number;
  city: string;
  districtsCount: number;
  checkIn: string;
  checkOut: string;
  nights: number;
  roomsCount: number;
  roomRows: RoomRowState[];
  propertyTypes: PropertyTypeKey[];
  boardTypes: BoardType[];
  stars: number[];
  features: FeatureKey[];
  company: string;
  phoneLocal: string;
  respAmount: number;
  respUnit: ResponseUnit;
}) {
  const seed = hashSeed(
    [
      args.city,
      String(args.districtsCount),
      args.checkIn,
      args.checkOut,
      String(args.nights),
      String(args.roomsCount),
      args.roomRows.map((r) => `${r.typeKey}:${r.count}`).join("|"),
      args.propertyTypes.join(","),
      args.boardTypes.join(","),
      args.stars.join(","),
      args.features.join(","),
      args.company,
      args.phoneLocal,
      String(args.respAmount),
      args.respUnit,
      String(args.tick)
    ].join("::")
  );

  const crowd = 35 + (seed % 55); // %35 - %90
  const hotels = 12 + (seed % 28); // 12 - 39
  const fast = 6 + (seed % 10); // 6 - 15 dk
  const out: CampaignItem[] = [];

  // CITY
  if (!args.city) {
    out.push({
      id: "ct-0",
      group: "city",
      tone: "sky",
      icon: "📍",
      title: "Şehir seç → oteller eşleşsin",
      desc: "Şehir seçilmeden sistem otel havuzu çıkaramaz."
    });
  } else {
    const cityTemplates: Array<(s: number) => CampaignItem> = [
      (s) => ({
        id: `ct-a-${s}`,
        group: "city",
        tone: "emerald",
        icon: "🟢",
        title: `${args.city}: ${hotels}+ otel uygunluk taramasında`,
        desc: `Şu an yoğunluk %${crowd}. İlk teklif genelde ${fast} dk içinde düşüyor.`
      }),
      (s) => ({
        id: `ct-b-${s}`,
        group: "city",
        tone: "amber",
        icon: "📈",
        title: `${args.city}’da grup talepleri artıyor`,
        desc: "5+ oda taleplerinde oteller öne geçmek ister: daha agresif fiyat görebilirsin."
      }),
      (s) => ({
        id: `ct-c-${s}`,
        group: "city",
        tone: "sky",
        icon: "🎯",
        title: "Şehir seçimi tamam → şimdi ilçe ile netleştir",
        desc: "İlçe seçimi: daha az otel ama daha isabetli teklif."
      })
    ];
    out.push(pick(cityTemplates, seed)(seed));
  }

  // DISTRICT
  if (args.city && args.districtsCount === 0) {
    out.push({
      id: "ds-0",
      group: "district",
      tone: "amber",
      icon: "🧲",
      title: "İlçe seçmezsen daha çok otel görür",
      desc: "Çok teklif istiyorsan ilçe boş kalsın. Kalite istiyorsan 1-2 ilçe seç."
    });
  } else if (args.districtsCount > 0) {
    out.push({
      id: "ds-1",
      group: "district",
      tone: "sky",
      icon: "📍",
      title: "İlçe seçimi: daha hedefli teklif",
      desc: "Seçtiğin ilçelerdeki oteller daha doğru fiyat verir."
    });
  }

  // DATES
  out.push({
    id: "dt-1",
    group: "dates",
    tone: "emerald",
    icon: "📅",
    title: `Tarih net: ${args.nights} gece`,
    desc: "Tarih netleşince otel uygunluk + fiyatlamayı daha hızlı yapar."
  });

  // ROOMS
  if (args.roomsCount >= 10) {
    out.push({
      id: "rm-10",
      group: "rooms",
      tone: "pink",
      icon: "🏷️",
      title: "10+ oda = oteller için büyük iş",
      desc: "Bu büyüklükte gruplarda oteller pazarlık alanı bırakır."
    });
  } else {
    out.push({
      id: "rm-5",
      group: "rooms",
      tone: "amber",
      icon: "🏨",
      title: "5+ oda talebi hızlı dönüş alır",
      desc: "Otel tarafı gruplara özel fiyat çıkarır."
    });
  }

  // ROOM ROWS
  const hasFamily = args.roomRows.some((r) => r.typeKey === "family" && Number(r.count) > 0);
  const hasSuite = args.roomRows.some((r) => r.typeKey === "suite" && Number(r.count) > 0);
  if (hasFamily) {
    out.push({
      id: "rr-family",
      group: "roomRows",
      tone: "pink",
      icon: "👨‍👩‍👧‍👦",
      title: "Aile odalarında yoğunluk var",
      desc: "Aile oda stokları hızlı biter — erken talep avantaj sağlar."
    });
  }
  if (hasSuite) {
    out.push({
      id: "rr-suite",
      group: "roomRows",
      tone: "amber",
      icon: "✨",
      title: "Suit odalar sınırlı",
      desc: "Az teklif gelir ama kalite daha yüksek olur."
    });
  }
  if (!hasFamily && !hasSuite) {
    out.push({
      id: "rr-any",
      group: "roomRows",
      tone: "sky",
      icon: "🧠",
      title: "Oda kırılımı net → fiyat daha doğru",
      desc: "Standart/Aile/Suit dağılımı netleşince oteller hızlı hesaplar."
    });
  }

  // PROPERTY
  if (args.propertyTypes.length === 0) {
    out.push({
      id: "pt-0",
      group: "property",
      tone: "sky",
      icon: "🧩",
      title: "Tesis tipi seçmezsen seçenek artar",
      desc: "Otel/apart/pansiyon hepsi teklif verebilir → daha çok alternatif."
    });
  } else {
    out.push({
      id: "pt-1",
      group: "property",
      tone: "emerald",
      icon: "✅",
      title: "Tesis tipi seçimi kaliteyi sabitler",
      desc: "Tesis tipi seçmek, otellerin doğru fiyat çıkarmasını kolaylaştırır."
    });
  }

  // BOARD
  if (args.boardTypes.length === 0) {
    out.push({
      id: "bd-0",
      group: "board",
      tone: "sky",
      icon: "🍴",
      title: "Konaklama tipini seçersen fiyat netleşir",
      desc: "RO/BB/HB/AI seçiminde oteller daha isabetli teklif verir."
    });
  } else {
    out.push({
      id: "bd-1",
      group: "board",
      tone: "amber",
      icon: "🍽️",
      title: "Board seçimi pazarlık gücünü etkiler",
      desc: "HB/AI gibi seçimlerde oteller kampanya sunabilir."
    });
  }

  // STARS
  if (args.stars.length === 0) {
    out.push({
      id: "st-0",
      group: "stars",
      tone: "sky",
      icon: "⭐",
      title: "Yıldız seçimi kalite bandını netleştirir",
      desc: "4★/5★ seçimi daha premium teklif getirir."
    });
  } else if (args.stars.includes(5)) {
    out.push({
      id: "st-5",
      group: "stars",
      tone: "pink",
      icon: "🏆",
      title: "5★ seçimi = VIP teklif dalgası",
      desc: "Premium oteller ilk saat içinde agresif fiyat verebilir."
    });
  } else {
    out.push({
      id: "st-any",
      group: "stars",
      tone: "amber",
      icon: "⭐",
      title: "Yıldız seçimi = daha doğru teklif",
      desc: "Otel tarafı kaliteye göre net fiyat çıkarır."
    });
  }

  // FEATURES
  if (args.features.length === 0) {
    out.push({
      id: "ft-0",
      group: "features",
      tone: "sky",
      icon: "🧩",
      title: "Özellik seçimi teklif kalitesini artırır",
      desc: "Toplantı salonu / otobüs parkı gibi seçimler hedefi daraltır."
    });
  } else {
    if (args.features.includes("busParking")) {
      out.push({
        id: "ft-bus",
        group: "features",
        tone: "amber",
        icon: "🚌",
        title: "Otobüs parkı: doğru otel filtresi",
        desc: "Grup otelleri bu detayı görünce daha hızlı dönüş verir."
      });
    }
    if (args.features.includes("meetingRoom")) {
      out.push({
        id: "ft-meet",
        group: "features",
        tone: "pink",
        icon: "🏢",
        title: "Toplantı salonu: kurumsal teklif artar",
        desc: "Kurumsal gruplara oteller ekstra avantaj ekleyebilir."
      });
    }
    if (args.features.includes("teamFriendly")) {
      out.push({
        id: "ft-team",
        group: "features",
        tone: "emerald",
        icon: "🏅",
        title: "Takım kafilesi: oteller özel fiyat verir",
        desc: "Takım grupları için oteller hızlı paket oluşturur."
      });
    }
  }

  // COMPANY
  if (!args.company.trim()) {
    out.push({
      id: "cp-0",
      group: "company",
      tone: "amber",
      icon: "🏷️",
      title: "Firma/Kurum alanı zorunlu",
      desc: "Otel tarafı grubu ciddiye alır → dönüş oranı yükselir."
    });
  } else {
    out.push({
      id: "cp-1",
      group: "company",
      tone: "emerald",
      icon: "✅",
      title: `${args.company} için teklif akışı güçlenir`,
      desc: "Kurumsal/takım bilgisi otelin hızlı fiyat çıkarmasını sağlar."
    });
  }

  // PHONE
  if (digitsOnly(args.phoneLocal).length < 10) {
    out.push({
      id: "ph-0",
      group: "phone",
      tone: "sky",
      icon: "📞",
      title: "Telefon girersen otel hızlı teyit eder",
      desc: "Grup taleplerinde oteller bazen hızlı arayarak netleştirir."
    });
  } else {
    out.push({
      id: "ph-1",
      group: "phone",
      tone: "emerald",
      icon: "📞",
      title: "Telefon hazır → hızlı kapanış",
      desc: "İyi teklif geldiğinde otel seni hızlıca teyit edebilir."
    });
  }

  // DEADLINE
  const human = `${args.respAmount} ${responseUnitLabelTR(args.respUnit)}`;
  out.push({
    id: "dl-1",
    group: "deadline",
    tone: args.respUnit === "minutes" ? "amber" : "emerald",
    icon: "⏱️",
    title: `Cevap süresi: ${human}`,
    desc:
      args.respUnit === "minutes"
        ? "Kısa süre → hızlı ilk dalga. Oteller agresif fiyat atar."
        : args.respUnit === "hours"
        ? "Orta süre → daha çok otel. Fiyat çeşitliliği artar."
        : "Uzun süre → maksimum otel havuzu. Daha fazla seçenek gelir."
  });

  // group-by
  const by: Record<CampaignGroup, CampaignItem[]> = {
    city: [],
    district: [],
    dates: [],
    rooms: [],
    roomRows: [],
    property: [],
    board: [],
    stars: [],
    features: [],
    company: [],
    deadline: [],
    phone: []
  };
  for (const x of out) by[x.group].push(x);

  // uniq per group
  for (const k of Object.keys(by) as CampaignGroup[]) {
    const seen = new Set<string>();
    by[k] = by[k].filter((it) => {
      if (seen.has(it.id)) return false;
      seen.add(it.id);
      return true;
    });
  }

  return by;
}

/** -------------------- PROMO UI -------------------- */

function PromoStrip({ items }: { items: CampaignItem[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mt-2 grid gap-2">
      {items.map((it) => (
        <div
          key={it.id}
          className={`rounded-xl border px-3 py-2 text-[0.78rem] ${toneBadge(it.tone)} bg-black/10`}
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
export default function GuestGroupRequestPage() {
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();
  const db = getFirestoreDb();

  // konum
  const [country, setCountry] = useState("Türkiye");
  const [city, setCity] = useState<string>("");
  const [selectedDistricts, setSelectedDistricts] = useState<string[]>([]);

  // tarih
  const [checkIn, setCheckIn] = useState(todayISO());
  const [checkOut, setCheckOut] = useState(addDaysISO(todayISO(), 3));
  const nights = calculateNights(checkIn, checkOut);

  // kişi / oda
  const [roomsCount, setRoomsCount] = useState("5");
  const [adults, setAdults] = useState("10");
  const [children, setChildren] = useState("0");

  const [roomRows, setRoomRows] = useState<RoomRowState[]>([
    { id: `row_${Date.now()}`, typeKey: "standard", count: "5" }
  ]);

  // tesis tipi
  const [propertyTypes, setPropertyTypes] = useState<PropertyTypeKey[]>([]);
  // konaklama tipi
  const [boardTypes, setBoardTypes] = useState<BoardType[]>([]);
  const [boardTypeNote, setBoardTypeNote] = useState("");
  // otel özellikleri
  const [features, setFeatures] = useState<FeatureKey[]>([]);
  const [featureNote, setFeatureNote] = useState("");
  // yıldız
  const [desiredStarRatings, setDesiredStarRatings] = useState<number[]>([]);

  // iletişim
  const [phoneCountryCode, setPhoneCountryCode] = useState("+90");
  const [phoneLocal, setPhoneLocal] = useState("");

  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactCompany, setContactCompany] = useState("");
  const [contactNote, setContactNote] = useState("");

  // cevap süresi
  const [responseAmount, setResponseAmount] = useState("3");
  const [responseUnit, setResponseUnit] = useState<ResponseUnit>("hours");

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // başarı modalı
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  // promos tick (dağılmış reklamlar “aynı dönmesin”)
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => (t + 1) % 999999), 2400);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (profile && !authLoading) {
      setContactName(profile.displayName || "");
      setContactEmail(profile.email || "");
    }
  }, [profile, authLoading]);

  // helpers
  function handleCityChange(cityName: string) {
    setCity(cityName);
    setSelectedDistricts([]);
  }
  function toggleDistrict(d: string) {
    setSelectedDistricts((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }
  function togglePropertyType(key: PropertyTypeKey) {
    setPropertyTypes((prev) => (prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]));
  }
  function toggleBoardType(key: BoardType) {
    setBoardTypes((prev) => (prev.includes(key) ? prev.filter((b) => b !== key) : [...prev, key]));
  }
  function toggleFeature(key: FeatureKey) {
    setFeatures((prev) => (prev.includes(key) ? prev.filter((f) => f !== key) : [...prev, key]));
  }
  function toggleStarRating(star: number) {
    setDesiredStarRatings((prev) => (prev.includes(star) ? prev.filter((s) => s !== star) : [...prev, star].sort()));
  }

  function addRoomRow() {
    setRoomRows((prev) => [
      ...prev,
      { id: `row_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, typeKey: "standard", count: "1" }
    ]);
  }
  function updateRoomRow(id: string, partial: Partial<Pick<RoomRowState, "typeKey" | "count">>) {
    setRoomRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...partial } : row)));
  }
  function removeRoomRow(id: string) {
    setRoomRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id)));
  }

  const currentCity = useMemo(() => CITY_OPTIONS.find((c) => c.name === city), [city]);

  // promos
  const promo = useMemo(() => {
    const rooms = Number(roomsCount) || 0;
    const respAmt = Number(responseAmount) || 3;
    return buildGroupCampaigns({
      tick,
      city,
      districtsCount: selectedDistricts.length,
      checkIn,
      checkOut,
      nights,
      roomsCount: rooms,
      roomRows,
      propertyTypes,
      boardTypes,
      stars: desiredStarRatings,
      features,
      company: contactCompany,
      phoneLocal,
      respAmount: respAmt,
      respUnit: responseUnit
    });
  }, [
    tick,
    city,
    selectedDistricts.length,
    checkIn,
    checkOut,
    nights,
    roomsCount,
    roomRows,
    propertyTypes,
    boardTypes,
    desiredStarRatings,
    features,
    contactCompany,
    phoneLocal,
    responseAmount,
    responseUnit
  ]);

  function rotate2<T>(items: T[]) {
    if (!items || items.length === 0) return [];
    if (items.length <= 2) return items;
    const start = tick % items.length;
    return [items[start], items[(start + 1) % items.length]];
  }

  if (authLoading) {
    return (
      <Protected allowedRoles={["guest"]}>
        <div className="container-page">
          <p className="text-sm text-slate-400">Bilgilerin yükleniyor...</p>
        </div>
      </Protected>
    );
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (!profile) {
      setError("Devam etmek için giriş yapmalısın.");
      return;
    }

    const rooms = Number(roomsCount);
    if (!rooms || rooms < 5) {
      setError("Grup rezervasyonu için en az 5 oda seçmelisin.");
      return;
    }

    if (!city.trim()) {
      setError("Lütfen şehir seç.");
      return;
    }

    if (!checkIn || !checkOut) {
      setError("Lütfen giriş ve çıkış tarihlerini seç.");
      return;
    }

    if (!contactName.trim() || !contactEmail.trim()) {
      setError("Ad soyad ve e-posta alanları zorunludur.");
      return;
    }

    if (!contactCompany.trim()) {
      setError("Firma / kurum / takım alanı bu formda zorunludur.");
      return;
    }

    const parsedRows = roomRows.map((row) => ({ ...row, countNum: Number(row.count) || 0 }));
    const totalRoomsFromRows = parsedRows.reduce((sum, r) => sum + r.countNum, 0);

    if (totalRoomsFromRows === 0) {
      setError("Lütfen oda satırlarında en az 1 oda belirt (toplam 0 olamaz).");
      return;
    }

    if (totalRoomsFromRows !== rooms) {
      setError(`Oda satırlarının toplamı (${totalRoomsFromRows}), üstteki toplam oda sayısına (${rooms}) eşit olmalı.`);
      return;
    }

    const totalGuests = (Number(adults) || 0) + (Number(children) || 0);

    const phoneDigits = digitsOnly(phoneLocal);
    const phoneFull = phoneDigits ? `${phoneCountryCode} ${phoneDigits}` : null;

    const respAmt = Number(responseAmount) || 3;
    const respUnit: ResponseUnit = responseUnit;
    const responseDeadlineMinutes = toMinutes(respAmt, respUnit);
    const responseHuman = `${respAmt} ${responseUnitLabelTR(respUnit)}`;

    const roomTypeCounts: Record<string, number> = {};
    parsedRows.forEach((r) => {
      roomTypeCounts[r.typeKey] = (roomTypeCounts[r.typeKey] || 0) + r.countNum;
    });

    const roomTypesSummary = Object.entries(roomTypeCounts)
      .filter(([, count]) => count > 0)
      .map(([key]) => key);

    const primaryDistrict = selectedDistricts[0] ?? null;
    const districtsArray = selectedDistricts.length > 0 ? selectedDistricts : null;

    try {
      setSaving(true);

      // 1) request kaydı
      const ref = await addDoc(collection(db, "requests"), {
        type: "group",
        isGroup: true,

        country: country || null,
        city: city.trim(),
        district: primaryDistrict,
        districts: districtsArray,

        checkIn,
        checkOut,
        nights,

        adults: Number(adults) || 0,
        childrenCount: Number(children) || 0,
        roomsCount: rooms,

        roomTypes: roomTypesSummary,
        roomTypeCounts,
        roomTypeRows: parsedRows.map((r) => ({ typeKey: r.typeKey, count: r.countNum })),

        propertyTypes: propertyTypes.length > 0 ? propertyTypes : null,

        boardTypes,
        boardTypeNote: boardTypeNote.trim() || null,

        hotelFeaturePrefs: features,
        hotelFeatureNote: featureNote.trim() || null,

        desiredStarRatings: desiredStarRatings.length > 0 ? desiredStarRatings : null,

        contactName: contactName.trim(),
        contactEmail: contactEmail.trim(),
        contactPhoneCountryCode: phoneCountryCode,
        contactPhoneLocal: phoneDigits || null,
        contactPhone: phoneFull,
        contactCompany: contactCompany.trim() || null,
        contactNote: contactNote.trim() || null,

        guestId: profile.uid,
        guestDisplayName: profile.displayName || null,

        responseDeadlineMinutes,
        responseTimeAmount: respAmt,
        responseTimeUnit: respUnit,
        responseHuman,

        createdAt: serverTimestamp(),
        status: "open",
        totalGuests
      });

      // 2) otellere notification (şehir + primary ilçe ile)
      await notifyHotelsForNewRequest({
        db,
        requestId: ref.id,
        city: city.trim(),
        district: primaryDistrict,
        checkIn,
        checkOut,
        adults: Number(adults) || 0,
        childrenCount: Number(children) || 0,
        roomsCount: rooms
      });

      const text = `Grup talebin gönderildi. Otellerin cevap süresi: ${responseHuman}. Bu süre içinde uygun oteller teklif gönderecek.`;
      setConfirmText(text);
      setConfirmOpen(true);
    } catch (err) {
      console.error("Group request create error:", err);
      setError("Talep kaydedilirken bir hata oluştu. Lütfen tekrar dene.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Protected allowedRoles={["guest"]}>
      <div className="container-page max-w-5xl space-y-6 relative">
        {/* premium bg */}
        <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
          <div className="absolute -top-40 left-1/2 h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-emerald-500/10 blur-3xl" />
          <div className="absolute top-44 -left-40 h-[520px] w-[620px] rounded-full bg-sky-500/10 blur-3xl" />
          <div className="absolute bottom-0 -right-56 h-[620px] w-[760px] rounded-full bg-pink-500/10 blur-3xl" />
          <div className="absolute inset-0 bg-gradient-to-b from-slate-950/30 via-slate-950 to-slate-950" />
        </div>

        {/* header */}
        <div className="rounded-2xl border border-emerald-500/25 bg-gradient-to-r from-emerald-500/12 via-sky-500/5 to-slate-950 px-6 py-5 shadow-[0_30px_120px_rgba(0,0,0,0.45)]">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[0.7rem] text-slate-200">
                ⚡ Grup talebi → Oteller → Teklif → Pazarlık → Rezervasyon
              </div>
              <h1 className="text-2xl md:text-3xl font-semibold text-slate-100">Grup talebi oluştur</h1>
              <p className="text-sm text-slate-300 max-w-3xl">
                5 oda ve üzeri konaklamalar için tek seferde grup talebi aç. Talebin kriterlerine uyan otellere kapalı devre düşer.
              </p>
            </div>

            
            
          </div>
        </div>

        {(error || message) && (
          <div className="space-y-2">
            {error && (
              <div className="text-xs text-red-200 bg-red-500/10 border border-red-500/40 rounded-xl px-4 py-3">
                {error}
              </div>
            )}
            {message && (
              <div className="text-xs text-emerald-200 bg-emerald-500/10 border border-emerald-500/40 rounded-xl px-4 py-3">
                {message}
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6 text-xs">
          {/* 1) Konum & tarih */}
          <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5 shadow shadow-slate-950/40 space-y-3">
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20 text-[0.75rem] text-emerald-200">1</span>
              Konum & Tarih
            </h2>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">Ülke</label>
                <input
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="Örn: Türkiye"
                  className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-xs text-slate-100"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">Şehir *</label>
                <select
                  value={city}
                  onChange={(e) => handleCityChange(e.target.value)}
                  className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-xs text-slate-100"
                >
                  <option value="">Şehir seç</option>
                  {CITY_OPTIONS.map((c) => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
                <PromoStrip items={rotate2(promo.city)} />
              </div>

              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">İlçeler (çoklu)</label>
                {city ? (
                  <div className="flex flex-wrap gap-2">
                    {(CITY_OPTIONS.find((c) => c.name === city)?.districts || []).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => toggleDistrict(d)}
                        className={`rounded-full border px-3 py-1 text-[0.7rem] transition ${
                          selectedDistricts.includes(d)
                            ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-200"
                            : "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-[0.7rem] text-slate-500">Önce şehir seç.</div>
                )}
                <PromoStrip items={rotate2(promo.district)} />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3 mt-2">
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">Giriş</label>
                <input
                  type="date"
                  value={checkIn}
                  min={todayISO()}
                  onChange={(e) => {
                    const val = e.target.value;
                    setCheckIn(val);
                    if (checkOut <= val) setCheckOut(addDaysISO(val, 1));
                  }}
                  className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-xs text-slate-100"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">Çıkış</label>
                <input
                  type="date"
                  value={checkOut}
                  min={addDaysISO(checkIn, 1)}
                  onChange={(e) => setCheckOut(e.target.value)}
                  className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-xs text-slate-100"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">Gece</label>
                <input
                  value={nights}
                  readOnly
                  className="w-full rounded-xl bg-slate-900/40 border border-dashed border-slate-700 px-4 py-3 text-xs text-slate-300"
                />
              </div>
            </div>

            <PromoStrip items={rotate2(promo.dates)} />
          </section>

          {/* 2) Kişi / oda / kırılım */}
          <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5 shadow shadow-slate-950/40 space-y-3">
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20 text-[0.75rem] text-emerald-200">2</span>
              Kişi & Oda & Oda kırılımı
            </h2>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">Toplam oda (min 5) *</label>
                <input
                  type="number"
                  min={5}
                  value={roomsCount}
                  onChange={(e) => setRoomsCount(e.target.value)}
                  placeholder="5"
                  className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-xs text-slate-100"
                />
                <PromoStrip items={rotate2(promo.rooms)} />
              </div>
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">Yetişkin</label>
                <input
                  type="number"
                  min={1}
                  value={adults}
                  onChange={(e) => setAdults(e.target.value)}
                  placeholder="10"
                  className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-xs text-slate-100"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">Çocuk</label>
                <input
                  type="number"
                  min={0}
                  value={children}
                  onChange={(e) => setChildren(e.target.value)}
                  placeholder="0"
                  className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-xs text-slate-100"
                />
              </div>
            </div>

            <div className="space-y-2 mt-2">
              <p className="text-[0.75rem] text-slate-200">Oda kırılımı (oda tipinden kaç oda?)</p>

              {roomRows.map((row) => (
                <div key={row.id} className="grid md:grid-cols-[2fr_1fr_auto] gap-2 items-center">
                  <select
                    value={row.typeKey}
                    onChange={(e) => updateRoomRow(row.id, { typeKey: e.target.value as RoomTypeKey })}
                    className="rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-xs text-slate-100"
                  >
                    {ROOM_TYPE_OPTIONS.map((rt) => (
                      <option key={rt.key} value={rt.key}>{rt.label}</option>
                    ))}
                  </select>

                  <input
                    type="number"
                    min={0}
                    value={row.count}
                    onChange={(e) => updateRoomRow(row.id, { count: e.target.value })}
                    placeholder="Örn: 5"
                    className="rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-xs text-slate-100"
                  />

                  <div className="flex justify-end">
                    {roomRows.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeRoomRow(row.id)}
                        className="rounded-xl border border-red-500/50 bg-red-500/10 px-3 py-2 text-[0.75rem] text-red-200 hover:bg-red-500/15"
                      >
                        Sil
                      </button>
                    )}
                  </div>
                </div>
              ))}

              <div className="flex items-center justify-between gap-3">
                <p className="text-[0.65rem] text-slate-500">
                  Satırlardaki toplam oda, üstteki toplam oda sayısına eşit olmalı.
                </p>
                <button
                  type="button"
                  onClick={addRoomRow}
                  className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[0.75rem] text-emerald-200 hover:bg-emerald-500/15"
                >
                  + Satır ekle
                </button>
              </div>

              <PromoStrip items={rotate2(promo.roomRows)} />
            </div>
          </section>

          {/* 3) Tesis / board / yıldız */}
          <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5 shadow shadow-slate-950/40 space-y-3">
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20 text-[0.75rem] text-emerald-200">3</span>
              Tesis & Konaklama & Yıldız
            </h2>

            <div className="space-y-2">
              <label className="text-[0.75rem] text-slate-200">Tesis tipi (isteğe bağlı)</label>
              <div className="grid md:grid-cols-3 gap-2">
                {PROPERTY_TYPE_OPTIONS.map((p) => (
                  <label key={p.key} className="flex items-center gap-2 text-[0.75rem] text-slate-200">
                    <input
                      type="checkbox"
                      checked={propertyTypes.includes(p.key)}
                      onChange={() => togglePropertyType(p.key)}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                    />
                    {p.label}
                  </label>
                ))}
              </div>
              <PromoStrip items={rotate2(promo.property)} />
            </div>

            <div className="space-y-2">
              <label className="text-[0.75rem] text-slate-200">Konaklama tipi (isteğe bağlı)</label>
              <div className="grid md:grid-cols-3 gap-2">
                {BOARD_OPTIONS.map((b) => (
                  <label key={b.key} className="flex items-center gap-2 text-[0.75rem] text-slate-200">
                    <input
                      type="checkbox"
                      checked={boardTypes.includes(b.key)}
                      onChange={() => toggleBoardType(b.key)}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                    />
                    {b.label}
                  </label>
                ))}
              </div>

              <textarea
                rows={2}
                value={boardTypeNote}
                onChange={(e) => setBoardTypeNote(e.target.value)}
                placeholder="Örn: Kahvaltı olsun ama akşam yemeği şart değil..."
                className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-xs text-slate-100"
              />
              <PromoStrip items={rotate2(promo.board)} />
            </div>

            <div className="space-y-2">
              <label className="text-[0.75rem] text-slate-200">Yıldız (isteğe bağlı)</label>
              <div className="flex flex-wrap gap-2">
                {[3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => toggleStarRating(star)}
                    className={`rounded-full border px-3 py-1 text-[0.7rem] transition ${
                      desiredStarRatings.includes(star)
                        ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-200"
                        : "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
                    }`}
                  >
                    {star}★
                  </button>
                ))}
              </div>
              <PromoStrip items={rotate2(promo.stars)} />
            </div>
          </section>

          {/* 4) Özellikler */}
          <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5 shadow shadow-slate-950/40 space-y-3">
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20 text-[0.75rem] text-emerald-200">4</span>
              Otel özellikleri
            </h2>

            <div className="grid md:grid-cols-3 gap-2">
              {FEATURE_OPTIONS.map((f) => (
                <label key={f.key} className="flex items-center gap-2 text-[0.75rem] text-slate-200">
                  <input
                    type="checkbox"
                    checked={features.includes(f.key)}
                    onChange={() => toggleFeature(f.key)}
                    className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                  />
                  {f.label}
                </label>
              ))}
            </div>

            <PromoStrip items={rotate2(promo.features)} />

            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-200">Diğer istekler</label>
              <textarea
                rows={3}
                value={featureNote}
                onChange={(e) => setFeatureNote(e.target.value)}
                placeholder="Örn: Otobüs parkı, toplantı salonu, sahile yakın, takım kafilesi..."
                className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-xs text-slate-100"
              />
            </div>
          </section>

          {/* 5) İletişim */}
          <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5 shadow shadow-slate-950/40 space-y-3">
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20 text-[0.75rem] text-emerald-200">5</span>
              İletişim bilgileri
            </h2>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">Ad soyad *</label>
                <input
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Örn: Yunus Emre"
                  className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-xs text-slate-100"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">E-posta *</label>
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="Örn: yunus@mail.com"
                  className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-xs text-slate-100"
                />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-[0.9fr_2fr_1.3fr]">
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">Kod</label>
                <select
                  value={phoneCountryCode}
                  onChange={(e) => setPhoneCountryCode(e.target.value)}
                  className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-xs text-slate-100"
                >
                  {PHONE_CODES.map((c) => (
                    <option key={c.code} value={c.code}>{c.label} ({c.code})</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">Telefon (ops.)</label>
                <input
                  value={phoneLocal}
                  onChange={(e) => setPhoneLocal(e.target.value)}
                  placeholder="Örn: 5XXXXXXXXX"
                  className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-xs text-slate-100"
                />
                <PromoStrip items={rotate2(promo.phone)} />
              </div>

              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">Firma/Kurum/Takım *</label>
                <input
                  value={contactCompany}
                  onChange={(e) => setContactCompany(e.target.value)}
                  placeholder="Örn: ABC Turizm / Kulüp / Şirket"
                  className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-xs text-slate-100"
                />
                <PromoStrip items={rotate2(promo.company)} />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-200">Not (ops.)</label>
              <textarea
                rows={3}
                value={contactNote}
                onChange={(e) => setContactNote(e.target.value)}
                placeholder="Örn: Turnuva için geliyoruz, giriş saati, özel istekler..."
                className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-xs text-slate-100"
              />
            </div>
          </section>

          {/* 6) Cevap süresi */}
          <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5 shadow shadow-slate-950/40 space-y-3">
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20 text-[0.75rem] text-emerald-200">6</span>
              Otellerin cevap süresi
            </h2>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="number"
                min={1}
                value={responseAmount}
                onChange={(e) => setResponseAmount(e.target.value)}
                placeholder="3"
                className="w-28 rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-xs text-slate-100"
              />
              <select
                value={responseUnit}
                onChange={(e) => setResponseUnit(e.target.value as ResponseUnit)}
                className="w-28 rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-xs text-slate-100"
              >
                <option value="minutes">dakika</option>
                <option value="hours">saat</option>
                <option value="days">gün</option>
              </select>
            </div>

            <PromoStrip items={rotate2(promo.deadline)} />
          </section>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-emerald-500 text-slate-950 px-6 py-3 text-sm font-semibold hover:bg-emerald-400 disabled:opacity-60 shadow-lg shadow-emerald-500/25"
            >
              {saving ? "Talep gönderiliyor..." : "Grup talebini gönder"}
            </button>
          </div>
        </form>

        {/* BAŞARI MODALI */}
        {confirmOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/95 p-5 w-full max-w-md text-xs shadow-xl shadow-slate-950/60 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-100">Grup talebin oluşturuldu</h2>
                <button
                  type="button"
                  onClick={() => setConfirmOpen(false)}
                  className="text-[0.75rem] text-slate-400 hover:text-slate-200"
                >
                  ✕
                </button>
              </div>

              <p className="text-[0.8rem] text-slate-200">{confirmText}</p>

              <p className="text-[0.7rem] text-slate-400">
                Oteller teklif gönderdikçe “Gelen teklifler” ekranında bu grup talebini göreceksin.
              </p>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmOpen(false)}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-[0.75rem] text-slate-100 hover:bg-white/10"
                >
                  Burada kal
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmOpen(false);
                    router.push("/guest/offers");
                  }}
                  className="rounded-xl bg-emerald-500 px-4 py-2 text-[0.75rem] font-semibold text-slate-950 hover:bg-emerald-400"
                >
                  Gelen tekliflere git
                </button>
              </div>
            </div>
          </div>
        )}

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
