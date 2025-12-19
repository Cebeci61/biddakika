"use client";

import { FormEvent, useMemo, useState, ChangeEvent } from "react";
import { Protected } from "@/components/Protected";
import { useAuth } from "@/context/AuthContext";
import { getFirebaseAuth, getFirestoreDb } from "@/lib/firebase/client";
import {
  addDoc,
  collection,
  serverTimestamp,
  getDocs,
  query,
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
    districts: [
      "Beşiktaş",
      "Şişli",
      "Kadıköy",
      "Üsküdar",
      "Fatih",
      "Beyoğlu",
      "Bakırköy",
      "Ataşehir",
      "Kartal",
      "Ümraniye",
      "Bahçelievler",
      "Sarıyer"
    ]
  },
  {
    name: "Ankara",
    districts: ["Çankaya", "Keçiören", "Yenimahalle", "Mamak", "Sincan", "Etimesgut"]
  },
  {
    name: "İzmir",
    districts: ["Konak", "Karşıyaka", "Bornova", "Buca", "Çeşme", "Alsancak"]
  },
  {
    name: "Antalya",
    districts: ["Muratpaşa", "Konyaaltı", "Lara", "Alanya", "Manavgat", "Belek", "Kemer"]
  },
  {
    name: "Trabzon",
    districts: [
      "Ortahisar",
      "Akçaabat",
      "Yomra",
      "Arsin",
      "Araklı",
      "Of",
      "Vakfıkebir",
      "Sürmene",
      "Maçka",
      "Beşikdüzü"
    ]
  }
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

  // 1) Önce yeni yapına göre: hotelProfile.city / hotelProfile.district
  const q1 = district
    ? query(
        usersCol,
        where("role", "==", "hotel"),
        where("hotelProfile.city", "==", city),
        where("hotelProfile.district", "==", district)
      )
    : query(usersCol, where("role", "==", "hotel"), where("hotelProfile.city", "==", city));

  let snap = await getDocs(q1);

  // 2) Fallback: eski projelerde users.city/users.district olabilir
  if (snap.empty) {
    const q2 = district
      ? query(usersCol, where("role", "==", "hotel"), where("city", "==", city), where("district", "==", district))
      : query(usersCol, where("role", "==", "hotel"), where("city", "==", city));
    snap = await getDocs(q2);
  }

  const base = {
    to: "", // doldurulacak
    type: "new_request",
    payload: {
      requestId,
      city,
      district,
      checkIn,
      checkOut,
      adults,
      childrenCount,
      roomsCount
    },
    createdAt: serverTimestamp(),
    read: false
  };

  const promises: Promise<any>[] = [];
  snap.forEach((d) => {
    promises.push(
      addDoc(notificationsCol, {
        ...base,
        to: d.id
      })
    );
  });

  if (promises.length) await Promise.all(promises);
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

  const currentCity = useMemo(
    () => CITY_OPTIONS.find((c) => c.name === selectedCity),
    [selectedCity]
  );

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

      // --------- 1) CONTACT / İLETİŞİM ---------
      const contactName = cleanText(fd.get("guestName")) || cleanText(profile?.displayName) || "Misafir";
      const contactEmail = cleanText(fd.get("guestEmail")) || cleanText(profile?.email) || cleanText(user.email) || "";
      const guestPhoneLocal = digitsOnly(cleanText(fd.get("guestPhone")));
      const guestPhone2Local = digitsOnly(cleanText(fd.get("guestPhone2")));

      if (!guestPhoneLocal || guestPhoneLocal.length < 10) {
        setError("Lütfen geçerli bir birincil telefon numarası girin.");
        return;
      }

      // --------- 2) TARİH ---------
      const checkIn = checkInInput || cleanText(fd.get("checkIn"));
      const checkOut = checkOutInput || cleanText(fd.get("checkOut"));
      if (!checkIn || !checkOut) {
        setError("Lütfen giriş ve çıkış tarihlerini seç.");
        return;
      }
      const nightsValue = computeNightsFromStrings(checkIn, checkOut);

      // --------- 3) ŞEHİR / İLÇE ---------
      const city = selectedCity || cleanText(fd.get("city"));
      const districtRaw = selectedDistrict || cleanText(fd.get("district"));
      const district = districtRaw ? districtRaw : null;

      if (!city) {
        setError("Lütfen şehir seçin.");
        return;
      }

      // --------- 4) KİŞİ / ODA ---------
      const adults = Math.max(1, Number(fd.get("adults") || 1));
      const safeChildrenCount = Math.max(0, Number(childrenCount || 0));
      const safeChildrenAges = Array.from({ length: safeChildrenCount }).map((_, i) => {
        const age = Number(childrenAges[i] ?? 5);
        return Number.isFinite(age) ? Math.max(0, Math.min(17, age)) : 5;
      });

      const safeRoomsCount = Math.max(1, Number(roomsCount || 1));
      const safeRoomTypes = Array.from({ length: safeRoomsCount }).map((_, i) => roomTypes[i] ?? "farketmez");

      const totalGuests = adults + safeChildrenCount;

      // --------- 5) KONUM / YAKINIMDA ---------
      const nearMe = nearMeChecked || fd.get("nearMe") === "on";
      const nearKm = nearMe ? Math.max(1, Number(nearMeKm || 10)) : null;
      const locationNote = cleanText(fd.get("locationNote")) || null;

      // --------- 6) TERCİHLER (otel tipi / yeme-içme / yıldız) ---------
      const accommodationType = cleanText(fd.get("accommodationType")) || null;

      const boardType = cleanText(fd.get("boardType")) || null; // tek seçim
      const boardTypes = boardType ? [boardType] : []; // otelci sayfaları için

      const starRatingPref = Number(fd.get("starRating") || 0);
      const desiredStarRatings =
        starRatingPref === 3 || starRatingPref === 4 || starRatingPref === 5
          ? [starRatingPref]
          : null;

      // --------- 7) ÖZELLİKLER ---------
      const featureKeys = fd.getAll("features").map(String); // checkbox
      const extraFeaturesText = cleanText(fd.get("extraFeatures")) || null;

      // otelci sayfaları için uyum:
      const hotelFeaturePrefs = featureKeys;
      const hotelFeatureNote = extraFeaturesText;

      // --------- 8) GENEL NOT ---------
      const note = cleanText(fd.get("note")) || null;

      // otelci tarafında “misafirin notu” diye göstermek için:
      const contactNote = note;

      // --------- 9) CEVAP SÜRESİ ---------
      const responseDeadlineMinutes = responseMinutesFromValue(responseValue, responseUnit);
      const responseTimeAmount = Math.max(1, Number(responseValue || 60));
      const responseTimeUnit = responseUnit;

      // --------- 10) oda tip count/rows (otelciye net tablo) ---------
      const roomTypeCounts: Record<string, number> = {};
      safeRoomTypes.forEach((t) => (roomTypeCounts[t] = (roomTypeCounts[t] || 0) + 1));
      const roomTypeRows = Object.entries(roomTypeCounts).map(([typeKey, count]) => ({ typeKey, count }));

      // --------- 11) Firestore write ---------
      const db = getFirestoreDb();

      const requestDoc = {
        type: "hotel",
        isGroup: false,

        // kim açtı
        guestId: user.uid,
        guestDisplayName: cleanText(profile?.displayName) || null,

        // İletişim (otelci tarafında maskeleyeceksin)
        contactName,
        contactEmail: contactEmail || null,
        contactPhoneCountryCode: phoneCode,
        contactPhoneLocal: guestPhoneLocal,
        contactPhone: `${phoneCode} ${guestPhoneLocal}`,
        contactPhone2: guestPhone2Local ? `${phoneCode2} ${guestPhone2Local}` : null,

        // geri uyum (eski alanların null gelmesini engeller)
        guestName: contactName,
        guestEmail: contactEmail || null,
        guestPhone: `${phoneCode} ${guestPhoneLocal}`,
        guestPhone2: guestPhone2Local ? `${phoneCode2} ${guestPhone2Local}` : null,

        // konum
        city,
        district,
        nearMe,
        nearMeKm: nearKm,
        locationNote,

        // tarih
        checkIn,
        checkOut,
        nights: nightsValue ?? null,

        // kişi/oda
        adults,
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
        extraFeaturesText,
        hotelFeaturePrefs,
        hotelFeatureNote,

        // notlar
        note,
        contactNote,

        // cevap süresi
        responseDeadlineMinutes,
        responseTimeAmount,
        responseTimeUnit,

        status: "open",
        createdAt: serverTimestamp()
      };

      const requestRef = await addDoc(collection(db, "requests"), requestDoc);

      // --------- 12) Notifications: sadece ilgili şehir/ilçe otelleri ---------
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

      // --------- 13) UI reset ---------
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
      <div className="container-page max-w-4xl space-y-6 relative">
        {/* Başlık kartı */}
        <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-slate-950 px-5 py-4">
          <h1 className="text-2xl md:text-3xl font-semibold mb-1">
            Otel için talep oluştur
          </h1>
          <p className="text-sm text-emerald-50/90 max-w-2xl">
            Bu formu doldurduğunda talebin kriterlerine uyan otellere kapalı devre gönderilir.
            Oteller, belirlediğin süre içinde sadece sana özel teklif verir.
          </p>
        </div>

        {/* Başarı overlay */}
        {showSuccessOverlay && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
            <div className="rounded-2xl border border-emerald-500/40 bg-slate-950 px-8 py-6 shadow-2xl shadow-emerald-500/40 max-w-md w-full space-y-3">
              <p className="text-emerald-300 font-semibold text-center text-lg">
                Talebin gönderildi! 🎉
              </p>
              <p className="text-[0.9rem] text-slate-100 text-center">
                Artık oteller belirlediğin kriterlere göre sana teklif hazırlayacak.
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

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* 1. Kimlik & iletişim */}
          <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow shadow-slate-950/40">
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-[0.7rem] text-emerald-300">1</span>
              Kimlik & iletişim
            </h2>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs text-slate-200">Ad Soyad</label>
                <input
                  name="guestName"
                  defaultValue={profile?.displayName || ""}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                  placeholder="Adınız Soyadınız"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-200">E-posta</label>
                <input
                  name="guestEmail"
                  type="email"
                  defaultValue={profile?.email || ""}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                  placeholder="ornek@mail.com"
                />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)]">
              <div className="space-y-1">
                <label className="text-xs text-slate-200">Birincil telefon (zorunlu)</label>
                <div className="flex gap-2">
                  <select
                    value={phoneCode}
                    onChange={(e) => setPhoneCode(e.target.value)}
                    className="rounded-md bg-slate-900 border border-slate-700 px-2 py-2 text-xs"
                  >
                    {PHONE_CODES.map((p) => (
                      <option key={p.code} value={p.code}>{p.label}</option>
                    ))}
                  </select>
                  <input
                    name="guestPhone"
                    type="tel"
                    required
                    className="flex-1 rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                    placeholder="5XXXXXXXXX"
                  />
                </div>
                <p className="text-[0.7rem] text-slate-500">Sadece rakam gir. Alan kodu soldan seçilir.</p>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-200">İkinci telefon (opsiyonel)</label>
                <div className="flex gap-2">
                  <select
                    value={phoneCode2}
                    onChange={(e) => setPhoneCode2(e.target.value)}
                    className="rounded-md bg-slate-900 border border-slate-700 px-2 py-2 text-xs"
                  >
                    {PHONE_CODES.map((p) => (
                      <option key={p.code} value={p.code}>{p.label}</option>
                    ))}
                  </select>
                  <input
                    name="guestPhone2"
                    type="tel"
                    className="flex-1 rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                    placeholder="İkinci numara varsa"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* 2. Tarihler & kişi sayısı */}
          <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow shadow-slate-950/40">
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-[0.7rem] text-emerald-300">2</span>
              Konaklama tarihleri & kişi sayısı
            </h2>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-200">Giriş Tarihi</label>
                <input
                  type="date"
                  name="checkIn"
                  required
                  value={checkInInput}
                  onChange={handleCheckInChange}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-200">Çıkış Tarihi</label>
                <input
                  type="date"
                  name="checkOut"
                  required
                  value={checkOutInput}
                  onChange={handleCheckOutChange}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-200">Toplam gece</label>
                <input
                  type="text"
                  value={nights ?? ""}
                  readOnly
                  placeholder="Tarihi seçince hesaplanır"
                  className="w-full rounded-md bg-slate-900/70 border border-dashed border-slate-700 px-3 py-2 text-sm text-slate-400 cursor-not-allowed"
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
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-200">Çocuk</label>
                <input
                  type="number"
                  min={0}
                  value={childrenCount}
                  onChange={handleChildrenChange}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-200">Oda Sayısı</label>
                <input
                  type="number"
                  min={1}
                  value={roomsCount}
                  onChange={handleRoomsChange}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                />
              </div>
            </div>

            {childrenCount > 0 && (
              <div className="space-y-1">
                <label className="text-xs text-slate-200">Çocuk yaşları (her çocuk için ayrı)</label>
                <div className="flex flex-wrap gap-2">
                  {Array.from({ length: childrenCount }).map((_, idx) => (
                    <div key={idx} className="flex items-center gap-1">
                      <span className="text-[0.7rem] text-slate-400">{idx + 1}.</span>
                      <input
                        type="number"
                        min={0}
                        max={17}
                        value={childrenAges[idx] ?? 5}
                        onChange={(e) => handleChildAgeChange(idx, Number(e.target.value || 0))}
                        className="w-16 rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-xs"
                      />
                      <span className="text-[0.7rem] text-slate-400">yaş</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {roomsCount > 0 && (
              <div className="space-y-1">
                <label className="text-xs text-slate-200">Her oda için oda tipi (oda sayısı kadar)</label>
                <div className="grid gap-2 md:grid-cols-2">
                  {Array.from({ length: roomsCount }).map((_, idx) => (
                    <div key={idx} className="space-y-1">
                      <span className="text-[0.7rem] text-slate-400">{idx + 1}. oda tipi</span>
                      <select
                        value={roomTypes[idx] ?? "farketmez"}
                        onChange={(e) => handleRoomTypeChange(idx, e.target.value)}
                        className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                      >
                        <option value="farketmez">Farketmez</option>
                        <option value="standard">Standart oda</option>
                        <option value="family">Aile odası</option>
                        <option value="suite">Suit</option>
                        <option value="deluxe">Deluxe oda</option>
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* 3. Konum */}
          <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow shadow-slate-950/40">
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-[0.7rem] text-emerald-300">3</span>
              Konum: il, ilçe ve yakınımda ara
            </h2>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs text-slate-200">İl (şehir)</label>
                <select
                  name="city"
                  value={selectedCity}
                  onChange={handleCityChange}
                  required
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                >
                  <option value="">Şehir seçin</option>
                  {CITY_OPTIONS.map((c) => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-200">İlçe</label>
                <select
                  name="district"
                  value={selectedDistrict}
                  onChange={(e) => setSelectedDistrict(e.target.value)}
                  disabled={!currentCity}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm disabled:opacity-60"
                >
                  <option value="">Farketmez (şehrin tamamı)</option>
                  {currentCity?.districts.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>

                <p className="text-[0.7rem] text-slate-500">
                  İlçe boşsa şehirdeki tüm otellere gider. İlçe seçersen sadece o ilçedeki otellere bildirim düşer.
                </p>
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
                  <span className="text-slate-200">Maks. mesafe:</span>
                  <input
                    type="number"
                    min={1}
                    value={nearMeKm}
                    onChange={(e) => setNearMeKm(Number(e.target.value || 1))}
                    className="w-16 rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-xs"
                  />
                  <span className="text-slate-400">km</span>
                </div>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-200">Otelin çevresi / konumla ilgili beklentin (opsiyonel)</label>
              <textarea
                name="locationNote"
                rows={2}
                className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                placeholder="Örn: hastaneye yakın, dere kenarı, stadyuma yürüme mesafesi..."
              />
            </div>
          </section>

          {/* 4. Tercihler */}
          <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow shadow-slate-950/40">
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-[0.7rem] text-emerald-300">4</span>
              Tesis türü, yeme-içme, yıldız ve otel özellikleri
            </h2>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-200">Tesis türü</label>
                <select
                  name="accommodationType"
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                >
                  <option value="">Farketmez</option>
                  {ACCOMMODATION_TYPES.map((t) => (
                    <option key={t.key} value={t.key}>{t.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-200">Yeme-içme tipi</label>
                <select
                  name="boardType"
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                >
                  <option value="">Farketmez</option>
                  {BOARD_TYPES.map((b) => (
                    <option key={b.key} value={b.key}>{b.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-200">Yıldız sayısı (isteğe bağlı)</label>
                <select
                  name="starRating"
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                >
                  <option value="">Farketmez</option>
                  <option value="3">En az 3★</option>
                  <option value="4">En az 4★</option>
                  <option value="5">Sadece 5★</option>
                </select>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowFeatures((v) => !v)}
              className="mt-2 inline-flex items-center rounded-md border border-slate-700 px-3 py-1 text-[0.7rem] text-slate-100 hover:border-emerald-400"
            >
              {showFeatures ? "Otel özelliklerini gizle" : "Otel özelliklerini göster (isteğe bağlı)"}
            </button>

            {showFeatures && (
              <div className="mt-3 space-y-3 border-t border-slate-800 pt-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-200">Otelde olmasını istediğin özellikler (checkbox)</label>
                  <div className="grid gap-2 md:grid-cols-2">
                    {FEATURES.map((f) => (
                      <label key={f.key} className="flex items-center gap-2 text-xs text-slate-200">
                        <input
                          type="checkbox"
                          name="features"
                          value={f.key}
                          className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                        />
                        {f.label}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-200">Ek özellikler (yazıyla belirt)</label>
                  <textarea
                    name="extraFeatures"
                    rows={2}
                    className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                    placeholder="Örn: toplantı salonu, büyük otobüs otoparkı, sahile yürüme mesafesi..."
                  />
                </div>
              </div>
            )}
          </section>

          {/* 5. Not & cevap süresi */}
          <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow shadow-slate-950/40">
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-[0.7rem] text-emerald-300">5</span>
              Not ve otellerin cevap süresi
            </h2>

            <div className="space-y-1">
              <label className="text-xs text-slate-200">Genel notun (opsiyonel)</label>
              <textarea
                name="note"
                rows={3}
                placeholder="Örn: Gece geç giriş yapacağız, mümkünse üst kat, balkonlu oda istiyoruz..."
                className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-200">Otellerin teklif göndermesi için en fazla süre</label>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <input
                  type="number"
                  min={1}
                  value={responseValue}
                  onChange={(e) => setResponseValue(Number(e.target.value || 1))}
                  className="w-20 rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-xs"
                />
                <select
                  value={responseUnit}
                  onChange={(e) => setResponseUnit(e.target.value as "minutes" | "hours" | "days")}
                  className="rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-xs"
                >
                  <option value="minutes">dakika</option>
                  <option value="hours">saat</option>
                  <option value="days">gün</option>
                </select>
                <span className="text-[0.7rem] text-slate-400">
                  Örn: 60 dk, 2 saat, 1 gün. Süre dolunca talep otomatik kapanır.
                </span>
              </div>
            </div>
          </section>

          {error && (
            <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/40 rounded-md px-3 py-2">
              {error}
            </p>
          )}
          {message && (
            <p className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/40 rounded-md px-3 py-2">
              {message}
            </p>
          )}

          <div className="flex justify-center">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center rounded-full bg-emerald-500 text-slate-950 font-semibold px-8 py-2 text-sm disabled:opacity-60 shadow-lg shadow-emerald-500/40 hover:bg-emerald-400 transition-transform hover:scale-[1.02]"
            >
              {submitting ? "Talebin gönderiliyor..." : "Talebi Gönder"}
            </button>
          </div>
        </form>
      </div>
    </Protected>
  );
}
