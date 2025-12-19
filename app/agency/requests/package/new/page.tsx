"use client";

import React, { FormEvent, useMemo, useState } from "react";
import { Protected } from "@/components/Protected";
import { useAuth } from "@/context/AuthContext";
import { getFirestoreDb } from "@/lib/firebase/client";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { useRouter } from "next/navigation";

type DeadlineUnit = "minutes" | "hours" | "days";
type TransferType = "one_way" | "round_trip";
type FlightType = "none" | "domestic" | "international";

const BOARD_TYPES = [
  { key: "RO", label: "Sadece oda (RO)" },
  { key: "BB", label: "Oda + Kahvaltı (BB)" },
  { key: "HB", label: "Yarım pansiyon (HB)" },
  { key: "FB", label: "Tam pansiyon (FB)" },
  { key: "AI", label: "Her şey dahil (AI)" },
  { key: "UAI", label: "Ultra her şey dahil (UAI)" }
] as const;

const ROOM_TYPES = [
  { key: "standard", label: "Standart" },
  { key: "family", label: "Aile" },
  { key: "suite", label: "Suit" },
  { key: "deluxe", label: "Deluxe" },
  { key: "any", label: "Farketmez" }
] as const;

const CAR_CLASSES = [
  { key: "economy", label: "Ekonomi" },
  { key: "compact", label: "Compact" },
  { key: "sedan", label: "Sedan" },
  { key: "suv", label: "SUV" },
  { key: "vip", label: "VIP" },
  { key: "van", label: "Minivan" }
] as const;

const TOUR_TYPES = [
  { key: "nature", label: "Doğa" },
  { key: "city", label: "Şehir" },
  { key: "culture", label: "Kültür" },
  { key: "boat", label: "Tekne" },
  { key: "shopping", label: "Shopping" },
  { key: "custom", label: "Özel" }
] as const;

