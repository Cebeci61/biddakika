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
    districts: ["Beşiktaş","Şişli","Kadıköy","Üsküdar","Fatih","Beyoğlu","Bakırköy","Ataşehir","Kartal","Ümraniye","Bahçelievler","Sarıyer"]
  },
  { name: "Ankara", districts: ["Çankaya","Keçiören","Yenimahalle","Mamak","Sincan","Etimesgut"] },
  { name: "İzmir", districts: ["Konak","Karşıyaka","Bornova","Buca","Çeşme","Alsancak"] },
  { name: "Antalya", districts: ["Muratpaşa","Konyaaltı","Lara","Alanya","Manavgat","Belek","Kemer"] },
  { name: "Trabzon", districts: ["Ortahisar","Akçaabat","Yomra","Arsin","Araklı","Of","Vakfıkebir","Sürmene","Maçka","Beşikdüzü"] }
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

/** ----------- NOTIFICATION: otellere talep bildirimi ----------- */
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

  const q1 = district
    ? query(
        usersCol,
        where("role", "==", "hotel"),
        where("hotelProfile.city", "==", city),
        where("hotelProfile.district", "==", district)
      )
    : query(usersCol, where("role", "==", "hotel"), where("hotelProfile.city", "==", city));

  let snap = await getDocs(q1);

  // fallback (eski user schema)
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

/** -------------------- KAMPANYA MOTORU (DAĞILMIŞ) -------------------- */

type CampaignTone = "emerald" | "amber" | "pink" | "sky";
type CampaignItem = { id: string; tone: CampaignTone; icon: string; title: string; desc: string };

function toneBadge(t: CampaignTone) {
  if (t === "emerald") return "border-emerald-400/30 bg-emerald-500/10 text-emerald-100";
  if (t === "amber") return "border-amber-400/30 bg-amber-500/10 text-amber-100";
  if (t === "pink") return "border-pink-400/30 bg-pink-500/10 text-pink-100";
  return "border-sky-400/30 bg-sky-500/10 text-sky-100";
}

