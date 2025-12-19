// app/hotel/profile/page.tsx
"use client";
/* eslint-disable react/no-unescaped-entities */
import {
  useEffect,
  useState,
  useRef,
  FormEvent
} from "react";
import { Protected } from "@/components/Protected";

import { useAuth } from "@/context/AuthContext";
import { getFirestoreDb } from "@/lib/firebase/client";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";

async function uploadImageToStorage(
  path: string,
  file: File
): Promise<string> {
  const storage = getStorage();
  const fileRef = ref(
    storage,
    `${path}/${Date.now()}_${file.name.replace(/\s+/g, "_")}`
  );
  await uploadBytes(fileRef, file);
  const url = await getDownloadURL(fileRef);
  return url;
}



type BoardType = "RO" | "BB" | "HB" | "FB" | "AI" | "UAI";
type CancellationPolicyType =
  | "non_refundable"
  | "flexible"
  | "until_days_before";

interface PaymentOptionsForm {
  card3d: boolean;
  payAtHotel: boolean;
  iban: string;
  bankName: string;
  accountName: string;
}

interface RoomTypeForm {
  id: string;
  name: string;
  shortDescription: string;
  description: string;
  maxAdults: number | null;
  maxChildren: number | null;
  imageUrls: string[];
}

interface ExtraHotelForm {
  id: string;
  name: string;
  address: string;
}

interface HotelProfileFormValues {
  // adres & temel bilgiler
  city: string;
  district: string;
  addressLine: string;
  phone: string;
  email: string;
  starRating: number | null;
  description: string; // min 50, max 1000
  website: string;

  boardTypes: BoardType[];
  features: string[];
  featureInput: string;

  // tesis görselleri
  imageUrls: string[];
  youtubeUrl: string;

  paymentOptions: PaymentOptionsForm;
  roomTypes: RoomTypeForm[];

  // iptal politikası
  cancellationPolicyType: CancellationPolicyType;
  cancellationPolicyDays: number | null;
  cancellationPolicyLabel: string;

  // harita konumu
  locationLat: string;
  locationLng: string;
  locationAddress: string;
  locationUrl: string;

  // yetkili kişi
  contactPersonName: string;
  contactPersonEmail: string;
  contactPersonPhone: string;

  // ekstra tesisler
  extraHotels: ExtraHotelForm[];
}

const BOARD_LABELS: { key: BoardType; label: string }[] = [
  { key: "RO", label: "Sadece oda (RO)" },
  { key: "BB", label: "Oda + Kahvaltı (BB)" },
  { key: "HB", label: "Yarım pansiyon (HB)" },
  { key: "FB", label: "Tam pansiyon (FB)" },
  { key: "AI", label: "Her şey dahil (AI)" },
  { key: "UAI", label: "Ultra her şey dahil (UAI)" }
];

const PREDEFINED_FEATURES: string[] = [
  "Havuz",
  "Spa / Wellness",
  "Otopark",
  "Ücretsiz Wi-Fi",
  "Deniz manzarası",
  "Balkon",
  "Aile odaları",
  "Evcil hayvan kabul edilir"
];

// Örnek şehir / ilçe listesi (istediğin kadar genişletebilirsin)
const CITY_DISTRICTS: Record<string, string[]> = {
  Trabzon: ["Ortahisar", "Akçaabat", "Yomra", "Arsin", "Vakfıkebir", "Of"],
  İstanbul: ["Beşiktaş", "Şişli", "Kadıköy", "Üsküdar", "Fatih"],
  Ankara: ["Çankaya", "Yenimahalle", "Keçiören"]
};

function emptyForm(): HotelProfileFormValues {
  return {
    city: "",
    district: "",
    addressLine: "",
    phone: "",
    email: "",
    starRating: null,
    description: "",
    website: "",
    boardTypes: [],
    features: [],
    featureInput: "",
    imageUrls: [],
    youtubeUrl: "",
    paymentOptions: {
      card3d: true,
      payAtHotel: true,
      iban: "",
      bankName: "",
      accountName: ""
    },
    roomTypes: [],
    cancellationPolicyType: "non_refundable",
    cancellationPolicyDays: 3,
    cancellationPolicyLabel: "",
    locationLat: "",
    locationLng: "",
    locationAddress: "",
    locationUrl: "",
    contactPersonName: "",
    contactPersonEmail: "",
    contactPersonPhone: "",
    extraHotels: []
  };
}

