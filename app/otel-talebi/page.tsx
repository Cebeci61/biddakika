"use client";

import React, { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getFirebaseAuth } from "@/lib/firebase/client"; // sende var
// UI tamamen sende – burası stabil, premium

type CallResult = { ok: boolean; requestId: string; claimToken: string; expiresHours: number };

function digitsOnly(v: string) {
  return v.replace(/\D/g, "");
}

const LS_KEY = "bdk_public_claim_token_v1";
const LS_KEY_TIME = "bdk_public_claim_token_ts_v1";

export default function PublicHotelRequestPage() {
  const router = useRouter();

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [successOpen, setSuccessOpen] = useState(false);
  const [successInfo, setSuccessInfo] = useState<{ requestId: string; minutes: number } | null>(null);

  // form state (minimum)
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneCode, setPhoneCode] = useState("+90");

  const [city, setCity] = useState("");
  const [district, setDistrict] = useState("");

  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");

  const [adults, setAdults] = useState(2);
  const [childrenCount, setChildrenCount] = useState(0);
  const [roomsCount, setRoomsCount] = useState(1);

  const [note, setNote] = useState("");
  const [responseDeadlineMinutes, setResponseDeadlineMinutes] = useState(60);

  // region sabit: functions v2 us-central1
  const callable = useMemo(() => {
    const auth = getFirebaseAuth();
    const app = (auth as any).app; // auth.app
    const functions = getFunctions(app, "us-central1");
    return httpsCallable(functions, "createPublicHotelRequest");
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);

    const name = contactName.trim();
    const phoneLocal = digitsOnly(phone);

    if (name.length < 2) return setErr("Lütfen ad soyad yaz.");
    if (phoneLocal.length < 10) return setErr("Lütfen geçerli telefon yaz (en az 10 rakam).");
    if (!city.trim()) return setErr("Şehir seçmelisin.");
    if (!checkIn || !checkOut) return setErr("Giriş/Çıkış tarihlerini seç.");

    setSubmitting(true);
    try {
      const payload = {
        contactName: name,
        contactPhoneCountryCode: phoneCode,
        contactPhoneLocal: phoneLocal,
        city: city.trim(),
        district: district.trim(),
        checkIn,
        checkOut,
        adults,
        childrenCount,
        roomsCount,
        note: note.trim(),
        responseDeadlineMinutes,
      };

      const res: any = await callable(payload);
      const data = res?.data as CallResult;

      if (!data?.ok) {
        throw new Error("Talep oluşturulamadı.");
      }

      // ✅ tokenı bu cihazda sakla (kayıt olunca claim edeceğiz)
      localStorage.setItem(LS_KEY, data.claimToken);
      localStorage.setItem(LS_KEY_TIME, String(Date.now()));

      setSuccessInfo({ requestId: data.requestId, minutes: responseDeadlineMinutes });
      setSuccessOpen(true);

      // reset (istersen kaldır)
      setNote("");
    } catch (e2: any) {
      console.error("createPublicHotelRequest error:", e2);
      const msg = e2?.message || "internal";
      const code = e2?.code ? String(e2.code) : "";
      setErr(code ? `${code}: ${msg}` : msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="container-page max-w-4xl py-10 space-y-6">
      {/* başlık */}
      <div className="rounded-2xl border border-emerald-500/20 bg-white/5 p-6 backdrop-blur">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-2">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/10 px-3 py-1 text-[0.75rem] text-slate-200">
              ⚡ Kayıt olmadan talep oluştur
            </p>
            <h1 className="text-2xl md:text-3xl font-semibold text-white">
              Otelden fiyat al (kayıtsız)
            </h1>
            <p className="text-sm text-slate-300">
              Talebin otellerin “Gelen talepler” ekranına düşer. <b>Teklifleri görmek ve seçmek</b> için kayıt olman gerekir.
              (Kayıt olmadan sadece talep başlatırsın.)
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/10 px-4 py-3 text-sm">
            <p className="text-slate-300 text-[0.75rem]">Cevap süresi</p>
            <p className="text-white text-xl font-extrabold">{responseDeadlineMinutes} dk</p>
            <p className="text-slate-400 text-[0.75rem]">Oteller bu süre içinde teklif üretir.</p>
          </div>
        </div>
      </div>

      {/* hata */}
      {err && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {err}
        </div>
      )}

      {/* form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <section className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur space-y-3">
          <h2 className="text-sm font-semibold text-white">1) Kimlik</h2>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-300">Ad Soyad</label>
              <input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400"
                placeholder="Örn: Yunus Cebeci"
              />
              <p className="text-[0.72rem] text-slate-400">
                İpucu: İsmini girince talep “gerçek müşteri” gibi görünür → dönüş artar.
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-300">Telefon (zorunlu)</label>
              <div className="flex gap-2">
                <select
                  value={phoneCode}
                  onChange={(e) => setPhoneCode(e.target.value)}
                  className="rounded-xl bg-slate-900/60 border border-white/10 px-3 py-3 text-sm text-white outline-none"
                >
                  <option value="+90">🇹🇷 +90</option>
                  <option value="+49">🇩🇪 +49</option>
                  <option value="+44">🇬🇧 +44</option>
                  <option value="+7">🇷🇺 +7</option>
                  <option value="+1">🇺🇸 +1</option>
                </select>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="flex-1 rounded-xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400"
                  placeholder="5XXXXXXXXX"
                />
              </div>
              <p className="text-[0.72rem] text-slate-400">
                Teklif sonrası otel operasyonu için gerekli.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur space-y-3">
          <h2 className="text-sm font-semibold text-white">2) Konum & Tarih</h2>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-300">Şehir</label>
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400"
                placeholder="Örn: Trabzon"
              />
              <p className="text-[0.72rem] text-slate-400">Şehir seçimi otellere bildirim düşürür.</p>
            </div>

            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-300">İlçe (opsiyonel)</label>
              <input
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400"
                placeholder="Örn: Ortahisar"
              />
              <p className="text-[0.72rem] text-slate-400">İlçe seçersen daha hedefli teklifler gelir.</p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-300">Giriş</label>
              <input
                type="date"
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
                className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-300">Çıkış</label>
              <input
                type="date"
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
                className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400"
              />
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur space-y-3">
          <h2 className="text-sm font-semibold text-white">3) Kişi & Not</h2>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-300">Yetişkin</label>
              <input
                type="number"
                min={1}
                value={adults}
                onChange={(e) => setAdults(Number(e.target.value || 1))}
                className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-300">Çocuk</label>
              <input
                type="number"
                min={0}
                value={childrenCount}
                onChange={(e) => setChildrenCount(Number(e.target.value || 0))}
                className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-300">Oda</label>
              <input
                type="number"
                min={1}
                value={roomsCount}
                onChange={(e) => setRoomsCount(Number(e.target.value || 1))}
                className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[0.75rem] text-slate-300">Not (opsiyonel)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400"
              placeholder="Örn: Sessiz oda, erken giriş, bebek yatağı..."
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2 items-end">
            <div className="space-y-1">
              <label className="text-[0.75rem] text-slate-300">Otel cevap süresi (dk)</label>
              <input
                type="number"
                min={15}
                max={10080}
                value={responseDeadlineMinutes}
                onChange={(e) => setResponseDeadlineMinutes(Number(e.target.value || 60))}
                className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400"
              />
              <p className="text-[0.72rem] text-slate-400">60 dk hızlı teklif, 2-4 saat daha çok otel.</p>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
            >
              {submitting ? "Gönderiliyor..." : "Talep oluştur"}
            </button>
          </div>
        </section>
      </form>

      {/* başarı modal */}
      {successOpen && successInfo && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md rounded-2xl border border-emerald-500/30 bg-slate-950 p-6 shadow-2xl">
            <p className="text-emerald-300 font-extrabold text-lg text-center">Talebin gönderildi! 🎉</p>
            <p className="mt-2 text-sm text-slate-200 text-center">
              Oteller bu talebe <b>{successInfo.minutes} dk</b> içinde teklif hazırlayacak.
            </p>

            <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              Teklifleri görmek ve seçmek için <b>kayıt olman gerekiyor</b>.
              Kayıt olursan bu talep <b>hesabına bağlanır</b> ve “Taleplerim” sayfanda görünür.
              <br />
              <span className="text-amber-200/80 text-[0.75rem]">
                Not: Şimdi çıkıp sonra kayıt olursan bu talep hesabına bağlanmaz.
              </span>
            </div>

            <div className="mt-4 grid gap-2">
              <Link
                href="/auth/register"
                className="text-center rounded-xl bg-emerald-500 px-4 py-3 font-semibold text-slate-950 hover:bg-emerald-400"
                onClick={() => {
                  // register sonrası claim sayfasına yönlendireceğiz
                  router.push("/auth/register?next=/claim");
                }}
              >
                Misafir olarak kayıt ol (teklifleri gör)
              </Link>

              <Link
                href="/auth/login"
                className="text-center rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-slate-100 hover:bg-white/10"
                onClick={() => router.push("/auth/login?next=/claim")}
              >
                Giriş yap (teklifleri gör)
              </Link>

              <button
                type="button"
                onClick={() => setSuccessOpen(false)}
                className="rounded-xl border border-white/10 bg-white/0 px-4 py-3 text-slate-200 hover:bg-white/5"
              >
                Şimdilik kapat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
