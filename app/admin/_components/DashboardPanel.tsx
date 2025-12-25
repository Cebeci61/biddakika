"use client";

import { useMemo } from "react";
import { COLLECTIONS } from "./firestoreAdmin";
import { useRealtimeList, isToday } from "./useAdminRealtime";

type OfferDoc = {
  createdAt?: any;
  status?: string;
  totalPrice?: number;
};

type BookingDoc = {
  createdAt?: any;
  status?: string;
  total?: number;
  commission?: number;
};

type RequestDoc = {
  createdAt?: any;
  status?: string;
};

type UserDoc = {
  role?: string;
  isActive?: boolean;
};

export default function DashboardPanel() {
  const { rows: offers, loading: lo1 } = useRealtimeList<OfferDoc>(COLLECTIONS.offers, {
    createdAtField: "createdAt",
    take: 500,
  });

  const { rows: bookings, loading: lo2 } = useRealtimeList<BookingDoc>(COLLECTIONS.bookings, {
    createdAtField: "createdAt",
    take: 500,
  });

  const { rows: requests, loading: lo3 } = useRealtimeList<RequestDoc>(COLLECTIONS.requests, {
    createdAtField: "createdAt",
    take: 500,
  });

  const { rows: users, loading: lo4 } = useRealtimeList<UserDoc>(COLLECTIONS.users, {
    createdAtField: "createdAt",
    take: 2000,
  });

  const loading = lo1 || lo2 || lo3 || lo4;

  const kpis = useMemo(() => {
    const todayRequests = requests.filter((r) => isToday((r as any).createdAt)).length;
    const todayOffers = offers.filter((r) => isToday((r as any).createdAt)).length;

    // Rezervasyon: senin sisteminde status alanı farklı olabilir
    const todayBookings = bookings.filter((b) => isToday((b as any).createdAt)).length;

    const totalCiro = bookings.reduce((sum, b) => sum + (Number((b as any).total ?? (b as any).totalPrice ?? 0) || 0), 0);
    const totalKomisyon = bookings.reduce((sum, b) => sum + (Number((b as any).commission ?? 0) || 0), 0);

    const activeUsers = users.filter((u) => (u as any).isActive !== false).length;

    return {
      todayRequests,
      todayOffers,
      todayBookings,
      totalCiro,
      totalKomisyon,
      activeUsers,
    };
  }, [offers, bookings, requests, users]);

  return (
    <div className="space-y-4">
      {/* PREMIUM KPI GRID */}
      <div className="grid gap-3 md:grid-cols-3">
        <KpiCard title="Bugün Talep" value={kpis.todayRequests} hint="Tüm iller" loading={loading} />
        <KpiCard title="Bugün Teklif" value={kpis.todayOffers} hint="Otel + Acenta" loading={loading} />
        <KpiCard title="Bugün Rezervasyon" value={kpis.todayBookings} hint="Onaylı/oluşan kayıtlar" loading={loading} />
        <KpiCard title="Toplam Ciro" value={money(kpis.totalCiro)} hint="Bookings üzerinden" loading={loading} />
        <KpiCard title="Toplam Komisyon" value={money(kpis.totalKomisyon)} hint="Bookings üzerinden" loading={loading} />
        <KpiCard title="Aktif Üye" value={kpis.activeUsers} hint="users koleksiyonu" loading={loading} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Panel title="Sistem Sağlığı">
          <div className="grid gap-2 text-sm text-slate-200">
            <Line label="Teklif Akışı" value={offers.length} />
            <Line label="Rezervasyon Kayıtları" value={bookings.length} />
            <Line label="Toplam Talep" value={requests.length} />
          </div>
        </Panel>

        <Panel title="Son Hareketler">
          <div className="text-sm text-slate-300">
            Şimdilik: “Son hareketler” için ayrı bir log koleksiyonu öneriyorum.  
            İstersen `activityLogs` koleksiyonu ekleyip her işlemde log basarız.
          </div>
        </Panel>
      </div>
    </div>
  );
}

function money(v: number) {
  const n = Math.round((v || 0) * 100) / 100;
  return `₺${n.toLocaleString("tr-TR")}`;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 text-sm font-semibold">{title}</div>
      {children}
    </div>
  );
}

function Line({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="text-slate-200">{label}</div>
      <div className="font-semibold">{value.toLocaleString("tr-TR")}</div>
    </div>
  );
}

function KpiCard({
  title,
  value,
  hint,
  loading,
}: {
  title: string;
  value: string | number;
  hint: string;
  loading?: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
      <div className="text-xs text-slate-300">{title}</div>
      <div className="mt-1 text-2xl font-semibold">
        {loading ? <span className="inline-block h-7 w-24 animate-pulse rounded bg-white/10" /> : value}
      </div>
      <div className="mt-1 text-xs text-slate-400">{hint}</div>
    </div>
  );
}