// Storage yardımcı fonksiyonu
async function uploadFileAndGetUrl(
  userId: string,
  file: File,
  folder: string
): Promise<string> {
  const storage = getStorage();
  const safeName = file.name.replace(/\s+/g, "_");
  const fileRef = ref(
    storage,
    `${folder}/${userId}/${Date.now()}_${safeName}`
  );
  await uploadBytes(fileRef, file);
  const url = await getDownloadURL(fileRef);
  return url;
}
export default function HotelProfilePage() {
  const { profile, loading: authLoading } = useAuth();
  const db = getFirestoreDb();

  const [form, setForm] = useState<HotelProfileFormValues>(
    emptyForm()
  );
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // file input referansları (otel görselleri)
  const hotelImagesInputRef = useRef<HTMLInputElement | null>(null);

  // mevcut profil bilgilerini Firestore'dan çek
  useEffect(() => {
    async function loadProfile() {
      if (authLoading) return;
      if (!profile) {
        setLoaded(true);
        return;
      }
      try {
        const ref = doc(db, "users", profile.uid);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          setLoaded(true);
          return;
        }
        const data = snap.data() as any;
        const hp = data.hotelProfile || {};

        const initial: HotelProfileFormValues = {
          city: hp.city ?? "",
          district: hp.district ?? "",
          addressLine: hp.addressLine ?? hp.address ?? "",
          phone: hp.phone ?? data.phone ?? "",
          email: hp.email ?? data.email ?? "",
          starRating: hp.starRating ?? null,
          description: hp.description ?? "",
          website: hp.website ?? data.website ?? "",
          boardTypes: hp.boardTypes ?? [],
          features: hp.features ?? [],
          featureInput: "",
          imageUrls: hp.imageUrls ?? [],
          youtubeUrl: hp.youtubeUrl ?? "",
          paymentOptions: {
            card3d: hp.paymentOptions?.card3d ?? true,
            payAtHotel: hp.paymentOptions?.payAtHotel ?? true,
            iban: hp.paymentOptions?.iban ?? "",
            bankName: hp.paymentOptions?.bankName ?? "",
            accountName: hp.paymentOptions?.accountName ?? ""
          },
          roomTypes: (hp.roomTypes as RoomTypeForm[]) ?? [],
          cancellationPolicyType:
            (hp.cancellationPolicyType as CancellationPolicyType) ??
            "non_refundable",
          cancellationPolicyDays:
            hp.cancellationPolicyDays != null
              ? hp.cancellationPolicyDays
              : 3,
          cancellationPolicyLabel: hp.cancellationPolicyLabel ?? "",
          locationLat: hp.locationLat ?? "",
          locationLng: hp.locationLng ?? "",
          locationAddress: hp.locationAddress ?? "",
          locationUrl: hp.locationUrl ?? "",
          contactPersonName: hp.contactPersonName ?? "",
          contactPersonEmail: hp.contactPersonEmail ?? "",
          contactPersonPhone: hp.contactPersonPhone ?? "",
          extraHotels: hp.extraHotels ?? []
        };

        setForm(initial);
      } catch (err) {
        console.error("Hotel profile load error:", err);
        setError("Profil bilgileri yüklenirken bir hata oluştu.");
      } finally {
        setLoaded(true);
      }
    }

    loadProfile();
  }, [authLoading, profile, db]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (!profile) {
      setError("Oturum bulunamadı. Lütfen yeniden giriş yapın.");
      return;
    }

    const descLen = form.description.trim().length;
    if (descLen > 0 && descLen < 50) {
      setError(
        "Otel hakkında açıklama en az 50 karakter olmalıdır."
      );
      return;
    }
    if (descLen > 1000) {
      setError(
        "Otel hakkında açıklama en fazla 1000 karakter olabilir."
      );
      return;
    }

    try {
      setSaving(true);

      const ref = doc(db, "users", profile.uid);

      const cleanImages = form.imageUrls
        .map((u) => u.trim())
        .filter((u) => u.length > 0);

      const cleanRoomTypes = form.roomTypes.map((rt) => ({
        ...rt,
        imageUrls: rt.imageUrls
          .map((u) => u.trim())
          .filter((u) => u.length > 0)
      }));

      const composedAddress = [
        form.city,
        form.district,
        form.addressLine
      ]
        .filter(Boolean)
        .join(" / ");

      await setDoc(
        ref,
        {
          displayName: profile.displayName,
          email: form.email || profile.email || null,
          hotelProfile: {
            city: form.city || null,
            district: form.district || null,
            address: composedAddress,
            addressLine: form.addressLine || null,
            phone: form.phone || null,
            email: form.email || profile.email || null,
            starRating: form.starRating,
            description: form.description.trim(),
            website: form.website.trim() || null,
            boardTypes: form.boardTypes,
            features: form.features,
            imageUrls: cleanImages,
            youtubeUrl: form.youtubeUrl.trim() || null,
            paymentOptions: {
              card3d: form.paymentOptions.card3d,
              payAtHotel: form.paymentOptions.payAtHotel,
              iban: form.paymentOptions.iban.trim() || null,
              bankName: form.paymentOptions.bankName.trim() || null,
              accountName:
                form.paymentOptions.accountName.trim() || null
            },
            roomTypes: cleanRoomTypes,
            cancellationPolicyType:
              form.cancellationPolicyType || "non_refundable",
            cancellationPolicyDays:
              form.cancellationPolicyType === "until_days_before"
                ? form.cancellationPolicyDays
                : null,
            cancellationPolicyLabel:
              form.cancellationPolicyLabel.trim() || null,
            locationLat: form.locationLat.trim() || null,
            locationLng: form.locationLng.trim() || null,
            locationAddress: form.locationAddress.trim() || null,
            locationUrl: form.locationUrl.trim() || null,
            contactPersonName:
              form.contactPersonName.trim() || null,
            contactPersonEmail:
              form.contactPersonEmail.trim() || null,
            contactPersonPhone:
              form.contactPersonPhone.trim() || null,
            extraHotels: form.extraHotels,
            updatedAt: serverTimestamp()
          }
        },
        { merge: true }
      );

      setMessage("Otel profiliniz başarıyla kaydedildi.");
    } catch (err) {
      console.error("Hotel profile save error:", err);
      setError(
        "Profil kaydedilirken bir hata oluştu. Lütfen tekrar deneyin."
      );
    } finally {
      setSaving(false);
    }
  }

  function toggleBoardType(key: BoardType) {
    setForm((prev) => {
      const exists = prev.boardTypes.includes(key);
      return {
        ...prev,
        boardTypes: exists
          ? prev.boardTypes.filter((k) => k !== key)
          : [...prev.boardTypes, key]
      };
    });
  }

  function toggleFeatureLabel(label: string) {
    setForm((prev) => {
      const exists = prev.features.includes(label);
      return {
        ...prev,
        features: exists
          ? prev.features.filter((f) => f !== label)
          : [...prev.features, label]
      };
    });
  }

  function addCustomFeature() {
    const text = form.featureInput.trim();
    if (!text) return;
    setForm((prev) => ({
      ...prev,
      features: prev.features.includes(text)
        ? prev.features
        : [...prev.features, text],
      featureInput: ""
    }));
  }

  function updateHotelImage(index: number, value: string) {
    setForm((prev) => {
      const arr = [...prev.imageUrls];
      arr[index] = value;
      return { ...prev, imageUrls: arr };
    });
  }

  function removeHotelImage(index: number) {
    setForm((prev) => ({
      ...prev,
      imageUrls: prev.imageUrls.filter((_, i) => i !== index)
    }));
  }

  async function handleHotelImagesFileChange(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    if (!profile) return;
    const files = e.target.files;
    if (!files || files.length === 0) return;

    try {
      const urls: string[] = [];
      for (const file of Array.from(files)) {
        const url = await uploadFileAndGetUrl(
          profile.uid,
          file,
          "hotelImages"
        );
        urls.push(url);
      }
      setForm((prev) => ({
        ...prev,
        imageUrls: [...prev.imageUrls, ...urls]
      }));
    } catch (err) {
      console.error("Hotel image upload error:", err);
      setError(
        "Tesis görselleri yüklenirken bir hata oluştu. Lütfen tekrar dene."
      );
    } finally {
      if (hotelImagesInputRef.current) {
        hotelImagesInputRef.current.value = "";
      }
    }
  }

