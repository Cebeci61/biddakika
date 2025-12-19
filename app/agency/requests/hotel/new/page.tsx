"use client";

import React, { FormEvent, useMemo, useState } from "react";
import { Protected } from "@/components/Protected";
import { useAuth } from "@/context/AuthContext";
import { getFirestoreDb } from "@/lib/firebase/client";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { useRouter } from "next/navigation";

type DeadlineUnit = "minutes" | "hours" | "days";

const ROOM_TYPES = [
  { key: "any", label: "Farketmez" },
  { key: "standard", label: "Standart" },
  { key: "family", label: "Aile odası" },
  { key: "suite", label: "Suit" },
  { key: "deluxe", label: "Deluxe" }
] as const;

const HOTEL_TYPES = [
  { key: "any", label: "Farketmez" },
  { key: "hotel", label: "Otel" },
  { key: "butik", label: "Butik Otel" },
  { key: "apart", label: "Apart / Residence" },
  { key: "pansiyon", label: "Pansiyon" },
  { key: "villa", label: "Villa" }
] as const;

const BOARD_TYPES = [
  { key: "any", label: "Farketmez" },
  { key: "RO", label: "Sadece oda (RO)" },
  { key: "BB", label: "Oda + Kahvaltı (BB)" },
  { key: "HB", label: "Yarım pansiyon (HB)" },
  { key: "FB", label: "Tam pansiyon (FB)" },
  { key: "AI", label: "Her şey dahil (AI)" },
  { key: "UAI", label: "Ultra her şey dahil (UAI)" }
] as const;

const FEATURES = [
  { key: "pool", label: "Havuz" },
  { key: "wifi", label: "Ücretsiz Wi-Fi" },
  { key: "parking", label: "Otopark" },
  { key: "spa", label: "Spa / Wellness" },
  { key: "seaView", label: "Deniz manzarası" },
  { key: "cityCenter", label: "Merkeze yakın" },
  { key: "family", label: "Aile odaları" },
  { key: "petFriendly", label: "Evcil kabul" },
  { key: "meeting", label: "Toplantı salonu" },
  { key: "beach", label: "Plaja yakın" }
] as const;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function calcNights(ci: string, co: string) {
  const a = new Date(ci);
  const b = new Date(co);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 1;
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  const diff = Math.floor((b.getTime() - a.getTime()) / 86400000);
  return diff > 0 ? diff : 1;
}

function toMinutes(value: number, unit: DeadlineUnit) {
  const v = clamp(Number(value || 0), 1, 999999);
  if (unit === "minutes") return v;
  if (unit === "hours") return v * 60;
  return v * 24 * 60;
}

function deadlineText(value: number, unit: DeadlineUnit) {
  if (unit === "minutes") return `${value} dakika`;
  if (unit === "hours") return `${value} saat`;
  return `${value} gün`;
}

function toggle(arr: string[], k: string) {
  return arr.includes(k) ? arr.filter((x) => x !== k) : [...arr, k];
}

