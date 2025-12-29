"use client";

import React, { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { Protected } from "@/components/Protected";
import { useAuth } from "@/context/AuthContext";
import { getFirebaseAuth, getFirestoreDb } from "@/lib/firebase/client";
import {
  addDoc,
  collection,
  getDocs,
  query,
  serverTimestamp,
  where
} from "firebase/firestore";

/** -------------------- SABİTLER -------------------- */
type AnyObj = Record<string, any>;


const CHECKOUT_TIME_FIXED = "12:00";

const FEATURES = [
  { key: "pool", label: "Havuz" },
  { key: "spa", label: "Spa / Wellness" },
  { key: "parking", label: "Otopark" },
  { key: "wifi", label: "Ücretsiz Wi-Fi" },
  { key: "seaView", label: "Deniz manzarası" },
  { key: "mountainView", label: "Dağ manzarası" },
  { key: "cityCenter", label: "Şehir merkezine yakın" },
  { key: "beachFront", label: "Denize sıfır" },
  { key: "forest", label: "Doğa / orman içinde" },
  { key: "riverside", label: "Dere / nehir kenarı" },
  { key: "stadiumNear", label: "Stadyuma yakın" },
  { key: "hospitalNear", label: "Hastaneye yakın" },
  { key: "shoppingMallNear", label: "AVM / alışveriş merkezine yakın" },
  { key: "family", label: "Aile odaları" },
  { key: "petFriendly", label: "Evcil hayvan kabul edilir" }
];

const FEATURE_PRIORITIES = [
  { key: "must", label: "Şart" },
  { key: "nice", label: "Olmasa da olur" }
] as const;
type FeaturePriority = (typeof FEATURE_PRIORITIES)[number]["key"];

const BOARD_TYPES = [
  { key: "RO", label: "Sadece oda (RO)" },
  { key: "BB", label: "Oda + Kahvaltı (BB)" },
  { key: "HB", label: "Yarım pansiyon (HB)" },
  { key: "FB", label: "Tam pansiyon (FB)" },
  { key: "AI", label: "Her şey dahil (AI)" },
  { key: "UAI", label: "Ultra her şey dahil (UAI)" }
];

const ACCOMMODATION_TYPES = [
  { key: "hotel", label: "Otel" },
  { key: "boutique", label: "Butik otel" },
  { key: "motel", label: "Motel" },
  { key: "pension", label: "Pansiyon" },
  { key: "apartHotel", label: "Apart otel" },
  { key: "apartment", label: "Daire / Apart" },
  { key: "bungalow", label: "Bungalov" },
  { key: "holidayVillage", label: "Tatil köyü / resort" },
  { key: "hostel", label: "Hostel" }
];

const CITY_OPTIONS: { name: string; districts: string[] }[] = [
  {
    name: "İstanbul",
    districts: [
      "Beşiktaş", "Şişli", "Kadıköy", "Üsküdar", "Fatih", "Beyoğlu", "Bakırköy",
      "Ataşehir", "Kartal", "Ümraniye", "Bahçelievler", "Sarıyer"
    ]
  },
  { name: "Ankara", districts: ["Çankaya", "Keçiören", "Yenimahalle", "Mamak", "Sincan", "Etimesgut"] },
  { name: "İzmir", districts: ["Konak", "Karşıyaka", "Bornova", "Buca", "Çeşme", "Alsancak"] },
  { name: "Antalya", districts: ["Muratpaşa", "Konyaaltı", "Lara", "Alanya", "Manavgat", "Belek", "Kemer"] },
  { name: "Trabzon", districts: ["Ortahisar", "Akçaabat", "Yomra", "Arsin", "Araklı", "Of", "Vakfıkebir", "Sürmene", "Maçka", "Beşikdüzü"] }
];

const PHONE_CODES = [
  { code: "+90", label: "🇹🇷 +90" },
  { code: "+49", label: "🇩🇪 +49" },
  { code: "+44", label: "🇬🇧 +44" },
  { code: "+7", label: "🇷🇺 +7" },
  { code: "+1", label: "🇺🇸 +1" },
  { code: "+31", label: "🇳🇱 +31" },
  { code: "+33", label: "🇫🇷 +33" },
  { code: "+39", label: "🇮🇹 +39" },
  { code: "+966", label: "🇸🇦 +966" },
  { code: "+971", label: "🇦🇪 +971" },
  { code: "+994", label: "🇦🇿 +994" }
];

/** -------------------- HELPERS -------------------- */

function cleanText(v: any): string {
  return String(v ?? "").trim();
}
function digitsOnly(v: string): string {
  return v.replace(/\D/g, "");
}

// “yunus emre” -> “Yunus Emre”
function titleCaseTR(text: string) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      const s = w.toLocaleLowerCase("tr-TR");
      const first = s.charAt(0).toLocaleUpperCase("tr-TR");
      return first + s.slice(1);
    })
    .join(" ");
}

// notların ilk harfi büyük (tek satır için)
function capFirstTR(text: string) {
  const s = String(text || "").trim();
  if (!s) return "";
  const first = s.charAt(0).toLocaleUpperCase("tr-TR");
  return first + s.slice(1);
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
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}
function computeNightsFromStrings(checkIn: string, checkOut: string): number | null {
  const ci = parseDate(checkIn);
  const co = parseDate(checkOut);
  if (!ci || !co) return null;
  const diff = diffInDays(co, ci);
  return diff > 0 ? diff : 1;
}
function responseMinutesFromValue(value: number, unit: "minutes" | "hours" | "days"): number {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return 60;
  if (unit === "minutes") return v;
  if (unit === "hours") return v * 60;
  return v * 60 * 24;
}

function labelOfAccommodation(key: string) {
  const m = ACCOMMODATION_TYPES.find((x) => x.key === key);
  return m?.label ?? "Farketmez";
}
function labelOfBoard(key: string) {
  const m = BOARD_TYPES.find((x) => x.key === key);
  return m?.label ?? "Farketmez";
}
function labelOfFeature(key: string) {
  const m = FEATURES.find((x) => x.key === key);
  return m?.label ?? key;
}

function todayISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function nowHHMM() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
function roundTo5Min(hhmm: string) {
  const [hh, mm] = hhmm.split(":").map(Number);
  const total = (hh || 0) * 60 + (mm || 0);
  const rounded = Math.ceil(total / 5) * 5;
  const rh = Math.floor(rounded / 60) % 24;
  const rm = rounded % 60;
  return `${String(rh).padStart(2, "0")}:${String(rm).padStart(2, "0")}`;
}
function timeToMinutes(t: string) {
  const [hh, mm] = String(t || "0:0").split(":").map(Number);
  return (hh || 0) * 60 + (mm || 0);
}
function buildLocalDateTime(dateStr: string, timeStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
}

function capacityWarning(totalGuests: number, roomsCount: number) {
  if (roomsCount <= 0) return "Oda sayısı 0 olamaz.";
  const perRoom = totalGuests / roomsCount;
  if (perRoom > 4.2) return "Kişi sayısı oda sayısına göre çok yüksek görünüyor. Teklif yanlış çıkabilir (oda arttırmayı düşün).";
  if (perRoom < 1) return "Oda sayısı kişi sayısına göre fazla görünüyor (istersen oda sayısını azalt).";
  return "";
}

function computeRequestScore(args: {
  nameOk: boolean;
  phoneOk: boolean;
  emailOk: boolean;
  cityOk: boolean;
  districtOk: boolean;
  datesOk: boolean;
  timesOk: boolean;
  roomsOk: boolean;
  roomTypesOk: boolean;
  accommodationOk: boolean;
  boardOk: boolean;
  starOk: boolean;
  featuresCount: number;
  noteOk: boolean;
  nearMeOk: boolean;
  responseOk: boolean;
}) {
  let s = 0;
  if (args.nameOk) s += 6;
  if (args.phoneOk) s += 10;
  if (args.emailOk) s += 4;
  if (args.cityOk) s += 10;
  if (args.districtOk) s += 4;
  if (args.datesOk) s += 14;
  if (args.timesOk) s += 10;
  if (args.roomsOk) s += 8;
  if (args.roomTypesOk) s += 8;
  if (args.accommodationOk) s += 6;
  if (args.boardOk) s += 6;
  if (args.starOk) s += 6;
  s += Math.min(10, args.featuresCount * 2);
  if (args.noteOk) s += 6;
  if (args.nearMeOk) s += 4;
  if (args.responseOk) s += 6;
  return Math.max(0, Math.min(100, s));
}