async function handleRoomImageUpload(
  roomId: string,
  fileList: FileList | null
) {
  if (!fileList || fileList.length === 0) return;
  if (!profile) return;

  try {
    const files = Array.from(fileList);
    const urls: string[] = [];

    for (const file of files) {
      const url = await uploadImageToStorage(
  `hotelRoomImages/${profile.uid}/${roomId}`,
  file
);

      urls.push(url);
    }

    setForm((prev) => ({
      ...prev,
      roomTypes: prev.roomTypes.map((rt) =>
        rt.id === roomId
          ? {
              ...rt,
              imageUrls: [...(rt.imageUrls || []), ...urls]
            }
          : rt
      )
    }));
  } catch (err) {
    console.error("Oda görseli yüklenirken hata:", err);
    // burada istersen kullanıcıya mesaj da verebilirsin
  }
}



  function addRoomType() {
    setForm((prev) => ({
      ...prev,
      roomTypes: [
        ...prev.roomTypes,
        {
          id: `rt_${Date.now()}_${Math.random()
            .toString(36)
            .slice(2, 7)}`,
          name: "",
          shortDescription: "",
          description: "",
          maxAdults: null,
          maxChildren: null,
          imageUrls: []
        }
      ]
    }));
  }

  function removeRoomType(id: string) {
    setForm((prev) => ({
      ...prev,
      roomTypes: prev.roomTypes.filter((rt) => rt.id !== id)
    }));
  }

  function addExtraHotel() {
    setForm((prev) => ({
      ...prev,
      extraHotels: [
        ...prev.extraHotels,
        {
          id: `eh_${Date.now()}_${Math.random()
            .toString(36)
            .slice(2, 6)}`,
          name: "",
          address: ""
        }
      ]
    }));
  }

  function removeExtraHotel(id: string) {
    setForm((prev) => ({
      ...prev,
      extraHotels: prev.extraHotels.filter((e) => e.id !== id)
    }));
  }

  async function handleUseCurrentLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("Tarayıcın konum özelliğini desteklemiyor.");
      return;
    }
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setForm((prev) => ({
          ...prev,
          locationLat: latitude.toString(),
          locationLng: longitude.toString()
        }));
      },
      () => {
        setError(
          "Konum alınırken bir hata oluştu. Lütfen izin verdiğinden emin ol."
        );
      }
    );
  }

  if (!loaded) {
    return (
      <Protected allowedRoles={["hotel"]}>
        <div className="container-page">
          <p className="text-sm text-slate-400">
            Otel profiliniz yükleniyor...
          </p>
        </div>
      </Protected>
    );
  }
  return (
    <Protected allowedRoles={["hotel"]}>
      <div className="container-page max-w-4xl space-y-6">
        {/* Başlık */}
        <section className="space-y-2">
          <h1 className="text-2xl font-semibold">Otel Profilim</h1>
          <p className="text-sm text-slate-300 max-w-3xl">
            Bu ekranda tesisinizin temel bilgilerini, oda tiplerini,
            özelliklerini, ödeme seçeneklerinizi, iptal politikanızı,
            görsellerinizi ve harita konumunuzu tanımlarsınız. Misafirler
            teklif ve rezervasyon detaylarında bu bilgileri görerek seçim
            yapar.
          </p>
        </section>

        {/* Hata / mesaj */}
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
          {/* TEMEL BİLGİLER */}
          <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-100">
                Temel bilgiler
              </h2>
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-emerald-500 text-slate-950 px-3 py-1 text-[0.7rem] font-semibold hover:bg-emerald-400 disabled:opacity-60"
              >
                Kaydet
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">
                  Tesis adı
                </label>
                <input
                  value={profile?.displayName || ""}
                  disabled
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs opacity-70 cursor-not-allowed"
                />
                <p className="text-[0.7rem] text-slate-500">
                  Tesis adını kullanıcı hesabı ayarlarından değiştirebilirsin.
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">
                  Web sitesi (opsiyonel)
                </label>
                <input
                  value={form.website}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      website: e.target.value
                    }))
                  }
                  placeholder="https://..."
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">
                  Şehir
                </label>
                <select
                  value={form.city}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      city: e.target.value,
                      district: ""
                    }))
                  }
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                >
                  <option value="">Seç</option>
                  {Object.keys(CITY_DISTRICTS).map((city) => (
                    <option key={city} value={city}>
                      {city}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">
                  İlçe (isteğe bağlı)
                </label>
                <select
                  value={form.district}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      district: e.target.value
                    }))
                  }
                  disabled={!form.city}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs disabled:opacity-60"
                >
                  <option value="">Seç</option>
                  {form.city &&
                    (CITY_DISTRICTS[form.city] || []).map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                </select>
              </div>

              <div className="space-y-1 md:col-span-2">
                <label className="text-[0.75rem] text-slate-200">
                  Adres satırı
                </label>
                <textarea
                  rows={3}
                  value={form.addressLine}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      addressLine: e.target.value
                    }))
                  }
                  placeholder="Mahalle, cadde, no, kapı vs. (şehir / ilçe yukarıdan seçiliyor)"
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">
                  Telefon
                </label>
                <input
                  value={form.phone}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      phone: e.target.value
                    }))
                  }
                  placeholder="+90 5XX XXX XX XX"
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">
                  E-posta
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      email: e.target.value
                    }))
                  }
                  placeholder="info@otel.com"
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[0.75rem] text-slate-200">
                  Yıldız sayısı
                </label>
                <select
                  value={form.starRating ?? ""}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      starRating: e.target.value
                        ? Number(e.target.value)
                        : null
                    }))
                  }
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                >
                  <option value="">Seç</option>
                  <option value="3">3★</option>
                  <option value="4">4★</option>
                  <option value="5">5★</option>
                </select>
              </div>

              <div className="space-y-1 md:col-span-2">
                <label className="text-[0.75rem] text-slate-200">
                  Otel hakkında kısa açıklama
                </label>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      description: e.target.value
                    }))
                  }
                  placeholder="Örn: Denize 200m, şehir merkezine 5dk, geniş aile odaları, çocuk dostu tesis..."
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                />
                <p className="text-[0.65rem] text-slate-500">
                  En az 50, en fazla 1000 karakter olması önerilir.
                </p>
              </div>
            </div>
          </section>

          {/* ODA TİPLERİ & ÖZELLİKLER */}
          <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-100">
                Oda tipleri ve tesis özellikleri
              </h2>
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-emerald-500 text-slate-950 px-3 py-1 text-[0.7rem] font-semibold hover:bg-emerald-400 disabled:opacity-60"
              >
                Kaydet
              </button>
            </div>

            {/* Konaklama tipleri */}
            <div className="space-y-2">
              <p className="text-[0.75rem] text-slate-200 mb-1">
                Satışa açtığınız konaklama tipleri
              </p>
              <div className="grid md:grid-cols-3 gap-2">
                {BOARD_LABELS.map((b) => (
                  <label
                    key={b.key}
                    className="flex items-center gap-2 text-[0.75rem] text-slate-200"
                  >
                    <input
                      type="checkbox"
                      checked={form.boardTypes.includes(b.key)}
                      onChange={() => toggleBoardType(b.key)}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                    />
                    {b.label}
                  </label>
                ))}
              </div>
            </div>

            {/* Tesis özellikleri */}
            <div className="space-y-2">
              <p className="text-[0.75rem] text-slate-200 mb-1">
                Tesis özellikleri
              </p>
              <div className="grid md:grid-cols-3 gap-2">
                {PREDEFINED_FEATURES.map((label) => (
                  <label
                    key={label}
                    className="flex items-center gap-2 text-[0.75rem] text-slate-200"
                  >
                    <input
                      type="checkbox"
                      checked={form.features.includes(label)}
                      onChange={() => toggleFeatureLabel(label)}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                    />
                    {label}
                  </label>
                ))}
              </div>

              <div className="space-y-1 mt-2">
                <label className="text-[0.75rem] text-slate-200">
                  Diğer özellikler (kendin yaz)
                </label>
                <div className="flex gap-2">
                  <input
                    value={form.featureInput}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        featureInput: e.target.value
                      }))
                    }
                    placeholder="Örn: Çocuk oyun alanı, toplantı salonu..."
                    className="flex-1 rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                  />
                  <button
                    type="button"
                    onClick={addCustomFeature}
                    className="rounded-md border border-emerald-500/70 px-3 py-1 text-[0.7rem] text-emerald-300 hover:bg-emerald-500/10"
                  >
                    Ekle
                  </button>
                </div>
                {form.features.length > 0 && (
                  <p className="text-[0.7rem] text-slate-400">
                    Seçili özellikler:{" "}
                    <span className="text-slate-100">
                      {form.features.join(", ")}
                    </span>
                  </p>
                )}
              </div>
            </div>

            {/* ODA TİPLERİ (DETAYLI) */}
            <div className="space-y-3">
              <h3 className="text-[0.8rem] font-semibold text-slate-100">
                Oda tipleri
              </h3>
              {form.roomTypes.length === 0 && (
                <p className="text-[0.7rem] text-slate-500">
                  Henüz oda tipi eklemediniz. Aşağıdan "Oda tipi ekle"
                  ile başlayabilirsiniz.
                </p>
              )}

              {form.roomTypes.map((rt, index) => (
                <div
                  key={rt.id}
                  className="rounded-xl border border-slate-800 bg-slate-900/70 p-3 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-[0.75rem] font-semibold text-slate-100">
                      Oda tipi #{index + 1}
                    </p>
                    <button
                      type="button"
                      onClick={() => removeRoomType(rt.id)}
                      className="text-[0.7rem] text-red-300 hover:text-red-200"
                    >
                      Odayı sil
                    </button>
                  </div>

                  <div className="grid gap-2 md:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-[0.75rem] text-slate-200">
                        Oda adı
                      </label>
                      <input
                        value={rt.name}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            roomTypes: prev.roomTypes.map((x) =>
                              x.id === rt.id
                                ? { ...x, name: e.target.value }
                                : x
                            )
                          }))
                        }
                        placeholder="Örn: Standart Deniz Manzaralı Oda"
                        className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[0.75rem] text-slate-200">
                        Kısa açıklama (listede)
                      </label>
                      <input
                        value={rt.shortDescription}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            roomTypes: prev.roomTypes.map((x) =>
                              x.id === rt.id
                                ? {
                                    ...x,
                                    shortDescription: e.target.value
                                  }
                                : x
                            )
                          }))
                        }
                        placeholder="Örn: 25m², 2+1 kişilik, deniz manzaralı"
                        className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid gap-2 md:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-[0.75rem] text-slate-200">
                        En fazla yetişkin
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={rt.maxAdults ?? ""}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            roomTypes: prev.roomTypes.map((x) =>
                              x.id === rt.id
                                ? {
                                    ...x,
                                    maxAdults: e.target.value
                                      ? Number(e.target.value)
                                      : null
                                  }
                                : x
                            )
                          }))
                        }
                        className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[0.75rem] text-slate-200">
                        En fazla çocuk
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={rt.maxChildren ?? ""}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            roomTypes: prev.roomTypes.map((x) =>
                              x.id === rt.id
                                ? {
                                    ...x,
                                    maxChildren: e.target.value
                                      ? Number(e.target.value)
                                      : null
                                  }
                                : x
                            )
                          }))
                        }
                        className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[0.75rem] text-slate-200">
                      Detaylı açıklama
                    </label>
                    <textarea
                      rows={3}
                      value={rt.description}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          roomTypes: prev.roomTypes.map((x) =>
                            x.id === rt.id
                              ? { ...x, description: e.target.value }
                              : x
                          )
                        }))
                      }
                      placeholder="Oda özelliklerini, yatak tiplerini, manzarayı vb. detaylandır."
                      className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                    />
                  </div>

          {/* Bu oda tipine özel görseller */}
