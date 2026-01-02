"use client";

import React, { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getFirebaseAuth } from "@/lib/firebase/client";

type CallResult = { ok: boolean; requestId: string; claimToken: string; expiresHours: number };

const LS_KEY = "bdk_public_claim_token_v1";
const LS_KEY_TIME = "bdk_public_claim_token_ts_v1";

function cls(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function digitsOnly(v: string) {
  return v.replace(/\D/g, "");
}

function toInt(v: any, d: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : d;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function nowTimeHHMM() {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function parseISODate(s?: string) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function calcNights(ci: string, co: string) {
  const a = parseISODate(ci);
  const b = parseISODate(co);
  if (!a || !b) return 0;
  const ms = b.getTime() - a.getTime();
  return Math.max(0, Math.round(ms / 86400000));
}

function humanizeFnError(err: any) {
  const code = String(err?.code || "");
  const msg = String(err?.message || "");

  if (code.includes("functions/internal") || msg.includes("functions/internal") || msg.includes("internal")) {
    return "Sistem şu an yoğun. Lütfen 20 saniye sonra tekrar dene.";
  }
  if (code.includes("functions/invalid-argument")) return "Bazı alanlar hatalı görünüyor. Formu kontrol edip tekrar dene.";
  if (code.includes("functions/unavailable")) return "Servis geçici olarak kapalı. Biraz sonra tekrar dene.";
  if (code.includes("functions/deadline-exceeded")) return "İstek zaman aşımına uğradı. İnternetini kontrol edip tekrar dene.";

  return msg.length ? msg : "Bir hata oluştu. Lütfen tekrar dene.";
}

// Basit seçenekler (istersen genişletiriz)
const CITY_SAMPLES = ["Trabzon", "Rize", "Giresun", "Ordu", "Samsun", "İstanbul", "Ankara", "İzmir"];
const ROOM_TYPE_OPTIONS = [
  { key: "any", label: "Farketmez" },
  { key: "standard", label: "Standart" },
  { key: "double", label: "Double" },
  { key: "family", label: "Aile" },
  { key: "suite", label: "Suit" },
  { key: "deluxe", label: "Deluxe" }
];

const ACCOM_TYPES = [
  { key: "any", label: "Farketmez" },
  { key: "hotel", label: "Otel" },
  { key: "boutique", label: "Butik otel" },
  { key: "apartHotel", label: "Apart otel" },
  { key: "bungalow", label: "Bungalov" },
  { key: "pension", label: "Pansiyon" }
];

const BOARD_TYPES = [
  { key: "any", label: "Farketmez" },
  { key: "RO", label: "Sadece oda (RO)" },
  { key: "BB", label: "Oda + Kahvaltı (BB)" },
  { key: "HB", label: "Yarım Pansiyon (HB)" },
  { key: "FB", label: "Tam Pansiyon (FB)" },
  { key: "AI", label: "Her şey dahil (AI)" }
];

const STAR_PREFS = [
  { key: "any", label: "Farketmez" },
  { key: "3", label: "3★" },
  { key: "4", label: "4★" },
  { key: "5", label: "5★" }
];

const FEATURES = [
  { key: "wifi", label: "Wi-Fi" },
  { key: "parking", label: "Otopark" },
  { key: "pool", label: "Havuz" },
  { key: "spa", label: "Spa" },
  { key: "seaView", label: "Deniz manzarası" },
  { key: "mountainView", label: "Dağ manzarası" },
  { key: "cityCenter", label: "Merkeze yakın" },
  { key: "family", label: "Aile odası" }
];
export default function PublicHotelRequestPage() {
  const router = useRouter();

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [successOpen, setSuccessOpen] = useState(false);
  const [successInfo, setSuccessInfo] = useState<{ requestId: string; minutes: number; expiresHours: number } | null>(null);

  // Step 1: Kimlik
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [phoneCode, setPhoneCode] = useState("+90");
  const [phone, setPhone] = useState("");
  const [phone2Code, setPhone2Code] = useState("+90");
  const [phone2, setPhone2] = useState("");

  // Step 2: Tarih & kişi & oda
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");

  const [checkInTime, setCheckInTime] = useState("14:00");
  const [checkOutTime] = useState("12:00"); // sistem sabit

  const [sameDayStay, setSameDayStay] = useState(false);

  const [earlyWanted, setEarlyWanted] = useState(false);
  const [earlyFrom, setEarlyFrom] = useState("10:00");
  const [earlyTo, setEarlyTo] = useState("14:00");

  const [lateWanted, setLateWanted] = useState(false);
  const [lateFrom, setLateFrom] = useState("12:00");
  const [lateTo, setLateTo] = useState("16:00");

  const [adults, setAdults] = useState(2);
  const [childrenCount, setChildrenCount] = useState(0);
  const [roomsCount, setRoomsCount] = useState(1);

  // oda tipi satırları (her oda için)
  const [roomTypeSelections, setRoomTypeSelections] = useState<string[]>(["any"]);

  // Step 3: Konum
  const [city, setCity] = useState("");
  const [district, setDistrict] = useState("");
  const [nearMe, setNearMe] = useState(false);
  const [nearMeKm, setNearMeKm] = useState<number>(10);
  const [locationNote, setLocationNote] = useState("");

  // Step 4: Tercihler
  const [accommodationType, setAccommodationType] = useState("any");
  const [boardType, setBoardType] = useState("any");
  const [starPref, setStarPref] = useState("any");
  const [featureKeys, setFeatureKeys] = useState<string[]>([]);

  // Step 5: Not & süre
  const [note, setNote] = useState("");
  const [responseAmount, setResponseAmount] = useState(60);
  const [responseUnit, setResponseUnit] = useState<"minutes" | "hours">("minutes");

  const responseDeadlineMinutes = useMemo(() => {
    const v = toInt(responseAmount, 60);
    return responseUnit === "hours" ? v * 60 : v;
  }, [responseAmount, responseUnit]);

  const nights = useMemo(() => (checkIn && checkOut ? calcNights(checkIn, checkOut) : 0), [checkIn, checkOut]);
  const totalGuests = useMemo(() => adults + childrenCount, [adults, childrenCount]);

  // “bugün seçiliyse checkInTime geçmiş olamaz” (basit koruma)
  useEffect(() => {
    if (!checkIn) return;
    const today = todayISO();
    if (checkIn !== today) return;

    const now = nowTimeHHMM();
    if (checkInTime < now) setCheckInTime(now);
  }, [checkIn, checkInTime]);

  // same day toggle → checkOut = checkIn
  useEffect(() => {
    if (!sameDayStay) return;
    if (!checkIn) return;
    setCheckOut(checkIn);
  }, [sameDayStay, checkIn]);

  // roomsCount değişince roomTypeSelections güncelle
  useEffect(() => {
    const c = Math.max(1, toInt(roomsCount, 1));
    setRoomTypeSelections((prev) => {
      const next = prev.slice(0, c);
      while (next.length < c) next.push("any");
      return next;
    });
  }, [roomsCount]);

  const callable = useMemo(() => {
    const auth = getFirebaseAuth();
    const app = (auth as any).app;
    const functions = getFunctions(app, "us-central1");
    return httpsCallable(functions, "createPublicHotelRequest");
  }, []);

  

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);

    const name = contactName.trim();
    const phoneLocal = digitsOnly(phone);
    const phoneLocal2 = digitsOnly(phone2);

    if (name.length < 2) return setErr("Lütfen ad soyad yaz.");
    if (phoneLocal.length < 10) return setErr("Lütfen geçerli telefon yaz (en az 10 rakam).");
    if (!city.trim()) return setErr("Şehir seçmelisin.");
    if (!checkIn || !checkOut) return setErr("Giriş/Çıkış tarihlerini seç.");
    if (!sameDayStay && nights <= 0) return setErr("Çıkış tarihi giriş tarihinden sonra olmalı.");
    if (roomsCount < 1) return setErr("Oda sayısı en az 1 olmalı.");

    setSubmitting(true);
    try {
      const payload = {
        // kimlik
        contactName: name,
        contactEmail: contactEmail.trim() || null,
        contactPhoneCountryCode: phoneCode,
        contactPhoneLocal: phoneLocal,
        contactPhone: `${phoneCode} ${phoneLocal}`,
        contactPhone2: phoneLocal2.length >= 10 ? `${phone2Code} ${phoneLocal2}` : null,

        // konum/tarih
        city: city.trim(),
        district: district.trim(),
        checkIn,
        checkOut,
        checkInTime,
        checkOutTime,
        sameDayStay,

        // erken/ geç
        earlyCheckInWanted: !!earlyWanted,
        earlyCheckInFrom: earlyWanted ? earlyFrom : null,
        earlyCheckInTo: earlyWanted ? earlyTo : null,

        lateCheckOutWanted: !!lateWanted,
        lateCheckOutFrom: lateWanted ? lateFrom : null,
        lateCheckOutTo: lateWanted ? lateTo : null,

        // kişi/oda
        adults,
        childrenCount,
        roomsCount,

        // oda tipleri
        roomTypes: roomTypeSelections, // hotel inbox’ta görünür
        roomTypeRows: roomTypeSelections.map((k, i) => ({ typeKey: k, count: 1, idx: i })),

        // tercihler
        accommodationType: accommodationType === "any" ? null : accommodationType,
        boardType: boardType === "any" ? null : boardType,
        desiredStarRatings: starPref === "any" ? [] : [Number(starPref)],
        featureKeys,

        // notlar
        locationNote: locationNote.trim() || null,
        note: note.trim() || null,

        // süre
        responseDeadlineMinutes
      };

      const res: any = await callable(payload);
      const data = res?.data as CallResult;

      if (!data?.ok) throw new Error("Talep oluşturulamadı.");

      localStorage.setItem(LS_KEY, data.claimToken);
      localStorage.setItem(LS_KEY_TIME, String(Date.now()));

      setSuccessInfo({
        requestId: data.requestId,
        minutes: responseDeadlineMinutes,
        expiresHours: data.expiresHours ?? 24
      });
      setSuccessOpen(true);
    } catch (e2: any) {
      console.error("createPublicHotelRequest error:", e2);
      setErr(humanizeFnError(e2));
    } finally {
      setSubmitting(false);
    }
  }
  const Card = ({ children }: { children: React.ReactNode }) => (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
      {children}
    </section>
  );

  const StepHeader = ({
    no,
    title,
    right
  }: {
    no: number;
    title: string;
    right?: React.ReactNode;
  }) => (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 font-extrabold">
          {no}
        </span>
        <h2 className="text-white font-extrabold">{title}</h2>
      </div>
      {right ? <div className="text-[0.75rem] text-slate-400">{right}</div> : null}
    </div>
  );

  const Hint = ({
    icon,
    title,
    text,
    tone = "emerald"
  }: {
    icon: string;
    title: string;
    text: string;
    tone?: "emerald" | "sky" | "amber";
  }) => {
    const toneCls =
      tone === "emerald"
        ? "border-emerald-500/25 bg-emerald-500/10"
        : tone === "sky"
        ? "border-sky-500/25 bg-sky-500/10"
        : "border-amber-500/25 bg-amber-500/10";

    return (
      <div className={cls("rounded-2xl border p-4", toneCls)}>
        <div className="flex items-start gap-3">
          <span className="text-lg">{icon}</span>
          <div>
            <p className="text-slate-100 font-semibold">{title}</p>
            <p className="text-slate-300 text-[0.85rem] mt-1">{text}</p>
          </div>
        </div>
      </div>
    );
  };

  function toggleFeature(key: string) {
    setFeatureKeys((prev) => {
      const s = new Set(prev);
      if (s.has(key)) s.delete(key);
      else s.add(key);
      return Array.from(s);
    });
  }

  return (
    <div className="container-page max-w-6xl py-10 space-y-6">
      {/* Sticky teşvik bar */}
      <div className="sticky top-2 z-[50]">
      <div className="min-h-[56px] rounded-2xl border-amber-500/25 bg-slate-950/80 backdrop-blur px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
         <div className="text-[0.85rem] text-amber-100">
  <span className="font-extrabold">⚡</span>{" "}
  Teklifleri görmek için kayıt olman gerekecek — 1 dakikada hazır. Oteller & acentalar seni bekliyor.
</div>

          <div className="flex gap-2">
            <Link
              href="/auth/register"
              className="rounded-xl bg-emerald-500 px-4 py-2 text-[0.85rem] font-extrabold text-slate-950 hover:bg-emerald-400"
            >
              Kayıt ol
            </Link>
            <Link
              href="/auth/login"
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-[0.85rem] font-semibold text-slate-100 hover:bg-white/10"
            >
              Giriş yap
            </Link>
          </div>
        </div>
      </div>

      {/* HERO (formla aynı dil) */}
      <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-7 md:p-9 backdrop-blur">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="space-y-3 max-w-3xl">
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center rounded-full border border-white/10 bg-black/10 px-3 py-1 text-[0.75rem] text-slate-200">
                ⚡ Kayıtsız talep oluştur
              </span>
              <span className="inline-flex items-center rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[0.75rem] text-emerald-200">
                Şehirdeki otellere düşer
              </span>
            </div>

            <h1 className="text-3xl md:text-4xl font-extrabold text-white">
              Otelden fiyat al <span className="text-emerald-300">(kayıtsız)</span>
            </h1>

            <p className="text-slate-300">
              Bu formu gönderince talebin <b>otomatik</b> olarak o şehirdeki otellerin ekranına düşer.
              <br />
              <span className="text-slate-200 font-semibold">Teklifleri görmek için kayıt/giriş gerekir.</span>
            </p>

            <div className="grid md:grid-cols-3 gap-2 pt-1">
              <Hint icon="🧠" title="Net bilgi = net fiyat" text="Tarih + kişi + oda net olursa teklif kalitesi artar." tone="sky" />
              <Hint icon="⚡" title="Hızlı dönüş" text="Oteller dakikalar içinde talebini görür." tone="emerald" />
              <Hint icon="🔥" title="Kaçırma" text="Kayıt olmazsan gelen teklifleri göremezsin." tone="amber" />
            </div>
          </div>

          <div className="w-full md:w-[300px] rounded-3xl border border-white/10 bg-black/10 p-5">
            <p className="text-slate-400 text-[0.75rem]">Cevap süresi</p>
            <p className="text-white text-2xl font-extrabold">{responseDeadlineMinutes} dk</p>
            <p className="text-slate-400 text-[0.75rem] mt-1">
              Oteller bu süre içinde teklif üretir.
            </p>

            <div className="mt-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4">
              <p className="text-amber-200 font-extrabold text-sm">🎯 Teklifleri görmek için</p>
              <p className="text-amber-100 text-[0.85rem] mt-1">
                Kayıt olman gerekir. (Talep sonrası 1 dk)
              </p>
            </div>
          </div>
        </div>
      </div>

      {err && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {err}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* 1) Kimlik & iletişim */}
        <Card>
          <StepHeader no={1} title="Kimlik & iletişim" right="Gerçek müşteri hissi → otel daha ciddi algılar" />

          <div className="grid gap-3 md:grid-cols-2 mt-4">
            <div className="space-y-2">
              <label className="text-[0.75rem] text-slate-300">Ad Soyad</label>
              <input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className="w-full rounded-2xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400"
                placeholder="Örn: yunus"
              />
              <Hint icon="🧠" title="İsmini yazınca otel daha ciddi algılar" text="Gerçek müşteri hissi → otelin teklif verme motivasyonu artar." tone="sky" />
            </div>

            <div className="space-y-2">
              <label className="text-[0.75rem] text-slate-300">E-posta (ops.)</label>
              <input
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                className="w-full rounded-2xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400"
                placeholder="örn: mail@..."
              />
              <p className="text-[0.75rem] text-slate-400">Mail eklemek teklif sonrası iletişimi hızlandırır.</p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 mt-4">
            <div className="space-y-2">
              <label className="text-[0.75rem] text-slate-300">Telefon (zorunlu)</label>
              <div className="flex gap-2">
                <select
                  value={phoneCode}
                  onChange={(e) => setPhoneCode(e.target.value)}
                  className="rounded-2xl bg-slate-900/60 border border-white/10 px-3 py-3 text-sm text-white"
                >
                  <option value="+90">TR +90</option>
                  <option value="+49">DE +49</option>
                  <option value="+44">UK +44</option>
                  <option value="+7">RU +7</option>
                  <option value="+1">US +1</option>
                </select>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="flex-1 rounded-2xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400"
                  placeholder="5XXXXXXXXX"
                />
              </div>
              <p className="text-[0.75rem] text-slate-400">Sadece rakam yaz. Örn: 5321234567</p>
            </div>

            <div className="space-y-2">
              <label className="text-[0.75rem] text-slate-300">2. Telefon (ops.)</label>
              <div className="flex gap-2">
                <select
                  value={phone2Code}
                  onChange={(e) => setPhone2Code(e.target.value)}
                  className="rounded-2xl bg-slate-900/60 border border-white/10 px-3 py-3 text-sm text-white"
                >
                  <option value="+90">TR +90</option>
                  <option value="+49">DE +49</option>
                  <option value="+44">UK +44</option>
                  <option value="+7">RU +7</option>
                  <option value="+1">US +1</option>
                </select>
                <input
                  value={phone2}
                  onChange={(e) => setPhone2(e.target.value)}
                  className="flex-1 rounded-2xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400"
                  placeholder="İkinci numara varsa"
                />
              </div>
              <p className="text-[0.75rem] text-slate-400">Opsiyonel.</p>
            </div>
          </div>
        </Card>

        {/* 2) Tarih & kişi & oda */}
        <Card>
          <StepHeader no={2} title="Tarih & kişi & oda" right="Tarih seç → oteller fiyat hesaplasın" />

          <div className="grid gap-3 md:grid-cols-3 mt-4">
            <div className="space-y-2">
              <label className="text-[0.75rem] text-slate-300">Giriş tarihi</label>
              <input
                type="date"
                min={todayISO()}
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
                className="w-full rounded-2xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400"
              />
              <button
                type="button"
                onClick={() => {
                  const t = todayISO();
                  setCheckIn(t);
                  setCheckInTime(nowTimeHHMM());
                }}
                className="w-full rounded-2xl border border-sky-500/25 bg-sky-500/10 px-4 py-3 text-sm text-sky-100 hover:bg-sky-500/15"
              >
                ⚡ Hemen şimdi giriş (tarih/saat otomatik)
              </button>

              <div className="space-y-2">
                <label className="text-[0.75rem] text-slate-300">Check-in saati</label>
                <input
                  type="time"
                  value={checkInTime}
                  onChange={(e) => setCheckInTime(e.target.value)}
                  className="w-full rounded-2xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400"
                />
                <p className="text-[0.75rem] text-slate-400">Bugün seçiliyse saat “şu an”dan önce olamaz.</p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[0.75rem] text-slate-300">Çıkış tarihi</label>
              <input
                type="date"
                min={checkIn ? checkIn : todayISO()}
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
                disabled={sameDayStay}
                className="w-full rounded-2xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400 disabled:opacity-60"
              />

              <label className="text-[0.75rem] text-slate-300">Check-out saati (sabit)</label>
              <input
                value={checkOutTime}
                readOnly
                className="w-full rounded-2xl bg-slate-900/40 border border-white/10 px-4 py-3 text-sm text-white/70"
              />
              <p className="text-[0.75rem] text-slate-400">Check-out saati sistem gereği 12:00 sabit.</p>

              <button
                type="button"
                onClick={() => setSameDayStay((s) => !s)}
                className={cls(
                  "w-full rounded-2xl border px-4 py-3 text-sm font-semibold",
                  sameDayStay
                    ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-100"
                    : "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
                )}
              >
                {sameDayStay ? "Aynı gün giriş-çıkış (çıkış 12:00)" : "Aynı gün giriş-çıkış"}
              </button>
              <p className="text-[0.75rem] text-slate-400">Aynı gün seçilirse çıkış tarihi otomatik giriş tarihi olur.</p>
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl border border-white/10 bg-black/10 px-4 py-4">
                <p className="text-[0.75rem] text-slate-400">Gece</p>
                <p className="text-white text-2xl font-extrabold">{sameDayStay ? 0 : nights || 0}</p>
                <p className="text-[0.75rem] text-slate-400">Giriş/çıkış seçince otomatik hesaplanır.</p>
              </div>

              <label className="inline-flex items-center gap-2 text-slate-200">
                <input type="checkbox" checked={earlyWanted} onChange={(e) => setEarlyWanted(e.target.checked)} className="accent-emerald-500" />
                Erken giriş istiyorum
              </label>
              {earlyWanted ? (
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="time"
                    value={earlyFrom}
                    onChange={(e) => setEarlyFrom(e.target.value)}
                    className="rounded-2xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white"
                  />
                  <input
                    type="time"
                    value={earlyTo}
                    onChange={(e) => setEarlyTo(e.target.value)}
                    className="rounded-2xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white"
                  />
                </div>
              ) : null}

              <label className="inline-flex items-center gap-2 text-slate-200">
                <input type="checkbox" checked={lateWanted} onChange={(e) => setLateWanted(e.target.checked)} className="accent-emerald-500" />
                Geç çıkış istiyorum
              </label>
              {lateWanted ? (
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="time"
                    value={lateFrom}
                    onChange={(e) => setLateFrom(e.target.value)}
                    className="rounded-2xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white"
                  />
                  <input
                    type="time"
                    value={lateTo}
                    onChange={(e) => setLateTo(e.target.value)}
                    className="rounded-2xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white"
                  />
                </div>
              ) : null}
            </div>
          </div>

          <Hint
            icon="👤"
            title={`${totalGuests} kişi için teklif akışı başlar`}
            text="Kişi sayısı net → teklif sayısı artar."
            tone="emerald"
          />

          <div className="grid gap-3 md:grid-cols-3 mt-4">
            <div className="space-y-2">
              <label className="text-[0.75rem] text-slate-300">Yetişkin</label>
              <input
                type="number"
                min={1}
                value={adults}
                onChange={(e) => setAdults(toInt(e.target.value, 1))}
                className="w-full rounded-2xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[0.75rem] text-slate-300">Çocuk</label>
              <input
                type="number"
                min={0}
                value={childrenCount}
                onChange={(e) => setChildrenCount(toInt(e.target.value, 0))}
                className="w-full rounded-2xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[0.75rem] text-slate-300">Oda sayısı</label>
              <input
                type="number"
                min={1}
                value={roomsCount}
                onChange={(e) => setRoomsCount(toInt(e.target.value, 1))}
                className="w-full rounded-2xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white"
              />
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <label className="text-[0.75rem] text-slate-300">Her oda için oda tipi</label>
            <div className="space-y-2">
              {roomTypeSelections.map((val, idx) => (
                <div key={idx} className="grid md:grid-cols-[140px_1fr] gap-2 items-center">
                  <div className="text-slate-300 text-[0.85rem]">{idx + 1}. oda</div>
                  <select
                    value={val}
                    onChange={(e) => {
                      const v = e.target.value;
                      setRoomTypeSelections((prev) => prev.map((x, i) => (i === idx ? v : x)));
                    }}
                    className="w-full rounded-2xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white"
                  >
                    {ROOM_TYPE_OPTIONS.map((x) => (
                      <option key={x.key} value={x.key}>{x.label}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* 3) Konum */}
        <Card>
          <StepHeader no={3} title="Konum" right="Şehir seçilmeden sistem otel eşleştiremez" />

          <div className="grid gap-3 md:grid-cols-2 mt-4">
            <div className="space-y-2">
              <label className="text-[0.75rem] text-slate-300">Şehir</label>
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                list="city-list"
                className="w-full rounded-2xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400"
                placeholder="Şehir seç"
              />
              <datalist id="city-list">
                {CITY_SAMPLES.map((c) => <option key={c} value={c} />)}
              </datalist>

              <Hint icon="📍" title="Şehir seç → teklifler başlasın" text="Şehir seçimi olmadan sistem otel eşleştiremez." tone="sky" />
            </div>

            <div className="space-y-2">
              <label className="text-[0.75rem] text-slate-300">İlçe</label>
              <input
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                className="w-full rounded-2xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400"
                placeholder="Farketmez (şehrin tamamı)"
              />
            </div>
          </div>

          <div className="mt-3 space-y-2">
            <label className="inline-flex items-center gap-2 text-slate-200">
              <input type="checkbox" checked={nearMe} onChange={(e) => setNearMe(e.target.checked)} className="accent-emerald-500" />
              Yakınımda ara
            </label>

            {nearMe ? (
              <div className="grid md:grid-cols-2 gap-2">
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-slate-200">
                  Yakınlık (km)
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={nearMeKm}
                    onChange={(e) => setNearMeKm(toInt(e.target.value, 10))}
                    className="mt-2 w-full rounded-2xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white"
                  />
                </div>
                <Hint icon="🧭" title="Yakınımda arayı açabilirsin" text="Konum daralırsa tekliflerin kalitesi artar." tone="emerald" />
              </div>
            ) : null}

            <div className="space-y-2 mt-3">
              <label className="text-[0.75rem] text-slate-300">Konum notu (ops.)</label>
              <textarea
                value={locationNote}
                onChange={(e) => setLocationNote(e.target.value)}
                rows={3}
                className="w-full rounded-2xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white resize-none"
                placeholder="Örn: hastaneye yakın, stadyuma yürüme mesafesi..."
              />
            </div>
          </div>
        </Card>

        {/* 4) Tercihler */}
        <Card>
          <StepHeader no={4} title="Tercihler" right="Seçim yaparsan kalite bandı netleşir" />

          <div className="grid gap-3 md:grid-cols-3 mt-4">
            <div className="space-y-2">
              <label className="text-[0.75rem] text-slate-300">Tesis türü</label>
              <select
                value={accommodationType}
                onChange={(e) => setAccommodationType(e.target.value)}
                className="w-full rounded-2xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white"
              >
                {ACCOM_TYPES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
              </select>
              <Hint icon="🧩" title="Tesis türü seç (öneri)" text="Otel/apart/bungalov… seçim yaparsan dönüş hızı artar." tone="sky" />
            </div>

            <div className="space-y-2">
              <label className="text-[0.75rem] text-slate-300">Yeme-içme</label>
              <select
                value={boardType}
                onChange={(e) => setBoardType(e.target.value)}
                className="w-full rounded-2xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white"
              >
                {BOARD_TYPES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
              </select>
              <Hint icon="🧠" title="Yeme-içme seçimi fiyatı netleştirir" text="Board seçimi yoksa otel geniş aralıkla teklif verir." tone="emerald" />
            </div>

            <div className="space-y-2">
              <label className="text-[0.75rem] text-slate-300">Yıldız</label>
              <select
                value={starPref}
                onChange={(e) => setStarPref(e.target.value)}
                className="w-full rounded-2xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white"
              >
                {STAR_PREFS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
              </select>
              <Hint icon="🧠" title="Yıldız seçersen kaliteyi sabitlersin" text="1–5★ seçimi kalite bandını netleştirir." tone="sky" />
            </div>
          </div>

          <details className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
            <summary className="cursor-pointer text-slate-200 font-semibold">
              Otel özelliklerini seç (isteğe bağlı)
            </summary>
            <div className="mt-3 flex flex-wrap gap-2">
              {FEATURES.map((f) => {
                const active = featureKeys.includes(f.key);
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => toggleFeature(f.key)}
                    className={cls(
                      "rounded-full border px-3 py-1 text-[0.85rem] transition",
                      active
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                        : "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
                    )}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
          </details>
        </Card>

        {/* 5) Not & teklif süresi */}
        <Card>
          <StepHeader no={5} title="Not & teklif süresi" right="Not ne kadar netse fiyat o kadar doğru" />

          <div className="mt-4 space-y-2">
            <label className="text-[0.75rem] text-slate-300">Genel not (ops.)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              className="w-full rounded-2xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white resize-none"
              placeholder="Örn: Geç giriş yapacağız, sigarasız oda, bebek yatağı..."
            />
            <Hint icon="💬" title="Not ne kadar netse fiyat o kadar doğru" text="Geç giriş, sigarasız oda, bebek yatağı… net yaz → yanlış teklif azalır." tone="emerald" />
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3 items-end">
            <div className="space-y-2">
              <label className="text-[0.75rem] text-slate-300">Cevap süresi</label>
              <input
                type="number"
                min={15}
                max={10080}
                value={responseAmount}
                onChange={(e) => setResponseAmount(toInt(e.target.value, 60))}
                className="w-full rounded-2xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[0.75rem] text-slate-300">Birim</label>
              <select
                value={responseUnit}
                onChange={(e) => setResponseUnit(e.target.value as any)}
                className="w-full rounded-2xl bg-slate-900/60 border border-white/10 px-4 py-3 text-sm text-white"
              >
                <option value="minutes">dakika</option>
                <option value="hours">saat</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="rounded-2xl bg-emerald-500 px-6 py-4 text-base font-extrabold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
            >
              {submitting ? "Gönderiliyor..." : "Talebi gönder → otellere düşsün 🚀"}
            </button>
          </div>

          <div className="mt-4 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-amber-100">
            ⚠️ Talep gönderildiğinde teklifleri görmek için <b>kayıt/giriş yapman gerekecek</b>.
            Şimdi kayıt olursan teklifleri kaçırmazsın.
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/auth/register" className="rounded-xl bg-emerald-500 px-4 py-2 text-[0.85rem] font-extrabold text-slate-950 hover:bg-emerald-400">
              Hadi kayıt ol
            </Link>
            <Link href="/auth/login" className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-[0.85rem] font-semibold text-slate-100 hover:bg-white/10">
              Giriş yap
            </Link>
            <span className="text-[0.8rem] text-slate-400">
              “Herkes burada” — oteller & acentalar aktif teklif veriyor.
            </span>
          </div>
        </Card>
      </form>
      {successOpen && successInfo && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-xl rounded-3xl border border-emerald-500/30 bg-slate-950 p-7 shadow-2xl space-y-4">
            <div className="text-center space-y-2">
              <div className="inline-flex items-center rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[0.75rem] text-emerald-200">
                Talep otellere düştü ✅
              </div>
              <h3 className="text-2xl font-extrabold text-white">Teklifler hazırlanıyor 🎉</h3>
              <p className="text-slate-300 text-sm">
                Oteller yaklaşık <b>{successInfo.minutes} dk</b> içinde teklif üretir.
              </p>
              <p className="text-[0.75rem] text-slate-500">
                Talep ID: <span className="text-slate-200 font-semibold">{successInfo.requestId}</span>
              </p>
            </div>

            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-amber-100 text-sm">
              <p className="font-extrabold text-amber-200">Şimdi kritik:</p>
              <p className="mt-1">
                <b>Kayıt/Giriş yapmazsan</b> gelen teklifleri <b>göremezsin</b>.
                Kayıt olunca bu talep hesabına bağlanır ve teklifleri tek ekranda seçersin.
              </p>
              <p className="mt-2 text-[0.75rem] text-amber-200/80">
                Claim token bu cihazda saklandı. Kayıt/Giriş sonrası otomatik bağlanır.
              </p>
            </div>

            <div className="grid gap-2">
              <button
                type="button"
                onClick={() => router.push("/auth/register?next=/claim")}
                className="rounded-2xl bg-emerald-500 px-6 py-4 text-base font-extrabold text-slate-950 hover:bg-emerald-400"
              >
                Kayıt ol • Teklifleri gör (1 dk)
              </button>

              <button
                type="button"
                onClick={() => router.push("/auth/login?next=/claim")}
                className="rounded-2xl border border-white/10 bg-white/5 px-6 py-4 text-base font-semibold text-slate-100 hover:bg-white/10"
              >
                Giriş yap • Teklifleri gör
              </button>

              <button
                type="button"
                onClick={() => setSuccessOpen(false)}
                className="rounded-2xl border border-white/10 bg-transparent px-6 py-3 text-slate-300 hover:bg-white/5"
              >
                Şimdilik kapat
              </button>
            </div>

            <div className="text-center text-[0.75rem] text-slate-500">
              Not: Teklifleri görmek için hesabın şart. Geç kalma — herkes burada.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
