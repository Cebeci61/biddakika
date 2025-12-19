// app/guest/package-requests/new/page.tsx
"use client";

import { FormEvent, useMemo, useState } from "react";
import { Protected } from "@/components/Protected";
import { useAuth } from "@/context/AuthContext";
import { getFirestoreDb } from "@/lib/firebase/client";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { useRouter } from "next/navigation";

type IncludeKey = "hotel" | "transfer" | "tour" | "guide" | "insurance" | "car" | "rentalItem" | "extras";

type CarPolicyKey = "freeCancellation48h" | "instantApproval" | "creditCardDeposit";

type CarRental = {
  enabled: boolean;
  policies: Partial<Record<CarPolicyKey, boolean>>;
  driverAge?: number | null;
  licenseYears?: number | null;
  secondDriver?: boolean;
  dailyKmLimit?: string; // "∞" | "200" | "300" vb.
  fuelPolicy?: string;   // "Full to Full" vb.
  afterHours?: boolean;
  oneWay?: boolean;
  youngDriverFee?: string;

  pickupCity?: string;
  dropoffCity?: string;
  pickupDate?: string; // YYYY-MM-DD
  dropoffDate?: string;
  pickupTime?: string; // HH:mm
  dropoffTime?: string;
  vehicleClass?: string; // "Auto" vb.
};

type StayPlanItem = {
  city?: string;
  hotelPref?: string;
  checkIn?: string;
  checkOut?: string;
  people?: number;
  rooms?: number;
  roomType?: string;
  notes?: string;
};

type RentalItem = {
  name?: string;
  date?: string;
  time?: string;
  returnDate?: string;
  returnTime?: string;
  days?: number;
  qty?: number;
  notes?: string;
};

type TourItem = {
  tourName?: string;
  tourType?: "group" | "private";
  date?: string;
  time?: string;
  people?: number;
  notes?: string;
};

type TransferItem = {
  direction?: "oneway" | "roundtrip";
  from?: string;
  to?: string;
  date?: string;
  time?: string;
  notes?: string;
};

type ExtraCard = {
  key: string;
  title: string;
  priceHint?: number;
};

type ExtraSelected = {
  key: string;
  qty: number;
  date?: string;
  time?: string;
  days?: number;
  notes?: string;
};

function safeStr(v: any, fallback = "—") {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s.length ? s : fallback;
}

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function calcNights(from?: string, to?: string) {
  const a = parseDate(from);
  const b = parseDate(to);
  if (!a || !b) return 1;
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  const diff = Math.floor((b.getTime() - a.getTime()) / 86400000);
  return diff > 0 ? diff : 1;
}