<div className="space-y-1">
  <label className="text-[0.75rem] text-slate-200">
    Bu oda tipine özel görseller
  </label>

  {/* Mevcut yüklenmiş görsellerin önizlemesi */}
  <div className="flex flex-wrap gap-2 mt-1">
    {rt.imageUrls && rt.imageUrls.length > 0 ? (
      rt.imageUrls.map((url, idx) => (
        <div
          key={idx}
          className="w-20 h-20 rounded-md border border-slate-700 overflow-hidden relative"
        >
          <img
            src={url}
            alt={`${rt.name || "Oda"} görsel ${idx + 1}`}
            className="w-full h-full object-cover"
          />
          <button
            type="button"
            onClick={() =>
              setForm((prev) => ({
                ...prev,
                roomTypes: prev.roomTypes.map((x) =>
                  x.id === rt.id
                    ? {
                        ...x,
                        imageUrls: x.imageUrls.filter((_, i) => i !== idx)
                      }
                    : x
                )
              }))
            }
            className="absolute top-0 right-0 m-1 rounded-full bg-black/60 text-[0.65rem] text-red-300 px-1"
          >
            ✕
          </button>
        </div>
      ))
    ) : (
      <p className="text-[0.7rem] text-slate-500">
        Bu oda için henüz görsel eklenmemiş. Aşağıdan yükleyebilirsin.
      </p>
    )}
  </div>

  {/* Yeni görsel yükleme input'u */}
  <div className="flex flex-wrap items-center gap-2 mt-2">
    <input
      type="file"
      accept="image/*"
      multiple
      onChange={(e) => handleRoomImageUpload(rt.id, e.target.files)}
      className="text-[0.7rem]"
    />
    <span className="text-[0.7rem] text-slate-500">
      Bilgisayar, telefon veya tabletinizden birden fazla görsel
      seçebilirsiniz.
    </span>
  </div>

  <p className="text-[0.65rem] text-slate-500">
    Buradan görsel seçtiğinizde Firebase Storage&apos;a yüklenecek ve
    linkleri bu oda tipi için otomatik kaydedilecektir. Değişikliklerin
    kalıcı olması için sayfanın altındaki &quot;Profili kaydet&quot;
    butonuna basmayı unutmayın.
  </p>