const EXTRAS = [
  { key: "breakfast_upgrade", label: "Kahvaltı upgrade" },
  { key: "late_checkout", label: "Late check-out" },
  { key: "early_checkin", label: "Early check-in" },
  { key: "baby_bed", label: "Bebek yatağı" },
  { key: "decor", label: "Oda süsleme" },
  { key: "insurance", label: "Sigorta (araç)" },
  { key: "sim", label: "SIM / eSIM" }
] as const;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function safeStr(v: any, fb = "—") {
  if (v === null || v === undefined) return fb;
  const s = String(v).trim();
  return s.length ? s : fb;
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
export default function AgencyPackageRequestNewPage() {
  const { profile } = useAuth() as any;
  const db = getFirestoreDb();
  const router = useRouter();
const [budgetMin, setBudgetMin] = useState("");
const [budgetMax, setBudgetMax] = useState("");

  // Paket meta
  const [title, setTitle] = useState("");
  const [city, setCity] = useState("");
  const [district, setDistrict] = useState("");

  // tarih + kişi
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [adults, setAdults] = useState(2);
  const [childrenCount, setChildrenCount] = useState(0);
  const [childrenAges, setChildrenAges] = useState<number[]>([]);

  // Konaklama planı (satır satır)
  const [stays, setStays] = useState<
    { hotelPref: string; checkIn: string; checkOut: string; boardType: string; roomType: string; roomsCount: number; note: string }[]
  >([{ hotelPref: "", checkIn: "", checkOut: "", boardType: "BB", roomType: "standard", roomsCount: 1, note: "" }]);

  // Rent-a-car
  const [carEnabled, setCarEnabled] = useState(false);
  const [carClass, setCarClass] = useState<(typeof CAR_CLASSES)[number]["key"]>("economy");
  const [carPickupCity, setCarPickupCity] = useState("");
  const [carDropoffCity, setCarDropoffCity] = useState("");
  const [carPickupDate, setCarPickupDate] = useState("");
  const [carDropoffDate, setCarDropoffDate] = useState("");
  const [carNote, setCarNote] = useState("");

  // Transfer
  const [transferEnabled, setTransferEnabled] = useState(false);
  const [transferType, setTransferType] = useState<TransferType>("one_way");
  const [transferFrom, setTransferFrom] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [transferDate, setTransferDate] = useState("");
  const [transferTime, setTransferTime] = useState("");
  const [transferNote, setTransferNote] = useState("");

  // Uçak bileti
  const [flightType, setFlightType] = useState<FlightType>("none");
  const [flightFrom, setFlightFrom] = useState("");
  const [flightTo, setFlightTo] = useState("");
  const [flightDate, setFlightDate] = useState("");
  const [flightReturnDate, setFlightReturnDate] = useState("");
  const [flightNote, setFlightNote] = useState("");

  // Turlar (çoklu)
  const [tours, setTours] = useState<
    { type: string; title: string; count: number; day: string; time: string; pax: number; note: string }[]
  >([]);

  // Ekstralar
  const [extras, setExtras] = useState<string[]>([]);
  const [extrasNote, setExtrasNote] = useState("");

  // Genel not
  const [generalNote, setGeneralNote] = useState("");

  // cevap süresi
  const [deadlineValue, setDeadlineValue] = useState(24);
  const [deadlineUnit, setDeadlineUnit] = useState<DeadlineUnit>("hours");

  // UI
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sentOpen, setSentOpen] = useState(false);

  const nights = useMemo(() => (dateFrom && dateTo ? calcNights(dateFrom, dateTo) : 1), [dateFrom, dateTo]);
  const pax = useMemo(() => adults + childrenCount, [adults, childrenCount]);

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

  function addStay() {
    setStays((p) => [...p, { hotelPref: "", checkIn: "", checkOut: "", boardType: "BB", roomType: "standard", roomsCount: 1, note: "" }]);
  }
  function removeStay(i: number) {
    setStays((p) => p.filter((_, idx) => idx !== i));
  }
  function updateStay(i: number, patch: Partial<(typeof stays)[number]>) {
    setStays((p) => p.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  function addTour() {
    setTours((p) => [...p, { type: "nature", title: "", count: 1, day: "", time: "", pax, note: "" }]);
  }
  function removeTour(i: number) {
    setTours((p) => p.filter((_, idx) => idx !== i));
  }
  function updateTour(i: number, patch: Partial<(typeof tours)[number]>) {
    setTours((p) => p.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }

  function validate() {
    if (!profile?.uid) return "Giriş bilgisi yok.";
    if (!city.trim()) return "Şehir zorunlu.";
    if (!dateFrom || !dateTo) return "Başlangıç / bitiş tarihi zorunlu.";
    if (adults < 1) return "Yetişkin en az 1 olmalı.";
    if (!stays.length) return "En az 1 konaklama satırı eklemelisin.";
    // Konaklama satırlarında tarih yoksa bile paket olabilir (acentaya esneklik), ama en az 1 satır var.
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

      await addDoc(collection(db, "packageRequests"), {
        // ✅ agency paket
        createdByRole: "agency",
        createdById: profile.uid,
        createdByName: profile.displayName || profile.email || null,

        // ✅ %5 gösterim (teklifler görüntülenirken uygulanacak)
        agencyDiscountRate: 5,

        // temel
        title: title.trim() || null,
        city: city.trim(),
        district: district.trim() || null,

        dateFrom,
        dateTo,
        nights,
        paxAdults: adults,
        paxChildren: childrenCount,
        childrenAges,

        // konaklama planı
        stays: stays.map((s) => ({
          hotelPref: s.hotelPref.trim() || null,
          checkIn: s.checkIn || null,
          checkOut: s.checkOut || null,
          nights: s.checkIn && s.checkOut ? calcNights(s.checkIn, s.checkOut) : null,
          boardType: s.boardType,
          roomType: s.roomType,
          roomsCount: clamp(Number(s.roomsCount || 1), 1, 50),
          note: s.note.trim() || null
        })),

        // rent-a-car
        car: {
          enabled: carEnabled,
          carClass,
          pickupCity: carPickupCity.trim() || null,
          dropoffCity: carDropoffCity.trim() || null,
          pickupDate: carPickupDate || null,
          dropoffDate: carDropoffDate || null,
          note: carNote.trim() || null
        },

        // transfer
        transfer: {
          enabled: transferEnabled,
          type: transferType,
          from: transferFrom.trim() || null,
          to: transferTo.trim() || null,
          date: transferDate || null,
          time: transferTime || null,
          note: transferNote.trim() || null
        },

        // flight
        flight: {
          type: flightType,
          from: flightFrom.trim() || null,
          to: flightTo.trim() || null,
          date: flightDate || null,
          returnDate: flightReturnDate || null,
          note: flightNote.trim() || null
        },

        // tours
        tours: tours.map((t) => ({
          type: t.type,
          title: t.title.trim() || null,
          count: clamp(Number(t.count || 1), 1, 50),
          day: t.day || null,
          time: t.time || null,
          pax: clamp(Number(t.pax || pax), 1, 999),
          note: t.note.trim() || null
        })),

        // extras
        extras,
        extrasNote: extrasNote.trim() || null,

        // general
        generalNote: generalNote.trim() || null,

        // response
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
      setErr(e?.message || "Paket talebi kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Protected allowedRoles={["agency"]}>
      <div className="container-page space-y-6">

        <section className="heroCard">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl md:text-3xl font-semibold text-slate-100">
                  Acenta • Paket Talebi Oluştur
                </h1>
                <span className="pill pill-indigo">ACENTA PAKET TALEBİ</span>
                <span className="pill pill-emerald">Tekliflerde %5 avantajlı gösterim</span>
              </div>
              <p className="text-sm text-slate-300 max-w-4xl">
                Bu paket talebini diğer acentalar görür ve teklif verir. Paket içeriğini satır satır yaz: konaklama planı, araç, tur, transfer, uçak bileti ve ekstralar.
              </p>
            </div>

            <div className="hidden md:block miniStat">
              <div>
                <p className="text-[0.7rem] text-slate-400">Gece</p>
                <p className="text-slate-100 font-semibold">{dateFrom && dateTo ? nights : "—"}</p>
              </div>
              <div>
                <p className="text-[0.7rem] text-slate-400">Kişi</p>
                <p className="text-slate-100 font-semibold">{pax}</p>
              </div>
              <div>
                <p className="text-[0.7rem] text-slate-400">Konaklama satırı</p>
                <p className="text-slate-100 font-semibold">{stays.length}</p>
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
                <h2 className="text-sm font-semibold text-slate-100">Paket genel</h2>
                <p className="text-[0.75rem] text-slate-400">Başlık, şehir ve tarih aralığı.</p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-6">
              <div className="field md:col-span-3">
                <label>Başlık (ops.)</label>
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Örn: Trabzon 3 gece paket" />
              </div>

              <div className="field md:col-span-2">
                <label>Şehir</label>
                <input className="input" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Örn: Trabzon" />
              </div>

              <div className="field md:col-span-1">
                <label>İlçe (ops.)</label>
                <input className="input" value={district} onChange={(e) => setDistrict(e.target.value)} placeholder="Ortahisar" />
              </div>

              <div className="field md:col-span-2">
                <label>Başlangıç</label>
                <input className="input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div className="field md:col-span-2">
                <label>Bitiş</label>
                <input className="input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
              <div className="field md:col-span-2">
                <label>Toplam gece</label>
                <input className="input" readOnly value={dateFrom && dateTo ? String(nights) : ""} placeholder="Tarih seçince hesaplanır" />
              </div>

              <div className="field md:col-span-2">
                <label>Yetişkin</label>
                <input className="input" type="number" min={1} value={adults} onChange={(e) => setAdults(Number(e.target.value))} />
              </div>
              <div className="field md:col-span-2">
                <label>Çocuk</label>
                <input className="input" type="number" min={0} value={childrenCount} onChange={(e) => syncAges(Number(e.target.value))} />
              </div>
              <div className="field md:col-span-2">
                <label>Toplam kişi</label>
                <input className="input" readOnly value={String(pax)} />
              </div>

              {childrenCount > 0 && (
                <div className="md:col-span-6 softBox">
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
              )}
            </div>
          </section>

          {/* 2 */}
          <section className="stepCard">
            <div className="stepTitle">
              <span className="stepNo">2</span>
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Konaklama planı (satır satır)</h2>
                <p className="text-[0.75rem] text-slate-400">Birden fazla otel / farklı tarihler olabilir.</p>
              </div>
            </div>

            <div className="flex justify-end">
              <button type="button" onClick={addStay} className="btn-soft">+ Konaklama satırı ekle</button>
            </div>

            <div className="mt-3 space-y-3">
              {stays.map((s, i) => (
                <div key={i} className="softBox">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="text-sm font-semibold text-slate-100">Konaklama #{i + 1}</p>
                    {stays.length > 1 && (
                      <button type="button" className="btn-danger" onClick={() => removeStay(i)}>
                        Sil
                      </button>
                    )}
                  </div>

                  <div className="grid gap-3 md:grid-cols-6">
                    <div className="field md:col-span-2">
                      <label>Otel tercihi (ops.)</label>
                      <input className="input" value={s.hotelPref} onChange={(e) => updateStay(i, { hotelPref: e.target.value })} placeholder="Örn: Merkez / 4★ / butik..." />
                    </div>

                    <div className="field md:col-span-2">
                      <label>Giriş</label>
                      <input className="input" type="date" value={s.checkIn} onChange={(e) => updateStay(i, { checkIn: e.target.value })} />
                    </div>
                    <div className="field md:col-span-2">
                      <label>Çıkış</label>
                      <input className="input" type="date" value={s.checkOut} onChange={(e) => updateStay(i, { checkOut: e.target.value })} />
                    </div>

                    <div className="field md:col-span-2">
                      <label>Board</label>
                      <select className="input" value={s.boardType} onChange={(e) => updateStay(i, { boardType: e.target.value })}>
                        {BOARD_TYPES.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
                      </select>
                    </div>
                    <div className="field md:col-span-2">
                      <label>Oda tipi</label>
                      <select className="input" value={s.roomType} onChange={(e) => updateStay(i, { roomType: e.target.value })}>
                        {ROOM_TYPES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                      </select>
                    </div>
                    <div className="field md:col-span-2">
                      <label>Oda adedi</label>
                      <input className="input" type="number" min={1} value={s.roomsCount} onChange={(e) => updateStay(i, { roomsCount: Number(e.target.value) })} />
                    </div>

                    <div className="field md:col-span-6">
                      <label>Konaklama notu (ops.)</label>
                      <input className="input" value={s.note} onChange={(e) => updateStay(i, { note: e.target.value })} placeholder="Örn: deniz manzarası, sigarasız, erken giriş..." />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 3 */}
          <section className="stepCard">
            <div className="stepTitle">
              <span className="stepNo">3</span>
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Araç / Transfer / Uçak</h2>
                <p className="text-[0.75rem] text-slate-400">Paketin lojistiğini burada belirt.</p>
              </div>
            </div>

            {/* Car */}
            <div className="softBox">
              <label className="inline-flex items-center gap-2 text-sm text-slate-200">
                <input type="checkbox" checked={carEnabled} onChange={(e) => setCarEnabled(e.target.checked)} />
                Rent-a-car dahil
              </label>

              {carEnabled && (
                <div className="grid gap-3 md:grid-cols-6 mt-3">
                  <div className="field md:col-span-2">
                    <label>Araç sınıfı</label>
                    <select className="input" value={carClass} onChange={(e) => setCarClass(e.target.value as any)}>
                      {CAR_CLASSES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                  </div>
                  <div className="field md:col-span-2">
                    <label>Alış (şehir)</label>
                    <input className="input" value={carPickupCity} onChange={(e) => setCarPickupCity(e.target.value)} placeholder="Örn: Trabzon" />
                  </div>
                  <div className="field md:col-span-2">
                    <label>Bırakış (şehir)</label>
                    <input className="input" value={carDropoffCity} onChange={(e) => setCarDropoffCity(e.target.value)} placeholder="Örn: Rize" />
                  </div>
                  <div className="field md:col-span-3">
                    <label>Alış tarihi</label>
                    <input className="input" type="date" value={carPickupDate} onChange={(e) => setCarPickupDate(e.target.value)} />
                  </div>
                  <div className="field md:col-span-3">
                    <label>Bırakış tarihi</label>
                    <input className="input" type="date" value={carDropoffDate} onChange={(e) => setCarDropoffDate(e.target.value)} />
                  </div>
                  <div className="field md:col-span-6">
                    <label>Araç notu</label>
                    <input className="input" value={carNote} onChange={(e) => setCarNote(e.target.value)} placeholder="Örn: otomatik vites, depozito istemesin..." />
                  </div>
                </div>
              )}
            </div>

            {/* Transfer */}
            <div className="softBox mt-3">
              <label className="inline-flex items-center gap-2 text-sm text-slate-200">
                <input type="checkbox" checked={transferEnabled} onChange={(e) => setTransferEnabled(e.target.checked)} />
                Transfer dahil
              </label>

              {transferEnabled && (
                <div className="grid gap-3 md:grid-cols-6 mt-3">
                  <div className="field md:col-span-2">
                    <label>Transfer tipi</label>
                    <select className="input" value={transferType} onChange={(e) => setTransferType(e.target.value as any)}>
                      <option value="one_way">Tek yön</option>
                      <option value="round_trip">Çift yön</option>
                    </select>
                  </div>
                  <div className="field md:col-span-2">
                    <label>Nereden</label>
                    <input className="input" value={transferFrom} onChange={(e) => setTransferFrom(e.target.value)} placeholder="Örn: Havalimanı" />
                  </div>
                  <div className="field md:col-span-2">
                    <label>Nereye</label>
                    <input className="input" value={transferTo} onChange={(e) => setTransferTo(e.target.value)} placeholder="Örn: Otel" />
                  </div>
                  <div className="field md:col-span-3">
                    <label>Tarih</label>
                    <input className="input" type="date" value={transferDate} onChange={(e) => setTransferDate(e.target.value)} />
                  </div>
                  <div className="field md:col-span-3">
                    <label>Saat</label>
                    <input className="input" type="time" value={transferTime} onChange={(e) => setTransferTime(e.target.value)} />
                  </div>
                  <div className="field md:col-span-6">
                    <label>Transfer notu</label>
                    <input className="input" value={transferNote} onChange={(e) => setTransferNote(e.target.value)} placeholder="Örn: 2 valiz, çocuk koltuğu..." />
                  </div>
                </div>
              )}
            </div>

            {/* Flight */}
            <div className="softBox mt-3">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="field">
                  <label>Uçak bileti</label>
                  <select className="input" value={flightType} onChange={(e) => setFlightType(e.target.value as any)}>
                    <option value="none">Hayır</option>
                    <option value="domestic">Evet (Yurt içi)</option>
                    <option value="international">Evet (Yurt dışı)</option>
                  </select>
                </div>
                <div className="field">
                  <label>Nereden</label>
                  <input className="input" value={flightFrom} onChange={(e) => setFlightFrom(e.target.value)} placeholder="Örn: IST" />
                </div>
                <div className="field">
                  <label>Nereye</label>
                  <input className="input" value={flightTo} onChange={(e) => setFlightTo(e.target.value)} placeholder="Örn: TZX" />
                </div>
                {flightType !== "none" && (
                  <>
                    <div className="field">
                      <label>Gidiş tarihi</label>
                      <input className="input" type="date" value={flightDate} onChange={(e) => setFlightDate(e.target.value)} />
                    </div>
                    <div className="field">
                      <label>Dönüş tarihi (ops.)</label>
                      <input className="input" type="date" value={flightReturnDate} onChange={(e) => setFlightReturnDate(e.target.value)} />
                    </div>
                    <div className="field">
                      <label>Uçuş notu</label>
                      <input className="input" value={flightNote} onChange={(e) => setFlightNote(e.target.value)} placeholder="Örn: bagaj dahil, sabah uçuş..." />
                    </div>
                  </>
                )}
              </div>
            </div>
          </section>

          {/* 4 */}
          <section className="stepCard">
            <div className="stepTitle">
              <span className="stepNo">4</span>
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Turlar</h2>
                <p className="text-[0.75rem] text-slate-400">Tur sayısını, türünü ve kaç defa olacağını belirt.</p>
              </div>
            </div>

            <div className="flex justify-end">
              <button type="button" className="btn-soft" onClick={addTour}>+ Tur ekle</button>
            </div>

            {tours.length === 0 ? (
              <p className="text-sm text-slate-400 mt-3">Henüz tur eklenmedi.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {tours.map((t, i) => (
                  <div key={i} className="softBox">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="text-sm font-semibold text-slate-100">Tur #{i + 1}</p>
                      <button type="button" className="btn-danger" onClick={() => removeTour(i)}>Sil</button>
                    </div>

                    <div className="grid gap-3 md:grid-cols-6">
                      <div className="field md:col-span-2">
                        <label>Tur türü</label>
                        <select className="input" value={t.type} onChange={(e) => updateTour(i, { type: e.target.value })}>
                          {TOUR_TYPES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                        </select>
                      </div>
                      <div className="field md:col-span-2">
                        <label>Tur adı / başlık</label>
                        <input className="input" value={t.title} onChange={(e) => updateTour(i, { title: e.target.value })} placeholder="Örn: Uzungöl + Ayder" />
                      </div>
                      <div className="field md:col-span-2">
                        <label>Kaç defa?</label>
                        <input className="input" type="number" min={1} value={t.count} onChange={(e) => updateTour(i, { count: Number(e.target.value) })} />
                      </div>

                      <div className="field md:col-span-2">
                        <label>Tarih (ops.)</label>
                        <input className="input" type="date" value={t.day} onChange={(e) => updateTour(i, { day: e.target.value })} />
                      </div>
                      <div className="field md:col-span-2">
                        <label>Saat (ops.)</label>
                        <input className="input" type="time" value={t.time} onChange={(e) => updateTour(i, { time: e.target.value })} />
                      </div>
                      <div className="field md:col-span-2">
                        <label>Kişi</label>
                        <input className="input" type="number" min={1} value={t.pax} onChange={(e) => updateTour(i, { pax: Number(e.target.value) })} />
                      </div>

                      <div className="field md:col-span-6">
                        <label>Tur notu</label>
                        <input className="input" value={t.note} onChange={(e) => updateTour(i, { note: e.target.value })} placeholder="Örn: öğle yemeği dahil olsun, rehber şart..." />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 5 */}
          <section className="stepCard">
            <div className="stepTitle">
              <span className="stepNo">5</span>
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Ekstralar, not ve cevap süresi</h2>
                <p className="text-[0.75rem] text-slate-400">Diğer acentalar belirlediğin süre içinde teklif verir.</p>
              </div>
            </div>

            <div className="softBox">
              <p className="text-xs text-slate-300 font-semibold mb-2">Ekstralar</p>
              <div className="grid gap-2 md:grid-cols-3">
                {EXTRAS.map((x) => (
                  <label key={x.key} className="flex items-center gap-2 text-xs text-slate-200">
                    <input type="checkbox" checked={extras.includes(x.key)} onChange={() => setExtras((p) => toggle(p, x.key))} />
                    {x.label}
                  </label>
                ))}
              </div>

              <div className="mt-3">
                <label className="text-xs text-slate-200">Ekstra notu</label>
                <input className="input mt-2" value={extrasNote} onChange={(e) => setExtrasNote(e.target.value)} placeholder="Örn: balon turu mutlaka olsun..." />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3 mt-3">
              <div className="field md:col-span-3">
                <label>Genel not</label>
                <textarea className="input h-28 text-sm" value={generalNote} onChange={(e) => setGeneralNote(e.target.value)} placeholder="Örn: Paket kurumsal, fatura kesilecek..." />
              </div>

              <div className="field">
                <label>Teklif süresi</label>
                <input className="input" type="number" min={1} value={deadlineValue} onChange={(e) => setDeadlineValue(Number(e.target.value))} />
              </div>
              <div className="field">
                <label>Birim</label>
                <select className="input" value={deadlineUnit} onChange={(e) => setDeadlineUnit(e.target.value as any)}>
                  <option value="minutes">dk</option>
                  <option value="hours">saat</option>
                  <option value="days">gün</option>
                </select>
              </div>
              <div className="field">
                <label>Bütçe (ops.)</label>
                <div className="grid grid-cols-2 gap-2">
                  <input className="input" value={budgetMin} onChange={(e) => setBudgetMin(e.target.value)} placeholder="min ₺" />
                  <input className="input" value={budgetMax} onChange={(e) => setBudgetMax(e.target.value)} placeholder="max ₺" />
                </div>
              </div>
            </div>

            <div className="flex justify-end mt-4">
              <button className="btn-primary" disabled={saving}>
                {saving ? "Gönderiliyor..." : "Paket talebini gönder"}
              </button>
            </div>
          </section>
        </form>

        {sentOpen && (
          <div className="fixed inset-0 z-[99] flex items-center justify-center bg-black/70">
            <div className="successModal">
              <div className="flex items-center gap-3">
                <div className="okIcon">✅</div>
                <div>
                  <p className="text-slate-100 font-semibold text-lg">Paket talebi gönderildi!</p>
                  <p className="text-slate-300 text-sm">
                    <b>{deadlineText(deadlineValue, deadlineUnit)}</b> içinde diğer acentalar dönüş yapacaktır.
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

        <style jsx global>{`
          .heroCard{
            border-radius: 16px;
            border: 1px solid rgba(51,65,85,1);
            background: radial-gradient(1200px 220px at 20% 0%, rgba(16,185,129,0.10), transparent 60%),
                        radial-gradient(1000px 220px at 80% 0%, rgba(99,102,241,0.10), transparent 60%),
                        rgba(2,6,23,0.65);
            padding: 18px;
            box-shadow: 0 18px 45px rgba(0,0,0,0.35);
          }
          .pill{
            display:inline-flex;align-items:center;
            border-radius:999px;padding:6px 10px;
            font-size:12px;font-weight:900;
            border:1px solid rgba(255,255,255,0.10);
            background: rgba(15,23,42,0.6);
            color:#e5e7eb;
          }
          .pill-indigo{ border-color: rgba(99,102,241,0.35); background: rgba(99,102,241,0.12); color: rgba(199,210,254,1); }
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
          .stepTitle{ display:flex;align-items:flex-start;gap:12px;margin-bottom: 12px; }
          .stepNo{
            width:28px;height:28px;border-radius:999px;
            display:flex;align-items:center;justify-content:center;
            background: rgba(16,185,129,0.12);
            border:1px solid rgba(16,185,129,0.25);
            color: rgba(167,243,208,1);
            font-weight:900;
            flex:0 0 auto;
          }

          .field label{ display:block;font-size:12px;color: rgba(226,232,240,0.9);margin-bottom:6px; }
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

          .agePill{
            display:flex;align-items:center;gap:10px;
            border-radius: 999px;
            border: 1px solid rgba(51,65,85,1);
            background: rgba(2,6,23,0.55);
            padding: 8px 10px;
          }
          .ageInput{
            width:64px;border-radius: 10px;
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
            font-weight: 800;
          }
          .btn-soft:hover{ border-color: rgba(16,185,129,0.55); }

          .btn-danger{
            border-radius: 12px;
            border: 1px solid rgba(239,68,68,0.30);
            background: rgba(239,68,68,0.10);
            padding: 10px 12px;
            color: rgba(254,202,202,1);
            font-size: 12px;
            font-weight: 900;
          }

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
            max-width: 520px;
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

          @keyframes pop{ from{ opacity:0; transform: translateY(10px) scale(0.98);} to{ opacity:1; transform: translateY(0) scale(1);} }
          @keyframes bar{ from{ width:0%; } to{ width:100%; } }
          .animate-bar{ animation: bar 1.3s linear both; }
        `}</style>
      </div>
    </Protected>
  );
}
