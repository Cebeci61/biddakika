"use client";

import { useEffect, useMemo, useState } from "react";
import { COLLECTIONS, tsToDate } from "./firestoreAdmin";
import { useRealtimeList } from "./useAdminRealtime";
import { doc, getDoc, getFirestore, updateDoc } from "firebase/firestore";
import { getAuth, sendPasswordResetEmail } from "firebase/auth";

type AnyObj = Record<string, any>;

/** =========================
 *  🔧 AYARLAR (TEK YER)
 *  ========================= */
const PAGE_SIZE = 20;

// Admin komisyon oranı (bookings’de komisyon alanı olmadığı için buradan hesaplıyoruz)
// Örn: %10 => 0.10
const COMMISSION_RATE = 0.1;

// Liste limitleri (Firestore take <= 5000 olmalı)
const TAKE_USERS = 3000;
const TAKE_BOOKINGS = 5000;
const TAKE_REQUESTS = 5000;
const TAKE_OFFERS = 5000;

/** =========================
 *  🔧 FIELD MAP (SENİN VERİNE GÖRE)
 *  ========================= */
const MAP = {
  users: {
    role: "role",
    displayName: "displayName",
    email: "email",
    phone: "phone",
    city: "city",
    district: "district",
    isActive: "isActive",
    deletedAt: "deletedAt", // soft delete
    createdAt: "createdAt",
  
    adminNote: "adminNote",
    adminTags: "adminTags",
  },

  bookings: {
    createdAt: "createdAt",
    status: "status",
    currency: "currency",
    city: "city",
    district: "district",
    checkIn: "checkIn",
    checkOut: "checkOut",
    adults: "adults",
    childrenCount: "childrenCount",
    totalPrice: "totalPrice",

    guestId: "guestId",
    guestName: "guestName",
    guestEmail: "guestEmail",
    guestPhone: "guestPhone",

    hotelId: "hotelId",
    hotelName: "hotelName",

    requestId: "requestId",
    offerId: "offerId",

    paymentMethod: "paymentMethod",
    paymentStatus: "paymentStatus",

    roomBreakdown: "roomBreakdown", // array
  },

  // requests koleksiyonunda senin önceki yapında: guestId + city/district + date/time + notes vb vardı
  requests: {
    createdAt: "createdAt",
    status: "status",
    city: "city",
    district: "district",
    date: "date",
    time: "time",
    notes: "notes",

    guestId: "guestId",
    createdById: "createdById",
  },

  // offers koleksiyonunda: requestId + hotelId + priceHistory/timeline + isHidden + price/currency
  offers: {
    createdAt: "createdAt",
    status: "status",
    requestId: "requestId",
    isHidden: "isHidden",
    currency: "currency",

    hotelId: "hotelId",
    hotelName: "hotelName",
    agencyId: "agencyId",
    agencyName: "agencyName",

    price: "price",
    totalPrice: "totalPrice",
    priceHistory: "priceHistory",
    timeline: "timeline",
  },
} as const;

