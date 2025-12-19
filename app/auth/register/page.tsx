"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { UserRole, HotelProfile, AgencyProfile, GuestProfile } from "@/types/biddakika";

import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { getFirestoreDb } from "@/lib/firebase/client";

const ROLE_OPTIONS: { key: UserRole; label: string; desc: string; emoji: string }[] = [
  { key: "guest", label: "Misafir", desc: "Kendin veya ailen için konaklama ara.", emoji: "🎒" },
  { key: "hotel", label: "Otel", desc: "Taleplere direkt teklif ver.", emoji: "🏨" },
  { key: "agency", label: "Acenta", desc: "Müşterilerin için çoklu otel yönet.", emoji: "🧳" }
];

const HOTEL_FEATURES = [
  { key: "pool", label: "Havuz" },
  { key: "spa", label: "Spa / Wellness" },
  { key: "parking", label: "Otopark" },
  { key: "wifi", label: "Ücretsiz Wi-Fi" },
  { key: "seaView", label: "Deniz manzarası" },
  { key: "cityCenter", label: "Şehir merkezine yakın" },
  { key: "family", label: "Aile odaları" },
  { key: "petFriendly", label: "Evcil hayvan kabul edilir" },
  { key: "meeting", label: "Toplantı salonu" },
  { key: "beach", label: "Plaj erişimi" }
];

const BOARD_TYPES = [
  { key: "RO", label: "Sadece oda (RO)" },
  { key: "BB", label: "Oda + Kahvaltı (BB)" },
  { key: "HB", label: "Yarım pansiyon (HB)" },
  { key: "FB", label: "Tam pansiyon (FB)" },
  { key: "AI", label: "Her şey dahil (AI)" },
  { key: "UAI", label: "Ultra her şey dahil (UAI)" }
];

function cleanStr(v: any) {
  const s = String(v || "").trim();
  return s.length ? s : "";
}