function buildDateRange(from?: string, to?: string) {
  const a = parseDate(from);
  const b = parseDate(to);
  if (!a || !b) return [];
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);

  const days: string[] = [];
  const cur = new Date(a);
  let guard = 0;
  while (cur.getTime() <= b.getTime() && guard < 120) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
    guard++;
  }
  return days;
}
export default function GuestPackageRequestNewPage() {
  const { profile } = useAuth() as any;
  const db = getFirestoreDb();
  const router = useRouter();

  // 1) Tarih seçimi (ana)
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // 2) Paket başlık / şehir
  const [title, setTitle] = useState("");
  const [city, setCity] = useState("");
  const [district, setDistrict] = useState("");

  // 3) Kişi
  const [adults, setAdults] = useState(2);
  const [childrenCount, setChildrenCount] = useState(0);
  const [childrenAges, setChildrenAges] = useState<number[]>([]);

  // 4) Araç (opsiyonel)
  const [carRental, setCarRental] = useState<CarRental>({
    enabled: false,
    policies: { freeCancellation48h: true, instantApproval: true, creditCardDeposit: false },
    driverAge: 26,
    licenseYears: 3,
    secondDriver: false,
    dailyKmLimit: "∞",
    fuelPolicy: "Full to Full",
    afterHours: false,
    oneWay: false,
    youngDriverFee: "Auto",
    pickupCity: "",
    dropoffCity: "",
    pickupDate: "",
    dropoffDate: "",
    pickupTime: "09:30",
    dropoffTime: "17:30",
    vehicleClass: "Auto"
  });

  // 5) Konaklama planı (çoklu)
  const [stayDraft, setStayDraft] = useState<StayPlanItem>({
    city: "",
    hotelPref: "",
    checkIn: "",
    checkOut: "",
    people: 2,
    rooms: 1,
    roomType: "Standart",
    notes: ""
  });
  const [stays, setStays] = useState<StayPlanItem[]>([]);

  // 6) Kiralık eşya (çoklu)
  const [rentalDraft, setRentalDraft] = useState<RentalItem>({
    name: "",
    date: "",
    time: "10:00",
    returnDate: "",
    returnTime: "10:00",
    days: 1,
    qty: 1,
    notes: ""
  });
  const [rentalItems, setRentalItems] = useState<RentalItem[]>([]);

  // 7) Tur (çoklu)
  const [tourDraft, setTourDraft] = useState<TourItem>({
    tourName: "",
    tourType: "group",
    date: "",
    time: "10:00",
    people: 2,
    notes: ""
  });
  const [tours, setTours] = useState<TourItem[]>([]);

  // 8) Transfer (çoklu)
  const [transferDraft, setTransferDraft] = useState<TransferItem>({
    direction: "oneway",
    from: "",
    to: "",
    date: "",
    time: "09:00",
    notes: ""
  });
  const [transfers, setTransfers] = useState<TransferItem[]>([]);

  // 9) Ekstralar (kart seçim)
  const EXTRA_CARDS: ExtraCard[] = [
    { key: "balloon", title: "Balon Turu", priceHint: 500 },
    { key: "zipline", title: "Zipline", priceHint: 0 },
    { key: "museum", title: "Müze Bileti", priceHint: 250 },
    { key: "vipDinner", title: "Özel Akşam Yemeği", priceHint: 1500 }
  ];
  const [extraSelectedKeys, setExtraSelectedKeys] = useState<Record<string, boolean>>({});
  const [extraDraftDate, setExtraDraftDate] = useState("");
  const [extraDraftTime, setExtraDraftTime] = useState("10:00");
  const [extraDraftDays, setExtraDraftDays] = useState(1);
  const [extraDraftQty, setExtraDraftQty] = useState(1);
  const [extras, setExtras] = useState<ExtraSelected[]>([]);

  // 10) Genel not + bütçe
  const [notes, setNotes] = useState("");
  const [budgetMin, setBudgetMin] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [responseDeadlineMinutes, setResponseDeadlineMinutes] = useState(120);

  // Takvim: hangi date inputa yazacağız?
  const [activeDateField, setActiveDateField] = useState<string>(""); 
  // örnek: "car.pickupDate" / "stayDraft.checkIn" / "tourDraft.date" / "extraDraftDate" vb.

  const nights = useMemo(() => calcNights(dateFrom, dateTo), [dateFrom, dateTo]);
  const totalGuests = useMemo(() => adults + childrenCount, [adults, childrenCount]);

  const calendarDays = useMemo(() => buildDateRange(dateFrom, dateTo), [dateFrom, dateTo]);

  function syncChildrenAges(nextCount: number) {
    setChildrenCount(nextCount);
    setChildrenAges((prev) => {
      const copy = [...prev];
      while (copy.length < nextCount) copy.push(7);
      while (copy.length > nextCount) copy.pop();
      return copy;
    });
  }

  function applyDateToActive(dateStr: string) {
    if (!activeDateField) return;

    switch (activeDateField) {
      case "car.pickupDate":
        setCarRental((p) => ({ ...p, pickupDate: dateStr }));
        return;
      case "car.dropoffDate":
        setCarRental((p) => ({ ...p, dropoffDate: dateStr }));
        return;

      case "stayDraft.checkIn":
        setStayDraft((p) => ({ ...p, checkIn: dateStr }));
        return;
      case "stayDraft.checkOut":
        setStayDraft((p) => ({ ...p, checkOut: dateStr }));
        return;

      case "rentalDraft.date":
        setRentalDraft((p) => ({ ...p, date: dateStr }));
        return;
      case "rentalDraft.returnDate":
        setRentalDraft((p) => ({ ...p, returnDate: dateStr }));
        return;

      case "tourDraft.date":
        setTourDraft((p) => ({ ...p, date: dateStr }));
        return;

      case "transferDraft.date":
        setTransferDraft((p) => ({ ...p, date: dateStr }));
        return;

      case "extraDraftDate":
        setExtraDraftDate(dateStr);
        return;

      default:
        return;
    }
  }

  // UI state
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);

    if (!profile?.uid) return setErr("Giriş bilgisi bulunamadı.");
    if (!dateFrom || !dateTo) return setErr("Tarih seçimi zorunlu.");
    if (!city.trim()) return setErr("Şehir zorunlu.");
    if (adults < 1) return setErr("Yetişkin sayısı en az 1 olmalı.");

    try {
      setSaving(true);

      // include flags: misafirin yaptığı her şeye göre otomatik
      const includeFlags: Record<IncludeKey, boolean> = {
        hotel: stays.length > 0,
        car: carRental.enabled,
        rentalItem: rentalItems.length > 0,
        tour: tours.length > 0,
        transfer: transfers.length > 0,
        extras: extras.length > 0,
        guide: tours.some((t) => (t.tourType ?? "") === "private") || false,
        insurance: false
      };

      await addDoc(collection(db, "packageRequests"), {
        createdByRole: "guest",
        createdById: profile.uid,
        createdByName: profile.displayName ?? profile.email ?? "Misafir",
        createdByPhone: profile.guestProfile?.phone ?? null,

        title: title.trim() || null,

        city: city.trim(),
        district: district.trim() || null,

        dateFrom,
        dateTo,
        nights,

        paxAdults: adults,
        paxChildren: childrenCount,
        childrenAges,

        include: includeFlags,

        budgetMin: budgetMin ? Number(budgetMin) : null,
        budgetMax: budgetMax ? Number(budgetMax) : null,
        responseDeadlineMinutes,

        notes: notes.trim() || null,

        // ✅ detay modüller (acentanın eksiksiz görmesi için)
        carRental,
        stays,
        rentalItems,
        tours,
        transfers,
        extras,

        status: "open",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      setMsg("Paket talebin oluşturuldu. Sadece acentalar bu talebi görebilir ve teklif verebilir.");
      setTimeout(() => router.push("/guest/offers"), 700);
    } catch (e: any) {
      console.error(e);
      setErr(e?.message || "Paket talebi kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  // küçük helperlar
  function addStay() {
    if (!stayDraft.checkIn || !stayDraft.checkOut) return setErr("Konaklama planında giriş/çıkış seç.");
    setStays((prev) => [...prev, { ...stayDraft }]);
    setStayDraft({ city: "", hotelPref: "", checkIn: "", checkOut: "", people: 2, rooms: 1, roomType: "Standart", notes: "" });
  }
  function clearStays() {
    setStays([]);
  }

  function addRentalItem() {
    if (!rentalDraft.name) return setErr("Kiralık eşya adı yaz.");
    setRentalItems((prev) => [...prev, { ...rentalDraft }]);
    setRentalDraft({ name: "", date: "", time: "10:00", returnDate: "", returnTime: "10:00", days: 1, qty: 1, notes: "" });
  }
  function clearRentalItems() {
    setRentalItems([]);
  }

  function addTour() {
    if (!tourDraft.tourName) return setErr("Tur seç/isim yaz.");
    setTours((prev) => [...prev, { ...tourDraft }]);
    setTourDraft({ tourName: "", tourType: "group", date: "", time: "10:00", people: 2, notes: "" });
  }
  function clearTours() {
    setTours([]);
  }

  function addTransfer() {
    if (!transferDraft.from || !transferDraft.to) return setErr("Transfer nereden/nereye zorunlu.");
    setTransfers((prev) => [...prev, { ...transferDraft }]);
    setTransferDraft({ direction: "oneway", from: "", to: "", date: "", time: "09:00", notes: "" });
  }
  function clearTransfers() {
    setTransfers([]);
  }

  function addSelectedExtras() {
    const chosen = Object.entries(extraSelectedKeys).filter(([, v]) => v).map(([k]) => k);
    if (chosen.length === 0) return setErr("Ekstra seç.");
    const rows: ExtraSelected[] = chosen.map((k) => ({
      key: k,
      qty: extraDraftQty,
      date: extraDraftDate || null || undefined,
      time: extraDraftTime || null || undefined,
      days: extraDraftDays,
      notes: ""
    }));
    setExtras((prev) => [...prev, ...rows]);
    setExtraSelectedKeys({});
  }
  function clearExtras() {
    setExtras([]);
  }
  return (
    <Protected allowedRoles={["guest"]}>
      <div className="container-page space-y-6">
        <section className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-100">Paket Talebi Oluştur</h1>
          <p className="text-sm text-slate-300 max-w-3xl">
            Bu paket talebini <b>sadece sisteme kayıtlı acentalar</b> görür ve teklif verir. Misafir olarak yaptığın tüm seçimler veritabanına kaydedilir.
          </p>
        </section>

        {(msg || err) && (
          <div className="space-y-2">
            {msg && <div className="alert-success">{msg}</div>}
            {err && <div className="alert-error">{err}</div>}
          </div>
        )}

        <form onSubmit={handleSubmit} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
          {/* SOL: FORMLAR */}
          <div className="space-y-4">

            {/* 1) Tarih Seçimi */}
            <div className="card">
              <h2 className="card-title">1) Tarih Seçimi</h2>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="label">Başlangıç</label>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="input"
                    onFocus={() => setActiveDateField("")}
                  />
                </div>
                <div className="space-y-1">
                  <label className="label">Bitiş</label>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="input"
                    onFocus={() => setActiveDateField("")}
                  />
                </div>
              </div>
              <p className="muted">Gece: <b className="text-slate-100">{nights}</b></p>
            </div>

            {/* 2) Paket genel */}
            <div className="card">
              <h2 className="card-title">2) Paket Genel</h2>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1 md:col-span-3">
                  <label className="label">Başlık (opsiyonel)</label>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} className="input" placeholder="Örn: Trabzon + Uzungöl + Transfer" />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="label">Şehir</label>
                  <input value={city} onChange={(e) => setCity(e.target.value)} className="input" placeholder="Örn: Trabzon" />
                </div>
                <div className="space-y-1">
                  <label className="label">İlçe (opsiyonel)</label>
                  <input value={district} onChange={(e) => setDistrict(e.target.value)} className="input" placeholder="Örn: Ortahisar" />
                </div>
              </div>
            </div>

            {/* 3) Araç Alış/Bırakış */}
            <div className="card">
              <div className="flex items-center justify-between gap-3">
                <h2 className="card-title">3) Araç Alış / Bırakış</h2>
                <label className="flex items-center gap-2 text-xs text-slate-200">
                  <input
                    type="checkbox"
                    checked={carRental.enabled}
                    onChange={(e) => setCarRental((p) => ({ ...p, enabled: e.target.checked }))}
                  />
                  Araç dahil
                </label>
              </div>

              {!carRental.enabled ? (
                <p className="muted">Araç istemiyorsan kapalı bırak.</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    <span className={`chip ${carRental.policies.freeCancellation48h ? "chip-on" : ""}`}
                      onClick={() => setCarRental((p) => ({ ...p, policies: { ...p.policies, freeCancellation48h: !p.policies.freeCancellation48h } }))}
                    >Ücretsiz iptal (48s)</span>
                    <span className={`chip ${carRental.policies.instantApproval ? "chip-on" : ""}`}
                      onClick={() => setCarRental((p) => ({ ...p, policies: { ...p.policies, instantApproval: !p.policies.instantApproval } }))}
                    >Anında onay</span>
                    <span className={`chip ${carRental.policies.creditCardDeposit ? "chip-on" : ""}`}
                      onClick={() => setCarRental((p) => ({ ...p, policies: { ...p.policies, creditCardDeposit: !p.policies.creditCardDeposit } }))}
                    >Kredi kartı depozitosu</span>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 mt-3">
                    <Field label="Sürücü yaşı">
                      <input type="number" value={carRental.driverAge ?? 26} onChange={(e) => setCarRental((p) => ({ ...p, driverAge: Number(e.target.value) }))} className="input" />
                    </Field>
                    <Field label="Ehliyet yılı">
                      <input type="number" value={carRental.licenseYears ?? 3} onChange={(e) => setCarRental((p) => ({ ...p, licenseYears: Number(e.target.value) }))} className="input" />
                    </Field>

                    <Field label="2. sürücü">
                      <select value={carRental.secondDriver ? "yes" : "no"} onChange={(e) => setCarRental((p) => ({ ...p, secondDriver: e.target.value === "yes" }))} className="input">
                        <option value="no">Hayır</option>
                        <option value="yes">Evet</option>
                      </select>
                    </Field>

                    <Field label="Günlük KM limiti">
                      <select value={carRental.dailyKmLimit ?? "∞"} onChange={(e) => setCarRental((p) => ({ ...p, dailyKmLimit: e.target.value }))} className="input">
                        <option value="∞">∞</option>
                        <option value="200">200</option>
                        <option value="300">300</option>
                        <option value="500">500</option>
                      </select>
                    </Field>

                    <Field label="Yakıt politikası">
                      <select value={carRental.fuelPolicy ?? "Full to Full"} onChange={(e) => setCarRental((p) => ({ ...p, fuelPolicy: e.target.value }))} className="input">
                        <option value="Full to Full">Full to Full</option>
                        <option value="Same to Same">Same to Same</option>
                        <option value="Full to Empty">Full to Empty</option>
                      </select>
                    </Field>

                    <Field label="Mesai dışı teslim">
                      <select value={carRental.afterHours ? "yes" : "no"} onChange={(e) => setCarRental((p) => ({ ...p, afterHours: e.target.value === "yes" }))} className="input">
                        <option value="no">Hayır</option>
                        <option value="yes">Evet</option>
                      </select>
                    </Field>

                    <Field label="Tek yön bırakma">
                      <select value={carRental.oneWay ? "yes" : "no"} onChange={(e) => setCarRental((p) => ({ ...p, oneWay: e.target.value === "yes" }))} className="input">
                        <option value="no">Hayır</option>
                        <option value="yes">Evet</option>
                      </select>
                    </Field>

                    <Field label="Genç sürücü ücreti">
                      <select value={carRental.youngDriverFee ?? "Auto"} onChange={(e) => setCarRental((p) => ({ ...p, youngDriverFee: e.target.value }))} className="input">
                        <option value="Auto">Auto</option>
                        <option value="Var">Var</option>
                        <option value="Yok">Yok</option>
                      </select>
                    </Field>
                  </div>

                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 mt-3">
                    <p className="text-xs text-slate-200 font-semibold mb-2">Alış / bırakış</p>
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label="Araç alış (şehir)">
                        <input value={carRental.pickupCity ?? ""} onChange={(e) => setCarRental((p) => ({ ...p, pickupCity: e.target.value }))} className="input" placeholder="Örn: Trabzon" />
                      </Field>
                      <Field label="Araç bırakış (şehir)">
                        <input value={carRental.dropoffCity ?? ""} onChange={(e) => setCarRental((p) => ({ ...p, dropoffCity: e.target.value }))} className="input" placeholder="Örn: Rize" />
                      </Field>

                      <Field label="Alış saati">
                        <input type="time" value={carRental.pickupTime ?? "09:30"} onChange={(e) => setCarRental((p) => ({ ...p, pickupTime: e.target.value }))} className="input" />
                      </Field>
                      <Field label="Bırakış saati">
                        <input type="time" value={carRental.dropoffTime ?? "17:30"} onChange={(e) => setCarRental((p) => ({ ...p, dropoffTime: e.target.value }))} className="input" />
                      </Field>

                      <Field label="Alış günü">
                        <input
                          type="date"
                          value={carRental.pickupDate ?? ""}
                          onChange={(e) => setCarRental((p) => ({ ...p, pickupDate: e.target.value }))}
                          onFocus={() => setActiveDateField("car.pickupDate")}
                          className="input"
                        />
                      </Field>
                      <Field label="Bırakış günü">
                        <input
                          type="date"
                          value={carRental.dropoffDate ?? ""}
                          onChange={(e) => setCarRental((p) => ({ ...p, dropoffDate: e.target.value }))}
                          onFocus={() => setActiveDateField("car.dropoffDate")}
                          className="input"
                        />
                      </Field>

                      <Field label="Araç sınıfı">
                        <input value={carRental.vehicleClass ?? "Auto"} onChange={(e) => setCarRental((p) => ({ ...p, vehicleClass: e.target.value }))} className="input" placeholder="Auto" />
                      </Field>
                    </div>
                    <p className="muted mt-2">Seçimlerine göre teklif acentadan gelecektir.</p>
                  </div>
                </>
              )}
            </div>

            {/* 4) Konaklama Planı */}
            <div className="card">
              <h2 className="card-title">4) Konaklama Planı</h2>

              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Otel (şehir/yer)">
                    <input value={stayDraft.city ?? ""} onChange={(e) => setStayDraft((p) => ({ ...p, city: e.target.value }))} className="input" placeholder="Örn: Trabzon" />
                  </Field>
                  <Field label="Otel tercihi (opsiyonel)">
                    <input value={stayDraft.hotelPref ?? ""} onChange={(e) => setStayDraft((p) => ({ ...p, hotelPref: e.target.value }))} className="input" placeholder="Örn: Merkezde / deniz manzarası" />
                  </Field>

                  <Field label="Giriş">
                    <input type="date" value={stayDraft.checkIn ?? ""} onChange={(e) => setStayDraft((p) => ({ ...p, checkIn: e.target.value }))} onFocus={() => setActiveDateField("stayDraft.checkIn")} className="input" />
                  </Field>
                  <Field label="Çıkış">
                    <input type="date" value={stayDraft.checkOut ?? ""} onChange={(e) => setStayDraft((p) => ({ ...p, checkOut: e.target.value }))} onFocus={() => setActiveDateField("stayDraft.checkOut")} className="input" />
                  </Field>

                  <Field label="Kişi">
                    <input type="number" value={stayDraft.people ?? 2} onChange={(e) => setStayDraft((p) => ({ ...p, people: Number(e.target.value) }))} className="input" />
                  </Field>
                  <Field label="Oda">
                    <input type="number" value={stayDraft.rooms ?? 1} onChange={(e) => setStayDraft((p) => ({ ...p, rooms: Number(e.target.value) }))} className="input" />
                  </Field>

                  <Field label="Oda tipi">
                    <select value={stayDraft.roomType ?? "Standart"} onChange={(e) => setStayDraft((p) => ({ ...p, roomType: e.target.value }))} className="input">
                      <option>Standart</option>
                      <option>Aile</option>
                      <option>Deluxe</option>
                      <option>Suit</option>
                    </select>
                  </Field>

                  <Field label="Not (opsiyonel)">
                    <input value={stayDraft.notes ?? ""} onChange={(e) => setStayDraft((p) => ({ ...p, notes: e.target.value }))} className="input" placeholder="Örn: sigarasız oda" />
                  </Field>
                </div>

                <div className="flex gap-2 mt-3">
                  <button type="button" onClick={addStay} className="btn-primary">Plana Ekle</button>
                  <button type="button" onClick={clearStays} className="btn-secondary">Planı Temizle</button>
                </div>

                <p className="muted mt-2">{stays.length ? `${stays.length} konaklama eklendi.` : "Henüz konaklama eklenmedi."}</p>
              </div>

              {stays.length > 0 && (
                <div className="mt-3 space-y-2">
                  {stays.map((s, idx) => (
                    <div key={idx} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-200">
                      <b>#{idx + 1}</b> {safeStr(s.city)} • {safeStr(s.checkIn)} – {safeStr(s.checkOut)} • {safeStr(s.roomType)}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 5) Kiralık Eşya */}
            <div className="card">
              <h2 className="card-title">5) Kiralık Eşya</h2>

              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <p className="muted mb-2">Eşya kiralamada gün sayısı alış/iade tarihine göre otomatik hesaplanır.</p>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Eşya">
                    <input value={rentalDraft.name ?? ""} onChange={(e) => setRentalDraft((p) => ({ ...p, name: e.target.value }))} className="input" placeholder="Örn: Bebek koltuğu" />
                  </Field>

                  <Field label="Alış günü">
                    <input type="date" value={rentalDraft.date ?? ""} onChange={(e) => setRentalDraft((p) => ({ ...p, date: e.target.value }))} onFocus={() => setActiveDateField("rentalDraft.date")} className="input" />
                  </Field>

                  <Field label="Alış saat">
                    <input type="time" value={rentalDraft.time ?? "10:00"} onChange={(e) => setRentalDraft((p) => ({ ...p, time: e.target.value }))} className="input" />
                  </Field>

                  <Field label="İade günü">
                    <input type="date" value={rentalDraft.returnDate ?? ""} onChange={(e) => setRentalDraft((p) => ({ ...p, returnDate: e.target.value }))} onFocus={() => setActiveDateField("rentalDraft.returnDate")} className="input" />
                  </Field>

                  <Field label="İade saat">
                    <input type="time" value={rentalDraft.returnTime ?? "10:00"} onChange={(e) => setRentalDraft((p) => ({ ...p, returnTime: e.target.value }))} className="input" />
                  </Field>

                  <Field label="Gün">
                    <input type="number" value={rentalDraft.days ?? 1} onChange={(e) => setRentalDraft((p) => ({ ...p, days: Number(e.target.value) }))} className="input" />
                  </Field>

                  <Field label="Adet">
                    <input type="number" value={rentalDraft.qty ?? 1} onChange={(e) => setRentalDraft((p) => ({ ...p, qty: Number(e.target.value) }))} className="input" />
                  </Field>
                </div>

                <div className="flex gap-2 mt-3">
                  <button type="button" onClick={addRentalItem} className="btn-primary">Ekle</button>
                  <button type="button" onClick={clearRentalItems} className="btn-secondary">Temizle</button>
                </div>
              </div>

              {rentalItems.length > 0 && (
                <div className="mt-3 space-y-2">
                  {rentalItems.map((it, idx) => (
                    <div key={idx} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-200">
                      <b>#{idx + 1}</b> {safeStr(it.name)} • {safeStr(it.date)} → {safeStr(it.returnDate)} • {safeStr(it.qty)} adet
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 6) Tur & Transfer */}
            <div className="card">
              <h2 className="card-title">6) Tur & Transfer</h2>

              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-3">
                <p className="text-sm font-semibold text-slate-100">Tur Ekle</p>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Tur">
                    <input value={tourDraft.tourName ?? ""} onChange={(e) => setTourDraft((p) => ({ ...p, tourName: e.target.value }))} className="input" placeholder="Örn: Uzungöl Turu" />
                  </Field>
                  <Field label="Tur tipi">
                    <select value={tourDraft.tourType ?? "group"} onChange={(e) => setTourDraft((p) => ({ ...p, tourType: e.target.value as any }))} className="input">
                      <option value="group">Grup</option>
                      <option value="private">Özel</option>
                    </select>
                  </Field>
                  <Field label="Tarih">
                    <input type="date" value={tourDraft.date ?? ""} onChange={(e) => setTourDraft((p) => ({ ...p, date: e.target.value }))} onFocus={() => setActiveDateField("tourDraft.date")} className="input" />
                  </Field>
                  <Field label="Saat">
                    <input type="time" value={tourDraft.time ?? "10:00"} onChange={(e) => setTourDraft((p) => ({ ...p, time: e.target.value }))} className="input" />
                  </Field>
                  <Field label="Kişi">
                    <input type="number" value={tourDraft.people ?? 2} onChange={(e) => setTourDraft((p) => ({ ...p, people: Number(e.target.value) }))} className="input" />
                  </Field>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={addTour} className="btn-primary">Tur Ekle</button>
                  <button type="button" onClick={clearTours} className="btn-secondary">Turları Kaldır</button>
                </div>

                <hr className="border-slate-800" />

                <p className="text-sm font-semibold text-slate-100">Transfer Ekle</p>
                <div className="flex gap-4 text-xs text-slate-200">
                  <label className="flex items-center gap-2">
                    <input type="radio" checked={(transferDraft.direction ?? "oneway") === "oneway"} onChange={() => setTransferDraft((p) => ({ ...p, direction: "oneway" }))} />
                    Tek yön
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" checked={(transferDraft.direction ?? "oneway") === "roundtrip"} onChange={() => setTransferDraft((p) => ({ ...p, direction: "roundtrip" }))} />
                    Çift yön
                  </label>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Nereden">
                    <input value={transferDraft.from ?? ""} onChange={(e) => setTransferDraft((p) => ({ ...p, from: e.target.value }))} className="input" placeholder="Örn: Trabzon Havalimanı" />
                  </Field>
                  <Field label="Nereye">
                    <input value={transferDraft.to ?? ""} onChange={(e) => setTransferDraft((p) => ({ ...p, to: e.target.value }))} className="input" placeholder="Örn: Otel" />
                  </Field>
                  <Field label="Tarih">
                    <input type="date" value={transferDraft.date ?? ""} onChange={(e) => setTransferDraft((p) => ({ ...p, date: e.target.value }))} onFocus={() => setActiveDateField("transferDraft.date")} className="input" />
                  </Field>
                  <Field label="Saat">
                    <input type="time" value={transferDraft.time ?? "09:00"} onChange={(e) => setTransferDraft((p) => ({ ...p, time: e.target.value }))} className="input" />
                  </Field>
                </div>

                <div className="flex gap-2">
                  <button type="button" onClick={addTransfer} className="btn-primary">Transfer Ekle</button>
                  <button type="button" onClick={clearTransfers} className="btn-secondary">Transf. Kaldır</button>
                </div>
              </div>

              {(tours.length > 0 || transfers.length > 0) && (
                <div className="mt-3 space-y-2">
                  {tours.map((t, i) => (
                    <div key={`t-${i}`} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-200">
                      <b>Tur</b> • {safeStr(t.tourName)} • {safeStr(t.date)} {safeStr(t.time)} • {safeStr(t.tourType)}
                    </div>
                  ))}
                  {transfers.map((t, i) => (
                    <div key={`tr-${i}`} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-200">
                      <b>Transfer</b> • {safeStr(t.from)} → {safeStr(t.to)} • {safeStr(t.date)} {safeStr(t.time)} • {safeStr(t.direction)}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 7) Ekstralar */}
            <div className="card">
              <h2 className="card-title">7) Ekstralar</h2>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-3">
                <p className="muted">Ekstra hizmetler “tahmini”dir; teklif sonrası netleşir.</p>

                <div className="grid gap-2 md:grid-cols-2">
                  {EXTRA_CARDS.map((c) => (
                    <label key={c.key} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 flex items-center justify-between gap-3">
                      <div className="space-y-0.5">
                        <p className="text-sm font-semibold text-slate-100">{c.title}</p>
                        <p className="text-[0.75rem] text-slate-400">{c.priceHint != null ? `${c.priceHint}₺` : "—"}</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={!!extraSelectedKeys[c.key]}
                        onChange={(e) => setExtraSelectedKeys((p) => ({ ...p, [c.key]: e.target.checked }))}
                      />
                    </label>
                  ))}
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <Field label="Adet">
                    <input type="number" value={extraDraftQty} onChange={(e) => setExtraDraftQty(Number(e.target.value))} className="input" />
                  </Field>
                  <Field label="Tarih">
                    <input type="date" value={extraDraftDate} onChange={(e) => setExtraDraftDate(e.target.value)} onFocus={() => setActiveDateField("extraDraftDate")} className="input" />
                  </Field>
                  <Field label="Saat">
                    <input type="time" value={extraDraftTime} onChange={(e) => setExtraDraftTime(e.target.value)} className="input" />
                  </Field>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Gün">
                    <input type="number" value={extraDraftDays} onChange={(e) => setExtraDraftDays(Number(e.target.value))} className="input" />
                  </Field>
                  <div className="flex items-end gap-2">
                    <button type="button" onClick={addSelectedExtras} className="btn-primary w-full">Seçili Ekstraları Ekle</button>
                    <button type="button" onClick={clearExtras} className="btn-secondary">Temizle</button>
                  </div>
                </div>

                <p className="muted">{extras.length ? `${extras.length} ekstra eklendi.` : "Henüz ekstra seçilmedi."}</p>
              </div>

              {extras.length > 0 && (
                <div className="mt-3 space-y-2">
                  {extras.map((x, i) => (
                    <div key={i} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-200">
                      <b>{x.key}</b> • {x.qty} adet • {safeStr(x.date)} {safeStr(x.time)} • {x.days} gün
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 8) Bütçe + Notlar + Gönder */}
            <div className="card">
              <h2 className="card-title">8) Notlar & Şartlar</h2>
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Bütçe min (ops.)">
                  <input value={budgetMin} onChange={(e) => setBudgetMin(e.target.value)} className="input" placeholder="₺" />
                </Field>
                <Field label="Bütçe max (ops.)">
                  <input value={budgetMax} onChange={(e) => setBudgetMax(e.target.value)} className="input" placeholder="₺" />
                </Field>
                <Field label="Cevap süresi">
                  <select value={responseDeadlineMinutes} onChange={(e) => setResponseDeadlineMinutes(Number(e.target.value))} className="input">
                    <option value={60}>60 dk</option>
                    <option value={120}>120 dk</option>
                    <option value={240}>240 dk</option>
                  </select>
                </Field>
              </div>

              <Field label="Genel not (misafir tüm istekleri)">
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="input h-28 text-xs" placeholder="Misafirin tüm detayları..." />
              </Field>

              <div className="flex justify-end gap-2">
                <button type="submit" disabled={saving} className="btn-primary">
                  {saving ? "Kaydediliyor..." : "Sepete ekle ve teklif al"}
                </button>
              </div>
            </div>
          </div>

          {/* SAĞ: ÖZET + TAKVİM */}
          <aside className="space-y-4 sticky top-20 h-fit">
            <div className="card">
              <h2 className="card-title">Özet</h2>
              <p className="text-sm text-slate-100 font-semibold">{safeStr(title, "Paket talebi")}</p>
              <p className="muted">{safeStr(city)}{district ? ` / ${district}` : ""}</p>
              <p className="muted">{safeStr(dateFrom)} – {safeStr(dateTo)} • <b className="text-slate-100">{nights}</b> gece</p>
              <p className="muted">{totalGuests} kişi • Y:{adults} • Ç:{childrenCount}</p>

              <div className="mt-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-[0.75rem] text-slate-400">Modül sayısı</p>
                <p className="text-slate-200 text-sm">
                  Konaklama: <b>{stays.length}</b> • Araç: <b>{carRental.enabled ? "var" : "yok"}</b> • Tur: <b>{tours.length}</b> • Transfer: <b>{transfers.length}</b> • Eşya: <b>{rentalItems.length}</b> • Ekstra: <b>{extras.length}</b>
                </p>
              </div>
            </div>

            <div className="card">
              <h2 className="card-title">Takvim</h2>
              <p className="muted">Bir güne tıklayınca, son odaklandığın tarih alanı otomatik dolar.</p>

              {!calendarDays.length ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-slate-400 text-sm">
                  Takvim için önce başlangıç ve bitiş tarihini seç.
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {calendarDays.slice(0, 60).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => applyDateToActive(d)}
                      className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-2 text-xs text-slate-200 hover:border-emerald-400 hover:bg-emerald-500/10"
                      title={`Seç: ${d}`}
                    >
                      {d.slice(8, 10)}.{d.slice(5, 7)}
                    </button>
                  ))}
                </div>
              )}

              <p className="muted mt-2">Aktif tarih alanı: <b className="text-slate-200">{activeDateField || "—"}</b></p>
            </div>
          </aside>
        </form>

        <style jsx global>{`
          .card {
            border-radius: 1rem;
            border: 1px solid rgba(51,65,85,1);
            background: rgba(2,6,23,0.75);
            padding: 1rem;
            box-shadow: 0 10px 30px rgba(0,0,0,0.35);
          }
          .card-title {
            font-size: 0.95rem;
            font-weight: 700;
            color: #e5e7eb;
            margin-bottom: 0.75rem;
          }
          .label { font-size: 0.75rem; color: #e5e7eb; }
          .muted { font-size: 0.75rem; color: rgba(148,163,184,1); margin-top: 0.35rem; }
          .input {
            width: 100%;
            border-radius: 0.5rem;
            background: rgba(15, 23, 42, 0.7);
            border: 1px solid rgba(51, 65, 85, 1);
            padding: 0.55rem 0.75rem;
            color: #e5e7eb;
            outline: none;
            font-size: 0.85rem;
          }
          .input:focus { border-color: rgba(52, 211, 153, 0.8); }
          .btn-primary {
            border-radius: 0.6rem;
            background: rgba(16,185,129,1);
            color: rgba(2,6,23,1);
            padding: 0.6rem 1rem;
            font-weight: 800;
            font-size: 0.85rem;
          }
          .btn-primary:hover { filter: brightness(1.05); }
          .btn-secondary {
            border-radius: 0.6rem;
            border: 1px solid rgba(51,65,85,1);
            background: rgba(15,23,42,0.6);
            color: rgba(226,232,240,1);
            padding: 0.6rem 1rem;
            font-weight: 700;
            font-size: 0.85rem;
          }
          .chip {
            user-select: none;
            cursor: pointer;
            border-radius: 999px;
            border: 1px solid rgba(51,65,85,1);
            padding: 0.35rem 0.6rem;
            font-size: 0.75rem;
            color: rgba(226,232,240,1);
            background: rgba(15,23,42,0.55);
          }
          .chip-on {
            border-color: rgba(16,185,129,0.45);
            background: rgba(16,185,129,0.10);
            color: rgba(167,243,208,1);
          }
          .alert-success {
            border-radius: 0.9rem;
            border: 1px solid rgba(16,185,129,0.35);
            background: rgba(16,185,129,0.12);
            padding: 0.75rem 1rem;
            color: rgba(167,243,208,1);
          }
          .alert-error {
            border-radius: 0.9rem;
            border: 1px solid rgba(239,68,68,0.35);
            background: rgba(239,68,68,0.12);
            padding: 0.75rem 1rem;
            color: rgba(254,202,202,1);
          }
        `}</style>
      </div>
    </Protected>
  );
}

function Field({ label, children }: { label: string; children: any }) {
  return (
    <div className="space-y-1">
      <label className="label">{label}</label>
      {children}
    </div>
  );
}
