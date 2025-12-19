// app/guest/group-request/page.tsx
"use client";

import { useState, FormEvent, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Protected } from "@/components/Protected";
import { useAuth } from "@/context/AuthContext";
import { getFirestoreDb } from "@/lib/firebase/client";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";

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

type PropertyTypeKey =
  | "hotel"
  | "motel"
  | "apart"
  | "pension"
  | "hostel"
  | "villa";

type ResponseUnit = "minutes" | "hours" | "days";

interface RoomRowState {
  id: string;
  typeKey: RoomTypeKey;
  count: string; // string input, sayıya çeviriyoruz
}

interface CityOption {
  name: string;
  districts: string[];
}

/* ---------- sabitler ---------- */

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

// Şehir–ilçe seçenekleri (örnek); istersen burayı kendi il–ilçelerine göre genişletebilirsin
const CITY_OPTIONS: CityOption[] = [
  {
    name: "Trabzon",
    districts: ["Ortahisar", "Akçaabat", "Yomra", "Sürmene", "Of", "Araklı"]
  },
  {
    name: "İstanbul",
    districts: [
      "Beşiktaş",
      "Şişli",
      "Fatih",
      "Kadıköy",
      "Üsküdar",
      "Bakırköy",
      "Beyoğlu"
    ]
  },
  {
    name: "Antalya",
    districts: ["Konyaaltı", "Muratpaşa", "Alanya", "Kemer", "Side", "Belek"]
  }
];

const PHONE_CODES = [
  { code: "+90", label: "Türkiye" },
  { code: "+994", label: "Azerbaycan" },
  { code: "+7", label: "Rusya / Kazakistan" },
  { code: "+971", label: "BAE" },
  { code: "+966", label: "Suudi Arabistan" },
  { code: "+974", label: "Katar" },
  { code: "+965", label: "Kuveyt" },
  { code: "+968", label: "Umman" },
  { code: "+973", label: "Bahreyn" },
  { code: "+964", label: "Irak" }
];

