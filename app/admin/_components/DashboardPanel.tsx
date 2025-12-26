"use client";

import type React from "react";
import { useMemo, useState } from "react";
import { useRealtimeList } from "./useAdminRealtime";
import { tsToDate } from "./firestoreAdmin";

type AnyObj = Record<string, any>;
const g = (o: AnyObj, k: string) => o?.[k];

const COL = {
  users: "users",
  requests: "requests",
  offers: "offers",
  bookings: "bookings",
  activityLogs: "activityLogs", // yoksa boş kalır
} as const;

// Booking komisyon alanı varsa onu kullanır, yoksa rate/percent, yoksa 0
function getCommissionFromBooking(b: AnyObj) {
  const amountRaw = b?.commissionAmount ?? b?.commission;
  const amount = Number(amountRaw);
  if (Number.isFinite(amount) && amount >= 0) return amount;

  const rateRaw = b?.commissionRate ?? b?.commissionPercent ?? b?.commissionPct;
  const rate = Number(rateRaw);
  const total = Number(b?.totalPrice ?? b?.total ?? 0);

  if (Number.isFinite(rate) && rate >= 0 && Number.isFinite(total) && total >= 0) {
    return (total * rate) / 100;
  }
  return 0;
}

function moneyTry(v: number) {
  const n = Math.round((Number(v || 0) || 0) * 100) / 100;
  return `₺${n.toLocaleString("tr-TR")}`;
}