/** ----------- NOTIFICATION: otellere talep bildirimi ----------- */
async function notifyHotelsForNewRequest(args: {
  db: ReturnType<typeof getFirestoreDb>;
  requestId: string;
  city: string;
  district: string | null;
  checkIn: string;
  checkInTime: string;
  checkOut: string;
  checkOutTime: string;
  sameDayStay: boolean;
  adults: number;
  childrenCount: number;
  roomsCount: number;
  nearMe: boolean;
}) {
  const { db, requestId, city, district, checkIn, checkInTime, checkOut, checkOutTime, sameDayStay, adults, childrenCount, roomsCount, nearMe } = args;

  const usersCol = collection(db, "users");
  const notificationsCol = collection(db, "notifications");

  // ✅ role TR/EN: hotel/otel
  const baseHotelQuery = district
    ? query(
        usersCol,
        where("role", "in", ["hotel", "otel"]),
        where("hotelProfile.city", "==", city),
        where("hotelProfile.district", "==", district)
      )
    : query(usersCol, where("role", "in", ["hotel", "otel"]), where("hotelProfile.city", "==", city));

  let snap = await getDocs(baseHotelQuery);

  // fallback (eski şema için)
  if (snap.empty) {
    const q2 = district
      ? query(usersCol, where("role", "in", ["hotel", "otel"]), where("city", "==", city), where("district", "==", district))
      : query(usersCol, where("role", "in", ["hotel", "otel"]), where("city", "==", city));
    snap = await getDocs(q2);
  }

  const base = {
    to: "",
    type: "new_request",
    payload: {
      requestId,
      city,
      district,
      checkIn,
      checkInTime,
      checkOut,
      checkOutTime,
      sameDayStay,
      adults,
      childrenCount,
      roomsCount,
      nearMe
    },
    createdAt: serverTimestamp(),
    read: false
  };

  const promises: Promise<any>[] = [];
  snap.forEach((d) => promises.push(addDoc(notificationsCol, { ...base, to: d.id })));
  if (promises.length) await Promise.all(promises);
}
/** -------------------- KAMPANYA MOTORU (100+ varyasyon) -------------------- */

type CampaignTone = "emerald" | "amber" | "pink" | "sky";
type CampaignGroup =
  | "name"
  | "city"
  | "district"
  | "dates"
  | "pax"
  | "rooms"
  | "accommodation"
  | "board"
  | "star"
  | "features"
  | "near"
  | "deadline"
  | "note";

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

function makeNumbers(seed: number) {
  const hotels = 14 + (seed % 27);
  const offers = 6 + (seed % 18);
  const fastMin = 4 + (seed % 9);
  const busy = 35 + (seed % 45);
  const drop = 3 + (seed % 7);
  return { hotels, offers, fastMin, busy, drop };
}