</div>



                </div>
              ))}

              <button
                type="button"
                onClick={addRoomType}
                className="rounded-md border border-emerald-500/70 px-3 py-1 text-[0.7rem] text-emerald-300 hover:bg-emerald-500/10"
              >
                + Oda tipi ekle
              </button>
            </div>
          </section>

          {/* TESİS GÖRSELLERİ & VİDEO */}
          <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-100">
                Tesis görselleri ve tanıtım videosu
              </h2>
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-emerald-500 text-slate-950 px-3 py-1 text-[0.7rem] font-semibold hover:bg-emerald-400 disabled:opacity-60"
              >
                Kaydet
              </button>
            </div>

            <div className="space-y-2">
  <p className="text-[0.75rem] text-slate-200">
    Tesis görselleri
  </p>

  {/* Mevcut görsellerin thumbnail’leri */}
  <div className="flex flex-wrap gap-2">
    {form.imageUrls.map((url, idx) => (
      <div
        key={idx}
        className="w-20 h-20 rounded-md border border-slate-700 overflow-hidden relative"
      >
        <img
          src={url}
          alt={`Tesis görsel ${idx + 1}`}
          className="w-full h-full object-cover"
        />
        <button
          type="button"
          onClick={() => removeHotelImage(idx)}
          className="absolute top-0 right-0 m-1 rounded-full bg-black/60 text-[0.65rem] text-red-300 px-1"
        >
          ✕
        </button>
      </div>
    ))}
  </div>

  {/* Yeni görseller yükle */}
  <div className="flex flex-col gap-2 mt-2">
    <div className="flex gap-2 items-center">
      <button
        type="button"
        onClick={() => hotelImagesInputRef.current?.click()}
        className="rounded-md border border-slate-700 px-3 py-1 text-[0.7rem] text-slate-200 hover:border-emerald-500"
      >
        Görsel yükle
      </button>
      <span className="text-[0.7rem] text-slate-500">
        Bilgisayar, telefon veya tabletinizden birden fazla görsel seçebilirsiniz.
      </span>
    </div>
    <input
      ref={hotelImagesInputRef}
      type="file"
      multiple
      accept="image/*"
      onChange={handleHotelImagesFileChange}
      className="hidden"
    />
  </div>