function f(obj: AnyObj, key: string) {
  return obj?.[key];
}
function num(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function moneyTry(v: number) {
  const n = Math.round((num(v) || 0) * 100) / 100;
  return `₺${n.toLocaleString("tr-TR")}`;
}
function money(v: number, currency?: string) {
  const cur = (currency || "TRY").toUpperCase();
  const sym = cur === "USD" ? "$" : cur === "EUR" ? "€" : "₺";
  const n = Math.round((num(v) || 0) * 100) / 100;
  return `${sym}${n.toLocaleString("tr-TR")}`;
}
function getCommissionFromBooking(b: any) {
  // 1) Direkt amount varsa onu kullan
  const amountRaw = b?.commissionAmount ?? b?.commission ?? b?.adminCommissionAmount;
  const amount = Number(amountRaw);
  if (Number.isFinite(amount) && amount >= 0) {
    return { amount, rate: null as number | null };
  }

  // 2) Rate/Percent varsa totalPrice üzerinden hesapla
  const rateRaw = b?.commissionRate ?? b?.commissionPercent ?? b?.commissionPct;
  const rate = Number(rateRaw);
  const total = Number(b?.totalPrice ?? b?.total ?? 0);

  if (Number.isFinite(rate) && rate >= 0 && Number.isFinite(total) && total >= 0) {
    return { amount: (total * rate) / 100, rate };
  }

  // 3) Yoksa 0 (fallback için aşağıda offer/hotel üzerinden ayrıca ekleyebiliriz)
  return { amount: 0, rate: null };
}

function maxDate(a: Date | null, b: Date | null) {
  if (!a) return b;
  if (!b) return a;
  return b > a ? b : a;
}
function badge(kind: "ok" | "bad" | "warn") {
  if (kind === "ok") return "rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-xs text-emerald-200";
  if (kind === "bad") return "rounded-lg border border-rose-400/30 bg-rose-400/10 px-2 py-1 text-xs text-rose-200";
  return "rounded-lg border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-xs text-amber-200";
}
function roleBadge(role: string) {
  const r = (role || "").toLowerCase();
  if (r === "admin") return <span className={badge("warn")}>Admin</span>;
  if (r === "hotel") return <span className={badge("ok")}>Otel</span>;
  if (r === "agency") return <span className={badge("ok")}>Acenta</span>;
  if (r === "guest") return <span className={badge("bad")}>Misafir</span>;
  return <span className={badge("warn")}>{role || "-"}</span>;
}

type UserRole = "admin" | "hotel" | "agency" | "guest";

type Stats = {
  bookingsAsGuest: number; // misafir yaptığı
  bookingsAsHotel: number; // otelin aldığı iş
  requestsCount: number;   // talep
  offersCount: number;     // teklif

  spentTotal: number;      // misafir harcaması
  earnedTotal: number;     // otel kazancı (ciro)
  adminCommission: number; // admin komisyonu (rate ile)

  lastBookingAt: Date | null;
  lastRequestAt: Date | null;
  lastOfferAt: Date | null;

  // fallback iletişim/konum (profil boşsa)
  fallbackPhone?: string;
  fallbackCity?: string;
  fallbackDistrict?: string;
};

const EMPTY: Stats = {
  bookingsAsGuest: 0,
  bookingsAsHotel: 0,
  requestsCount: 0,
  offersCount: 0,
  spentTotal: 0,
  earnedTotal: 0,
  adminCommission: 0,
  lastBookingAt: null,
  lastRequestAt: null,
  lastOfferAt: null,
};

export default function UsersAccountingPanel() {
  // Realtime data
  const { rows: users, loading: ul, error: ue } = useRealtimeList<any>(COLLECTIONS.users, {
    createdAtField: MAP.users.createdAt,
    take: TAKE_USERS,
  });

  const { rows: bookings, loading: bl, error: be } = useRealtimeList<any>(COLLECTIONS.bookings, {
    createdAtField: MAP.bookings.createdAt,
    take: TAKE_BOOKINGS,
  });
    // =========================
  // ADMIN META ACTIONS
  // =========================
  async function saveAdminNote(uid: string, note: string) {
    const db = getFirestore();
    await updateDoc(doc(db, COLLECTIONS.users, uid), {
      [MAP.users.adminNote]: note,
      updatedAt: new Date(),
    } as any);
  }

  async function saveAdminTags(uid: string, tags: string[]) {
    const db = getFirestore();
    await updateDoc(doc(db, COLLECTIONS.users, uid), {
      [MAP.users.adminTags]: tags,
      updatedAt: new Date(),
    } as any);
  }


  const { rows: requests, loading: rl, error: re } = useRealtimeList<any>(COLLECTIONS.requests, {
    createdAtField: MAP.requests.createdAt,
    take: TAKE_REQUESTS,
  });

  const { rows: offers, loading: ol, error: oe } = useRealtimeList<any>(COLLECTIONS.offers, {
    createdAtField: MAP.offers.createdAt,
    take: TAKE_OFFERS,
  });

  const loading = ul || bl || rl || ol;

  // Filters
  const [q, setQ] = useState("");
  const [role, setRole] = useState<UserRole | "">("");
  const [status, setStatus] = useState<"" | "active" | "passive">("");
  const [city, setCity] = useState("");
  const [minAmount, setMinAmount] = useState<string>("");
  const [maxAmount, setMaxAmount] = useState<string>("");
  const [page, setPage] = useState(1);

  // Selection
  const [selected, setSelected] = useState<{ u: AnyObj; st: Stats } | null>(null);

  // Cities list (users)
  const cities = useMemo(() => {
    const set = new Set<string>();
    for (const u of users) {
      const c = String(f(u, MAP.users.city) ?? "").trim();
      if (c) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "tr"));
  }, [users]);

  /**
   * Build:
   * - statsMap: uid -> stats
   * - bookingByUid: uid -> booking list (guest/hotel)
   * - requestByUid: uid -> request list (guest)
   * - offerByUid: uid -> offer list (hotel/agency)
   */
  const { statsMap, bookingByUid, requestByUid, offerByUid } = useMemo(() => {
    const sm = new Map<string, Stats>();
    const bMap = new Map<string, AnyObj[]>();
    const rMap = new Map<string, AnyObj[]>();
    const oMap = new Map<string, AnyObj[]>();

    function S(uid: string) {
      const cur = sm.get(uid) ?? { ...EMPTY };
      sm.set(uid, cur);
      return cur;
    }
    function push(map: Map<string, AnyObj[]>, uid: string, item: AnyObj) {
      if (!uid) return;
      const arr = map.get(uid) ?? [];
      arr.push(item);
      map.set(uid, arr);
    }

    // BOOKINGS: guest + hotel
    for (const b of bookings) {
      const at = tsToDate(f(b, MAP.bookings.createdAt));
      const total = num(f(b, MAP.bookings.totalPrice));
      const cur = String(f(b, MAP.bookings.currency) ?? "TRY");
      const guestId = String(f(b, MAP.bookings.guestId) ?? "");
      const hotelId = String(f(b, MAP.bookings.hotelId) ?? "");

      const bookingCity = String(f(b, MAP.bookings.city) ?? "").trim();
      const bookingDistrict = String(f(b, MAP.bookings.district) ?? "").trim();
      const guestPhone = String(f(b, MAP.bookings.guestPhone) ?? "").trim();

      // guest stats
      if (guestId) {
        const st = S(guestId);
        st.bookingsAsGuest += 1;
        st.spentTotal += total;
        st.adminCommission += total * COMMISSION_RATE;
        st.lastBookingAt = maxDate(st.lastBookingAt, at);

        // fallback phone/city/district for guest
        if (!st.fallbackPhone && guestPhone) st.fallbackPhone = guestPhone;
        if (!st.fallbackCity && bookingCity) st.fallbackCity = bookingCity;
        if (!st.fallbackDistrict && bookingDistrict) st.fallbackDistrict = bookingDistrict;

        push(bMap, guestId, b);
      }

      // hotel stats
      if (hotelId) {
        const st = S(hotelId);
        st.bookingsAsHotel += 1;
        st.earnedTotal += total;
        st.adminCommission += total * COMMISSION_RATE;
        st.lastBookingAt = maxDate(st.lastBookingAt, at);

        // fallback location for hotel (en azından booking lokasyonu)
        if (!st.fallbackCity && bookingCity) st.fallbackCity = bookingCity;
        if (!st.fallbackDistrict && bookingDistrict) st.fallbackDistrict = bookingDistrict;

        push(bMap, hotelId, b);
      }

      // currency şimdilik TRY gibi; ekranda booking detayda currency ile göstereceğiz
      void cur;
    }

    // REQUESTS: guestId/createdById
    for (const r of requests) {
      const at = tsToDate(f(r, MAP.requests.createdAt));
      const createdBy = String(f(r, MAP.requests.guestId) ?? f(r, MAP.requests.createdById) ?? "");
      if (!createdBy) continue;

      const st = S(createdBy);
      st.requestsCount += 1;
      st.lastRequestAt = maxDate(st.lastRequestAt, at);

      // fallback location
      const rc = String(f(r, MAP.requests.city) ?? "").trim();
      const rd = String(f(r, MAP.requests.district) ?? "").trim();
      if (!st.fallbackCity && rc) st.fallbackCity = rc;
      if (!st.fallbackDistrict && rd) st.fallbackDistrict = rd;

      push(rMap, createdBy, r);
    }

    // OFFERS: hotelId/agencyId owner
    for (const o of offers) {
      const at = tsToDate(f(o, MAP.offers.createdAt));
      const hotelId = String(f(o, MAP.offers.hotelId) ?? "");
      const agencyId = String(f(o, MAP.offers.agencyId) ?? "");
      const owner = hotelId || agencyId;
      if (!owner) continue;

      const st = S(owner);
      st.offersCount += 1;
      st.lastOfferAt = maxDate(st.lastOfferAt, at);

      push(oMap, owner, o);
    }

    // Sort all lists desc by createdAt
    function sortByCreatedAtDesc(arr: AnyObj[], key: string) {
      return arr.sort(
        (a, b) =>
          (tsToDate(f(b, key))?.getTime() ?? 0) - (tsToDate(f(a, key))?.getTime() ?? 0)
      );
    }

    for (const [k, arr] of bMap) bMap.set(k, sortByCreatedAtDesc(arr, MAP.bookings.createdAt));
    for (const [k, arr] of rMap) rMap.set(k, sortByCreatedAtDesc(arr, MAP.requests.createdAt));
    for (const [k, arr] of oMap) oMap.set(k, sortByCreatedAtDesc(arr, MAP.offers.createdAt));

    return { statsMap: sm, bookingByUid: bMap, requestByUid: rMap, offerByUid: oMap };
  }, [bookings, requests, offers]);

  // Filtered users
  const filteredUsers = useMemo(() => {
    const minV = minAmount ? num(minAmount) : null;
    const maxV = maxAmount ? num(maxAmount) : null;

    return users.filter((u) => {
      const uid = String(u.id);
      const deletedAt = f(u, MAP.users.deletedAt);
      if (deletedAt) return false;

      const r = String(f(u, MAP.users.role) ?? "");
      const name = String(f(u, MAP.users.displayName) ?? "");
      const email = String(f(u, MAP.users.email) ?? "");
      const phone = String(f(u, MAP.users.phone) ?? "");

      const uCity = String(f(u, MAP.users.city) ?? "").trim();
      const uDistrict = String(f(u, MAP.users.district) ?? "").trim();

      const isActive = f(u, MAP.users.isActive);
      const active = isActive === false ? false : true;

      if (role && r !== role) return false;
      if (status === "active" && !active) return false;
      if (status === "passive" && active) return false;
      if (city && uCity !== city) return false;

      const st = statsMap.get(uid) ?? EMPTY;

      // min/max based on (earned+spent)
      const amount = st.earnedTotal + st.spentTotal;
      if (minV != null && amount < minV) return false;
      if (maxV != null && amount > maxV) return false;

      const text = `${uid} ${r} ${name} ${email} ${phone} ${uCity} ${uDistrict}`.toLowerCase();
      if (q && !text.includes(q.toLowerCase())) return false;

      return true;
    });
  }, [users, role, status, city, q, minAmount, maxAmount, statsMap]);

  // Reset page on filter change
  useEffect(() => {
    setPage(1);
  }, [q, role, status, city, minAmount, maxAmount]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedUsers = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredUsers.slice(start, start + PAGE_SIZE);
  }, [filteredUsers, safePage]);

  // Totals
  const totals = useMemo(() => {
    let earned = 0, spent = 0, adminCom = 0, jobs = 0, req = 0, off = 0, rez = 0;

    for (const u of filteredUsers) {
      const st = statsMap.get(String(u.id)) ?? EMPTY;
      earned += st.earnedTotal;
      spent += st.spentTotal;
      adminCom += st.adminCommission;
      jobs += st.bookingsAsHotel;
      rez += st.bookingsAsGuest;
      req += st.requestsCount;
      off += st.offersCount;
    }

    return { earned, spent, adminCom, jobs, rez, req, off };
  }, [filteredUsers, statsMap]);

  // Actions
  async function setUserActive(uid: string, active: boolean) {
    const db = getFirestore();
    await updateDoc(doc(db, COLLECTIONS.users, uid), {
      [MAP.users.isActive]: active,
      updatedAt: new Date(),
    } as any);
  }

  async function saveUserPhone(uid: string, phone: string) {
    const db = getFirestore();
    await updateDoc(doc(db, COLLECTIONS.users, uid), {
      [MAP.users.phone]: phone,
      updatedAt: new Date(),
    } as any);
  }

  async function softDeleteUser(uid: string) {
    const db = getFirestore();
    await updateDoc(doc(db, COLLECTIONS.users, uid), {
      [MAP.users.deletedAt]: new Date(),
      [MAP.users.isActive]: false,
      updatedAt: new Date(),
    } as any);
  }

  return (
    <div className="space-y-4">
      {/* KPI */}
      <div className="grid gap-3 md:grid-cols-7">
        <Kpi title="Rezervasyon" value={loading ? "-" : totals.rez.toLocaleString("tr-TR")} hint="misafir" />
        <Kpi title="İş" value={loading ? "-" : totals.jobs.toLocaleString("tr-TR")} hint="otel" />
        <Kpi title="Talep" value={loading ? "-" : totals.req.toLocaleString("tr-TR")} hint="requests" />
        <Kpi title="Teklif" value={loading ? "-" : totals.off.toLocaleString("tr-TR")} hint="offers" />
        <Kpi title="Kazanç" value={loading ? "-" : moneyTry(totals.earned)} hint="otel ciro" />
        <Kpi title="Harcama" value={loading ? "-" : moneyTry(totals.spent)} hint="misafir" />
        <Kpi title="Admin Komisyon" value={loading ? "-" : moneyTry(totals.adminCom)} hint={`%${Math.round(COMMISSION_RATE * 100)}`} />
      </div>

      {/* PRO FILTER BAR */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="grid gap-3 md:grid-cols-12">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ara: ad / email / tel / UID / şehir…"
            className="md:col-span-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-2 text-sm outline-none focus:border-white/20"
          />

          <select
            value={role}
            onChange={(e) => setRole(e.target.value as any)}
            className="md:col-span-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-white/20"
          >
            <option value="">Tüm Roller</option>
            <option value="hotel">Otel</option>
            <option value="agency">Acenta</option>
            <option value="guest">Misafir</option>
            <option value="admin">Admin</option>
          </select>

          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as any)}
            className="md:col-span-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-white/20"
          >
            <option value="">Tüm Durumlar</option>
            <option value="active">Sadece Aktif</option>
            <option value="passive">Sadece Pasif</option>
          </select>

          <select
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="md:col-span-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-white/20"
          >
            <option value="">Tüm Şehirler</option>
            {cities.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <input
            value={minAmount}
            onChange={(e) => setMinAmount(e.target.value)}
            placeholder="Min ₺"
            className="md:col-span-1 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-white/20"
          />
          <input
            value={maxAmount}
            onChange={(e) => setMaxAmount(e.target.value)}
            placeholder="Max ₺"
            className="md:col-span-1 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-white/20"
          />
        </div>

        <div className="mt-2 text-xs text-slate-400">
          {ue ? <span className="text-rose-300">Users Hata: {ue}</span> : null}
          {be ? <span className="ml-3 text-rose-300">Bookings Hata: {be}</span> : null}
          {re ? <span className="ml-3 text-rose-300">Requests Hata: {re}</span> : null}
          {oe ? <span className="ml-3 text-rose-300">Offers Hata: {oe}</span> : null}
        </div>
      </div>

      {/* TABLE */}
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
        <div className="overflow-x-auto">
          <table className="min-w-[1600px] w-full text-sm">
            <thead className="bg-white/[0.03] text-slate-300">
              <tr>
                <th className="p-3 text-left">UID</th>
                <th className="p-3 text-left">Durum</th>
                <th className="p-3 text-left">Rol</th>
                <th className="p-3 text-left">Kullanıcı</th>
                <th className="p-3 text-left">İletişim</th>
                <th className="p-3 text-left">Konum</th>

                <th className="p-3 text-left">Rez</th>
                <th className="p-3 text-left">İş</th>
                <th className="p-3 text-left">Talep</th>
                <th className="p-3 text-left">Teklif</th>

                <th className="p-3 text-left">Kazanç</th>
                <th className="p-3 text-left">Harcama</th>
                <th className="p-3 text-left">Adm Kom</th>

                <th className="p-3 text-right">İşlem</th>
              </tr>
            </thead>

            <tbody>
              {pagedUsers.map((u) => {
                const uid = String(u.id);
                const r = String(f(u, MAP.users.role) ?? "-");
                const name = String(f(u, MAP.users.displayName) ?? "-");
                const email = String(f(u, MAP.users.email) ?? "-");
                const phone = String(f(u, MAP.users.phone) ?? "").trim();
                const uCity = String(f(u, MAP.users.city) ?? "").trim();
                const uDistrict = String(f(u, MAP.users.district) ?? "").trim();

                const isActive = f(u, MAP.users.isActive);
                const active = isActive === false ? false : true;

                const st = statsMap.get(uid) ?? EMPTY;

                // iletişim fallback: guest için booking.guestPhone
                const phoneShow = phone || st.fallbackPhone || "";
                // konum fallback
                const cityShow = uCity || st.fallbackCity || "-";
                const districtShow = uDistrict || st.fallbackDistrict || "";

                return (
                  <tr key={uid} className="border-t border-white/10 hover:bg-white/[0.03]">
                    <td className="p-3 font-semibold">{uid}</td>
                    <td className="p-3">
                      <span className={active ? badge("ok") : badge("bad")}>
                        {active ? "Aktif" : "Pasif"}
                      </span>
                    </td>
                    <td className="p-3">{roleBadge(r)}</td>

                    <td className="p-3">
                      <div className="font-semibold">{name}</div>
                      <div className="text-xs text-slate-400">{email}</div>
                    </td>

                    <td className="p-3">
                      <div className="text-slate-200">
                        {phoneShow ? phoneShow : <span className="text-amber-200">Eksik</span>}
                      </div>
                      <div className="text-xs text-slate-400">{email}</div>
                    </td>

                    <td className="p-3">
                      {cityShow}{districtShow ? ` / ${districtShow}` : ""}
                    </td>

                    <td className="p-3">{st.bookingsAsGuest}</td>
                    <td className="p-3">{st.bookingsAsHotel}</td>
                    <td className="p-3">{st.requestsCount}</td>
                    <td className="p-3">{st.offersCount}</td>

                    <td className="p-3">{moneyTry(st.earnedTotal)}</td>
                    <td className="p-3">{moneyTry(st.spentTotal)}</td>
                    <td className="p-3">{moneyTry(st.adminCommission)}</td>

                    <td className="p-3">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => setSelected({ u, st })}
                          className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs hover:bg-white/[0.06]"
                        >
                          Detay
                        </button>
                        <button
                          onClick={() => setUserActive(uid, !active)}
                          className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs hover:bg-white/[0.06]"
                        >
                          {active ? "Pasif Yap" : "Aktif Yap"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {pagedUsers.length === 0 && (
                <tr>
                  <td colSpan={14} className="p-8 text-center text-slate-400">Kayıt yok.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 bg-white/[0.02] p-3">
          <div className="text-xs text-slate-400">
            Sayfa <b className="text-slate-100">{safePage}</b> / {totalPages} • Toplam:{" "}
            <b className="text-slate-100">{filteredUsers.length}</b>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setPage(1)}
              disabled={safePage === 1}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs disabled:opacity-40 hover:bg-white/[0.06]"
            >
              İlk
            </button>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs disabled:opacity-40 hover:bg-white/[0.06]"
            >
              Geri
            </button>

            {Array.from({ length: Math.min(totalPages, 12) }).map((_, i) => {
              const n = i + 1;
              return (
                <button
                  key={n}
                  onClick={() => setPage(n)}
                  className={[
                    "rounded-xl border px-3 py-2 text-xs",
                    n === safePage ? "border-white/20 bg-white/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]",
                  ].join(" ")}
                >
                  {n}
                </button>
              );
            })}
            {totalPages > 12 ? <span className="px-2 text-xs text-slate-400">…</span> : null}

            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs disabled:opacity-40 hover:bg-white/[0.06]"
            >
              İleri
            </button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={safePage === totalPages}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs disabled:opacity-40 hover:bg-white/[0.06]"
            >
              Son
            </button>
          </div>
        </div>
      </div>

      {/* DETAIL MODAL */}
      {selected && (
 <UserDetailUltraModal
  data={selected}
  bookings={bookingByUid.get(String(selected.u.id)) ?? []}
  requests={requestByUid.get(String(selected.u.id)) ?? []}
  offers={offerByUid.get(String(selected.u.id)) ?? []}
  onClose={() => setSelected(null)}
  onToggleActive={setUserActive}
  onSavePhone={saveUserPhone}
  onSoftDelete={softDeleteUser}
  onSaveAdminNote={saveAdminNote}
  onSaveAdminTags={saveAdminTags}
/>

      )}
    </div>
  );
}

/** =========================
 *  UI PIECES
 *  ========================= */
function Kpi({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
      <div className="text-xs text-slate-300">{title}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-slate-400">{hint}</div>
    </div>
  );
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-xs text-slate-400">{title}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function ListBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-2 text-xs text-slate-400">{title}</div>
      {children}
    </div>
  );
}

function MiniList({
  rows,
  render,
}: {
  rows: AnyObj[];
  render: (row: AnyObj) => React.ReactNode;
}) {
  if (!rows.length) return <div className="text-sm text-slate-400">Kayıt yok.</div>;
  return (
    <div className="max-h-[340px] space-y-2 overflow-auto pr-1">
      {rows.map((r) => (
        <div key={String(r.id)} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
          {render(r)}
        </div>
      ))}
    </div>
  );
}
function UserDetailUltraModal({
  data,
  bookings,
  requests,
  offers,
  onClose,
  onToggleActive,
  onSavePhone,
  onSoftDelete,
  onSaveAdminNote,
  onSaveAdminTags,
}: {
  data: { u: AnyObj; st: Stats };
  bookings: AnyObj[];
  requests: AnyObj[];
  offers: AnyObj[];
  onClose: () => void;
  onToggleActive: (uid: string, active: boolean) => Promise<void>;
  onSavePhone: (uid: string, phone: string) => Promise<void>;
  onSoftDelete: (uid: string) => Promise<void>;
  onSaveAdminNote: (uid: string, note: string) => Promise<void>;
  onSaveAdminTags: (uid: string, tags: string[]) => Promise<void>;
}) {
  const { u, st } = data;

  const uid = String(u?.id ?? "");
  const role = String(f(u, MAP.users.role) ?? "-");
  const name = String(f(u, MAP.users.displayName) ?? "-");
  const email = String(f(u, MAP.users.email) ?? "-");

  const userPhone = String(f(u, MAP.users.phone) ?? "").trim();
  const userCity = String(f(u, MAP.users.city) ?? "").trim();
  const userDistrict = String(f(u, MAP.users.district) ?? "").trim();

  const isActive = f(u, MAP.users.isActive);
  const active = isActive === false ? false : true;

  const cityShow = userCity || st.fallbackCity || "";
  const districtShow = userDistrict || st.fallbackDistrict || "";

  const [tab, setTab] = useState<"overview" | "bookings" | "requests" | "offers" | "ledger">("overview");

  // Phone
  const [phone, setPhone] = useState(userPhone || st.fallbackPhone || "");

  // Admin meta
  const initialNote = String(f(u, MAP.users.adminNote) ?? "");
  const initialTags = Array.isArray(f(u, MAP.users.adminTags)) ? (f(u, MAP.users.adminTags) as string[]) : [];

  const [adminNote, setAdminNote] = useState(initialNote);
  const [tags, setTags] = useState<string[]>(initialTags);

  const [tagInput, setTagInput] = useState("");

  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset password
  async function resetPassword() {
    if (!email || email === "-") return alert("Email yok. Reset maili gönderilemez.");
    if (!confirm("Şifre sıfırlama maili gönderilsin mi?")) return;
    if (!confirm("Emin misin? Bu kullanıcıya reset maili gidecek.")) return;

    try {
      const auth = getAuth();
      await sendPasswordResetEmail(auth, email);
      alert("Şifre sıfırlama maili gönderildi.");
    } catch (e: any) {
      alert("Hata: " + (e?.message || e));
    }
  }

  const whatsappLink = phone ? `https://wa.me/${phone.replace(/\D/g, "")}` : "";
  const mapsLink =
    cityShow || districtShow
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${cityShow} ${districtShow}`)}`
      : "";

  // ===== Aylık cari (ledger) =====
  // role’a göre: guest => harcama, hotel/agency => kazanç (bu sistemde hotel kazancı booking.totalPrice üzerinden)
  const ledgerRows = useMemo(() => {
    const m: Record<string, { count: number; earned: number; spent: number; adminCom: number }> = {};

    for (const b of bookings) {
      const at = tsToDate(f(b, MAP.bookings.createdAt));
      if (!at) continue;
      const key = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}`;

      const total = num(f(b, MAP.bookings.totalPrice));
      const adminCom = total * COMMISSION_RATE;

      if (!m[key]) m[key] = { count: 0, earned: 0, spent: 0, adminCom: 0 };
      m[key].count += 1;
      m[key].adminCom += adminCom;

      const r = (role || "").toLowerCase();
      if (r === "guest") m[key].spent += total;
      else m[key].earned += total;
    }

    const arr = Object.entries(m)
      .map(([month, v]) => ({ month, ...v }))
      .sort((a, b) => (a.month < b.month ? 1 : -1)); // desc

    return arr;
  }, [bookings, role]);

  const totals = useMemo(() => {
    const earned = ledgerRows.reduce((s, x) => s + x.earned, 0);
    const spent = ledgerRows.reduce((s, x) => s + x.spent, 0);
    const adminCom = ledgerRows.reduce((s, x) => s + x.adminCom, 0);
    const count = ledgerRows.reduce((s, x) => s + x.count, 0);
    return { earned, spent, adminCom, count };
  }, [ledgerRows]);

  function togglePresetTag(t: string) {
    setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }
  function addCustomTag() {
    const t = tagInput.trim();
    if (!t) return;
    setTags((prev) => (prev.includes(t) ? prev : [...prev, t]));
    setTagInput("");
  }
  function removeTag(t: string) {
    setTags((prev) => prev.filter((x) => x !== t));
  }

  async function saveMeta() {
    await onSaveAdminNote(uid, adminNote);
    await onSaveAdminTags(uid, tags);
    alert("Admin notu/etiketler kaydedildi.");
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 p-4 md:p-10">
      <div className="mx-auto max-w-6xl overflow-hidden rounded-2xl border border-white/10 bg-[#070A12]">
        {/* HEADER */}
        <div className="flex flex-col gap-3 border-b border-white/10 p-4 md:flex-row md:items-center md:justify-between md:p-6">
          <div>
            <div className="text-xs text-slate-400">Kullanıcı Paneli</div>
            <div className="mt-1 text-xl font-semibold">
              {name} <span className="ml-2">{roleBadge(role)}</span>{" "}
              <span className="ml-2">
                <span className={active ? badge("ok") : badge("bad")}>{active ? "Aktif" : "Pasif"}</span>
              </span>
            </div>
            <div className="mt-1 text-xs text-slate-400">
              UID: <span className="text-slate-200">{uid}</span> • Email:{" "}
              <span className="text-slate-200">{email}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <a
              href={`mailto:${email}`}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm hover:bg-white/[0.06]"
            >
              Mail
            </a>

            {whatsappLink ? (
              <a
                href={whatsappLink}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm hover:bg-white/[0.06]"
              >
                WhatsApp
              </a>
            ) : null}

            {mapsLink ? (
              <a
                href={mapsLink}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm hover:bg-white/[0.06]"
              >
                Harita
              </a>
            ) : null}

            <button
              onClick={() => onToggleActive(uid, !active)}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm hover:bg-white/[0.06]"
            >
              {active ? "Pasife Al" : "Aktife Al"}
            </button>

            <button
              onClick={resetPassword}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm hover:bg-white/[0.06]"
            >
              Şifre Sıfırla
            </button>

            <button
              onClick={onClose}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm hover:bg-white/[0.06]"
            >
              Kapat
            </button>
          </div>
        </div>

        {/* TABS */}
        <div className="border-b border-white/10 bg-white/[0.02] px-4 py-2 md:px-6">
          <div className="flex flex-wrap gap-2">
            <TabBtn active={tab === "overview"} onClick={() => setTab("overview")}>Özet</TabBtn>
            <TabBtn active={tab === "bookings"} onClick={() => setTab("bookings")}>Rezervasyonlar</TabBtn>
            <TabBtn active={tab === "requests"} onClick={() => setTab("requests")}>Talepler</TabBtn>
            <TabBtn active={tab === "offers"} onClick={() => setTab("offers")}>Teklifler</TabBtn>
            <TabBtn active={tab === "ledger"} onClick={() => setTab("ledger")}>Muhasebe</TabBtn>
          </div>
        </div>

        {/* BODY */}
        <div className="p-4 md:p-6 space-y-4">
          {/* OVERVIEW */}
          {tab === "overview" && (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                <Box title="İletişim & Konum">
                  <div className="text-sm text-slate-200">Telefon: <b>{phone || "Eksik"}</b></div>
                  <div className="mt-1 text-xs text-slate-400">
                    Konum: {cityShow || "-"} {districtShow ? ` / ${districtShow}` : ""}
                  </div>

                  <div className="mt-3 flex gap-2">
                    <input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="Telefon ekle/güncelle"
                      className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-white/20"
                    />
                    <button
                      onClick={() => onSavePhone(uid, phone)}
                      className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm hover:bg-white/[0.06]"
                    >
                      Kaydet
                    </button>
                  </div>
                </Box>

                <Box title="Aktivite Özet">
                  <div className="text-sm text-slate-200">Rezervasyon: <b>{st.bookingsAsGuest}</b></div>
                  <div className="text-sm text-slate-200">İş: <b>{st.bookingsAsHotel}</b></div>
                  <div className="text-sm text-slate-200">Talep: <b>{st.requestsCount}</b></div>
                  <div className="text-sm text-slate-200">Teklif: <b>{st.offersCount}</b></div>
                  <div className="mt-2 text-xs text-slate-400">
                    Son İşlem: {st.lastBookingAt ? st.lastBookingAt.toLocaleString("tr-TR") : "-"}
                  </div>
                </Box>

                <Box title="Muhasebe Özet">
                  <div className="text-sm text-slate-200">Toplam: <b>{totals.count}</b> kayıt</div>
                  <div className="text-sm text-slate-200">Kazanç: <b>{moneyTry(totals.earned)}</b></div>
                  <div className="text-sm text-slate-200">Harcama: <b>{moneyTry(totals.spent)}</b></div>
                  <div className="text-sm text-slate-200">Admin Komisyon: <b>{moneyTry(totals.adminCom)}</b></div>
                </Box>
              </div>

              {/* Admin Note + Tags */}
              <div className="grid gap-3 md:grid-cols-2">
                <Box title="Admin Notu">
                  <textarea
                    value={adminNote}
                    onChange={(e) => setAdminNote(e.target.value)}
                    placeholder="Admin notu yaz (VIP, sorun, aranacak, takip...)"
                    className="min-h-[110px] w-full resize-none rounded-xl border border-white/10 bg-black/20 p-3 text-sm outline-none focus:border-white/20"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={saveMeta}
                      className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm hover:bg-white/[0.06]"
                    >
                      Kaydet
                    </button>
                  </div>
                </Box>

                <Box title="Etiketler">
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => togglePresetTag("VIP")} className={tags.includes("VIP") ? ChipActive() : Chip()}>
                      VIP
                    </button>
                    <button onClick={() => togglePresetTag("SORUNLU")} className={tags.includes("SORUNLU") ? ChipActive() : Chip()}>
                      Sorunlu
                    </button>
                    <button onClick={() => togglePresetTag("TAKIP")} className={tags.includes("TAKIP") ? ChipActive() : Chip()}>
                      Takip
                    </button>
                  </div>

                  <div className="mt-3 flex gap-2">
                    <input
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      placeholder="Özel etiket ekle"
                      className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-white/20"
                    />
                    <button
                      onClick={addCustomTag}
                      className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm hover:bg-white/[0.06]"
                    >
                      Ekle
                    </button>
                    <button
                      onClick={saveMeta}
                      className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm hover:bg-white/[0.06]"
                    >
                      Kaydet
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {tags.length === 0 ? (
                      <div className="text-sm text-slate-400">Etiket yok.</div>
                    ) : (
                      tags.map((t) => (
                        <span key={t} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-1 text-xs">
                          {t}
                          <button onClick={() => removeTag(t)} className="text-slate-400 hover:text-slate-100">✕</button>
                        </span>
                      ))
                    )}
                  </div>
                </Box>
              </div>

              {/* Dangerous actions */}
              <Box title="Kullanıcı Silme (Soft Delete)">
                <div className="text-sm text-slate-300">
                  Silme geri dönüşü zor. 2 adımlı onay var.
                </div>

                {!confirmDelete ? (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="mt-3 rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-200 hover:bg-rose-400/20"
                  >
                    Kullanıcıyı Sil
                  </button>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={async () => {
                        if (!confirm("Son kez soruyorum: Bu kullanıcı soft-delete yapılsın mı?")) return;
                        await onSoftDelete(uid);
                        onClose();
                      }}
                      className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-200 hover:bg-rose-400/20"
                    >
                      Eminim, Sil
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm hover:bg-white/[0.06]"
                    >
                      Vazgeç
                    </button>
                  </div>
                )}
              </Box>
            </>
          )}

          {/* BOOKINGS TAB */}
          {tab === "bookings" && (
            <Box title={`Rezervasyonlar / İşler (${bookings.length})`}>
              <div className="grid gap-2">
                {bookings.length === 0 ? (
                  <div className="text-sm text-slate-400">Kayıt yok.</div>
                ) : (
                  bookings.slice(0, 200).map((b) => {
                    const at = tsToDate(f(b, MAP.bookings.createdAt));
                    const cur = String(f(b, MAP.bookings.currency) ?? "TRY");
                    const total = num(f(b, MAP.bookings.totalPrice));
                    const c = String(f(b, MAP.bookings.city) ?? "");
                    const d = String(f(b, MAP.bookings.district) ?? "");
                    const hotelName = String(f(b, MAP.bookings.hotelName) ?? "");
                    const payMethod = String(f(b, MAP.bookings.paymentMethod) ?? "");
                    const payStatus = String(f(b, MAP.bookings.paymentStatus) ?? "");
                    return (
                      <div key={String(b.id)} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold">{money(total, cur)}</div>
                            <div className="text-xs text-slate-400">
                              {hotelName ? `${hotelName} • ` : ""}{c}{d ? ` / ${d}` : ""} • {payMethod}/{payStatus}
                            </div>
                          </div>
                          <div className="text-xs text-slate-500">{at ? at.toLocaleString("tr-TR") : "-"}</div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </Box>
          )}

          {/* REQUESTS TAB */}
          {tab === "requests" && (
            <Box title={`Talepler (${requests.length})`}>
              <div className="grid gap-2">
                {requests.length === 0 ? (
                  <div className="text-sm text-slate-400">Kayıt yok.</div>
                ) : (
                  requests.slice(0, 200).map((r) => {
                    const at = tsToDate(f(r, MAP.requests.createdAt));
                    const c = String(f(r, MAP.requests.city) ?? "");
                    const d = String(f(r, MAP.requests.district) ?? "");
                    const stt = String(f(r, MAP.requests.status) ?? "");
                    const date = String(f(r, MAP.requests.date) ?? "");
                    const time = String(f(r, MAP.requests.time) ?? "");
                    return (
                      <div key={String(r.id)} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold">{c}{d ? ` / ${d}` : ""}</div>
                            <div className="text-xs text-slate-400">{stt || "-"} • {date} {time}</div>
                          </div>
                          <div className="text-xs text-slate-500">{at ? at.toLocaleString("tr-TR") : "-"}</div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </Box>
          )}

          {/* OFFERS TAB */}
          {tab === "offers" && (
            <Box title={`Teklifler (${offers.length})`}>
              <div className="grid gap-2">
                {offers.length === 0 ? (
                  <div className="text-sm text-slate-400">Kayıt yok.</div>
                ) : (
                  offers.slice(0, 200).map((o) => {
                    const at = tsToDate(f(o, MAP.offers.createdAt));
                    const cur = String(f(o, MAP.offers.currency) ?? "TRY");
                    const price = num(f(o, MAP.offers.totalPrice) ?? f(o, MAP.offers.price));
                    const hidden = Boolean(f(o, MAP.offers.isHidden));
                    const reqId = String(f(o, MAP.offers.requestId) ?? "-");
                    return (
                      <div key={String(o.id)} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold">{money(price, cur)}</div>
                            <div className="text-xs text-slate-400">
                              Talep: {reqId} • {hidden ? "Gizli" : "Görünür"}
                            </div>
                          </div>
                          <div className="text-xs text-slate-500">{at ? at.toLocaleString("tr-TR") : "-"}</div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </Box>
          )}

          {/* LEDGER TAB */}
          {tab === "ledger" && (
            <Box title="Aylık Cari">
              <div className="text-xs text-slate-400 mb-3">
                Role’a göre: Misafir → Harcama, Otel/Acenta → Kazanç.
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-[700px] w-full text-sm">
                  <thead className="text-slate-300">
                    <tr className="border-b border-white/10">
                      <th className="p-2 text-left">Ay</th>
                      <th className="p-2 text-left">Kayıt</th>
                      <th className="p-2 text-left">Kazanç</th>
                      <th className="p-2 text-left">Harcama</th>
                      <th className="p-2 text-left">Admin Komisyon</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerRows.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-4 text-slate-400">Kayıt yok.</td>
                      </tr>
                    ) : (
                      ledgerRows.map((r) => (
                        <tr key={r.month} className="border-b border-white/10">
                          <td className="p-2 font-semibold">{r.month}</td>
                          <td className="p-2">{r.count}</td>
                          <td className="p-2">{moneyTry(r.earned)}</td>
                          <td className="p-2">{moneyTry(r.spent)}</td>
                          <td className="p-2">{moneyTry(r.adminCom)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                  <div className="text-xs text-slate-400">Toplam Kayıt</div>
                  <div className="text-lg font-semibold">{totals.count}</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                  <div className="text-xs text-slate-400">Toplam Kazanç</div>
                  <div className="text-lg font-semibold">{moneyTry(totals.earned)}</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                  <div className="text-xs text-slate-400">Toplam Admin Komisyon</div>
                  <div className="text-lg font-semibold">{moneyTry(totals.adminCom)}</div>
                </div>
              </div>
            </Box>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- small UI helpers inside same file ---------- */
function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={[
        "rounded-xl border px-3 py-2 text-sm transition",
        active ? "border-white/20 bg-white/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function Chip() {
  return "rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1 text-xs hover:bg-white/[0.06]";
}
function ChipActive() {
  return "rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-200 hover:bg-emerald-400/20";
}

/** =========================
 *  ULTRA MODAL (Premium++)
 *  ========================= */

/** =========================
 *  Booking Detail Modal (SUPER)
 *  ========================= */
function BookingDetailModal({ booking, onClose }: { booking: AnyObj; onClose: () => void }) {
  const at = tsToDate(f(booking, MAP.bookings.createdAt));
  const cur = String(f(booking, MAP.bookings.currency) ?? "TRY");
  const total = num(f(booking, MAP.bookings.totalPrice));
  const city = String(f(booking, MAP.bookings.city) ?? "-");
  const district = String(f(booking, MAP.bookings.district) ?? "-");
  const status = String(f(booking, MAP.bookings.status) ?? "-");
  const checkIn = String(f(booking, MAP.bookings.checkIn) ?? "-");
  const checkOut = String(f(booking, MAP.bookings.checkOut) ?? "-");
  const adults = num(f(booking, MAP.bookings.adults));
  const children = num(f(booking, MAP.bookings.childrenCount));
  const payMethod = String(f(booking, MAP.bookings.paymentMethod) ?? "-");
  const payStatus = String(f(booking, MAP.bookings.paymentStatus) ?? "-");

  const guestName = String(f(booking, MAP.bookings.guestName) ?? "-");
  const guestEmail = String(f(booking, MAP.bookings.guestEmail) ?? "-");
  const guestPhone = String(f(booking, MAP.bookings.guestPhone) ?? "-");

  const hotelName = String(f(booking, MAP.bookings.hotelName) ?? "-");
  const roomBreakdown = Array.isArray(f(booking, MAP.bookings.roomBreakdown)) ? f(booking, MAP.bookings.roomBreakdown) : [];

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 p-4 md:p-10">
      <div className="mx-auto max-w-5xl overflow-hidden rounded-2xl border border-white/10 bg-[#070A12]">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 p-4 md:p-6">
          <div>
            <div className="text-xs text-slate-400">Rezervasyon / İş Detayı</div>
            <div className="mt-1 text-lg font-semibold">
              {hotelName} • {money(total, cur)}
            </div>
            <div className="mt-1 text-xs text-slate-400">
              {city}{district ? ` / ${district}` : ""} • {status} • {at ? at.toLocaleString("tr-TR") : "-"}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm hover:bg-white/[0.06]"
          >
            Kapat
          </button>
        </div>

        <div className="p-4 md:p-6 grid gap-3 md:grid-cols-3">
          <Box title="Tarih & Misafir">
            <div className="text-sm text-slate-200"><b>Check-in:</b> {checkIn}</div>
            <div className="text-sm text-slate-200"><b>Check-out:</b> {checkOut}</div>
            <div className="mt-2 text-sm text-slate-200"><b>Misafir:</b> {guestName}</div>
            <div className="text-sm text-slate-200"><b>Email:</b> {guestEmail}</div>
            <div className="text-sm text-slate-200"><b>Tel:</b> {guestPhone}</div>
            <div className="mt-2 text-xs text-slate-400">Kişi: {adults} yetişkin • {children} çocuk</div>
          </Box>

          <Box title="Ödeme">
            <div className="text-sm text-slate-200"><b>Yöntem:</b> {payMethod}</div>
            <div className="text-sm text-slate-200"><b>Durum:</b> {payStatus}</div>
            <div className="mt-2 text-sm text-slate-200"><b>Toplam:</b> {money(total, cur)}</div>
            <div className="mt-2 text-xs text-slate-400">Admin Komisyon (oran): %{Math.round(COMMISSION_RATE * 100)}</div>
            <div className="text-sm text-slate-200"><b>Admin Komisyon:</b> {money(total * COMMISSION_RATE, cur)}</div>
          </Box>

          <Box title="Konum">
            <div className="text-sm text-slate-200"><b>Şehir:</b> {city}</div>
            <div className="text-sm text-slate-200"><b>İlçe:</b> {district || "-"}</div>
          </Box>
        </div>

        <div className="p-4 md:p-6 pt-0">
          <Box title="Oda Kırılımı (roomBreakdown)">
            {roomBreakdown.length === 0 ? (
              <div className="text-sm text-slate-300">Oda kırılımı yok.</div>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {roomBreakdown.map((rb: any, i: number) => (
                  <div key={i} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                    <div className="text-sm font-semibold">{rb.roomTypeName || "Room"}</div>
                    <div className="mt-1 text-xs text-slate-400">
                      Gecelik: {money(rb.nightlyPrice || 0, cur)} • Gece: {rb.nights || "-"} • Oda: {rb.roomsCount || 1}
                    </div>
                    <div className="mt-2 text-sm text-slate-200">
                      Toplam: <b>{money(rb.totalPrice || 0, cur)}</b>
                    </div>
                    <div className="mt-1 text-xs text-slate-400">Durum: {rb.status || "-"}</div>
                  </div>
                ))}
              </div>
            )}
          </Box>
        </div>
      </div>
    </div>
  );
}

/** =========================
 *  Offer Detail Modal (talep + fiyat geçmişi)
 *  ========================= */
function OfferDetailModal({
  offer,
  request,
  loading,
  onClose,
}: {
  offer: AnyObj;
  request: AnyObj | null;
  loading: boolean;
  onClose: () => void;
}) {
  const currency = String(f(offer, MAP.offers.currency) ?? "TRY");
  const sym = currency === "USD" ? "$" : currency === "EUR" ? "€" : "₺";

  const ph = f(offer, MAP.offers.priceHistory);
  const tl = f(offer, MAP.offers.timeline);
  const history: any[] = Array.isArray(ph) ? ph : Array.isArray(tl) ? tl : [];

  return (
    <div className="fixed inset-0 z-[80] bg-black/70 p-4 md:p-10">
      <div className="mx-auto max-w-6xl overflow-hidden rounded-2xl border border-white/10 bg-[#070A12]">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 p-4 md:p-6">
          <div>
            <div className="text-xs text-slate-400">Teklif Detayı</div>
            <div className="mt-1 text-lg font-semibold">
              Teklif: <span className="text-slate-200">{offer.id}</span> • Talep:{" "}
              <span className="text-slate-200">{String(f(offer, MAP.offers.requestId) ?? "-")}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm hover:bg-white/[0.06]"
          >
            Kapat
          </button>
        </div>

        <div className="p-4 md:p-6 grid gap-3 md:grid-cols-2">
          <Box title="Talep Bilgisi">
            {loading ? (
              <div className="text-sm text-slate-300">Yükleniyor…</div>
            ) : !request ? (
              <div className="text-sm text-slate-300">Talep bulunamadı.</div>
            ) : (
              <div className="space-y-1 text-sm text-slate-200">
                <div><b>Konum:</b> {request.city || "-"} {request.district ? ` / ${request.district}` : ""}</div>
                <div><b>Tarih/Saat:</b> {request.date || "-"} {request.time ? ` • ${request.time}` : ""}</div>
                <div><b>Not:</b> {request.notes || "-"}</div>
              </div>
            )}
          </Box>

          <Box title="Fiyat Geçmişi / Revizeler">
            {history.length === 0 ? (
              <div className="text-sm text-slate-300">Fiyat geçmişi yok.</div>
            ) : (
              <div className="max-h-[420px] overflow-auto space-y-2 pr-1">
                {history.map((h: any, idx: number) => {
                  const kind = String(h.kind || h.type || "STEP").toUpperCase();
                  const actor = String(h.actor || h.by || "SYSTEM").toUpperCase();
                  const at = h.at?.seconds ? new Date(h.at.seconds * 1000) : h.at ? new Date(h.at) : null;
                  const price = num(h.price || h.amount || 0);

                  return (
                    <div key={idx} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="text-sm font-semibold">{kind} • {actor}</div>
                        <div className="text-xs text-slate-400">{at ? at.toLocaleString("tr-TR") : "-"}</div>
                      </div>
                      <div className="mt-1 text-lg font-semibold">
                        {sym}{price.toLocaleString("tr-TR")}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Box>
        </div>
      </div>
    </div>
  );
}