function buildCampaigns(args: {
  tick: number;
  name: string;
  city: string;
  district: string;
  checkIn: string;
  checkOut: string;
  nights: number | null;
  adults: number;
  childrenCount: number;
  roomsCount: number;
  roomTypes: string[];
  accommodationType: string;
  boardType: string;
  starRating: string;
  features: string[];
  nearMe: boolean;
  responseValue: number;
  responseUnit: "minutes" | "hours" | "days";
}) {
  const {
    tick, name, city, district, checkIn, checkOut, nights,
    adults, childrenCount, roomsCount, roomTypes,
    accommodationType, boardType, starRating, features, nearMe,
    responseValue, responseUnit
  } = args;

  const seed = hashSeed(
    [
      name, city, district, checkIn, checkOut,
      String(nights ?? ""), String(adults), String(childrenCount),
      String(roomsCount), roomTypes.join("|"),
      accommodationType, boardType, starRating,
      features.join("|"), String(nearMe),
      String(responseValue), responseUnit, String(tick)
    ].join("::")
  );

  const nums = makeNumbers(seed);

  const firstName = (name || "").trim().split(" ")[0] || "Misafir";
  const cityPretty = city || "Şehir";
  const districtPretty = district || "İlçe";

  const fset = new Set(features.map(String));
  const roomSet = new Set(roomTypes.map((x) => String(x).toLowerCase()));

  const starNum = starRating ? Number(starRating) : 0;
  const starOk = starNum >= 1 && starNum <= 5;

  const bt = (boardType || "").toUpperCase();
  const at = (accommodationType || "").toLowerCase();

  const out: CampaignItem[] = [];

  const nameTemplates: Array<(s: number) => CampaignItem> = [
    (s) => ({ id: `nm-a-${s}`, group: "name", tone: "emerald", icon: "✅", title: `${firstName}, talebin otellere “anında” düşer`, desc: `Net bilgi → hızlı teklif. Ortalama ${nums.fastMin} dk içinde ilk dönüş geliyor.` }),
    (s) => ({ id: `nm-b-${s}`, group: "name", tone: "pink", icon: "⚡", title: `${firstName}, bugün yoğunluk yüksek`, desc: `Yoğunluk %${nums.busy}. Erken talep açanlar daha iyi fiyat yakalıyor.` }),
    (s) => ({ id: `nm-c-${s}`, group: "name", tone: "sky", icon: "🧠", title: "İsmini yazınca otel daha ciddi algılar", desc: "Gerçek müşteri hissi → otelin teklif verme motivasyonu artar." }),
    (s) => ({ id: `nm-d-${s}`, group: "name", tone: "amber", icon: "🎯", title: "İsmin + şehir = hedefli otel seçimi", desc: `Sistem şehirdeki uygun ${nums.hotels} oteli anında tarar.` }),
    (s) => ({ id: `nm-e-${s}`, group: "name", tone: "emerald", icon: "📩", title: "Talebin otomatik bildirimle yayılır", desc: `Uygun otellere tek tek aramadan ulaş. Ortalama ${nums.offers} teklif potansiyeli.` })
  ];
  out.push(pick(nameTemplates, seed)(seed));

  if (city) {
    const cityTemplates: Array<(s: number) => CampaignItem> = [
      (s) => ({ id: `ct-a-${s}`, group: "city", tone: "sky", icon: "🟢", title: `${cityPretty} otelleri teklif için hazır`, desc: `Şehir seçimi tamam. Şimdi ilçe seçersen “tam isabet” olur.` }),
      (s) => ({ id: `ct-b-${s}`, group: "city", tone: "amber", icon: "📈", title: `${cityPretty} için talep artışı var`, desc: `Bu saatlerde teklif trafiği artıyor. İlk ${nums.fastMin} dk kritik.` }),
      (s) => ({ id: `ct-c-${s}`, group: "city", tone: "emerald", icon: "💸", title: `${cityPretty}’da fiyat rekabeti yüksek`, desc: `Oteller daha çok indirim yapıyor. Ortalama fiyat düşüşü %${nums.drop}.` }),
      (s) => ({ id: `ct-d-${s}`, group: "city", tone: "pink", icon: "🔥", title: `${cityPretty} doluluk yükseliyor`, desc: `Yoğun tarihlerde erken talep açan kazanır. Şimdi gönder, ilk dalgayı yakala.` })
    ];
    out.push(pick(cityTemplates, seed + 11)(seed + 11));
  } else {
    out.push({ id: "ct-empty", group: "city", tone: "sky", icon: "📍", title: "Şehir seç → teklifler başlasın", desc: "Şehir seçimi olmadan sistem otel eşleştiremez." });
  }

  if (city && district) {
    out.push({
      id: "ds-picked",
      group: "district",
      tone: "sky",
      icon: "🎯",
      title: `${cityPretty} / ${districtPretty}: daha isabetli`,
      desc: "İlçe seçimi otel havuzunu daraltır → daha net fiyatlar gelir."
    });
  } else if (city && !district) {
    out.push({
      id: "ds-any",
      group: "district",
      tone: "amber",
      icon: "🧲",
      title: "İlçe seçmezsen daha çok teklif gelir",
      desc: "Çok teklif istiyorsan ilçe boş kalsın. Daha kaliteli teklif istiyorsan ilçe seç."
    });
  }

  if (checkIn && checkOut) {
    const dateTemplates: Array<(s: number) => CampaignItem> = [
      (s) => ({ id: `dt-a-${s}`, group: "dates", tone: "emerald", icon: "📅", title: "Tarih netleşti → oteller hızlanır", desc: `Tarih girilince uygunluk filtresi çalışır. İlk teklif genelde ${nums.fastMin} dk.` }),
      (s) => ({ id: `dt-b-${s}`, group: "dates", tone: "amber", icon: "⏳", title: "Yoğun tarih seçimi fiyatı etkiler", desc: "Yoğun tarihlerde oteller hızlı kapanır. Talebi geciktirme." }),
      (s) => ({ id: `dt-c-${s}`, group: "dates", tone: "sky", icon: "🔍", title: "Tarih aralığı net → daha doğru oda", desc: "Net tarih = otelin doğru oda tipine doğru fiyat vermesi." })
    ];
    out.push(pick(dateTemplates, seed + 31)(seed + 31));
  } else {
    out.push({ id: "dt-empty", group: "dates", tone: "sky", icon: "📅", title: "Tarih seç → oteller fiyat hesaplasın", desc: "Giriş/çıkış seçince gece sayısı otomatik hesaplanır." });
  }

  const pax = adults + childrenCount;
  out.push({
    id: "px-main",
    group: "pax",
    tone: childrenCount > 0 ? "pink" : "emerald",
    icon: childrenCount > 0 ? "👨‍👩‍👧" : "👤",
    title: `${pax} kişi için teklif akışı başlar`,
    desc: childrenCount > 0 ? "Çocuk yaşı girilirse oteller doğru tarife verir." : "Kişi sayısı net → teklif sayısı artar."
  });

  if (roomSet.has("family")) out.push({ id: "rm-family", group: "rooms", tone: "pink", icon: "👨‍👩‍👧‍👦", title: "Aile odaları hızlı bitiyor", desc: "Bu kategori bugün çok isteniyor. Erken teklif avantajı var." });
  if (roomSet.has("suite")) out.push({ id: "rm-suite", group: "rooms", tone: "amber", icon: "✨", title: "Suit az, ama premium", desc: "Daha az teklif gelir; kalite daha yüksek olur." });
  if (roomsCount >= 3) out.push({ id: "rm-multi", group: "rooms", tone: "amber", icon: "🏷️", title: "Çok odalı taleplerde oteller öne geçmek ister", desc: "3+ oda taleplerinde daha agresif fiyat görebilirsin." });

  if (at) {
    if (at === "hotel") out.push({ id: "ac-hotel", group: "accommodation", tone: "amber", icon: "🏨", title: "Otel seçimi hızlı teklif çeker", desc: "Merkez bölgelerde doluluk daha hızlı artar." });
    else if (at === "apartment" || at === "aparthotel") out.push({ id: "ac-apart", group: "accommodation", tone: "emerald", icon: "🏢", title: "Apart/dairenin talebi yükseldi", desc: "Uzun konaklamalarda daha avantajlı fiyatlar gelir." });
    else if (at === "bungalow") out.push({ id: "ac-bung", group: "accommodation", tone: "pink", icon: "🌲", title: "Bungalovlar erken kapanıyor", desc: "Doğa konseptinde fiyat hızlı değişir; erken gönder." });
    else out.push({ id: "ac-gen", group: "accommodation", tone: "sky", icon: "✅", title: "Tesis türü seçimi hedefi daraltır", desc: "Daha doğru otel havuzu → daha iyi teklifler." });
  } else {
    out.push({ id: "ac-0", group: "accommodation", tone: "sky", icon: "🧩", title: "Tesis türü seç (öneri)", desc: "Otel/apart/bungalov… seçim yaparsan dönüş hızı artar." });
  }

  if (!bt) out.push({ id: "bd-0", group: "board", tone: "sky", icon: "🧠", title: "Yeme-içme seçimi fiyatı netleştirir", desc: "Board seçimi yoksa otel geniş aralıkla teklif verir." });
  else if (bt === "AI" || bt === "UAI") out.push({ id: "bd-ai", group: "board", tone: "emerald", icon: "🍽️", title: "AI/UAI: kampanya daha çok", desc: "Her şey dahil paketlerde indirim oranı yükselir." });
  else if (bt === "BB") out.push({ id: "bd-bb", group: "board", tone: "sky", icon: "☕", title: "BB: en çok teklif gelen kategori", desc: "Kahvaltı dahil otel sayısını artırır." });
  else out.push({ id: "bd-gen", group: "board", tone: "amber", icon: "🍴", title: `${bt}: pazarlık alanı geniş`, desc: "HB/FB gibi seçeneklerde oteller farklı indirimler sunabilir." });

  if (starOk && starRating === "5") out.push({ id: "st-5", group: "star", tone: "pink", icon: "🏆", title: "5★: VIP teklif dalgası", desc: "İlk 30 dakikada daha agresif fiyat gelebilir." });
  else if (starOk && starRating === "4") out.push({ id: "st-4", group: "star", tone: "amber", icon: "⭐", title: "4★: fiyat/performans rekabeti", desc: "Teklif sayısı yüksek, pazarlık şansı güçlü." });
  else if (starOk && starRating === "3") out.push({ id: "st-3", group: "star", tone: "sky", icon: "⭐", title: "3★: hızlı yanıt", desc: "Kısa süreli taleplerde daha hızlı dönüş." });
  else out.push({ id: "st-0", group: "star", tone: "sky", icon: "🧠", title: "Yıldız seçersen kaliteyi sabitlersin", desc: "1–5★ seçimi kalite bandını netleştirir." });

  if (fset.size === 0) out.push({ id: "ft-0", group: "features", tone: "sky", icon: "🧩", title: "Özellik seçimi teklifleri güzelleştirir", desc: "Havuz/Spa/Merkez… seçtikçe daha isabetli oteller döner." });

  if (nearMe) out.push({ id: "nr-1", group: "near", tone: "sky", icon: "🧭", title: "Yakınımda ara: hızlı eşleşme", desc: "Konum daraldıkça oteller daha hızlı tepki verir." });
  else out.push({ id: "nr-0", group: "near", tone: "sky", icon: "🧭", title: "Yakınımda arayı açabilirsin", desc: "Konum daralırsa tekliflerin kalitesi artar." });

  const deadlineLabel = responseUnit === "minutes" ? `${responseValue} dk` : responseUnit === "hours" ? `${responseValue} saat` : `${responseValue} gün`;
  out.push({
    id: "dl-1",
    group: "deadline",
    tone: responseUnit === "minutes" ? "amber" : "emerald",
    icon: "⏱️",
    title: `Cevap süresi: ${deadlineLabel}`,
    desc: responseUnit === "minutes"
      ? "Kısa süre → hızlı ilk dalga."
      : responseUnit === "hours"
      ? "Orta süre → daha çok otel."
      : "Uzun süre → maksimum otel havuzu."
  });

  out.push({
    id: "nt-1",
    group: "note",
    tone: "emerald",
    icon: "💬",
    title: "Not ne kadar netse fiyat o kadar doğru",
    desc: "Geç giriş, sigarasız oda, bebek yatağı… net yaz → yanlış teklif azalır."
  });

  const by: Record<CampaignGroup, CampaignItem[]> = {
    name: [],
    city: [],
    district: [],
    dates: [],
    pax: [],
    rooms: [],
    accommodation: [],
    board: [],
    star: [],
    features: [],
    near: [],
    deadline: [],
    note: []
  };
  for (const x of out) by[x.group].push(x);

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

function FieldHint({ children }: { children: React.ReactNode }) {
  return <div className="mt-1 text-[0.72rem] text-slate-400">{children}</div>;
}
export default function NewRequestPage() {
  const { profile } = useAuth();

  const [submitting, setSubmitting] = useState(false);
  const [submitLockUntil, setSubmitLockUntil] = useState<number>(0);

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // kişi/oda
  const [adults, setAdults] = useState<number>(2);
  const [childrenCount, setChildrenCount] = useState<number>(0);
  const [childrenAges, setChildrenAges] = useState<number[]>([]);
  const [roomsCount, setRoomsCount] = useState<number>(1);
  const [roomTypes, setRoomTypes] = useState<string[]>(["farketmez"]);

  // cevap süresi
  const [responseValue, setResponseValue] = useState<number>(60);
  const [responseUnit, setResponseUnit] = useState<"minutes" | "hours" | "days">("minutes");

  // yakınımda
  const [nearMeChecked, setNearMeChecked] = useState(false);
  const [nearMeKm, setNearMeKm] = useState<number>(10);
  const [geo, setGeo] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const [geoMsg, setGeoMsg] = useState<string>("");

  // telefon kodları
  const [phoneCode, setPhoneCode] = useState<string>("+90");
  const [phoneCode2, setPhoneCode2] = useState<string>("+90");

  // şehir / ilçe
  const [selectedCity, setSelectedCity] = useState<string>("");
  const [selectedDistrict, setSelectedDistrict] = useState<string>("");

  // tarih & gece
  const [checkInInput, setCheckInInput] = useState<string>("");
  const [checkOutInput, setCheckOutInput] = useState<string>("");
  const [nights, setNights] = useState<number | null>(null);

  // saatler
  const [checkInTime, setCheckInTime] = useState<string>("14:00");
  const [sameDayStay, setSameDayStay] = useState<boolean>(false);

  // erken/geç
  const [earlyCheckInWanted, setEarlyCheckInWanted] = useState(false);
  const [earlyCheckInFrom, setEarlyCheckInFrom] = useState("10:00");
  const [earlyCheckInTo, setEarlyCheckInTo] = useState("14:00");
  const [lateCheckOutWanted, setLateCheckOutWanted] = useState(false);
  const [lateCheckOutFrom, setLateCheckOutFrom] = useState("12:00");
  const [lateCheckOutTo, setLateCheckOutTo] = useState("16:00");

  // özellik paneli
  const [showFeatures, setShowFeatures] = useState(false);

  // feature priorities
  const [featurePriority, setFeaturePriority] = useState<Record<string, FeaturePriority>>({});
  const [featureKeysLive, setFeatureKeysLive] = useState<string[]>([]);

  // başarı overlay
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
  const [overlayResponseText, setOverlayResponseText] = useState<string>("");

  // LIVE kampanya state
  const [guestNameLive, setGuestNameLive] = useState<string>(cleanText(profile?.displayName) || "");
  const [accommodationTypeLive, setAccommodationTypeLive] = useState<string>("");
  const [boardTypeLive, setBoardTypeLive] = useState<string>("");
  const [starRatingLive, setStarRatingLive] = useState<string>("");

  // title-case default
  useEffect(() => {
    setGuestNameLive(titleCaseTR(cleanText(profile?.displayName) || ""));
  }, [profile?.displayName]);

  // same-day toggle -> checkout = checkin
  useEffect(() => {
    if (!checkInInput) return;
    if (sameDayStay) {
      setCheckOutInput(checkInInput);
      setNights(1);
    }
  }, [sameDayStay, checkInInput]);

  // geolocation auto
  useEffect(() => {
    if (!nearMeChecked) {
      setGeo(null);
      setGeoMsg("");
      return;
    }
    if (!navigator.geolocation) {
      setGeoMsg("Cihaz konumu desteklemiyor.");
      return;
    }
    setGeoMsg("Konum alınıyor...");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setGeoMsg("Konum alındı ✅");
      },
      () => setGeoMsg("Konum alınamadı. Konum izni ver."),
      { enableHighAccuracy: true, timeout: 9000 }
    );
  }, [nearMeChecked]);

  function refetchGeo() {
    if (!navigator.geolocation) return setGeoMsg("Cihaz konumu desteklemiyor.");
    setGeoMsg("Konum tekrar alınıyor...");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setGeoMsg("Konum alındı ✅");
      },
      () => setGeoMsg("Konum alınamadı. Konum izni ver."),
      { enableHighAccuracy: true, timeout: 9000 }
    );
  }

  function setNowAsCheckIn() {
    const today = todayISO();
    const now = roundTo5Min(nowHHMM());
    setCheckInInput(today);
    setCheckInTime(now);

    if (sameDayStay) {
      setCheckOutInput(today);
      setNights(1);
    } else {
      if (!checkOutInput) {
        const t = new Date();
        t.setDate(t.getDate() + 1);
        const y = t.getFullYear();
        const m = String(t.getMonth() + 1).padStart(2, "0");
        const d = String(t.getDate()).padStart(2, "0");
        setCheckOutInput(`${y}-${m}-${d}`);
        setNights(1);
      } else {
        setNights(computeNightsFromStrings(today, checkOutInput));
      }
    }
  }

  const currentCity = useMemo(() => CITY_OPTIONS.find((c) => c.name === selectedCity), [selectedCity]);

  // promos tick
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => (t + 1) % 999999), 2300);
    return () => window.clearInterval(id);
  }, []);

  const campaigns = useMemo(() => {
    return buildCampaigns({
      tick,
      name: guestNameLive,
      city: selectedCity,
      district: selectedDistrict,
      checkIn: checkInInput,
      checkOut: checkOutInput,
      nights,
      adults,
      childrenCount,
      roomsCount,
      roomTypes,
      accommodationType: accommodationTypeLive,
      boardType: boardTypeLive,
      starRating: starRatingLive,
      features: featureKeysLive,
      nearMe: nearMeChecked,
      responseValue,
      responseUnit
    });
  }, [
    tick,
    guestNameLive,
    selectedCity,
    selectedDistrict,
    checkInInput,
    checkOutInput,
    nights,
    adults,
    childrenCount,
    roomsCount,
    roomTypes,
    accommodationTypeLive,
    boardTypeLive,
    starRatingLive,
    featureKeysLive,
    nearMeChecked,
    responseValue,
    responseUnit
  ]);

  function rotate2<T>(items: T[]) {
    if (!items || items.length === 0) return [];
    if (items.length <= 2) return items;
    const start = tick % items.length;
    return [items[start], items[(start + 1) % items.length]];
  }

  function handleChildrenChange(e: ChangeEvent<HTMLInputElement>) {
    const value = Math.max(0, Number(e.target.value || 0));
    setChildrenCount(value);
    setChildrenAges((prev) => {
      const next = [...prev];
      while (next.length < value) next.push(5);
      if (next.length > value) next.length = value;
      return next;
    });
  }

  function handleChildAgeChange(idx: number, age: number) {
    const safe = Math.max(0, Math.min(17, Number(age || 0)));
    setChildrenAges((prev) => {
      const next = [...prev];
      next[idx] = safe;
      return next;
    });
  }

  function handleRoomsChange(e: ChangeEvent<HTMLInputElement>) {
    const value = Math.max(1, Number(e.target.value || 1));
    setRoomsCount(value);
    setRoomTypes((prev) => {
      const next = [...prev];
      while (next.length < value) next.push("farketmez");
      if (next.length > value) next.length = value;
      return next;
    });
  }

  function handleRoomTypeChange(idx: number, type: string) {
    setRoomTypes((prev) => {
      const next = [...prev];
      next[idx] = type;
      return next;
    });
  }

  function handleCityChange(e: ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    setSelectedCity(value);
    setSelectedDistrict("");
  }

  function handleCheckInChange(e: ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setCheckInInput(value);
    if (sameDayStay) setCheckOutInput(value);
    setNights(computeNightsFromStrings(value, sameDayStay ? value : checkOutInput));
  }

  function handleCheckOutChange(e: ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setCheckOutInput(value);
    setNights(computeNightsFromStrings(checkInInput, value));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    setError(null);

    // lock 3 sn
    const nowMs = Date.now();
    if (nowMs < submitLockUntil) {
      setSubmitting(false);
      setError("Lütfen birkaç saniye bekle, talep gönderiliyor.");
      return;
    }
    setSubmitLockUntil(nowMs + 3000);

    try {
      const auth = getFirebaseAuth();
      const user = auth.currentUser;
      if (!user) {
        setError("Oturumun düşmüş görünüyor. Lütfen tekrar giriş yap.");
        return;
      }

      const formEl = e.currentTarget;
      const fd = new FormData(formEl);

      // ---- iletişim ----
      const rawName = cleanText(fd.get("guestName")) || cleanText(profile?.displayName) || "Misafir";
      const contactName = titleCaseTR(rawName);

      const contactEmail = cleanText(fd.get("guestEmail")) || cleanText(profile?.email) || cleanText(user.email) || "";
      const guestPhoneLocal = digitsOnly(cleanText(fd.get("guestPhone")));
      const guestPhone2Local = digitsOnly(cleanText(fd.get("guestPhone2")));

      if (!guestPhoneLocal || guestPhoneLocal.length < 10) {
        setError("Lütfen geçerli bir birincil telefon numarası girin.");
        return;
      }

      // ---- konum ----
      const cityRaw = selectedCity || cleanText(fd.get("city"));
      const districtRaw = selectedDistrict || cleanText(fd.get("district"));
      const city = titleCaseTR(cityRaw);
      const district = districtRaw ? titleCaseTR(districtRaw) : null;

      if (!city) {
        setError("Lütfen şehir seçin.");
        return;
      }

      const nearMe = nearMeChecked || fd.get("nearMe") === "on";
      const nearKm = nearMe ? Math.max(1, Number(nearMeKm || 10)) : null;

      if (nearMe && !geo) {
        setError("Yakınımda açıkken konum alınamadı. Lütfen konum izni ver veya tekrar dene.");
        return;
      }

      const locationNote = capFirstTR(cleanText(fd.get("locationNote")) || "") || null;

      // ---- tarih + saat ----
      const checkIn = checkInInput || cleanText(fd.get("checkIn"));
      const checkOutRaw = checkOutInput || cleanText(fd.get("checkOut"));

      if (!checkIn || !checkOutRaw) {
        setError("Lütfen giriş ve çıkış tarihlerini seç.");
        return;
      }

      if (checkIn < todayISO()) {
        setError("Check-in bugünden önce olamaz.");
        return;
      }

      const ciTime = checkInTime || "14:00";
      const coTime = CHECKOUT_TIME_FIXED;

      const checkOut = sameDayStay ? checkIn : checkOutRaw;

      // bugünse check-in saati geride olamaz
      if (checkIn === todayISO()) {
        const nowMin = timeToMinutes(nowHHMM());
        const ciMin = timeToMinutes(ciTime);
        if (ciMin < nowMin) {
          setError("Check-in saati şu andan önce olamaz. Lütfen saat seçimini güncelle.");
          return;
        }
      }

      const ciDT = buildLocalDateTime(checkIn, ciTime);
      const coDT = buildLocalDateTime(checkOut, coTime);

      if (sameDayStay) {
        if (timeToMinutes(ciTime) >= timeToMinutes(CHECKOUT_TIME_FIXED)) {
          setError("Aynı gün giriş-çıkış için giriş saati 12:00'dan önce olmalı.");
          return;
        }
      } else {
        if (coDT.getTime() <= ciDT.getTime()) {
          setError("Çıkış tarihi/saatı girişten önce olamaz.");
          return;
        }
      }

      const nightsValue = computeNightsFromStrings(checkIn, checkOut);

      // ---- kişi/oda ----
      const adultsSafe = Math.max(1, Number(adults || fd.get("adults") || 1));
      const safeChildrenCount = Math.max(0, Number(childrenCount || 0));
      const safeChildrenAges = Array.from({ length: safeChildrenCount }).map((_, i) => {
        const age = Number(childrenAges[i] ?? 5);
        return Number.isFinite(age) ? Math.max(0, Math.min(17, age)) : 5;
      });

      const safeRoomsCount = Math.max(1, Number(roomsCount || 1));
      const safeRoomTypes = Array.from({ length: safeRoomsCount }).map((_, i) => roomTypes[i] ?? "farketmez");
      const totalGuests = adultsSafe + safeChildrenCount;

      // kapasite uyarısı (hard değil ama çok abartıysa submiti durdur)
      const capWarn = capacityWarning(totalGuests, safeRoomsCount);
      if (capWarn && totalGuests / safeRoomsCount > 6) {
        setError("Kişi/oda oranı çok yüksek. Lütfen oda sayısını arttır (aksi halde teklif hatalı olur).");
        return;
      }

      // ---- tercihler ----
      const accommodationType = cleanText(fd.get("accommodationType")) || null;
      const boardType = cleanText(fd.get("boardType")) || null;
      const boardTypes = boardType ? [boardType] : [];

      const starRatingPref = String(fd.get("starRating") || "");
      const starNum = Number(starRatingPref || 0);
      const desiredStarRatings = Number.isFinite(starNum) && starNum >= 1 && starNum <= 5 ? [starNum] : null;

      // ---- features ----
      const featureKeys = fd.getAll("features").map(String);
      const extraFeaturesText = capFirstTR(cleanText(fd.get("extraFeatures")) || "") || null;

      // ---- note ----
      const note = capFirstTR(cleanText(fd.get("note")) || "") || null;

      // ---- early/late ----
      if (earlyCheckInWanted && timeToMinutes(earlyCheckInFrom) >= timeToMinutes(earlyCheckInTo)) {
        setError("Erken giriş saat aralığı hatalı. Başlangıç bitişten küçük olmalı.");
        return;
      }
      if (lateCheckOutWanted && timeToMinutes(lateCheckOutFrom) >= timeToMinutes(lateCheckOutTo)) {
        setError("Geç çıkış saat aralığı hatalı. Başlangıç bitişten küçük olmalı.");
        return;
      }

      // ---- süre ----
      const responseDeadlineMinutes = responseMinutesFromValue(responseValue, responseUnit);
      const responseTimeAmount = Math.max(1, Number(responseValue || 60));
      const responseTimeUnit = responseUnit;

      // room rows
      const roomTypeCounts: Record<string, number> = {};
      safeRoomTypes.forEach((t) => (roomTypeCounts[t] = (roomTypeCounts[t] || 0) + 1));
      const roomTypeRows = Object.entries(roomTypeCounts).map(([typeKey, count]) => ({ typeKey, count }));

      const db = getFirestoreDb();

      const requestDoc: AnyObj = {
        type: "hotel",
        isGroup: false,

        guestId: user.uid,
        guestDisplayName: cleanText(profile?.displayName) || null,

        // iletişim
        contactName,
        contactEmail: contactEmail || null,
        contactPhoneCountryCode: phoneCode,
        contactPhoneLocal: guestPhoneLocal,
        contactPhone: `${phoneCode} ${guestPhoneLocal}`,
        contactPhone2: guestPhone2Local ? `${phoneCode2} ${guestPhone2Local}` : null,

        // legacy
        guestName: contactName,
        guestEmail: contactEmail || null,
        guestPhone: `${phoneCode} ${guestPhoneLocal}`,
        guestPhone2: guestPhone2Local ? `${phoneCode2} ${guestPhone2Local}` : null,

        // konum
        city,
        district,
        nearMe,
        nearMeKm: nearKm,
        geo: geo ? { lat: geo.lat, lng: geo.lng, accuracy: geo.accuracy ?? null } : null,
        locationNote,

        // tarih + saat
        checkIn,
        checkInTime: ciTime,
        checkInDateTime: ciDT.toISOString(),

        checkOut,
        checkOutTime: CHECKOUT_TIME_FIXED,
        checkOutDateTime: coDT.toISOString(),

        sameDayStay: !!sameDayStay,
        nights: nightsValue ?? null,

        // kişi/oda
        adults: adultsSafe,
        childrenCount: safeChildrenCount,
        childrenAges: safeChildrenAges,
        roomsCount: safeRoomsCount,
        roomTypes: safeRoomTypes,
        totalGuests,
        roomTypeCounts,
        roomTypeRows,

        // tercihler
        accommodationType,
        boardType,
        boardTypes,
        starRating: desiredStarRatings ? desiredStarRatings[0] : null,
        desiredStarRatings,

        // özellikler
        featureKeys,
        featurePriorities: featurePriority,
        extraFeaturesText,
        hotelFeaturePrefs: featureKeys,
        hotelFeatureNote: extraFeaturesText,

        // early/late
        earlyCheckInWanted,
        earlyCheckInFrom: earlyCheckInWanted ? earlyCheckInFrom : null,
        earlyCheckInTo: earlyCheckInWanted ? earlyCheckInTo : null,

        lateCheckOutWanted,
        lateCheckOutFrom: lateCheckOutWanted ? lateCheckOutFrom : null,
        lateCheckOutTo: lateCheckOutWanted ? lateCheckOutTo : null,

        // not
        note,
        contactNote: note,

        // süre
        responseDeadlineMinutes,
        responseTimeAmount,
        responseTimeUnit,

        status: "open",
        createdAt: serverTimestamp()
      };

      const requestRef = await addDoc(collection(db, "requests"), requestDoc);

      await notifyHotelsForNewRequest({
        db,
        requestId: requestRef.id,
        city,
        district,
        checkIn,
        checkInTime: ciTime,
        checkOut,
        checkOutTime: CHECKOUT_TIME_FIXED,
        sameDayStay: !!sameDayStay,
        adults: adultsSafe,
        childrenCount: safeChildrenCount,
        roomsCount: safeRoomsCount,
        nearMe
      });

      // reset
      formEl.reset();

      setAdults(2);
      setChildrenCount(0);
      setChildrenAges([]);
      setRoomsCount(1);
      setRoomTypes(["farketmez"]);

      setResponseValue(60);
      setResponseUnit("minutes");

      setNearMeChecked(false);
      setNearMeKm(10);
      setGeo(null);
      setGeoMsg("");

      setSelectedCity("");
      setSelectedDistrict("");

      setCheckInInput("");
      setCheckOutInput("");
      setNights(null);

      setCheckInTime("14:00");
      setSameDayStay(false);

      setEarlyCheckInWanted(false);
      setEarlyCheckInFrom("10:00");
      setEarlyCheckInTo("14:00");

      setLateCheckOutWanted(false);
      setLateCheckOutFrom("12:00");
      setLateCheckOutTo("16:00");

      setShowFeatures(false);
      setFeatureKeysLive([]);
      setFeaturePriority({});

      setAccommodationTypeLive("");
      setBoardTypeLive("");
      setStarRatingLive("");

      let responseText = "";
      if (responseUnit === "minutes") responseText = `Otellerin bu talebe en geç ${responseValue} dakika içinde cevap vermesini istedin.`;
      else if (responseUnit === "hours") responseText = `Otellerin bu talebe en geç ${responseValue} saat içinde cevap vermesini istedin.`;
      else responseText = `Otellerin bu talebe en geç ${responseValue} gün içinde cevap vermesini istedin.`;

      setOverlayResponseText(responseText);
      setShowSuccessOverlay(true);
      setMessage("Talebin başarıyla oluşturuldu. Oteller belirlediğin süre içinde sana özel teklifler gönderecek.");
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Talep oluşturulurken bir hata oluştu. Lütfen tekrar dene.");
    } finally {
      setSubmitting(false);
    }
  }
  const totalGuestsPreview = adults + childrenCount;
  const capWarnText = capacityWarning(totalGuestsPreview, roomsCount);

  const score = useMemo(() => {
    const nameOk = (guestNameLive || "").trim().length >= 3;
    const phoneOk = true; // submitte kontrol
    const emailOk = true; // opsiyon
    const cityOk = !!selectedCity;
    const districtOk = !!selectedDistrict;
    const datesOk = !!checkInInput && !!checkOutInput;
    const timesOk = !!checkInTime;
    const roomsOk = roomsCount >= 1;
    const roomTypesOk = roomTypes.length === roomsCount;
    const accommodationOk = !!accommodationTypeLive;
    const boardOk = !!boardTypeLive;
    const starOk = !!starRatingLive;
    const featuresCount = featureKeysLive.length;
    const noteOk = true;
    const nearMeOk = !nearMeChecked || !!geo;
    const responseOk = !!responseValue && !!responseUnit;

    return computeRequestScore({
      nameOk, phoneOk, emailOk, cityOk, districtOk,
      datesOk, timesOk, roomsOk, roomTypesOk,
      accommodationOk, boardOk, starOk,
      featuresCount, noteOk, nearMeOk, responseOk
    });
  }, [
    guestNameLive, selectedCity, selectedDistrict, checkInInput, checkOutInput,
    checkInTime, roomsCount, roomTypes, accommodationTypeLive, boardTypeLive,
    starRatingLive, featureKeysLive, nearMeChecked, geo, responseValue, responseUnit
  ]);

  const scoreTone =
    score >= 80 ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100" :
    score >= 55 ? "border-amber-500/40 bg-amber-500/10 text-amber-100" :
    "border-red-500/40 bg-red-500/10 text-red-100";

  return (
    <Protected allowedRoles={["guest"]}>
      <div className="container-page max-w-5xl space-y-6 relative">
        {/* background */}
        <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
          <div className="absolute -top-40 left-1/2 h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-emerald-500/10 blur-3xl" />
          <div className="absolute top-44 -left-40 h-[520px] w-[620px] rounded-full bg-sky-500/10 blur-3xl" />
          <div className="absolute bottom-0 -right-56 h-[620px] w-[760px] rounded-full bg-pink-500/10 blur-3xl" />
          <div className="absolute inset-0 bg-gradient-to-b from-slate-950/30 via-slate-950 to-slate-950" />
        </div>

        {/* success overlay */}
        {showSuccessOverlay && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
            <div className="rounded-2xl border border-emerald-500/40 bg-slate-950 px-8 py-6 shadow-2xl shadow-emerald-500/40 max-w-md w-full space-y-3">
              <p className="text-emerald-300 font-semibold text-center text-lg">Talebin gönderildi! 🎉</p>
              <p className="text-[0.9rem] text-slate-100 text-center">Oteller belirlediğin kriterlere göre teklif hazırlayacak.</p>

              {overlayResponseText && (
                <p className="text-[0.85rem] text-amber-200 text-center border border-amber-400/40 bg-amber-500/10 rounded-md px-3 py-2 mt-1">
                  {overlayResponseText}
                </p>
              )}

              <p className="text-[0.75rem] text-slate-400 text-center">Gelen tekliflerini “Gelen teklifler” ekranından takip edebilirsin.</p>

              <div className="flex justify-center mt-2">
                <button
                  type="button"
                  onClick={() => setShowSuccessOverlay(false)}
                  className="inline-flex items-center rounded-full bg-emerald-500 text-slate-950 font-semibold px-5 py-1.5 text-[0.8rem] hover:bg-emerald-400"
                >
                  Tamam
                </button>
              </div>
            </div>
          </div>
        )}

        {/* header */}
        <div className="rounded-2xl border border-emerald-500/25 bg-gradient-to-r from-emerald-500/12 via-sky-500/5 to-slate-950 px-6 py-5 shadow-[0_30px_120px_rgba(0,0,0,0.45)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[0.7rem] text-slate-200">
                ⚡ Talep → Teklif → Pazarlık → Rezervasyon
              </div>
              <h1 className="text-2xl md:text-3xl font-semibold text-slate-100">Otel için talep oluştur</h1>
              <p className="text-sm text-slate-300 max-w-3xl">
                Talebin kriterlerine uyan otellere kapalı devre gider. Oteller belirlediğin süre içinde sadece sana özel teklif verir.
              </p>
            </div>
          </div>
        </div>

        {/* Request Score */}
        <div className={`rounded-2xl border px-5 py-4 ${scoreTone}`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[0.9rem] font-semibold">Talep Skoru: {score}/100</p>
              <p className="text-[0.75rem] opacity-90">Skor yükseldikçe teklifler daha doğru ve hızlı gelir.</p>
            </div>
            <div className="w-44 h-2 rounded-full bg-black/20 overflow-hidden">
              <div className="h-full bg-white/70" style={{ width: `${score}%` }} />
            </div>
          </div>
        </div>

        {error && <div className="text-xs text-red-200 bg-red-500/10 border border-red-500/40 rounded-xl px-4 py-3">{error}</div>}
        {message && <div className="text-xs text-emerald-200 bg-emerald-500/10 border border-emerald-500/40 rounded-xl px-4 py-3">{message}</div>}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* 1) Kimlik */}
          <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-5 shadow shadow-slate-950/40">
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20 text-[0.75rem] text-emerald-200">1</span>
              Kimlik & iletişim
            </h2>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs text-slate-200">Ad Soyad</label>
                <input
                  name="guestName"
                  defaultValue={profile?.displayName || ""}
                  onChange={(e) => setGuestNameLive(e.target.value)}
                  onBlur={(e) => {
                    const v = titleCaseTR(e.target.value);
                    e.target.value = v;
                    setGuestNameLive(v);
                  }}
                  placeholder="Örn: Yunus Emre"
                  className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100 focus:border-emerald-400 outline-none"
                />
                <PromoStrip items={rotate2(campaigns.name)} />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-200">E-posta (ops.)</label>
                <input
                  name="guestEmail"
                  type="email"
                  defaultValue={profile?.email || ""}
                  placeholder="Örn: yunus@mail.com"
                  className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100 focus:border-emerald-400 outline-none"
                />
                <FieldHint>Mail eklemek teklif sonrası iletişimi hızlandırır.</FieldHint>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs text-slate-200">Telefon (zorunlu)</label>
                <div className="flex gap-2">
                  <select
                    value={phoneCode}
                    onChange={(e) => setPhoneCode(e.target.value)}
                    className="rounded-xl bg-slate-900/70 border border-slate-700 px-3 py-3 text-xs text-slate-100 focus:border-emerald-400 outline-none"
                  >
                    {PHONE_CODES.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
                  </select>
                  <input
                    name="guestPhone"
                    required
                    placeholder="5XXXXXXXXX"
                    className="flex-1 rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100 focus:border-emerald-400 outline-none"
                  />
                </div>
                <FieldHint>Sadece rakam yaz. Örn: 5321234567</FieldHint>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-200">2. Telefon (ops.)</label>
                <div className="flex gap-2">
                  <select
                    value={phoneCode2}
                    onChange={(e) => setPhoneCode2(e.target.value)}
                    className="rounded-xl bg-slate-900/70 border border-slate-700 px-3 py-3 text-xs text-slate-100 focus:border-emerald-400 outline-none"
                  >
                    {PHONE_CODES.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
                  </select>
                  <input
                    name="guestPhone2"
                    placeholder="İkinci numara varsa"
                    className="flex-1 rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100 focus:border-emerald-400 outline-none"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* 2) Tarih & kişi & oda */}
          <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-5 shadow shadow-slate-950/40">
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20 text-[0.75rem] text-emerald-200">2</span>
              Tarih & kişi & oda
            </h2>

            <div className="grid gap-3 md:grid-cols-3">
              {/* CHECK-IN */}
              <div className="space-y-1">
                <label className="text-xs text-slate-200">Giriş tarihi</label>
                <input
                  type="date"
                  name="checkIn"
                  required
                  min={todayISO()}
                  value={checkInInput}
                  onChange={handleCheckInChange}
                  className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100 focus:border-emerald-400 outline-none"
                />

                <button
                  type="button"
                  onClick={setNowAsCheckIn}
                  className="mt-2 inline-flex w-full items-center justify-center rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-2 text-[0.75rem] font-semibold text-sky-200 hover:bg-sky-500/20"
                >
                  ⚡ Hemen şimdi giriş (tarih/saat otomatik)
                </button>

                <div className="mt-2">
                  <label className="text-[0.75rem] text-slate-400">Check-in saati</label>
                  <input
                    type="time"
                    value={checkInTime}
                    min={checkInInput === todayISO() ? nowHHMM() : undefined}
                    onChange={(e) => setCheckInTime(e.target.value)}
                    className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-2 text-sm text-slate-100 focus:border-emerald-400 outline-none"
                  />
                  <FieldHint>Bugün seçiliyse saat “şu andan önce” olamaz.</FieldHint>
                </div>
              </div>

              {/* CHECK-OUT */}
              <div className="space-y-1">
                <label className="text-xs text-slate-200">Çıkış tarihi</label>
                <input
                  type="date"
                  name="checkOut"
                  required
                  min={checkInInput ? checkInInput : todayISO()}
                  value={checkOutInput}
                  onChange={handleCheckOutChange}
                  disabled={sameDayStay}
                  className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100 focus:border-emerald-400 outline-none disabled:opacity-60"
                />

                <div className="mt-2">
                  <label className="text-[0.75rem] text-slate-400">Check-out saati (sabit)</label>
                  <div className="w-full rounded-xl bg-slate-900/40 border border-dashed border-slate-700 px-4 py-2 text-sm text-slate-200">
                    {CHECKOUT_TIME_FIXED}
                  </div>
                  <FieldHint>Check-out saati sistem gereği 12:00 sabit.</FieldHint>
                </div>

                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setSameDayStay((v) => !v)}
                    className={`w-full rounded-xl border px-4 py-2 text-[0.75rem] font-semibold ${
                      sameDayStay
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                        : "border-slate-700 bg-slate-900/30 text-slate-200 hover:border-emerald-400"
                    }`}
                  >
                    {sameDayStay ? "Aynı gün giriş-çıkış aktif ✅" : "Aynı gün giriş-çıkış (çıkış 12:00)"}
                  </button>
                  <FieldHint>Aynı gün seçilirse çıkış tarihi otomatik giriş tarihi olur.</FieldHint>
                </div>
              </div>

              {/* NIGHTS + EARLY/LATE */}
              <div className="space-y-2">
                <div className="space-y-1">
                  <label className="text-xs text-slate-200">Gece</label>
                  <input
                    readOnly
                    value={nights ?? ""}
                    placeholder="Tarih seç"
                    className="w-full rounded-xl bg-slate-900/40 border border-dashed border-slate-700 px-4 py-3 text-sm text-slate-400"
                  />
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-2">
                  <label className="inline-flex items-center gap-2 text-xs text-slate-200">
                    <input type="checkbox" checked={earlyCheckInWanted} onChange={(e) => setEarlyCheckInWanted(e.target.checked)} className="h-4 w-4 rounded border-slate-600 bg-slate-900" />
                    Erken giriş istiyorum
                  </label>
                  {earlyCheckInWanted && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[0.7rem] text-slate-400">Başlangıç</label>
                        <input type="time" value={earlyCheckInFrom} onChange={(e) => setEarlyCheckInFrom(e.target.value)} className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-slate-100" />
                      </div>
                      <div>
                        <label className="text-[0.7rem] text-slate-400">Bitiş</label>
                        <input type="time" value={earlyCheckInTo} onChange={(e) => setEarlyCheckInTo(e.target.value)} className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-slate-100" />
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-2">
                  <label className="inline-flex items-center gap-2 text-xs text-slate-200">
                    <input type="checkbox" checked={lateCheckOutWanted} onChange={(e) => setLateCheckOutWanted(e.target.checked)} className="h-4 w-4 rounded border-slate-600 bg-slate-900" />
                    Geç çıkış istiyorum
                  </label>
                  {lateCheckOutWanted && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[0.7rem] text-slate-400">Başlangıç</label>
                        <input type="time" value={lateCheckOutFrom} onChange={(e) => setLateCheckOutFrom(e.target.value)} className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-slate-100" />
                      </div>
                      <div>
                        <label className="text-[0.7rem] text-slate-400">Bitiş</label>
                        <input type="time" value={lateCheckOutTo} onChange={(e) => setLateCheckOutTo(e.target.value)} className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-slate-100" />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <PromoStrip items={rotate2(campaigns.dates)} />

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-200">Yetişkin</label>
                <input
                  type="number"
                  name="adults"
                  min={1}
                  value={adults}
                  onChange={(e) => setAdults(Math.max(1, Number(e.target.value || 1)))}
                  className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-200">Çocuk</label>
                <input
                  type="number"
                  min={0}
                  value={childrenCount}
                  onChange={handleChildrenChange}
                  className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-200">Oda sayısı</label>
                <input
                  type="number"
                  min={1}
                  value={roomsCount}
                  onChange={handleRoomsChange}
                  className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100"
                />
              </div>
            </div>

            {capWarnText ? (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-[0.8rem] text-amber-100">
                ⚠️ {capWarnText}
              </div>
            ) : null}

            <PromoStrip items={rotate2(campaigns.pax)} />

            {childrenCount > 0 && (
              <div className="space-y-2">
                <label className="text-xs text-slate-200">Çocuk yaşları</label>
                <div className="flex flex-wrap gap-2">
                  {Array.from({ length: childrenCount }).map((_, idx) => (
                    <div key={idx} className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2 flex items-center gap-2">
                      <span className="text-[0.7rem] text-slate-400">#{idx + 1}</span>
                      <input
                        type="number"
                        min={0}
                        max={17}
                        value={childrenAges[idx] ?? 5}
                        onChange={(e) => handleChildAgeChange(idx, Number(e.target.value || 0))}
                        className="w-16 rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-xs text-slate-100"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs text-slate-200">Her oda için oda tipi</label>
              <div className="grid gap-2 md:grid-cols-2">
                {Array.from({ length: roomsCount }).map((_, idx) => (
                  <div key={idx} className="space-y-1">
                    <span className="text-[0.7rem] text-slate-400">{idx + 1}. oda</span>
                    <select
                      value={roomTypes[idx] ?? "farketmez"}
                      onChange={(e) => handleRoomTypeChange(idx, e.target.value)}
                      className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-xs text-slate-100"
                    >
                      <option value="farketmez">Farketmez</option>
                      <option value="standard">Standart</option>
                      <option value="family">Aile odası</option>
                      <option value="suite">Suit</option>
                      <option value="deluxe">Deluxe</option>
                    </select>
                  </div>
                ))}
              </div>
              <PromoStrip items={rotate2(campaigns.rooms)} />
            </div>
          </section>
          {/* 3) Konum */}
          <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-5 shadow shadow-slate-950/40">
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20 text-[0.75rem] text-emerald-200">3</span>
              Konum
            </h2>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs text-slate-200">Şehir</label>
                <select
                  name="city"
                  value={selectedCity}
                  onChange={handleCityChange}
                  required
                  className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100"
                >
                  <option value="">Şehir seçin</option>
                  {CITY_OPTIONS.map((c) => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
                <PromoStrip items={rotate2(campaigns.city)} />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-200">İlçe</label>
                <select
                  name="district"
                  value={selectedDistrict}
                  onChange={(e) => setSelectedDistrict(e.target.value)}
                  disabled={!currentCity}
                  className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100 disabled:opacity-60"
                >
                  <option value="">Farketmez (şehrin tamamı)</option>
                  {currentCity?.districts.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
                <PromoStrip items={rotate2(campaigns.district)} />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 text-xs text-slate-200">
                <input
                  type="checkbox"
                  name="nearMe"
                  checked={nearMeChecked}
                  onChange={(e) => setNearMeChecked(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                />
                Yakınımda ara
              </label>

              {nearMeChecked && (
                <>
                  <div className="inline-flex items-center gap-1 text-xs">
                    <span className="text-slate-200">Maks.:</span>
                    <input
                      type="number"
                      min={1}
                      value={nearMeKm}
                      onChange={(e) => setNearMeKm(Number(e.target.value || 1))}
                      className="w-20 rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-xs text-slate-100"
                    />
                    <span className="text-slate-400">km</span>
                  </div>

                  <button
                    type="button"
                    onClick={refetchGeo}
                    className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2 text-[0.75rem] text-slate-200 hover:border-emerald-400"
                  >
                    Konumu tekrar al
                  </button>
                </>
              )}
            </div>

            {nearMeChecked && (
              <div className="text-[0.75rem] text-slate-300">
                {geoMsg ? geoMsg : "Konum alınıyor..."}
                {geo ? (
                  <span className="text-slate-500"> • {geo.lat.toFixed(5)}, {geo.lng.toFixed(5)} (±{Math.round(geo.accuracy || 0)}m)</span>
                ) : null}
              </div>
            )}

            <PromoStrip items={rotate2(campaigns.near)} />

            <div className="space-y-1">
              <label className="text-xs text-slate-200">Konum notu (ops.)</label>
              <textarea
                name="locationNote"
                rows={2}
                placeholder="Örn: hastaneye yakın, stadyuma yürüme mesafesi..."
                className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-xs text-slate-100"
              />
            </div>
          </section>

          {/* 4) Tercihler */}
          <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-5 shadow shadow-slate-950/40">
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20 text-[0.75rem] text-emerald-200">4</span>
              Tercihler
            </h2>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-200">Tesis türü</label>
                <select
                  name="accommodationType"
                  onChange={(e) => setAccommodationTypeLive(e.target.value)}
                  className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-xs text-slate-100"
                >
                  <option value="">Farketmez</option>
                  {ACCOMMODATION_TYPES.map((t) => (
                    <option key={t.key} value={t.key}>{t.label}</option>
                  ))}
                </select>
                <PromoStrip items={rotate2(campaigns.accommodation)} />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-200">Yeme-içme</label>
                <select
                  name="boardType"
                  onChange={(e) => setBoardTypeLive(e.target.value)}
                  className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-xs text-slate-100"
                >
                  <option value="">Farketmez</option>
                  {BOARD_TYPES.map((b) => (
                    <option key={b.key} value={b.key}>{b.label}</option>
                  ))}
                </select>
                <PromoStrip items={rotate2(campaigns.board)} />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-200">Yıldız</label>
                <select
                  name="starRating"
                  onChange={(e) => setStarRatingLive(e.target.value)}
                  className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-xs text-slate-100"
                >
                  <option value="">Farketmez</option>
                  <option value="1">En az 1★</option>
                  <option value="2">En az 2★</option>
                  <option value="3">En az 3★</option>
                  <option value="4">En az 4★</option>
                  <option value="5">Sadece 5★</option>
                </select>
                <PromoStrip items={rotate2(campaigns.star)} />
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowFeatures((v) => !v)}
              className="mt-2 inline-flex items-center rounded-xl border border-slate-700 px-4 py-2 text-[0.75rem] text-slate-100 hover:border-emerald-400 bg-white/0 hover:bg-white/5"
            >
              {showFeatures ? "Özellikleri gizle" : "Otel özelliklerini seç (isteğe bağlı)"}
            </button>

            {showFeatures && (
              <div className="mt-3 space-y-3 border-t border-slate-800 pt-3">
                <div className="grid gap-2 md:grid-cols-2">
                  {FEATURES.map((f) => (
                    <div key={f.key} className="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <label className="flex items-center gap-2 text-xs text-slate-200">
                          <input
                            type="checkbox"
                            name="features"
                            value={f.key}
                            onChange={(e) => {
                              const key = e.target.value;

                              setFeatureKeysLive((prev) =>
                                e.target.checked ? Array.from(new Set([...prev, key])) : prev.filter((x) => x !== key)
                              );

                              if (!e.target.checked) {
                                setFeaturePriority((prev) => {
                                  const n = { ...prev };
                                  delete n[key];
                                  return n;
                                });
                              } else {
                                setFeaturePriority((prev) => ({ ...prev, [key]: prev[key] ?? "nice" }));
                              }
                            }}
                            className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                          />
                          {f.label}
                        </label>

                        <select
                          value={featurePriority[f.key] || "nice"}
                          onChange={(e) => setFeaturePriority((prev) => ({ ...prev, [f.key]: e.target.value as FeaturePriority }))}
                          disabled={!featureKeysLive.includes(f.key)}
                          className="rounded-lg bg-slate-900 border border-slate-700 px-2 py-1 text-[0.7rem] text-slate-100 disabled:opacity-50"
                        >
                          {FEATURE_PRIORITIES.map((p) => (
                            <option key={p.key} value={p.key}>{p.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>

                <PromoStrip items={rotate2(campaigns.features)} />

                <div className="space-y-1">
                  <label className="text-xs text-slate-200">Ek özellikler (ops.)</label>
                  <textarea
                    name="extraFeatures"
                    rows={2}
                    placeholder="Örn: toplantı salonu, büyük otobüs otoparkı..."
                    className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-xs text-slate-100"
                  />
                </div>
              </div>
            )}
          </section>

          {/* 5) Not & Süre */}
          <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-5 shadow shadow-slate-950/40">
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20 text-[0.75rem] text-emerald-200">5</span>
              Not & teklif süresi
            </h2>

            <div className="space-y-1">
              <label className="text-xs text-slate-200">Genel not (ops.)</label>
              <textarea
                name="note"
                rows={3}
                placeholder="Örn: Geç giriş yapacağız, sigarasız oda, bebek yatağı..."
                className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100"
              />
              <PromoStrip items={rotate2(campaigns.note)} />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-200">Cevap süresi</label>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <input
                  type="number"
                  min={1}
                  value={responseValue}
                  onChange={(e) => setResponseValue(Number(e.target.value || 1))}
                  className="w-24 rounded-xl bg-slate-900/70 border border-slate-700 px-3 py-2 text-xs text-slate-100"
                />
                <select
                  value={responseUnit}
                  onChange={(e) => setResponseUnit(e.target.value as any)}
                  className="rounded-xl bg-slate-900/70 border border-slate-700 px-3 py-2 text-xs text-slate-100"
                >
                  <option value="minutes">dakika</option>
                  <option value="hours">saat</option>
                  <option value="days">gün</option>
                </select>
              </div>
              <PromoStrip items={rotate2(campaigns.deadline)} />
            </div>
          </section>

          <div className="flex justify-center pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center rounded-full bg-emerald-500 text-slate-950 font-semibold px-10 py-3 text-sm disabled:opacity-60 shadow-lg shadow-emerald-500/30 hover:bg-emerald-400 transition-transform hover:scale-[1.02]"
            >
              {submitting ? "Talebin gönderiliyor..." : "Talebi Gönder"}
            </button>
          </div>
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