</div>


            <div className="space-y-2">
              <label className="text-[0.75rem] text-slate-200">
                YouTube tanıtım videosu (opsiyonel)
              </label>
              <input
                value={form.youtubeUrl}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    youtubeUrl: e.target.value
                  }))
                }
                placeholder="https://www.youtube.com/watch?v=..."
                className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
              />
              {form.youtubeUrl && (
                <div className="mt-2 aspect-video rounded-xl overflow-hidden border border-slate-800">
                  <iframe
                    className="w-full h-full"
                    src={form.youtubeUrl.replace(
                      "watch?v=",
                      "embed/"
                    )}
                    title="Otel tanıtım videosu"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              )}
            </div>
          </section>

          {/* ÖDEME & İPTAL POLİTİKALARI */}
          <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 space-y-4">
            <h2 className="text-sm font-semibold text-slate-100">
              Ödeme ve iptal politikası
            </h2>

            {/* Ödeme seçenekleri */}
            <div className="space-y-3">
              <p className="text-[0.75rem] text-slate-200">
                Ödeme seçenekleri
              </p>
              <p className="text-[0.7rem] text-slate-400">
                Misafir tarafında bu otel için sadece seçili ödeme
                yöntemleri gösterilecektir.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex items-center gap-2 text-[0.75rem] text-slate-200">
                  <input
                    type="checkbox"
                    checked={form.paymentOptions.card3d}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        paymentOptions: {
                          ...prev.paymentOptions,
                          card3d: e.target.checked
                        }
                      }))
                    }
                    className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                  />
                  3D Secure kart ödemesi
                </label>

                <label className="flex items-center gap-2 text-[0.75rem] text-slate-200">
                  <input
                    type="checkbox"
                    checked={form.paymentOptions.payAtHotel}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        paymentOptions: {
                          ...prev.paymentOptions,
                          payAtHotel: e.target.checked
                        }
                      }))
                    }
                    className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                  />
                  Otelde ödeme (check-in&apos;de)
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <label className="text-[0.75rem] text-slate-200">
                    Banka adı (opsiyonel)
                  </label>
                  <input
                    value={form.paymentOptions.bankName}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        paymentOptions: {
                          ...prev.paymentOptions,
                          bankName: e.target.value
                        }
                      }))
                    }
                    className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[0.75rem] text-slate-200">
                    Hesap adı (opsiyonel)
                  </label>
                  <input
                    value={form.paymentOptions.accountName}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        paymentOptions: {
                          ...prev.paymentOptions,
                          accountName: e.target.value
                        }
                      }))
                    }
                    className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[0.75rem] text-slate-200">
                    IBAN (opsiyonel)
                  </label>
                  <input
                    value={form.paymentOptions.iban}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        paymentOptions: {
                          ...prev.paymentOptions,
                          iban: e.target.value
                        }
                      }))
                    }
                    placeholder="TR00 0000 0000 0000..."
                    className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                  />
                </div>
              </div>
            </div>

            {/* İptal politikası */}
            <div className="space-y-3">
              <p className="text-[0.75rem] text-slate-200">
                İptal politikası
              </p>
              <p className="text-[0.7rem] text-slate-400 max-w-2xl">
                Misafir rezervasyon iptal koşulları bu politikaya göre
                belirlenir. Her teklif oluştururken bu profil
                varsayılanı üzerinden teklif bazlı iptal politikası da
                seçebilirsin.
              </p>

              <div className="space-y-2 text-xs">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="cancellationPolicyType"
                    value="non_refundable"
                    checked={
                      form.cancellationPolicyType ===
                      "non_refundable"
                    }
                    onChange={() =>
                      setForm((prev) => ({
                        ...prev,
                        cancellationPolicyType:
                          "non_refundable",
                        cancellationPolicyDays: null
                      }))
                    }
                  />
                  <span className="text-slate-100">
                    İptal edilemez – misafir rezervasyonu iptal
                    edemez, iade yapılmaz.
                  </span>
                </label>

                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="cancellationPolicyType"
                    value="flexible"
                    checked={
                      form.cancellationPolicyType === "flexible"
                    }
                    onChange={() =>
                      setForm((prev) => ({
                        ...prev,
                        cancellationPolicyType: "flexible",
                        cancellationPolicyDays: null
                      }))
                    }
                  />
                  <span className="text-slate-100">
                    Her zaman ücretsiz iptal – check-in tarihine kadar
                    iptal edilebilir.
                  </span>
                </label>

                <div className="flex items-start gap-2">
                  <label className="flex items-center gap-2 mt-1">
                    <input
                      type="radio"
                      name="cancellationPolicyType"
                      value="until_days_before"
                      checked={
                        form.cancellationPolicyType ===
                        "until_days_before"
                      }
                      onChange={() =>
                        setForm((prev) => ({
                          ...prev,
                          cancellationPolicyType:
                            "until_days_before",
                          cancellationPolicyDays:
                            prev.cancellationPolicyDays ?? 3
                        }))
                      }
                    />
                    <span className="text-slate-100">
                      Giriş tarihinden{" "}
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={form.cancellationPolicyDays ?? 3}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            cancellationPolicyType:
                              "until_days_before",
                            cancellationPolicyDays:
                              Number(e.target.value) || 1
                          }))
                        }
                        className="w-14 rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-[0.7rem]"
                      />{" "}
                      gün öncesine kadar ücretsiz iptal.
                    </span>
                  </label>
                </div>

                <div className="space-y-1 mt-2">
                  <label className="text-[0.75rem] text-slate-200">
                    Misafire gösterilecek açıklama (opsiyonel)
                  </label>
                  <textarea
                    rows={2}
                    value={form.cancellationPolicyLabel}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        cancellationPolicyLabel: e.target.value
                      }))
                    }
                    placeholder="Örn: Giriş tarihinden 3 gün öncesine kadar ücretsiz iptal, sonrasında ilk gece ücreti tahsil edilir."
                    className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-[0.75rem] resize-none"
                  />
                  <p className="text-[0.65rem] text-slate-500">
                    Boş bırakırsan sistem otomatik metin kullanır.
                    Doldurursan misafir tarafında bu metin görünecek.
                  </p>
                </div>
              </div>
            </div>

            {/* KONUM */}
            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 space-y-3 mt-4">
              <h2 className="text-sm font-semibold text-slate-100">
                Konum (harita için)
              </h2>
              <p className="text-[0.7rem] text-slate-400">
                Bu konum misafir detay ekranında &quot;haritada konumu
                gör&quot; linki için kullanılacaktır. Enlem / boylamı
                manuel girebilir veya &quot;kendi konumumu kullan&quot;
                butonuyla doldurabilirsin.
              </p>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <label className="text-[0.75rem] text-slate-200">
                    Enlem (lat)
                  </label>
                  <input
                    value={form.locationLat}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        locationLat: e.target.value
                      }))
                    }
                    placeholder="41.00..."
                    className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[0.75rem] text-slate-200">
                    Boylam (lng)
                  </label>
                  <input
                    value={form.locationLng}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        locationLng: e.target.value
                      }))
                    }
                    placeholder="39.72..."
                    className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[0.75rem] text-slate-200">
                    Konum linki (opsiyonel)
                  </label>
                  <input
                    value={form.locationUrl}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        locationUrl: e.target.value
                      }))
                    }
                    placeholder="https://maps.google.com/..."
                    className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 mt-2">
                <button
                  type="button"
                  onClick={handleUseCurrentLocation}
                  className="rounded-md border border-emerald-500/70 px-3 py-1 text-[0.7rem] text-emerald-300 hover:bg-emerald-500/10"
                >
                  Kendi konumumu kullan
                </button>
                {(form.locationLat || form.locationLng) && (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                      `${form.locationLat},${form.locationLng}`
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[0.7rem] text-sky-300 hover:underline"
                  >
                    Haritada kontrol et
                  </a>
                )}
              </div>

              <div className="space-y-1 mt-2">
                <label className="text-[0.75rem] text-slate-200">
                  Konum açıklaması (misafire gösterilmeyecek)
                </label>
                <textarea
                  rows={2}
                  value={form.locationAddress}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      locationAddress: e.target.value
                    }))
                  }
                  placeholder="Örn: Otelimiz sahil yolunun hemen üzerinde, XYZ kavşağının yanında..."
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                />
              </div>
            </div>

            {/* Yetkili kişi */}
            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 space-y-3 mt-4">
              <h2 className="text-sm font-semibold text-slate-100">
                Yetkili kişi bilgileri
              </h2>
              <p className="text-[0.7rem] text-slate-400">
                Bu bilgiler misafire gösterilmez, sadece Biddakika yönetimi
                için kayıt altına alınır.
              </p>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <label className="text-[0.75rem] text-slate-200">
                    Ad soyad
                  </label>
                  <input
                    value={form.contactPersonName}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        contactPersonName: e.target.value
                      }))
                    }
                    className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[0.75rem] text-slate-200">
                    E-posta
                  </label>
                  <input
                    type="email"
                    value={form.contactPersonEmail}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        contactPersonEmail: e.target.value
                      }))
                    }
                    className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[0.75rem] text-slate-200">
                    Telefon
                  </label>
                  <input
                    value={form.contactPersonPhone}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        contactPersonPhone: e.target.value
                      }))
                    }
                    className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Ek tesisler */}
            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 space-y-3 mt-4">
              <h2 className="text-sm font-semibold text-slate-100">
                Diğer tesisler / şubeler (opsiyonel)
              </h2>
              <p className="text-[0.7rem] text-slate-400">
                Aynı kullanıcı hesabıyla yönettiğiniz farklı tesis veya
                şubeler varsa buraya kaydedebilirsiniz.
              </p>

              {form.extraHotels.length === 0 && (
                <p className="text-[0.7rem] text-slate-500">
                  Henüz ek tesis eklemediniz.
                </p>
              )}

              <div className="space-y-2">
                {form.extraHotels.map((eh) => (
                  <div
                    key={eh.id}
                    className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <input
                        value={eh.name}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            extraHotels: prev.extraHotels.map((x) =>
                              x.id === eh.id
                                ? { ...x, name: e.target.value }
                                : x
                            )
                          }))
                        }
                        placeholder="Tesis adı"
                        className="flex-1 rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => removeExtraHotel(eh.id)}
                        className="text-[0.7rem] text-red-300 hover:text-red-200"
                      >
                        Sil
                      </button>
                    </div>
                    <textarea
                      rows={2}
                      value={eh.address}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          extraHotels: prev.extraHotels.map((x) =>
                            x.id === eh.id
                              ? { ...x, address: e.target.value }
                              : x
                          )
                        }))
                      }
                      placeholder="Adres"
                      className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs mt-1"
                    />
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={addExtraHotel}
                className="rounded-md border border-emerald-500/70 px-3 py-1 text-[0.7rem] text-emerald-300 hover:bg-emerald-500/10"
              >
                + Yeni tesis / şube ekle
              </button>
            </div>

            <div className="flex justify-end mt-4">
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-emerald-500 text-slate-950 px-5 py-2 text-sm font-semibold hover:bg-emerald-400 disabled:opacity-60"
              >
                {saving ? "Kaydediliyor..." : "Profili kaydet"}
              </button>
            </div>
          </section>
        </form>
      </div>
    </Protected>
  );
}