function inRange(d: Date, start: Date, end: Date) {
  const t = d.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function endOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

type Role = "all" | "guest" | "hotel" | "agency";

export default function DashboardPanel() {

  // realtime data
  const { rows: users } = useRealtimeList<any>(COL.users, {
    createdAtField: "createdAt",
    take: 5000,
  });

  const { rows: requests } = useRealtimeList<any>(COL.requests, {
    createdAtField: "createdAt",
    take: 5000,
  });

  const { rows: offers } = useRealtimeList<any>(COL.offers, {
    createdAtField: "createdAt",
    take: 5000,
  });

  const { rows: bookings } = useRealtimeList<any>(COL.bookings, {
    createdAtField: "createdAt",
    take: 5000,
  });

  const { rows: logs } = useRealtimeList<any>(COL.activityLogs, {
    createdAtField: "createdAt",
    take: 300,
  });
  // ===== FILTER BAR (role -> city -> district -> date) =====
  const [role, setRole] = useState<Role>("all");
  const [city, setCity] = useState("");
  const [district, setDistrict] = useState("");
  const [preset, setPreset] = useState<"today" | "yesterday" | "last7" | "range">("today");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));

  // role’a göre şehir/ilçe listeleri (users üzerinden)
  const roleUsers = useMemo(() => {
    return users.filter((u) => {
      const r = String(u?.role ?? "");
      if (role === "all") return true;
      return r === role;
    });
  }, [users, role]);

  const cities = useMemo(() => {
    const set = new Set<string>();
    for (const u of roleUsers) {
      const c = String(u?.city ?? "").trim();
      if (c) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "tr"));
  }, [roleUsers]);

  const districts = useMemo(() => {
    const set = new Set<string>();
    for (const u of roleUsers) {
      const c = String(u?.city ?? "").trim();
      const d = String(u?.district ?? "").trim();
      if (city && c !== city) continue;
      if (d) set.add(d);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "tr"));
  }, [roleUsers, city]);

  // date range
  const { rangeStart, rangeEnd } = useMemo(() => {
    const now = new Date();
    if (preset === "today") {
      return { rangeStart: startOfDay(now), rangeEnd: endOfDay(now) };
    }
    if (preset === "yesterday") {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { rangeStart: startOfDay(y), rangeEnd: endOfDay(y) };
    }
    if (preset === "last7") {
      const s = new Date(now);
      s.setDate(s.getDate() - 6);
      return { rangeStart: startOfDay(s), rangeEnd: endOfDay(now) };
    }
    // range
    return {
      rangeStart: startOfDay(new Date(startDate)),
      rangeEnd: endOfDay(new Date(endDate)),
    };
  }, [preset, startDate, endDate]);

  // ===== FILTERED METRICS =====
  const filtered = useMemo(() => {
    // role+city+district filtresi: direkt “users” üzerinden entity seçmek doğru.
    // requests/offers/bookings içinde de city/district varsa onu da süz.
    const cityOk = (c: any) => !city || String(c ?? "").trim() === city;
    const distOk = (d: any) => !district || String(d ?? "").trim() === district;

    const req = requests.filter((r) => {
      const at = tsToDate(r?.createdAt);
      if (!at) return false;
      if (!inRange(at, rangeStart, rangeEnd)) return false;
      if (!cityOk(r?.city)) return false;
      if (!distOk(r?.district)) return false;
      return true;
    });

    const off = offers.filter((o) => {
      const at = tsToDate(o?.createdAt);
      if (!at) return false;
      if (!inRange(at, rangeStart, rangeEnd)) return false;
      if (!cityOk(o?.city)) return false;
      if (!distOk(o?.district)) return false;
      return true;
    });

    const bok = bookings.filter((b) => {
      const at = tsToDate(b?.createdAt);
      if (!at) return false;
      if (!inRange(at, rangeStart, rangeEnd)) return false;
      if (!cityOk(b?.city)) return false;
      if (!distOk(b?.district)) return false;
      return true;
    });

    return { req, off, bok };
  }, [requests, offers, bookings, rangeStart, rangeEnd, city, district]);

  const kpi = useMemo(() => {
    const reqCount = filtered.req.length;
    const offerCount = filtered.off.length;
    const bookingCount = filtered.bok.length;

    const ciro = filtered.bok.reduce((s, b) => s + Number(b?.totalPrice ?? 0), 0);
    const kom = filtered.bok.reduce((s, b) => s + getCommissionFromBooking(b), 0);

    return { reqCount, offerCount, bookingCount, ciro, kom };
  }, [filtered]);

  // city distribution
  const cityDist = useMemo(() => {
    const mapReq: Record<string, number> = {};
    const mapOff: Record<string, number> = {};
    for (const r of filtered.req) {
      const c = String(r?.city ?? "—");
      mapReq[c] = (mapReq[c] || 0) + 1;
    }
    for (const o of filtered.off) {
      const c = String(o?.city ?? "—");
      mapOff[c] = (mapOff[c] || 0) + 1;
    }
    const cities = Array.from(new Set([...Object.keys(mapReq), ...Object.keys(mapOff)]));
    return cities
      .map((c) => ({ city: c, requests: mapReq[c] || 0, offers: mapOff[c] || 0 }))
      .sort((a, b) => (b.requests + b.offers) - (a.requests + a.offers))
      .slice(0, 8);
  }, [filtered]);

  // top hotels by offer count (in filtered)
  const topHotels = useMemo(() => {
    const map: Record<string, { name: string; count: number }> = {};
    for (const o of filtered.off) {
      const hid = String(o?.hotelId ?? "");
      const nm = String(o?.hotelName ?? o?.providerName ?? "Otel");
      const key = hid || nm;
      map[key] = map[key] || { name: nm, count: 0 };
      map[key].count += 1;
    }
    return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 8);
  }, [filtered]);

  // new user registrations in range
  const newUsers = useMemo(() => {
    const stats = { guest: 0, hotel: 0, agency: 0 };
    for (const u of users) {
      const at = tsToDate(u?.createdAt);
      if (!at) continue;
      if (!inRange(at, rangeStart, rangeEnd)) continue;
      const r = String(u?.role ?? "");
      if (r === "guest" || r === "hotel" || r === "agency") stats[r] += 1;
    }
    return stats;
  }, [users, rangeStart, rangeEnd]);

  // real activity logs (filter by date/city/district + role)
  const recentLogs = useMemo(() => {
    const cityOk = (c: any) => !city || String(c ?? "").trim() === city;
    const distOk = (d: any) => !district || String(d ?? "").trim() === district;
    const roleOk = (r: any) => role === "all" || String(r ?? "") === role;

    return logs
      .map((x) => ({ ...x, _at: tsToDate(x?.createdAt) }))
      .filter((x) => x._at && inRange(x._at, rangeStart, rangeEnd))
      .filter((x) => cityOk(x?.city))
      .filter((x) => distOk(x?.district))
      .filter((x) => roleOk(x?.actorRole))
      .sort((a, b) => (b._at!.getTime() - a._at!.getTime()))
      .slice(0, 12);
  }, [logs, rangeStart, rangeEnd, city, district, role]);

  return (
    <div className="space-y-4">
      {/* FILTER BAR */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="grid gap-3 md:grid-cols-12">
          <select
            value={role}
            onChange={(e) => {
              setRole(e.target.value as Role);
              setCity("");
              setDistrict("");
            }}
            className="md:col-span-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-white/20"
          >
            <option value="all">Tüm Roller</option>
            <option value="guest">Misafir</option>
            <option value="hotel">Otel</option>
            <option value="agency">Acenta</option>
          </select>

          <select
            value={city}
            onChange={(e) => {
              setCity(e.target.value);
              setDistrict("");
            }}
            className="md:col-span-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-white/20"
          >
            <option value="">Tüm Şehirler</option>
            {cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          <select
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            className="md:col-span-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-white/20"
          >
            <option value="">Tüm İlçeler</option>
            {districts.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>

          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value as any)}
            className="md:col-span-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-white/20"
          >
            <option value="today">Bugün</option>
            <option value="yesterday">Dün</option>
            <option value="last7">Son 7 Gün</option>
            <option value="range">Tarih Aralığı</option>
          </select>

          {preset === "range" ? (
            <>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="md:col-span-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none"
              />
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="md:col-span-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none"
              />
            </>
          ) : (
            <div className="md:col-span-4 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-300">
              {rangeStart.toLocaleDateString("tr-TR")} – {rangeEnd.toLocaleDateString("tr-TR")}
            </div>
          )}
        </div>

        <div className="mt-2 text-xs text-slate-400">
          Filtre: <b className="text-slate-100">{role === "all" ? "Tüm Roller" : role}</b>
          {city ? <> • <b className="text-slate-100">{city}</b></> : null}
          {district ? <> / <b className="text-slate-100">{district}</b></> : null}
        </div>
      </div>

      {/* KPI */}
      <div className="grid gap-3 md:grid-cols-3">
        <Kpi title="Talep" value={kpi.reqCount} hint="Filtreye göre" />
        <Kpi title="Teklif" value={kpi.offerCount} hint="Filtreye göre" />
        <Kpi title="Rezervasyon" value={kpi.bookingCount} hint="Filtreye göre" />
        <Kpi title="Ciro" value={moneyTry(kpi.ciro)} hint="Bookings totalPrice" />
        <Kpi title="Komisyon" value={moneyTry(kpi.kom)} hint="Booking komisyon alanı" />
        <Kpi title="Yeni Kayıtlar" value={`${newUsers.guest}/${newUsers.hotel}/${newUsers.agency}`} hint="Misafir/Otel/Acenta" />
      </div>

      {/* CITY DISTRIBUTION + TOP HOTELS */}
      <div className="grid gap-3 md:grid-cols-2">
        <Panel title="Şehir Bazlı Akış">
          {cityDist.length === 0 ? (
            <div className="text-sm text-slate-400">Bu filtrede veri yok.</div>
          ) : (
            <div className="space-y-2">
              {cityDist.map((x) => (
                <div key={x.city} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] p-3">
                  <div className="font-semibold">{x.city}</div>
                  <div className="text-xs text-slate-300">
                    Talep: <b>{x.requests}</b> • Teklif: <b>{x.offers}</b>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Top Oteller (Teklif Sayısı)">
          {topHotels.length === 0 ? (
            <div className="text-sm text-slate-400">Bu filtrede veri yok.</div>
          ) : (
            <div className="space-y-2">
              {topHotels.map((x, i) => (
                <div key={i} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] p-3">
                  <div className="font-semibold">{x.name}</div>
                  <div className="text-xs text-slate-300">Teklif: <b>{x.count}</b></div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* REAL ACTIVITY LOG */}
      <Panel title="Son İşlemler (Gerçek)">
        {recentLogs.length === 0 ? (
          <div className="text-sm text-slate-400">
            activityLogs koleksiyonu yoksa burası boş görünür. İstersen tüm create/update noktalarına 3 satırla log basacağız.
          </div>
        ) : (
          <div className="space-y-2">
            {recentLogs.map((l) => (
              <div key={l.id} className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <div>
                  <div className="text-sm font-semibold">{String(l.message ?? l.type ?? "İşlem")}</div>
                  <div className="mt-1 text-xs text-slate-400">
                    {String(l.actorRole ?? "-")} • {String(l.actorName ?? "-")} •{" "}
                    {String(l.city ?? "")}{l.district ? ` / ${String(l.district)}` : ""}
                  </div>
                </div>
                <div className="text-xs text-slate-500">{l._at ? l._at.toLocaleString("tr-TR") : "-"}</div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function Kpi({ title, value, hint }: { title: string; value: any; hint: string }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
      <div className="text-xs text-slate-300">{title}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-slate-400">{hint}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 text-sm font-semibold">{title}</div>
      {children}
    </div>
  );
}