function safeStr(v: any, fb = "—") {
  if (v === null || v === undefined) return fb;
  const s = String(v).trim();
  return s.length ? s : fb;
}
export default function AgencyHotelRequestNewPage() {
  const { profile } = useAuth() as any;
  const db = getFirestoreDb();
  const router = useRouter();

  // 1) Kimlik & iletişim (müşteri)
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [phone1, setPhone1] = useState("");
  const [phone2, setPhone2] = useState("");

  // 2) Konaklama tarihleri & kişi
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [adults, setAdults] = useState(2);
  const [childrenCount, setChildrenCount] = useState(0);
  const [childrenAges, setChildrenAges] = useState<number[]>([]);
  const [roomsCount, setRoomsCount] = useState(1);

  // her oda için oda tipi
  const [roomTypeRows, setRoomTypeRows] = useState<{ typeKey: string }[]>([{ typeKey: "any" }]);

  // 3) Konum
  const [city, setCity] = useState("");
  const [district, setDistrict] = useState("");
  const [nearMe, setNearMe] = useState(false);
  const [nearMeKm, setNearMeKm] = useState(10);
  const [locationNote, setLocationNote] = useState("");

  // 4) Tesis türü / yeme-içme / yıldız / özellikler
  const [hotelType, setHotelType] = useState<(typeof HOTEL_TYPES)[number]["key"]>("any");
  const [boardType, setBoardType] = useState<(typeof BOARD_TYPES)[number]["key"]>("any");
  const [starPref, setStarPref] = useState<number | "">("");
  const [showFeatures, setShowFeatures] = useState(false);
  const [featurePrefs, setFeaturePrefs] = useState<string[]>([]);

  // 5) Not + cevap süresi
  const [generalNote, setGeneralNote] = useState("");
  const [deadlineValue, setDeadlineValue] = useState(60);
  const [deadlineUnit, setDeadlineUnit] = useState<DeadlineUnit>("minutes");

  // bütçe (opsiyonel ama profesyonel)
  const [budgetMin, setBudgetMin] = useState("");
  const [budgetMax, setBudgetMax] = useState("");

  // UI
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sentOpen, setSentOpen] = useState(false);

  const nights = useMemo(() => (checkIn && checkOut ? calcNights(checkIn, checkOut) : 1), [checkIn, checkOut]);
  const totalGuests = useMemo(() => adults + childrenCount, [adults, childrenCount]);

  function syncAges(n: number) {
    const count = clamp(Number(n || 0), 0, 10);
    setChildrenCount(count);
    setChildrenAges((prev) => {
      const copy = [...prev];
      while (copy.length < count) copy.push(7);
      while (copy.length > count) copy.pop();
      return copy;
    });
  }

  function syncRoomRows(n: number) {
    const count = clamp(Number(n || 1), 1, 20);
    setRoomsCount(count);
    setRoomTypeRows((prev) => {
      const copy = [...prev];
      while (copy.length < count) copy.push({ typeKey: "any" });
      while (copy.length > count) copy.pop();
      return copy;
    });
  }

  function validate() {
    if (!profile?.uid) return "Giriş bilgisi yok.";
    if (!customerName.trim()) return "Müşteri adı zorunlu.";
    if (!phone1.trim()) return "Birincil telefon zorunlu.";
    if (!checkIn || !checkOut) return "Giriş/Çıkış tarihi zorunlu.";
    if (!city.trim()) return "Şehir zorunlu.";
    if (adults < 1) return "Yetişkin sayısı en az 1 olmalı.";
    if (roomsCount < 1) return "Oda sayısı en az 1 olmalı.";
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);

    const vErr = validate();
    if (vErr) return setErr(vErr);

    try {
      setSaving(true);

      const responseDeadlineMinutes = toMinutes(deadlineValue, deadlineUnit);

      // roomTypes (legacy alanı) + roomTypeRows (detay alanı)
      const roomTypesLegacy = roomTypeRows.map((r) => r.typeKey);

      await addDoc(collection(db, "requests"), {
        // rules uyumu
        guestId: profile.uid,

        // ✅ ACENTA
        createdByRole: "agency",
        agencyId: profile.uid,
        agencyDiscountRate: 5,

        // müşteri (acenta adına)
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim() || null,
        customerPhone: phone1.trim(),
        customerPhone2: phone2.trim() || null,

        // talep tipi
        type: "standard",
        isGroup: false,

        // konum
        city: city.trim(),
        district: district.trim() || null,
        nearMe,
        nearMeKm: nearMe ? Number(nearMeKm || 10) : null,
        locationNote: locationNote.trim() || null,

        // tarih & kişi
        checkIn,
        checkOut,
        adults,
        childrenCount,
        childrenAges,
        roomsCount,

        // oda tipleri
        roomTypes: roomTypesLegacy,
        roomTypeRows: roomTypeRows.map((r) => ({ typeKey: r.typeKey, count: 1 })),

        // tesis / yeme / yıldız
        hotelType: hotelType === "any" ? null : hotelType,
        boardType: boardType === "any" ? null : boardType,
        starRatingPref: starPref === "" ? null : Number(starPref),

        // özellikler
        hotelFeaturePrefs: featurePrefs,

        // bütçe
        budgetMin: budgetMin ? Number(budgetMin) : null,
        budgetMax: budgetMax ? Number(budgetMax) : null,

        // not + süre
        generalNote: generalNote.trim() || null,
        responseDeadlineMinutes,

        status: "open",
        createdAt: serverTimestamp()
      });

      setSentOpen(true);

      setTimeout(() => {
        setSentOpen(false);
        router.push("/agency/requests");
      }, 1400);
    } catch (e: any) {
      console.error(e);
      setErr(e?.message || "Talep kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Protected allowedRoles={["agency"]}>
      <div className="container-page space-y-6">
        {/* HERO */}
        <section className="heroCard">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl md:text-3xl font-semibold text-slate-100">
                  Acenta için otel talep oluştur
                </h1>
                <span className="pill pill-sky">ACENTA TALEBİ</span>
                <span className="pill pill-emerald">Otel teklifi %5 düşük görünür</span>
              </div>
              <p className="text-sm text-slate-300 max-w-4xl">
                Bu talep, kriterlerine uyan otellere kapalı devre gönderilir. Oteller belirlediğin süre içinde sadece bu talep için fiyat verir.
              </p>
            </div>

            <div className="hidden md:block">
              <div className="miniStat">
                <div>
                  <p className="text-[0.7rem] text-slate-400">Gece</p>
                  <p className="text-slate-100 font-semibold">{nights}</p>
                </div>
                <div>
                  <p className="text-[0.7rem] text-slate-400">Kişi</p>
                  <p className="text-slate-100 font-semibold">{totalGuests}</p>
                </div>
                <div>
                  <p className="text-[0.7rem] text-slate-400">Oda</p>
                  <p className="text-slate-100 font-semibold">{roomsCount}</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {err && <div className="alert alert-red">{err}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 1 */}
          <section className="stepCard">
            <div className="stepTitle">
              <span className="stepNo">1</span>
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Kimlik & iletişim</h2>
                <p className="text-[0.75rem] text-slate-400">
                  Bu bilgiler, rezervasyon sonrası operasyon için net olmalı.
                </p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="field">
                <label>Ad Soyad</label>
                <input className="input" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Örn: Ahmet Yılmaz" />
              </div>
              <div className="field">
                <label>E-posta</label>
                <input className="input" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="ornek@mail.com" />
              </div>
              <div className="field">
                <label>Telefon (zorunlu)</label>
                <input className="input" value={phone1} onChange={(e) => setPhone1(e.target.value)} placeholder="+90..." />
              </div>
              <div className="field md:col-span-3">
                <label>İkinci telefon (opsiyonel)</label>
                <input className="input" value={phone2} onChange={(e) => setPhone2(e.target.value)} placeholder="İkinci numara varsa" />
              </div>
            </div>
          </section>

          {/* 2 */}
          <section className="stepCard">
            <div className="stepTitle">
              <span className="stepNo">2</span>
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Konaklama tarihleri & kişi sayısı</h2>
                <p className="text-[0.75rem] text-slate-400">
                  Oda sayısı kadar oda tipi seçebilirsin (opsiyonel).
                </p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <div className="field">
                <label>Giriş tarihi</label>
                <input className="input" type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
              </div>
              <div className="field">
                <label>Çıkış tarihi</label>
                <input className="input" type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
              </div>
              <div className="field">
                <label>Toplam gece</label>
                <input className="input" value={checkIn && checkOut ? String(nights) : ""} readOnly placeholder="Tarihi seçince hesaplanır" />
              </div>
              <div className="field">
                <label>Oda sayısı</label>
                <input className="input" type="number" min={1} value={roomsCount} onChange={(e) => syncRoomRows(Number(e.target.value))} />
              </div>

              <div className="field">
                <label>Yetişkin</label>
                <input className="input" type="number" min={1} value={adults} onChange={(e) => setAdults(Number(e.target.value))} />
              </div>
              <div className="field">
                <label>Çocuk</label>
                <input className="input" type="number" min={0} value={childrenCount} onChange={(e) => syncAges(Number(e.target.value))} />
              </div>
              <div className="field md:col-span-2">
                <label>Her oda için oda tipi</label>
                <div className="space-y-2">
                  {roomTypeRows.map((r, idx) => (
                    <div key={idx} className="roomRow">
                      <span className="text-[0.7rem] text-slate-400">Oda {idx + 1}</span>
                      <select
                        className="input"
                        value={r.typeKey}
                        onChange={(e) =>
                          setRoomTypeRows((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, typeKey: e.target.value } : x))
                          )
                        }
                      >
                        {ROOM_TYPES.map((rt) => (
                          <option key={rt.key} value={rt.key}>{rt.label}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {childrenCount > 0 && (
                <div className="md:col-span-4">
                  <div className="softBox">
                    <p className="text-xs text-slate-300 mb-2 font-semibold">Çocuk yaşları</p>
                    <div className="flex flex-wrap gap-2">
                      {childrenAges.map((age, idx) => (
                        <div key={idx} className="agePill">
                          <span className="text-xs text-slate-400">#{idx + 1}</span>
                          <input
                            className="ageInput"
                            type="number"
                            min={0}
                            max={17}
                            value={age}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              setChildrenAges((prev) => prev.map((a, i) => (i === idx ? v : a)));
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* 3 */}
          <section className="stepCard">
            <div className="stepTitle">
              <span className="stepNo">3</span>
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Konum</h2>
                <p className="text-[0.75rem] text-slate-400">
                  Şehir/ilçe seç, istersen yakınımda ara seçeneğini aç.
                </p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="field">
                <label>İl (şehir)</label>
                <input className="input" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Örn: Trabzon" />
              </div>
              <div className="field">
                <label>İlçe</label>
                <input className="input" value={district} onChange={(e) => setDistrict(e.target.value)} placeholder="Örn: Ortahisar (ops.)" />
              </div>

              <div className="md:col-span-2 flex items-center gap-3">
                <label className="inline-flex items-center gap-2 text-sm text-slate-200">
                  <input type="checkbox" checked={nearMe} onChange={(e) => setNearMe(e.target.checked)} />
                  Yakınımda ara
                </label>

                {nearMe && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">Km</span>
                    <input className="input w-24" type="number" min={1} max={100} value={nearMeKm} onChange={(e) => setNearMeKm(Number(e.target.value))} />
                  </div>
                )}
              </div>

              <div className="field md:col-span-2">
                <label>Konum / çevre notu (ops.)</label>
                <input className="input" value={locationNote} onChange={(e) => setLocationNote(e.target.value)} placeholder="Örn: hastaneye yakın, stadyuma yürüyüş mesafesi..." />
              </div>
            </div>
          </section>

          {/* 4 */}
          <section className="stepCard">
            <div className="stepTitle">
              <span className="stepNo">4</span>
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Tesis türü, yeme-içme, yıldız ve otel özellikleri</h2>
                <p className="text-[0.75rem] text-slate-400">
                  İstersen özellikleri açıp tek tek seç.
                </p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="field">
                <label>Tesis türü</label>
                <select className="input" value={hotelType} onChange={(e) => setHotelType(e.target.value as any)}>
                  {HOTEL_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Yeme-içme tipi</label>
                <select className="input" value={boardType} onChange={(e) => setBoardType(e.target.value as any)}>
                  {BOARD_TYPES.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Yıldız (isteğe bağlı)</label>
                <select className="input" value={String(starPref)} onChange={(e) => setStarPref(e.target.value ? Number(e.target.value) : "")}>
                  <option value="">Farketmez</option>
                  <option value="3">3★</option>
                  <option value="4">4★</option>
                  <option value="5">5★</option>
                </select>
              </div>

              <div className="md:col-span-3">
                <button type="button" onClick={() => setShowFeatures((v) => !v)} className="btn-soft">
                  {showFeatures ? "Otel özelliklerini gizle" : "Otel özelliklerini göster"}
                </button>
              </div>

              {showFeatures && (
                <div className="md:col-span-3 softBox">
                  <div className="grid gap-2 md:grid-cols-3">
                    {FEATURES.map((f) => (
                      <label key={f.key} className="flex items-center gap-2 text-xs text-slate-200">
                        <input
                          type="checkbox"
                          checked={featurePrefs.includes(f.key)}
                          onChange={() => setFeaturePrefs((p) => toggle(p, f.key))}
                        />
                        {f.label}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* 5 */}
          <section className="stepCard">
            <div className="stepTitle">
              <span className="stepNo">5</span>
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Not ve otellerin cevap süresi</h2>
                <p className="text-[0.75rem] text-slate-400">
                  Süre dolunca talep otomatik kapanır.
                </p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="field md:col-span-3">
                <label>Genel not (ops.)</label>
                <textarea className="input h-28 text-sm" value={generalNote} onChange={(e) => setGeneralNote(e.target.value)} placeholder="Örn: Gece geç giriş yapacağız, sigarasız oda istiyoruz..." />
              </div>

              <div className="field">
                <label>Teklif süresi</label>
                <input className="input" type="number" min={1} value={deadlineValue} onChange={(e) => setDeadlineValue(Number(e.target.value))} />
              </div>
              <div className="field">
                <label>Birim</label>
                <select className="input" value={deadlineUnit} onChange={(e) => setDeadlineUnit(e.target.value as DeadlineUnit)}>
                  <option value="minutes">dakika</option>
                  <option value="hours">saat</option>
                  <option value="days">gün</option>
                </select>
              </div>

              <div className="field">
                <label>Bütçe aralığı (ops.)</label>
                <div className="grid grid-cols-2 gap-2">
                  <input className="input" value={budgetMin} onChange={(e) => setBudgetMin(e.target.value)} placeholder="min ₺" />
                  <input className="input" value={budgetMax} onChange={(e) => setBudgetMax(e.target.value)} placeholder="max ₺" />
                </div>
              </div>
            </div>

            <div className="flex justify-end mt-3">
              <button className="btn-primary" disabled={saving}>
                {saving ? "Gönderiliyor..." : "Talebi gönder"}
              </button>
            </div>
          </section>
        </form>

        {/* Başarı animasyonu */}
        {sentOpen && (
          <div className="fixed inset-0 z-[99] flex items-center justify-center bg-black/70">
            <div className="successModal">
              <div className="flex items-center gap-3">
                <div className="okIcon">✅</div>
                <div>
                  <p className="text-slate-100 font-semibold text-lg">Talebiniz otelcilere gitti!</p>
                  <p className="text-slate-300 text-sm">
                    <b>{deadlineText(deadlineValue, deadlineUnit)}</b> içinde dönüş yapılacaktır.
                  </p>
                </div>
              </div>

              <div className="mt-4 h-2 rounded-full bg-slate-800 overflow-hidden">
                <div className="h-full bg-emerald-500 animate-bar" />
              </div>

              <p className="mt-3 text-[0.75rem] text-slate-400">Birazdan “Taleplerim” sayfasına yönlendiriliyorsun…</p>
            </div>
          </div>
        )}

        {/* Styles */}
        <style jsx global>{`
          .heroCard{
            border-radius: 16px;
            border: 1px solid rgba(51,65,85,1);
            background: radial-gradient(1200px 200px at 20% 0%, rgba(16,185,129,0.10), transparent 60%),
                        radial-gradient(1000px 200px at 80% 0%, rgba(56,189,248,0.08), transparent 60%),
                        rgba(2,6,23,0.65);
            padding: 18px;
            box-shadow: 0 18px 45px rgba(0,0,0,0.35);
          }
          .pill{
            display:inline-flex;align-items:center;
            border-radius:999px;padding:6px 10px;
            font-size:12px;font-weight:700;
            border:1px solid rgba(255,255,255,0.10);
            background: rgba(15,23,42,0.6);
            color:#e5e7eb;
          }
          .pill-sky{ border-color: rgba(56,189,248,0.35); background: rgba(56,189,248,0.10); color: rgba(186,230,253,1); }
          .pill-emerald{ border-color: rgba(16,185,129,0.35); background: rgba(16,185,129,0.10); color: rgba(167,243,208,1); }

          .miniStat{
            display:grid;grid-template-columns:repeat(3,1fr);
            gap:10px;
            padding:12px;
            border-radius:14px;
            border:1px solid rgba(51,65,85,1);
            background: rgba(2,6,23,0.55);
          }

          .stepCard{
            border-radius: 16px;
            border: 1px solid rgba(51,65,85,1);
            background: rgba(2,6,23,0.65);
            padding: 16px;
            box-shadow: 0 12px 34px rgba(0,0,0,0.30);
          }
          .stepTitle{
            display:flex;align-items:flex-start;gap:12px;
            margin-bottom: 12px;
          }
          .stepNo{
            width:28px;height:28px;border-radius:999px;
            display:flex;align-items:center;justify-content:center;
            background: rgba(16,185,129,0.12);
            border:1px solid rgba(16,185,129,0.25);
            color: rgba(167,243,208,1);
            font-weight:900;
            flex:0 0 auto;
          }

          .field label{
            display:block;
            font-size:12px;
            color: rgba(226,232,240,0.9);
            margin-bottom: 6px;
          }

          .input{
            width:100%;
            border-radius: 12px;
            background: rgba(15,23,42,0.72);
            border: 1px solid rgba(51,65,85,1);
            padding: 12px 12px;
            color: #e5e7eb;
            outline: none;
            font-size: 14px;
          }
          .input:focus{ border-color: rgba(16,185,129,0.7); }

          .softBox{
            border-radius: 14px;
            border: 1px solid rgba(51,65,85,1);
            background: rgba(2,6,23,0.55);
            padding: 14px;
          }

          .roomRow{
            display:grid;
            grid-template-columns: 70px 1fr;
            gap:10px;
            align-items:center;
          }

          .agePill{
            display:flex;align-items:center;gap:10px;
            border-radius: 999px;
            border: 1px solid rgba(51,65,85,1);
            background: rgba(2,6,23,0.55);
            padding: 8px 10px;
          }
          .ageInput{
            width:64px;
            border-radius: 10px;
            background: rgba(15,23,42,0.72);
            border: 1px solid rgba(51,65,85,1);
            padding: 6px 8px;
            color: #e5e7eb;
            outline:none;
            font-size: 12px;
          }

          .btn-soft{
            border-radius: 12px;
            border: 1px solid rgba(51,65,85,1);
            background: rgba(15,23,42,0.55);
            padding: 10px 12px;
            color: rgba(226,232,240,0.95);
            font-size: 12px;
            font-weight: 700;
          }
          .btn-soft:hover{ border-color: rgba(16,185,129,0.55); }

          .btn-primary{
            border-radius: 14px;
            background: rgba(16,185,129,1);
            color: rgba(2,6,23,1);
            padding: 12px 18px;
            font-weight: 900;
            font-size: 14px;
            box-shadow: 0 14px 34px rgba(16,185,129,0.15);
          }
          .btn-primary:hover{ filter: brightness(1.05); }
          .btn-primary:disabled{ opacity: .6; cursor:not-allowed; }

          .alert{ border-radius: 14px; padding: 12px 14px; border: 1px solid; font-size: 13px; }
          .alert-red{ border-color: rgba(239,68,68,0.35); background: rgba(239,68,68,0.10); color: rgba(254,202,202,1); }

          .successModal{
            width:100%;
            max-width: 460px;
            border-radius: 18px;
            border: 1px solid rgba(16,185,129,0.25);
            background: rgba(2,6,23,0.92);
            padding: 18px;
            box-shadow: 0 24px 60px rgba(0,0,0,0.55);
            animation: pop .18s ease-out both;
          }
          .okIcon{
            width:52px;height:52px;border-radius: 16px;
            display:flex;align-items:center;justify-content:center;
            background: rgba(16,185,129,0.12);
            border: 1px solid rgba(16,185,129,0.25);
            font-size: 24px;
          }

          @keyframes pop{
            from{ opacity:0; transform: translateY(10px) scale(0.98); }
            to{ opacity:1; transform: translateY(0) scale(1); }
          }
          @keyframes bar{ from{ width:0%; } to{ width:100%; } }
          .animate-bar{ animation: bar 1.3s linear both; }
        `}</style>
      </div>
    </Protected>
  );
}