/* ---------- helper fonksiyonlar ---------- */

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
    {
      id: `row_${Date.now()}`,
      typeKey: "standard",
      count: "5"
    }
  ]);

  // tesis tipi
  const [propertyTypes, setPropertyTypes] = useState<PropertyTypeKey[]>([]);

  // konaklama tipi
  const [boardTypes, setBoardTypes] = useState<BoardType[]>([]);
  const [boardTypeNote, setBoardTypeNote] = useState("");

  // otel özellikleri
  const [features, setFeatures] = useState<FeatureKey[]>([]);
  const [featureNote, setFeatureNote] = useState("");

  // yıldız tipi
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

  useEffect(() => {
    if (profile && !authLoading) {
      setContactName(profile.displayName || "");
      setContactEmail(profile.email || "");
    }
  }, [profile, authLoading]);

  if (authLoading) {
    return (
      <Protected allowedRoles={["guest"]}>
        <div className="container-page">
          <p className="text-sm text-slate-400">
            Bilgilerin yükleniyor...
          </p>
        </div>
      </Protected>
    );
  }

  /* ---------- toggle’lar ---------- */

  function handleCityChange(cityName: string) {
    setCity(cityName);
    setSelectedDistricts([]); // şehir değişince ilçeleri sıfırla
  }

  function toggleDistrict(d: string) {
    setSelectedDistricts((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
    );
  }

  function togglePropertyType(key: PropertyTypeKey) {
    setPropertyTypes((prev) =>
      prev.includes(key)
        ? prev.filter((p) => p !== key)
        : [...prev, key]
    );
  }

  function toggleBoardType(key: BoardType) {
    setBoardTypes((prev) =>
      prev.includes(key)
        ? prev.filter((b) => b !== key)
        : [...prev, key]
    );
  }

  function toggleFeature(key: FeatureKey) {
    setFeatures((prev) =>
      prev.includes(key)
        ? prev.filter((f) => f !== key)
        : [...prev, key]
    );
  }

  function toggleStarRating(star: number) {
    setDesiredStarRatings((prev) =>
      prev.includes(star)
        ? prev.filter((s) => s !== star)
        : [...prev, star].sort()
    );
  }

  function addRoomRow() {
    setRoomRows((prev) => [
      ...prev,
      {
        id: `row_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        typeKey: "standard",
        count: "1"
      }
    ]);
  }

  function updateRoomRow(
    id: string,
    partial: Partial<Pick<RoomRowState, "typeKey" | "count">>
  ) {
    setRoomRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...partial } : row))
    );
  }

  function removeRoomRow(id: string) {
    setRoomRows((prev) =>
      prev.length <= 1 ? prev : prev.filter((r) => r.id !== id)
    );
  }

  /* ---------- submit ---------- */

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

    const parsedRows = roomRows.map((row) => ({
      ...row,
      countNum: Number(row.count) || 0
    }));

    const totalRoomsFromRows = parsedRows.reduce(
      (sum, r) => sum + r.countNum,
      0
    );

    if (totalRoomsFromRows === 0) {
      setError(
        "Lütfen en az bir oda satırında kaç oda istediğini belirt (toplam 0 olamaz)."
      );
      return;
    }

    if (totalRoomsFromRows !== rooms) {
      setError(
        `Oda satırlarındaki toplam oda sayısı (${totalRoomsFromRows}), üstteki toplam oda sayısı (${rooms}) ile aynı olmalıdır. Lütfen düzelt.`
      );
      return;
    }

    const totalGuests =
      (Number(adults) || 0) + (Number(children) || 0);

    const phoneFull =
      phoneLocal.trim() !== ""
        ? `${phoneCountryCode} ${phoneLocal.trim()}`
        : "";

    const respAmt = Number(responseAmount) || 3;
    const respUnit: ResponseUnit = responseUnit;
    const responseDeadlineMinutes = toMinutes(respAmt, respUnit);
    const responseHuman = `${respAmt} ${responseUnitLabelTR(
      respUnit
    )}`;

    // oda tiplerini aggregate et (otel tarafı için)
    const roomTypeCounts: Record<string, number> = {};
    parsedRows.forEach((r) => {
      roomTypeCounts[r.typeKey] =
        (roomTypeCounts[r.typeKey] || 0) + r.countNum;
    });

    const roomTypesSummary = Object.entries(roomTypeCounts)
      .filter(([, count]) => count > 0)
      .map(([key]) => key);

    // çoklu ilçe
    const primaryDistrict = selectedDistricts[0] ?? null;
    const districtsArray =
      selectedDistricts.length > 0 ? selectedDistricts : null;

    try {
      setSaving(true);

      await addDoc(collection(db, "requests"), {
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
        roomTypeRows: parsedRows.map((r) => ({
          typeKey: r.typeKey,
          count: r.countNum
        })),

        propertyTypes:
          propertyTypes.length > 0 ? propertyTypes : null,

        boardTypes,
        boardTypeNote: boardTypeNote.trim() || null,
        hotelFeaturePrefs: features,
        hotelFeatureNote: featureNote.trim() || null,
        desiredStarRatings:
          desiredStarRatings.length > 0
            ? desiredStarRatings
            : null,

        contactName: contactName.trim(),
        contactEmail: contactEmail.trim(),
        contactPhoneCountryCode: phoneCountryCode,
        contactPhoneLocal: phoneLocal.trim() || null,
        contactPhone: phoneFull || null,
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

      const text = `Grup rezervasyon talebin oluşturuldu. Otellerin cevap süresi: ${responseHuman}. Bu süre içinde uygun oteller teklif gönderecek.`;
      setConfirmText(text);
      setConfirmOpen(true);
    } catch (err) {
      console.error("Group request create error:", err);
      setError(
        "Talep kaydedilirken bir hata oluştu. Lütfen tekrar dene."
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <Protected allowedRoles={["guest"]}>
      <div className="container-page max-w-3xl space-y-6">
        {/* Başlık */}
        <section className="space-y-2">
          <h1 className="text-2xl font-semibold">Grup talebi oluştur</h1>
          <p className="text-sm text-slate-300">
            Buradan <strong>5 oda ve üzeri</strong> konaklamalar için tek
            seferde grup rezervasyon talebi oluşturabilirsin. Talebin,
            kriterlerine uyan otellere kapalı devre olarak gönderilir; oteller
            belirlediğin süre içinde sana özel fiyat teklif eder.
          </p>
        </section>

        {/* Hata / bilgi mesajları */}
        {(error || message) && (
          <section className="space-y-1 text-xs">
            {error && (
              <p className="text-red-300 bg-red-500/10 border border-red-500/40 rounded-md px-3 py-2">
                {error}
              </p>
            )}
            {message && (
              <p className="text-emerald-300 bg-emerald-500/10 border border-emerald-500/40 rounded-md px-3 py-2">
                {message}
              </p>
            )}
          </section>
        )}

        {/* FORM */}
        <form onSubmit={handleSubmit} className="space-y-6 text-xs">
          {/* Konum & tarih */}
          <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 space-y-3">
            <h2 className="text-sm font-semibold text-slate-100">
              Konum ve tarih
            </h2>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">
                  Ülke
                </label>
                <input
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="Örn: Türkiye"
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">
                  Şehir *
                </label>
                <select
                  value={city}
                  onChange={(e) => handleCityChange(e.target.value)}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                >
                  <option value="">Şehir seç</option>
                  {CITY_OPTIONS.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">
                  İlçeler (birden fazla seçebilirsin)
                </label>
                {city ? (
                  <div className="flex flex-wrap gap-2">
                    {(
                      CITY_OPTIONS.find((c) => c.name === city)?.districts ||
                      []
                    ).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => toggleDistrict(d)}
                        className={`rounded-full border px-3 py-1 text-[0.7rem] ${
                          selectedDistricts.includes(d)
                            ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                            : "border-slate-600 text-slate-200 hover:border-emerald-400"
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                    {selectedDistricts.length === 0 && (
                      <p className="text-[0.65rem] text-slate-500">
                        İlçe seçmezsen şehirdeki tüm oteller talebini
                        görebilir.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-[0.65rem] text-slate-500">
                    Önce şehir seç, sonra ilçeleri seçebilirsin.
                  </p>
                )}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3 mt-4">
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">
                  Giriş tarihi
                </label>
                <input
                  type="date"
                  value={checkIn}
                  min={todayISO()}
                  onChange={(e) => {
                    const val = e.target.value;
                    setCheckIn(val);
                    if (checkOut <= val) {
                      setCheckOut(addDaysISO(val, 1));
                    }
                  }}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">
                  Çıkış tarihi
                </label>
                <input
                  type="date"
                  value={checkOut}
                  min={addDaysISO(checkIn, 1)}
                  onChange={(e) => setCheckOut(e.target.value)}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">
                  Gece sayısı
                </label>
                <input
                  value={nights}
                  readOnly
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs opacity-70 cursor-default"
                />
              </div>
            </div>
          </section>

          {/* Kişi, oda ve tesis tipi */}
          <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 space-y-3">
            <h2 className="text-sm font-semibold text-slate-100">
              Kişi, oda ve tesis tipi
            </h2>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">
                  Toplam oda sayısı (en az 5) *
                </label>
                <input
                  type="number"
                  min={5}
                  value={roomsCount}
                  onChange={(e) => setRoomsCount(e.target.value)}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">
                  Yetişkin sayısı
                </label>
                <input
                  type="number"
                  min={1}
                  value={adults}
                  onChange={(e) => setAdults(e.target.value)}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">
                  Çocuk sayısı
                </label>
                <input
                  type="number"
                  min={0}
                  value={children}
                  onChange={(e) => setChildren(e.target.value)}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                />
              </div>
            </div>

            {/* oda satırları */}
            <div className="mt-3 space-y-2">
              <p className="text-[0.75rem] text-slate-200">
                Hangi oda tipinden kaç adet istiyorsun?
              </p>
              <div className="space-y-2">
                {roomRows.map((row) => (
                  <div
                    key={row.id}
                    className="grid md:grid-cols-[2fr_1fr_auto] gap-2 items-center"
                  >
                    <select
                      value={row.typeKey}
                      onChange={(e) =>
                        updateRoomRow(row.id, {
                          typeKey: e.target.value as RoomTypeKey
                        })
                      }
                      className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                    >
                      {ROOM_TYPE_OPTIONS.map((rt) => (
                        <option key={rt.key} value={rt.key}>
                          {rt.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={0}
                      value={row.count}
                      onChange={(e) =>
                        updateRoomRow(row.id, {
                          count: e.target.value
                        })
                      }
                      className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                      placeholder="Oda sayısı"
                    />
                    <div className="flex justify-end">
                      {roomRows.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeRoomRow(row.id)}
                          className="rounded-md border border-red-500/70 px-2 py-1 text-[0.7rem] text-red-300 hover:bg-red-500/10"
                        >
                          Sil
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between items-center">
                <p className="text-[0.65rem] text-slate-500">
                  Oda satırlarındaki toplam, üstteki toplam oda sayısına eşit
                  olmalıdır. Örn: 5 standart + 5 aile = 10 oda.
                </p>
                <button
                  type="button"
                  onClick={addRoomRow}
                  className="rounded-md border border-emerald-500/70 px-3 py-1 text-[0.7rem] text-emerald-300 hover:bg-emerald-500/10"
                >
                  + Oda satırı ekle
                </button>
              </div>
            </div>

            {/* tesis tipi */}
            <div className="space-y-1 mt-3">
              <label className="text-[0.75rem] text-slate-200">
                Tesis tipi tercihin
              </label>
              <div className="grid md:grid-cols-3 gap-2">
                {PROPERTY_TYPE_OPTIONS.map((p) => (
                  <label
                    key={p.key}
                    className="flex items-center gap-2 text-[0.75rem] text-slate-200"
                  >
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
              <p className="text-[0.65rem] text-slate-500">
                Seçim yapmazsan şehirdeki tüm tesisler (otel, apart vb.)
                teklif verebilir.
              </p>
            </div>

            {/* konaklama tipi */}
            <div className="space-y-1 mt-3">
              <label className="text-[0.75rem] text-slate-200">
                Konaklama tipi tercihin (isteğe bağlı)
              </label>
              <div className="grid md:grid-cols-3 gap-2">
                {BOARD_OPTIONS.map((b) => (
                  <label
                    key={b.key}
                    className="flex items-center gap-2 text-[0.75rem] text-slate-200"
                  >
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
                placeholder="Konaklama tipiyle ilgili özel isteğin varsa yaz. Örn: Sadece kahvaltı, akşam yemeği zorunlu değil vb."
                className="mt-2 w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs resize-none"
              />
            </div>

            {/* yıldız tipi */}
            <div className="space-y-1 mt-3">
              <label className="text-[0.75rem] text-slate-200">
                Tercih ettiğin otel yıldız tipi (isteğe bağlı)
              </label>
              <div className="flex flex-wrap gap-2">
                {[3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => toggleStarRating(star)}
                    className={`rounded-full border px-3 py-1 text-[0.7rem] ${
                      desiredStarRatings.includes(star)
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                        : "border-slate-600 text-slate-200 hover:border-emerald-400"
                    }`}
                  >
                    {star}★
                  </button>
                ))}
              </div>
              <p className="text-[0.65rem] text-slate-500">
                Seçim yapmazsan tüm yıldız tipleri teklif verebilir.
              </p>
            </div>
          </section>

          {/* Otel özellikleri */}
          <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 space-y-3">
            <h2 className="text-sm font-semibold text-slate-100">
              Otel özellikleri (tercihi)
            </h2>
            <p className="text-[0.7rem] text-slate-400">
              Otelde olmasını istediğin özellikleri seçebilirsin. Özellikle
              kafile / takım / şirket grupları için önemli gördüğün detayları
              aşağıya da yazabilirsin.
            </p>
            <div className="grid md:grid-cols-3 gap-2">
              {FEATURE_OPTIONS.map((f) => (
                <label
                  key={f.key}
                  className="flex items-center gap-2 text-[0.75rem] text-slate-200"
                >
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
            <div className="space-y-1 mt-2">
              <label className="text-[0.75rem] text-slate-200">
                Diğer özellikler / özel istekler
              </label>
              <textarea
                rows={3}
                value={featureNote}
                onChange={(e) => setFeatureNote(e.target.value)}
                placeholder="Örn: Büyük otobüs parkı, toplantı salonu, sahile yürüme mesafesi, takım kafilesi, çocuklar için oyun alanı vb."
                className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs resize-none"
              />
            </div>
          </section>

          {/* İletişim bilgileri */}
          <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 space-y-3">
            <h2 className="text-sm font-semibold text-slate-100">
              İletişim bilgilerin
            </h2>
            <p className="text-[0.7rem] text-slate-400">
              Bu bilgiler sadece teklif veren oteller tarafından görülür.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">
                  Ad soyad *
                </label>
                <input
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">
                  E-posta *
                </label>
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-[0.9fr_2fr_1.3fr] mt-2">
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">
                  Ülke kodu
                </label>
                <select
                  value={phoneCountryCode}
                  onChange={(e) => setPhoneCountryCode(e.target.value)}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                >
                  {PHONE_CODES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label} ({c.code})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">
                  Telefon (opsiyonel)
                </label>
                <input
                  value={phoneLocal}
                  onChange={(e) => setPhoneLocal(e.target.value)}
                  placeholder="5XXXXXXXXX veya sabit hat"
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">
                  Firma / kurum / takım *
                </label>
                <input
                  value={contactCompany}
                  onChange={(e) => setContactCompany(e.target.value)}
                  placeholder="Örn: ABC Turizm / Kulüp / Şirket"
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-200">
                Ek notlar / açıklama
              </label>
              <textarea
                rows={3}
                value={contactNote}
                onChange={(e) => setContactNote(e.target.value)}
                placeholder="Örn: Turnuva için geliyoruz, giriş saati, özel istekler vb."
                className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
              />
            </div>
          </section>

          {/* Otellerin cevap süresi */}
          <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 space-y-3">
            <h2 className="text-sm font-semibold text-slate-100">
              Otellerin cevap süresi
            </h2>
            <p className="text-[0.7rem] text-slate-400">
              Bu süre içinde oteller tekliflerini gönderecek. Süre dolduğunda
              talebin otomatik kapanır ve yeni teklif gelmez.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="number"
                min={1}
                value={responseAmount}
                onChange={(e) => setResponseAmount(e.target.value)}
                className="w-24 rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
              />
              <select
                value={responseUnit}
                onChange={(e) =>
                  setResponseUnit(e.target.value as ResponseUnit)
                }
                className="w-28 rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
              >
                <option value="minutes">dakika</option>
                <option value="hours">saat</option>
                <option value="days">gün</option>
              </select>
              <span className="text-[0.7rem] text-slate-400">
                Örn: 3 saat, 6 saat, 1 gün vb.
              </span>
            </div>
          </section>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-emerald-500 text-slate-950 px-5 py-2 text-sm font-semibold hover:bg-emerald-400 disabled:opacity-60"
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
                <h2 className="text-sm font-semibold text-slate-100">
                  Grup talebin oluşturuldu
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmOpen(false);
                    router.push("/guest/offers");
                  }}
                  className="text-[0.75rem] text-slate-400 hover:text-slate-200"
                >
                  ✕
                </button>
              </div>
              <p className="text-[0.75rem] text-slate-300">
                {confirmText}
              </p>
              <p className="text-[0.7rem] text-slate-400">
                Uygun oteller tekliflerini gönderdikçe,{" "}
                <span className="font-semibold">Gelen teklifler</span>{" "}
                sayfasında bu grup talebini ve otellerden gelen grup
                fiyatlarını görebilirsin. Teklif kabul ettiğinde sistem
                seni grup rezervasyonuna yönlendirecek.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmOpen(false)}
                  className="rounded-md border border-slate-700 px-3 py-1 text-[0.7rem] text-slate-200 hover:border-slate-500"
                >
                  Talebi görmeye devam et
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmOpen(false);
                    router.push("/guest/offers");
                  }}
                  className="rounded-md bg-emerald-500 text-slate-950 px-3 py-1 text-[0.7rem] font-semibold hover:bg-emerald-400"
                >
                  Gelen teklifleri gör
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Protected>
  );
}