export default function RegisterPage() {
  const router = useRouter();

  const [role, setRole] = useState<UserRole>("guest");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = e.currentTarget;
    const formData = new FormData(form);

    const displayName = cleanStr(formData.get("name"));
    const email = cleanStr(formData.get("email")).toLowerCase();
    const password = String(formData.get("password") || "");

    if (!displayName) return setError("Ad Soyad zorunlu.");
    if (!email) return setError("E-posta zorunlu.");
    if (!password || password.length < 6) return setError("Şifre en az 6 karakter olmalı.");

    // rol bazlı profil datası
    let guestProfile: GuestProfile | undefined;
    let hotelProfile: HotelProfile | undefined;
    let agencyProfile: AgencyProfile | undefined;

    if (role === "guest") {
      const phone = cleanStr(formData.get("guestPhone"));
      const country = cleanStr(formData.get("guestCountry"));
      guestProfile = {
        phone: phone || undefined,
        country: country || undefined
      };
    }

    if (role === "hotel") {
      const boardTypes = formData.getAll("hotelBoardTypes").map(String);
      const features = formData.getAll("hotelFeatures").map(String);
      const starRatingStr = cleanStr(formData.get("hotelStar"));

      const hotelName = cleanStr(formData.get("hotelName"));
      const address = cleanStr(formData.get("hotelAddress"));
      const phone = cleanStr(formData.get("hotelPhone"));

      if (!hotelName) return setError("Tesis adı zorunlu.");
      if (!address) return setError("Adres zorunlu.");
      if (!phone) return setError("Telefon zorunlu.");

      hotelProfile = {
        hotelName,
        address,
        phone,
        website: cleanStr(formData.get("hotelWebsite")) || undefined,
        starRating: starRatingStr ? Number(starRatingStr) : undefined,
        propertyType: cleanStr(formData.get("hotelPropertyType") || "hotel") as HotelProfile["propertyType"],
        boardTypes,
        features
      };
    }

    if (role === "agency") {
      const agencyName = cleanStr(formData.get("agencyName"));
      const address = cleanStr(formData.get("agencyAddress"));
      const phone = cleanStr(formData.get("agencyPhone"));

      if (!agencyName) return setError("Acenta adı zorunlu.");
      if (!address) return setError("Adres zorunlu.");
      if (!phone) return setError("Telefon zorunlu.");

      agencyProfile = {
        agencyName,
        address,
        phone,
        website: cleanStr(formData.get("agencyWebsite")) || undefined,
        description: cleanStr(formData.get("agencyDescription")) || undefined
      };
    }

    try {
      setLoading(true);

      const auth = getAuth();
      const db = getFirestoreDb();

      // 1) Önce normal create dene
      try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);

        await setDoc(
          doc(db, "users", cred.user.uid),
          {
            role,
            displayName,
            email,
            createdAt: serverTimestamp(),

            ...(role === "guest" ? { guestProfile: guestProfile || {} } : {}),
            ...(role === "hotel" ? { hotelProfile: hotelProfile || {} } : {}),
            ...(role === "agency" ? { agencyProfile: agencyProfile || {} } : {})
          },
          { merge: true }
        );
      } catch (err2: any) {
        // 2) Email zaten varsa => create YAPMA, giriş yap + rol yükselt + merge
        if (err2?.code === "auth/email-already-in-use") {
          const cred2 = await signInWithEmailAndPassword(auth, email, password);

          await setDoc(
            doc(db, "users", cred2.user.uid),
            {
              // aynı hesap içinde rol yükseltme
              role,
              displayName,
              email,
              updatedAt: serverTimestamp(),

              ...(role === "guest" ? { guestProfile: guestProfile || {} } : {}),
              ...(role === "hotel" ? { hotelProfile: hotelProfile || {} } : {}),
              ...(role === "agency" ? { agencyProfile: agencyProfile || {} } : {})
            },
            { merge: true }
          );
        } else {
          throw err2;
        }
      }

      // yönlendirme (senin route yapına göre)
      if (role === "guest") router.push("/dashboard/guest");
      else if (role === "hotel") router.push("/hotel/dashboard");
      else if (role === "agency") router.push("/dashboard/agency");
      else router.push("/");

    } catch (err: any) {
      console.error(err);

      const code = err?.code || "";
      if (code === "auth/wrong-password") {
        setError("Bu e-posta zaten kayıtlı. Otel/Acenta olmak için aynı e-posta ile doğru şifreyi girmelisin.");
      } else if (code === "auth/invalid-credential") {
        setError("E-posta/şifre hatalı. Bu e-posta zaten kayıtlı olabilir, doğru şifre ile deneyin.");
      } else if (code === "auth/weak-password") {
        setError("Şifre çok zayıf. En az 6 karakter kullan.");
      } else if (code === "auth/invalid-email") {
        setError("Geçersiz e-posta formatı.");
      } else {
        setError(err?.message || "Kayıt sırasında bir hata oluştu.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container-page flex min-h-[calc(100vh-80px)] items-center justify-center">
      <div className="w-full max-w-4xl rounded-2xl border border-slate-800 bg-slate-950/80 p-6 md:p-8 shadow-xl shadow-slate-950/60">
        <div className="mb-6 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
              Biddakika&apos;ya Kayıt Ol
            </h1>
            <p className="text-xs md:text-sm text-slate-300 mt-1 max-w-md">
              Rolünü seç, temel bilgilerini ve işletme detaylarını gir; birkaç dakika içinde
              taleplerini, tekliflerini veya paketlerini yönetmeye başla.
            </p>
          </div>
          <p className="text-[0.7rem] md:text-xs text-slate-400">
            Zaten hesabın var mı?{" "}
            <a href="/auth/login" className="text-emerald-400 hover:text-emerald-300">
              Giriş yap
            </a>
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-[1.1fr_minmax(0,1.3fr)]">
          {/* Rol kartları */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-slate-200">Rolünü seç:</p>
            <div className="grid gap-3">
              {ROLE_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setRole(opt.key)}
                  className={`flex items-start gap-3 rounded-xl border px-3 py-3 text-left text-xs transition ${
                    role === opt.key
                      ? "border-emerald-400 bg-emerald-500/10"
                      : "border-slate-700 bg-slate-900/60 hover:border-emerald-400/80"
                  }`}
                >
                  <div className="mt-0.5 text-lg">{opt.emoji}</div>
                  <div>
                    <div className="font-semibold text-slate-100">{opt.label}</div>
                    <div className="text-[0.7rem] text-slate-300">{opt.desc}</div>
                  </div>
                </button>
              ))}
            </div>

            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-[0.7rem] text-slate-300 space-y-1">
              {role === "guest" && (
                <>
                  <p>• Kısa sürede talep açıp otellerden teklif toplamak için idealdir.</p>
                  <p>• Telefon ve ülke bilgisini ekleyerek rezervasyonlarını daha hızlı tamamlayabilirsin.</p>
                </>
              )}
              {role === "hotel" && (
                <>
                  <p>• Tesis adın, adresin, yıldızın ve özelliklerin; gelen taleplerle doğru eşleşme için kullanılır.</p>
                  <p>• Konaklama tipleri ve özellikleri seçtiğin için filtreleme daha temiz çalışır.</p>
                </>
              )}
              {role === "agency" && (
                <>
                  <p>• Acenta bilgilerin; B2B işlemler ve paket satışlarının temelidir.</p>
                  <p>• Açıklama alanına uzmanlığını (incoming, MICE, FIT vb.) yazabilirsin.</p>
                </>
              )}
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-3 text-sm">
            {/* Ortak alanlar */}
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs text-slate-200">Ad Soyad</label>
                <input
                  name="name"
                  required
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
                  placeholder="Adınız Soyadınız"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-200">E-posta</label>
                <input
                  name="email"
                  type="email"
                  required
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
                  placeholder="ornek@mail.com"
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs text-slate-200">Şifre</label>
                <input
                  name="password"
                  type="password"
                  required
                  minLength={6}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
                  placeholder="En az 6 karakter"
                />
                <p className="text-[0.7rem] text-slate-500 mt-1">
                  Eğer bu e-posta zaten kayıtlıysa, aynı şifre ile giriş yapıp rol yükseltme yapılır.
                </p>
              </div>

              {role === "guest" && (
                <>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-200">Telefon (opsiyonel)</label>
                    <input
                      name="guestPhone"
                      className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
                      placeholder="+90 ..."
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-200">Ülke (opsiyonel)</label>
                    <input
                      name="guestCountry"
                      className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
                      placeholder="Türkiye, Almanya vb."
                    />
                  </div>
                </>
              )}
            </div>

            {/* OTEL ALANLARI */}
            {role === "hotel" && (
              <div className="space-y-3 pt-1">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-200">Tesis Adı</label>
                    <input
                      name="hotelName"
                      required
                      className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
                      placeholder="Örn: Biddakika Resort Hotel"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-200">Telefon</label>
                    <input
                      name="hotelPhone"
                      required
                      className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
                      placeholder="+90 ..."
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-200">Adres</label>
                  <input
                    name="hotelAddress"
                    required
                    className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
                    placeholder="İl, ilçe, mahalle, cadde..."
                  />
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-200">Web sitesi (opsiyonel)</label>
                    <input
                      name="hotelWebsite"
                      className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs focus:border-emerald-400 focus:outline-none"
                      placeholder="https://..."
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-200">Yıldız</label>
                    <select
                      name="hotelStar"
                      className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs focus:border-emerald-400 focus:outline-none"
                    >
                      <option value="">Seç</option>
                      <option value="1">1 ★</option>
                      <option value="2">2 ★★</option>
                      <option value="3">3 ★★★</option>
                      <option value="4">4 ★★★★</option>
                      <option value="5">5 ★★★★★</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-200">Tesis Tipi</label>
                    <select
                      name="hotelPropertyType"
                      className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs focus:border-emerald-400 focus:outline-none"
                      defaultValue="hotel"
                    >
                      <option value="hotel">Otel</option>
                      <option value="butik">Butik Otel</option>
                      <option value="pansiyon">Pansiyon</option>
                      <option value="apart">Apart / Residence</option>
                      <option value="villa">Villa</option>
                      <option value="hostel">Hostel</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-200">Konaklama Tipleri (birden fazla seçebilirsin)</label>
                  <div className="grid gap-2 md:grid-cols-2">
                    {BOARD_TYPES.map((bt) => (
                      <label key={bt.key} className="flex items-center gap-2 text-xs text-slate-200">
                        <input type="checkbox" name="hotelBoardTypes" value={bt.key} className="h-4 w-4 rounded border-slate-600 bg-slate-900" />
                        {bt.label}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-200">Tesis Özellikleri (checkbox ile seç)</label>
                  <div className="grid gap-2 md:grid-cols-2">
                    {HOTEL_FEATURES.map((f) => (
                      <label key={f.key} className="flex items-center gap-2 text-xs text-slate-200">
                        <input type="checkbox" name="hotelFeatures" value={f.key} className="h-4 w-4 rounded border-slate-600 bg-slate-900" />
                        {f.label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ACENTA ALANLARI */}
            {role === "agency" && (
              <div className="space-y-3 pt-1">
                <div className="space-y-1">
                  <label className="text-xs text-slate-200">Acenta Adı</label>
                  <input name="agencyName" required className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-200">Adres</label>
                  <input name="agencyAddress" required className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none" />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-200">Telefon</label>
                    <input name="agencyPhone" required className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-200">Web sitesi (opsiyonel)</label>
                    <input name="agencyWebsite" className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs focus:border-emerald-400 focus:outline-none" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-200">Açıklama (opsiyonel)</label>
                  <textarea name="agencyDescription" rows={3} className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-xs focus:border-emerald-400 focus:outline-none" />
                </div>
              </div>
            )}

            {error && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/40 rounded-md px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-2 w-full rounded-md bg-emerald-500 text-slate-950 text-sm font-medium py-2.5 shadow shadow-emerald-500/30 hover:bg-emerald-400 disabled:opacity-60"
            >
              {loading ? "İşleniyor..." : "Kayıt Ol ve Devam Et"}
            </button>

            <p className="text-[0.65rem] text-slate-500 mt-2">
              Kayıt olarak şartları ve KVKK kapsamında açıklanacak gizlilik politikasını kabul etmiş olursun.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
