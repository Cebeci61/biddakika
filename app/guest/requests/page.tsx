// app/guest/requests/new/page.tsx
"use client";

import { FormEvent, useState } from "react";
import { Protected } from "@/components/Protected";
import { useAuth } from "@/context/AuthContext";
import { getFirestoreDb, getFirebaseAuth } from "@/lib/firebase/client";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";

const FEATURES = [
  { key: "pool", label: "Havuz" },
  { key: "parking", label: "Otopark" },
  { key: "spa", label: "Spa / Wellness" },
  { key: "wifi", label: "Ücretsiz Wi-Fi" },
  { key: "seaView", label: "Deniz manzarası" },
  { key: "balcony", label: "Balkon" },
  { key: "family", label: "Aile odaları" },
  { key: "petFriendly", label: "Evcil hayvan kabul edilir" }
];

const DEADLINES = [
  { key: 30, label: "30 dakika" },
  { key: 60, label: "1 saat" },
  { key: 180, label: "3 saat" },
  { key: 1440, label: "24 saat" }
];

export default function NewRequestPage() {
  const { profile } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    setError(null);

    try {
      const form = e.currentTarget;
      const formData = new FormData(form);

      const auth = getFirebaseAuth();
      const user = auth.currentUser;
      if (!user) {
        setError("Oturumun düşmüş görünüyor. Lütfen tekrar giriş yap.");
        setSubmitting(false);
        return;
      }

      const checkIn = String(formData.get("checkIn") || "");
      const checkOut = String(formData.get("checkOut") || "");
      const city = String(formData.get("city") || "");
      const radiusKmRaw = String(formData.get("radiusKm") || "");
      const adults = Number(formData.get("adults") || 1);
      const children = Number(formData.get("children") || 0);
      const rooms = Number(formData.get("rooms") || 1);
      const boardType = String(formData.get("boardType") || "");
      const note = String(formData.get("note") || "");
      const deadlineMinutes = Number(formData.get("deadline") || 60);
      const featureKeys = formData.getAll("features").map(String);

      const db = getFirestoreDb();
      const requestsCol = collection(db, "requests");

      await addDoc(requestsCol, {
        guestId: user.uid,
        guestName: profile?.displayName || user.email || null,
        city,
        radiusKm: radiusKmRaw ? Number(radiusKmRaw) : null,
        checkIn,
        checkOut,
        adults,
        children,
        rooms,
        boardType: boardType || null,
        featureKeys,
        note: note || null,
        responseDeadlineMinutes: deadlineMinutes,
        status: "open",
        createdAt: serverTimestamp()
      });

      form.reset();
      setMessage(
        "Talebin başarıyla oluşturuldu. Oteller, seçtiğin süre içinde sana özel teklif gönderecek."
      );
    } catch (err: any) {
      console.error(err);
      setError(
        err?.message || "Talep oluşturulurken bir hata oluştu. Lütfen tekrar dene."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Protected allowedRoles={["guest"]}>
      <div className="container-page max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Otel için talep oluştur</h1>
          <p className="text-sm text-slate-300">
            Giriş–çıkış tarihini, kişi sayısını, konaklama tipini ve istediğin özellikleri
            belirt. Talebin, seçtiğin şehirdeki ve kriterlerine uyan otellere gönderilecek.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Tarih alanları */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs text-slate-200">Giriş Tarihi</label>
              <input
                type="date"
                name="checkIn"
                required
                className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-200">Çıkış Tarihi</label>
              <input
                type="date"
                name="checkOut"
                required
                className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
              />
            </div>
          </div>

          {/* Kişi / oda */}
          <div className="grid gap-4 md:grid-cols-3">
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
                name="children"
                min={0}
                defaultValue={0}
                className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-200">Oda Sayısı</label>
              <input
                type="number"
                name="rooms"
                min={1}
                defaultValue={1}
                className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
              />
            </div>
          </div>

          {/* Konum */}
          <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
            <div className="space-y-1">
              <label className="text-xs text-slate-200">Şehir</label>
              <input
                type="text"
                name="city"
                placeholder="Örn: Antalya, İstanbul..."
                className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-200">En fazla mesafe (km, opsiyonel)</label>
              <input
                type="number"
                name="radiusKm"
                min={0}
                placeholder="Örn: 10"
                className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
              />
            </div>
          </div>

          {/* Konaklama tipi */}
          <div className="space-y-1">
            <label className="text-xs text-slate-200">Konaklama tipi (opsiyonel)</label>
            <select
              name="boardType"
              className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
            >
              <option value="">Farketmez</option>
              <option value="RO">Sadece oda (RO)</option>
              <option value="BB">Oda + Kahvaltı (BB)</option>
              <option value="HB">Yarım pansiyon (HB)</option>
              <option value="FB">Tam pansiyon (FB)</option>
              <option value="AI">Her şey dahil (AI)</option>
              <option value="UAI">Ultra her şey dahil (UAI)</option>
            </select>
          </div>

          {/* Özellikler */}
          <div className="space-y-1">
            <label className="text-xs text-slate-200">
              Otelde olmasını istediğin özellikler (checkbox ile seç)
            </label>
            <div className="grid gap-2 md:grid-cols-2">
              {FEATURES.map((f) => (
                <label
                  key={f.key}
                  className="flex items-center gap-2 text-xs text-slate-200"
                >
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

          {/* Not */}
          <div className="space-y-1">
            <label className="text-xs text-slate-200">Not (opsiyonel)</label>
            <textarea
              name="note"
              rows={3}
              placeholder="Örn: Yüksek kat tercih ederim, mümkünse deniz manzaralı..."
              className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
            />
          </div>

          {/* Cevap süresi */}
          <div className="space-y-1">
            <label className="text-xs text-slate-200">
              Otellerin cevap vermesini istediğin süre
            </label>
            <div className="flex flex-wrap gap-2 text-xs">
              {DEADLINES.map((d) => (
                <label key={d.key} className="cursor-pointer">
                  <input
                    type="radio"
                    name="deadline"
                    value={d.key}
                    defaultChecked={d.key === 60}
                    className="peer hidden"
                  />
                  <span className="inline-flex items-center rounded-full border border-slate-700 px-3 py-1 peer-checked:border-emerald-400 peer-checked:bg-emerald-500/10">
                    {d.label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Hata / mesaj ve buton */}
          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/40 rounded-md px-3 py-2">
              {error}
            </p>
          )}
          {message && (
            <p className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/40 rounded-md px-3 py-2">
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-emerald-500 text-slate-950 font-medium px-4 py-2 text-sm disabled:opacity-60"
          >
            {submitting ? "Talebin kaydediliyor..." : "Talebi Gönder"}
          </button>
        </form>
      </div>
    </Protected>
  );
}