function buildDistributedCampaigns(args: {
  name: string;
  city: string;
  district: string;
  accommodationType: string;
  boardType: string;
  starRating: string;
  roomTypes: string[];
  features: string[];
  nearMe: boolean;
}) {
  const name = (args.name || "").trim();
  const nameLower = name.toLowerCase();
  const city = (args.city || "").trim();
  const cityLower = city.toLowerCase();
  const district = (args.district || "").trim();
  const at = (args.accommodationType || "").trim().toLowerCase();
  const bt = (args.boardType || "").trim().toUpperCase();
  const star = (args.starRating || "").trim();
  const roomTypes = args.roomTypes || [];
  const features = new Set((args.features || []).map(String));
  const nearMe = !!args.nearMe;

  const by: Record<
    "name" | "city" | "district" | "rooms" | "accommodation" | "board" | "star" | "features" | "near",
    CampaignItem[]
  > = {
    name: [],
    city: [],
    district: [],
    rooms: [],
    accommodation: [],
    board: [],
    star: [],
    features: [],
    near: []
  };

  // NAME
  if (name.length >= 2) {
    const hotName = ["yunus", "emre", "ali", "ahmet", "mehmet"].some((x) => nameLower.includes(x));
    by.name.push(
      hotName
        ? { id: "nm-1", tone: "pink", icon: "⚡", title: `${name.split(" ")[0]} acele et`, desc: "Bu saatlerde odalar hızlı kapanıyor. Erken talep daha çok teklif getirir." }
        : { id: "nm-2", tone: "emerald", icon: "✅", title: "Talep otellere anında düşer", desc: "Net bilgiler = daha hızlı ve daha iyi fiyat." }
    );
  } else {
    by.name.push({ id: "nm-0", tone: "sky", icon: "🧩", title: "İsmini yaz, talebi güçlendir", desc: "Otel tarafında talep daha ‘gerçek’ görünür → dönüş artar." });
  }

  // CITY
  if (city) {
    if (cityLower.includes("ankara")) by.city.push({ id: "ct-ank", tone: "amber", icon: "📈", title: "Ankara’da yoğunluk var", desc: "Kısa süreli taleplerde oteller daha agresif teklif verir." });
    else if (cityLower.includes("istanbul")) by.city.push({ id: "ct-ist", tone: "amber", icon: "🏙️", title: "İstanbul’da fiyatlar anlık değişiyor", desc: "Süreyi kısa tutmak fiyat avantajı sağlar." });
    else if (cityLower.includes("antalya")) by.city.push({ id: "ct-ant", tone: "emerald", icon: "🌴", title: "Antalya’da kampanyalar düşüyor", desc: "BB/HB/AI seçimlerinde gizli indirimli teklifler gelir." });
    else if (cityLower.includes("trabzon")) by.city.push({ id: "ct-trab", tone: "sky", icon: "⛰️", title: "Trabzon’da manzara odaları hızla bitiyor", desc: "Manzara seçimi kaliteyi artırır; erken karar avantaj." });
    else by.city.push({ id: "ct-gen", tone: "sky", icon: "🟢", title: `${city} için oteller hazır`, desc: "İlçe seçersen daha hedefli teklifler gelir." });
  }

  // DISTRICT
  if (city && district) by.district.push({ id: "ds-1", tone: "sky", icon: "📍", title: `${city}/${district} hedefli`, desc: "İlçe seçimi otel havuzunu daraltır → daha net teklif." });
  else if (city && !district) by.district.push({ id: "ds-0", tone: "amber", icon: "🎯", title: "İlçe seçimi = daha net fiyat", desc: "İlçe seçmezsen daha çok teklif; seçersen daha kaliteli teklif." });

  // ROOMS
  if (roomTypes.some((t) => String(t).toLowerCase() === "family")) by.rooms.push({ id: "rm-fam", tone: "pink", icon: "👨‍👩‍👧‍👦", title: "Aile odaları sınırlı", desc: "Bu kategori hızlı kapanır. Erken teklif yakala." });
  if (roomTypes.some((t) => String(t).toLowerCase() === "suite")) by.rooms.push({ id: "rm-suite", tone: "amber", icon: "✨", title: "Suit odalar az", desc: "Daha az teklif ama daha premium seçenekler gelir." });
  if (roomTypes.length && roomTypes.every((t) => String(t).toLowerCase() === "farketmez")) by.rooms.push({ id: "rm-any", tone: "sky", icon: "🧠", title: "Oda tipi seçersen kalite artar", desc: "Otel doğru oda tipine net fiyat verir." });

  // ACCOMMODATION
  if (at === "hotel") by.accommodation.push({ id: "ac-hotel", tone: "amber", icon: "🏨", title: "Oteller hızla doluyor", desc: "Merkez bölgelerde erken teklif avantajı var." });
  else if (at === "apartment" || at === "aparthotel") by.accommodation.push({ id: "ac-apart", tone: "emerald", icon: "🏢", title: "Apart/dairenin talebi yüksek", desc: "Uzun konaklamada daha iyi fiyat verir." });
  else if (at === "bungalow") by.accommodation.push({ id: "ac-bung", tone: "pink", icon: "🌲", title: "Bungalovlar erken kapanır", desc: "Doğa konseptinde fiyat hızlı değişir." });
  else by.accommodation.push({ id: "ac-0", tone: "sky", icon: "🧩", title: "Tesis türü seçmek faydalı", desc: "Seçim yaparsan dönüş hızı artar." });

  // BOARD
  if (!bt) by.board.push({ id: "bd-0", tone: "sky", icon: "🧠", title: "Yeme-içme seçimi fiyatı netleştirir", desc: "Board seçimi olmadan otel geniş aralıkla teklif verir." });
  else if (bt === "AI" || bt === "UAI") by.board.push({ id: "bd-ai", tone: "emerald", icon: "🍽️", title: "AI/UAI kampanyalı", desc: "Her şey dahil paketlerde indirim artar." });
  else if (bt === "BB") by.board.push({ id: "bd-bb", tone: "sky", icon: "☕", title: "BB en çok teklif gelen", desc: "Kahvaltı dahil otel havuzunu artırır." });
  else by.board.push({ id: "bd-gen", tone: "amber", icon: "🍴", title: "HB/FB’de pazarlık şansı", desc: "Bazı oteller bu tiplerde ekstra indirim verir." });

  // STAR
  if (star === "5") by.star.push({ id: "st-5", tone: "pink", icon: "🏆", title: "5★ VIP teklif dalgası", desc: "İlk 30 dk daha agresif fiyat gelir." });
  else if (star === "4") by.star.push({ id: "st-4", tone: "amber", icon: "⭐", title: "4★ fiyat/performans", desc: "Teklif sayısı yüksek, pazarlık şansı güçlü." });
  else if (star === "3") by.star.push({ id: "st-3", tone: "sky", icon: "⭐", title: "3★ hızlı yanıt", desc: "Kısa süreli taleplerde daha hızlı dönüş." });
  else by.star.push({ id: "st-0", tone: "sky", icon: "🧠", title: "Yıldız seçersen kalite sabitlenir", desc: "4★/5★ seçimi kaliteyi netleştirir." });

  // FEATURES
  if (features.size === 0) by.features.push({ id: "ft-0", tone: "sky", icon: "🧩", title: "Özellik seçimi teklifleri güzelleştirir", desc: "Havuz/Spa/Merkez… seçtikçe daha isabetli oteller döner." });
  else {
    if (features.has("pool")) by.features.push({ id: "ft-pool", tone: "amber", icon: "🏊", title: "Havuzlu oteller rekabetçi", desc: "Kalite artar; indirimli teklif gelebilir." });
    if (features.has("spa")) by.features.push({ id: "ft-spa", tone: "pink", icon: "💆", title: "Spa premium teklifler", desc: "Bazı oteller upgrade bile ekleyebilir." });
    if (features.has("cityCenter")) by.features.push({ id: "ft-center", tone: "amber", icon: "📍", title: "Merkez oteller hızlı kapanıyor", desc: "Erken teklif avantajı." });
    if (features.has("family")) by.features.push({ id: "ft-family", tone: "pink", icon: "👨‍👩‍👧‍👦", title: "Aile konseptinde talep yüksek", desc: "Doluluk daha hızlı artar." });
  }

  // NEAR
  if (nearMe) by.near.push({ id: "nr-1", tone: "sky", icon: "🧭", title: "Yakınımda ara: hızlı eşleşme", desc: "Konum daraldıkça oteller daha hızlı tepki verir." });
  else by.near.push({ id: "nr-0", tone: "sky", icon: "🧭", title: "Yakınımda arayı açabilirsin", desc: "Konum daralırsa tekliflerin kalitesi artar." });

  return by;
}
export default function NewRequestPage() {
  const { profile } = useAuth();

  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // çocuk
  const [childrenCount, setChildrenCount] = useState<number>(0);
  const [childrenAges, setChildrenAges] = useState<number[]>([]);

  // oda sayısı / tipi
  const [roomsCount, setRoomsCount] = useState<number>(1);
  const [roomTypes, setRoomTypes] = useState<string[]>(["farketmez"]);

  // cevap süresi
  const [responseValue, setResponseValue] = useState<number>(60);
  const [responseUnit, setResponseUnit] = useState<"minutes" | "hours" | "days">("minutes");

  // yakınımda ara
  const [nearMeChecked, setNearMeChecked] = useState(false);
  const [nearMeKm, setNearMeKm] = useState<number>(10);

  // telefon kodları
  const [phoneCode, setPhoneCode] = useState<string>("+90");
  const [phoneCode2, setPhoneCode2] = useState<string>("+90");

  // şehir / ilçe
  const [selectedCity, setSelectedCity] = useState<string>("");
  const [selectedDistrict, setSelectedDistrict] = useState<string>("");

  // tarih & geceler
  const [checkInInput, setCheckInInput] = useState<string>("");
  const [checkOutInput, setCheckOutInput] = useState<string>("");
  const [nights, setNights] = useState<number | null>(null);

  // otel özellikleri paneli
  const [showFeatures, setShowFeatures] = useState(false);

  // başarı overlay
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
  const [overlayResponseText, setOverlayResponseText] = useState<string>("");

  // LIVE reklam state (sayfaya dağılmış)
  const [guestNameLive, setGuestNameLive] = useState<string>(cleanText(profile?.displayName) || "");
  const [accommodationTypeLive, setAccommodationTypeLive] = useState<string>("");
  const [boardTypeLive, setBoardTypeLive] = useState<string>("");
  const [starRatingLive, setStarRatingLive] = useState<string>("");
  const [featureKeysLive, setFeatureKeysLive] = useState<string[]>([]);

  // reklam rotasyonu (her alan altında aynı reklam kalmasın)
  const [promoTick, setPromoTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setPromoTick((t) => (t + 1) % 999999), 2400);
    return () => window.clearInterval(id);
  }, []);

  const currentCity = useMemo(
    () => CITY_OPTIONS.find((c) => c.name === selectedCity),
    [selectedCity]
  );

  const campaigns = useMemo(() => {
    return buildDistributedCampaigns({
      name: guestNameLive,
      city: selectedCity,
      district: selectedDistrict,
      accommodationType: accommodationTypeLive,
      boardType: boardTypeLive,
      starRating: starRatingLive,
      roomTypes,
      features: featureKeysLive,
      nearMe: nearMeChecked
    });
  }, [
    guestNameLive,
    selectedCity,
    selectedDistrict,
    accommodationTypeLive,
    boardTypeLive,
    starRatingLive,
    roomTypes,
    featureKeysLive,
    nearMeChecked
  ]);

  function rotate(items: CampaignItem[]) {
    if (!items || items.length === 0) return [];
    if (items.length <= 2) return items;
    const start = promoTick % items.length;
    const a = items[start];
    const b = items[(start + 1) % items.length];
    return [a, b];
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
    setNights(computeNightsFromStrings(value, checkOutInput));
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

    try {
      const auth = getFirebaseAuth();
      const user = auth.currentUser;
      if (!user) {
        setError("Oturumun düşmüş görünüyor. Lütfen tekrar giriş yap.");
        return;
      }

      const formEl = e.currentTarget;
      const fd = new FormData(formEl);

      const contactName = cleanText(fd.get("guestName")) || cleanText(profile?.displayName) || "Misafir";
      const contactEmail = cleanText(fd.get("guestEmail")) || cleanText(profile?.email) || cleanText(user.email) || "";
      const guestPhoneLocal = digitsOnly(cleanText(fd.get("guestPhone")));
      const guestPhone2Local = digitsOnly(cleanText(fd.get("guestPhone2")));

      if (!guestPhoneLocal || guestPhoneLocal.length < 10) {
        setError("Lütfen geçerli bir birincil telefon numarası girin.");
        return;
      }

      const checkIn = checkInInput || cleanText(fd.get("checkIn"));
      const checkOut = checkOutInput || cleanText(fd.get("checkOut"));
      if (!checkIn || !checkOut) {
        setError("Lütfen giriş ve çıkış tarihlerini seç.");
        return;
      }
      const nightsValue = computeNightsFromStrings(checkIn, checkOut);

      const city = selectedCity || cleanText(fd.get("city"));
      const districtRaw = selectedDistrict || cleanText(fd.get("district"));
      const district = districtRaw ? districtRaw : null;
      if (!city) {
        setError("Lütfen şehir seçin.");
        return;
      }

      const adults = Math.max(1, Number(fd.get("adults") || 1));
      const safeChildrenCount = Math.max(0, Number(childrenCount || 0));
      const safeChildrenAges = Array.from({ length: safeChildrenCount }).map((_, i) => {
        const age = Number(childrenAges[i] ?? 5);
        return Number.isFinite(age) ? Math.max(0, Math.min(17, age)) : 5;
      });

      const safeRoomsCount = Math.max(1, Number(roomsCount || 1));
      const safeRoomTypes = Array.from({ length: safeRoomsCount }).map((_, i) => roomTypes[i] ?? "farketmez");
      const totalGuests = adults + safeChildrenCount;

      const nearMe = nearMeChecked || fd.get("nearMe") === "on";
      const nearKm = nearMe ? Math.max(1, Number(nearMeKm || 10)) : null;
      const locationNote = cleanText(fd.get("locationNote")) || null;

      const accommodationType = cleanText(fd.get("accommodationType")) || null;
      const boardType = cleanText(fd.get("boardType")) || null;
      const boardTypes = boardType ? [boardType] : [];

      const starRatingPref = String(fd.get("starRating") || "");
      const starNum = Number(starRatingPref || 0);
      const desiredStarRatings = starNum === 3 || starNum === 4 || starNum === 5 ? [starNum] : null;

      const featureKeys = fd.getAll("features").map(String);
      const extraFeaturesText = cleanText(fd.get("extraFeatures")) || null;

      const note = cleanText(fd.get("note")) || null;

      const responseDeadlineMinutes = responseMinutesFromValue(responseValue, responseUnit);
      const responseTimeAmount = Math.max(1, Number(responseValue || 60));
      const responseTimeUnit = responseUnit;

      const roomTypeCounts: Record<string, number> = {};
      safeRoomTypes.forEach((t) => (roomTypeCounts[t] = (roomTypeCounts[t] || 0) + 1));
      const roomTypeRows = Object.entries(roomTypeCounts).map(([typeKey, count]) => ({ typeKey, count }));

      const db = getFirestoreDb();

      const requestDoc = {
        type: "hotel",
        isGroup: false,

        guestId: user.uid,
        guestDisplayName: cleanText(profile?.displayName) || null,

        contactName,
        contactEmail: contactEmail || null,
        contactPhoneCountryCode: phoneCode,
        contactPhoneLocal: guestPhoneLocal,
        contactPhone: `${phoneCode} ${guestPhoneLocal}`,
        contactPhone2: guestPhone2Local ? `${phoneCode2} ${guestPhone2Local}` : null,

        // legacy compat
        guestName: contactName,
        guestEmail: contactEmail || null,
        guestPhone: `${phoneCode} ${guestPhoneLocal}`,
        guestPhone2: guestPhone2Local ? `${phoneCode2} ${guestPhone2Local}` : null,

        city,
        district,
        nearMe,
        nearMeKm: nearKm,
        locationNote,

        checkIn,
        checkOut,
        nights: nightsValue ?? null,

        adults,
        childrenCount: safeChildrenCount,
        childrenAges: safeChildrenAges,
        roomsCount: safeRoomsCount,
        roomTypes: safeRoomTypes,
        totalGuests,
        roomTypeCounts,
        roomTypeRows,

        accommodationType,
        boardType,
        boardTypes,
        starRating: desiredStarRatings ? desiredStarRatings[0] : null,
        desiredStarRatings,

        featureKeys,
        extraFeaturesText,
        hotelFeaturePrefs: featureKeys,
        hotelFeatureNote: extraFeaturesText,

        note,
        contactNote: note,

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
        checkOut,
        adults,
        childrenCount: safeChildrenCount,
        roomsCount: safeRoomsCount
      });

      // reset
      formEl.reset();
      setChildrenCount(0);
      setChildrenAges([]);
      setRoomsCount(1);
      setRoomTypes(["farketmez"]);
      setResponseValue(60);
      setResponseUnit("minutes");
      setNearMeChecked(false);
      setNearMeKm(10);
      setSelectedCity("");
      setSelectedDistrict("");
      setCheckInInput("");
      setCheckOutInput("");
      setNights(null);
      setShowFeatures(false);

      setGuestNameLive(cleanText(profile?.displayName) || "");
      setAccommodationTypeLive("");
      setBoardTypeLive("");
      setStarRatingLive("");
      setFeatureKeysLive([]);

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
              <p className="text-[0.9rem] text-slate-100 text-center">
                Oteller belirlediğin kriterlere göre teklif hazırlayacak.
              </p>

              {overlayResponseText && (
                <p className="text-[0.85rem] text-amber-200 text-center border border-amber-400/40 bg-amber-500/10 rounded-md px-3 py-2 mt-1">
                  {overlayResponseText}
                </p>
              )}

              <p className="text-[0.75rem] text-slate-400 text-center">
                Gelen tekliflerini üst menüdeki{" "}
                <span className="font-semibold text-emerald-300">“Gelen teklifler”</span>{" "}
                sayfasından takip edebilirsin.
              </p>

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
                Talebin kriterlerine uyan otellere “kapalı devre” gider. Oteller belirlediğin süre içinde sadece sana özel teklif verir.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-slate-200">
              <div className="flex items-center justify-between gap-8">
                <div>
                  <div className="text-slate-400">Gece</div>
                  <div className="text-lg font-extrabold text-white">{nights ?? "-"}</div>
                </div>
                <div>
                  <div className="text-slate-400">Oda</div>
                  <div className="text-lg font-extrabold text-white">{roomsCount}</div>
                </div>
                <div>
                  <div className="text-slate-400">Çocuk</div>
                  <div className="text-lg font-extrabold text-white">{childrenCount}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* global errors */}
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
                  className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100 focus:border-emerald-400 outline-none"
                />
                <PromoStrip2 items={rotate(campaigns.name)} />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-200">E-posta</label>
                <input
                  name="guestEmail"
                  type="email"
                  defaultValue={profile?.email || ""}
                  className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100 focus:border-emerald-400 outline-none"
                />
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
                    {PHONE_CODES.map((p) => (
                      <option key={p.code} value={p.code}>{p.label}</option>
                    ))}
                  </select>
                  <input
                    name="guestPhone"
                    required
                    className="flex-1 rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100 focus:border-emerald-400 outline-none"
                    placeholder="5XXXXXXXXX"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-200">2. Telefon (ops.)</label>
                <div className="flex gap-2">
                  <select
                    value={phoneCode2}
                    onChange={(e) => setPhoneCode2(e.target.value)}
                    className="rounded-xl bg-slate-900/70 border border-slate-700 px-3 py-3 text-xs text-slate-100 focus:border-emerald-400 outline-none"
                  >
                    {PHONE_CODES.map((p) => (
                      <option key={p.code} value={p.code}>{p.label}</option>
                    ))}
                  </select>
                  <input
                    name="guestPhone2"
                    className="flex-1 rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100 focus:border-emerald-400 outline-none"
                    placeholder="İkinci numara varsa"
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
              <div className="space-y-1">
                <label className="text-xs text-slate-200">Giriş</label>
                <input
                  type="date"
                  name="checkIn"
                  required
                  value={checkInInput}
                  onChange={handleCheckInChange}
                  className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100 focus:border-emerald-400 outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-200">Çıkış</label>
                <input
                  type="date"
                  name="checkOut"
                  required
                  value={checkOutInput}
                  onChange={handleCheckOutChange}
                  className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100 focus:border-emerald-400 outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-200">Gece</label>
                <input
                  readOnly
                  value={nights ?? ""}
                  className="w-full rounded-xl bg-slate-900/40 border border-dashed border-slate-700 px-4 py-3 text-sm text-slate-400"
                  placeholder="Tarih seç"
                />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-200">Yetişkin</label>
                <input
                  type="number"
                  name="adults"
                  min={1}
                  defaultValue={2}
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

            {roomsCount > 0 && (
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
                <PromoStrip2 items={rotate(campaigns.rooms)} />
              </div>
            )}
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
                <PromoStrip2 items={rotate(campaigns.city)} />
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
                <PromoStrip2 items={rotate(campaigns.district)} />
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
              )}
            </div>

            <PromoStrip2 items={rotate(campaigns.near)} />

            <div className="space-y-1">
              <label className="text-xs text-slate-200">Konum notu (ops.)</label>
              <textarea
                name="locationNote"
                rows={2}
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
                <PromoStrip2 items={rotate(campaigns.accommodation)} />
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
                <PromoStrip2 items={rotate(campaigns.board)} />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-200">Yıldız</label>
                <select
                  name="starRating"
                  onChange={(e) => setStarRatingLive(e.target.value)}
                  className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-xs text-slate-100"
                >
                  <option value="">Farketmez</option>
                  <option value="3">En az 3★</option>
                  <option value="4">En az 4★</option>
                  <option value="5">Sadece 5★</option>
                </select>
                <PromoStrip2 items={rotate(campaigns.star)} />
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
                    <label key={f.key} className="flex items-center gap-2 text-xs text-slate-200">
                      <input
                        type="checkbox"
                        name="features"
                        value={f.key}
                        onChange={(e) => {
                          const key = e.target.value;
                          setFeatureKeysLive((prev) =>
                            e.target.checked ? Array.from(new Set([...prev, key])) : prev.filter((x) => x !== key)
                          );
                        }}
                        className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                      />
                      {f.label}
                    </label>
                  ))}
                </div>

                <PromoStrip2 items={rotate(campaigns.features)} />

                <div className="space-y-1">
                  <label className="text-xs text-slate-200">Ek özellikler (ops.)</label>
                  <textarea
                    name="extraFeatures"
                    rows={2}
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
                className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-4 py-3 text-sm text-slate-100"
              />
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
                <span className="text-[0.75rem] text-slate-400">
                  Kısa süre = hızlı teklif, uzun süre = daha çok otel.
                </span>
              </div>

              <div className="mt-2 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-[0.75rem] text-amber-100">
                ⏱️ 60 dk: hızlı dalga • 2-4 saat: daha çok otel • 1 gün: maksimum çeşit
              </div>
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

/** -------------------- PROMO UI -------------------- */

function PromoStrip2({ items }: { items: CampaignItem[] }) {
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
