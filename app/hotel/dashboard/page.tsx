// app/hotel/dashboard/page.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import { Protected } from "@/components/Protected";
import { useAuth } from "@/context/AuthContext";
import { getFirestoreDb } from "@/lib/firebase/client";
import {
  collection,
  getDocs,
  query,
  where,
  Timestamp
} from "firebase/firestore";

type OfferMode = "simple" | "refreshable" | "negotiable";

interface Booking {
  id: string;
  hotelId?: string;
  hotelName?: string | null;
  city?: string;
  district?: string | null;
  checkIn: string;
  checkOut: string;
  totalPrice: number;
  currency: string;
  paymentMethod: string;
  paymentStatus: string;
  status: string;
  roomsCount?: number | null;
  adults?: number | null;
  childrenCount?: number | null;
  roomTypeName?: string | null;
  createdAt?: Timestamp;
}

interface Offer {
  id: string;
  requestId: string;
  totalPrice: number;
  currency: string;
  status: string; // sent | accepted | rejected | countered
  mode: OfferMode;
  createdAt?: Timestamp;
}

function parseDate(value?: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function normalized(d: Date) {
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return n;
}

function diffInDays(a: Date, b: Date) {
  const ms = normalized(a).getTime() - normalized(b).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function isSameDay(a: Date, b: Date) {
  return normalized(a).getTime() === normalized(b).getTime();
}

const MODE_LABEL: Record<OfferMode, string> = {
  simple: "Standart teklif",
  refreshable: "Yenilenebilir teklif",
  negotiable: "Pazarlıklı teklif"
};

export default function HotelDashboardPage() {
  const { profile, loading: authLoading } = useAuth();
  const db = getFirestoreDb();

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (authLoading) return;
      if (!profile || profile.role !== "hotel") {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        // 🔹 Bu otele ait rezervasyonlar
        const qBookings = query(
          collection(db, "bookings"),
          where("hotelId", "==", profile.uid)
        );
        const snapBookings = await getDocs(qBookings);
        const bookingData: Booking[] = snapBookings.docs.map((d) => {
          const v = d.data() as any;
          return {
            id: d.id,
            hotelId: v.hotelId,
            hotelName: v.hotelName,
            city: v.city,
            district: v.district ?? null,
            checkIn: v.checkIn,
            checkOut: v.checkOut,
            totalPrice: v.totalPrice,
            currency: v.currency,
            paymentMethod: v.paymentMethod,
            paymentStatus: v.paymentStatus,
            status: v.status ?? "active",
            roomsCount: v.roomsCount ?? null,
            adults: v.adults ?? null,
            childrenCount: v.childrenCount ?? null,
            roomTypeName: v.roomTypeName ?? null,
            createdAt: v.createdAt
          };
        });

        bookingData.sort((a, b) => {
          const ta = a.createdAt?.toMillis() ?? 0;
          const tb = b.createdAt?.toMillis() ?? 0;
          return tb - ta;
        });

        // 🔹 Bu otelin verdiği teklifler
        const qOffers = query(
          collection(db, "offers"),
          where("hotelId", "==", profile.uid)
        );
        const snapOffers = await getDocs(qOffers);
        const offerData: Offer[] = snapOffers.docs.map((d) => {
          const v = d.data() as any;
          return {
            id: d.id,
            requestId: v.requestId,
            totalPrice: v.totalPrice,
            currency: v.currency,
            status: v.status ?? "sent",
            mode: (v.mode as OfferMode) ?? "simple",
            createdAt: v.createdAt
          };
        });

        offerData.sort((a, b) => {
          const ta = a.createdAt?.toMillis() ?? 0;
          const tb = b.createdAt?.toMillis() ?? 0;
          return tb - ta;
        });

        setBookings(bookingData);
        setOffers(offerData);
      } catch (err) {
        console.error("Hotel dashboard yüklenirken hata:", err);
        setError("Panel verileri yüklenirken bir hata oluştu.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [authLoading, profile, db]);

  const today = useMemo(() => new Date(), []);

  const stats = useMemo(() => {
    const now = new Date();

    let totalRevenue = 0;
    let onlineRevenue = 0;
    let payAtHotelRevenue = 0;

    let upcomingCount = 0;
    let pastCount = 0;

    bookings.forEach((b) => {
      const checkIn = parseDate(b.checkIn);
      const checkOut = parseDate(b.checkOut);

      const isPastStay = checkOut ? diffInDays(checkOut, now) < 0 : false;
      if (isPastStay) pastCount += 1;
      else upcomingCount += 1;

      if (b.status === "active" || b.status === "completed") {
        totalRevenue += b.totalPrice ?? 0;
        if (b.paymentMethod === "card3d" && b.paymentStatus === "paid") {
          onlineRevenue += b.totalPrice ?? 0;
        }
        if (b.paymentMethod === "payAtHotel") {
          payAtHotelRevenue += b.totalPrice ?? 0;
        }
      }
    });

    let totalOffers = offers.length;
    let activeOffers = 0;
    let acceptedOffers = 0;
    let rejectedOffers = 0;
    offers.forEach((o) => {
      if (o.status === "accepted") acceptedOffers += 1;
      else if (o.status === "rejected") rejectedOffers += 1;
      else activeOffers += 1;
    });

    return {
      totalRevenue,
      onlineRevenue,
      payAtHotelRevenue,
      upcomingCount,
      pastCount,
      totalOffers,
      activeOffers,
      acceptedOffers,
      rejectedOffers
    };
  }, [bookings, offers]);

  const todayCheckins = useMemo(
    () =>
      bookings.filter((b) => {
        const ci = parseDate(b.checkIn);
        if (!ci) return false;
        return b.status === "active" && isSameDay(ci, today);
      }),
    [bookings, today]
  );

  const todayCheckouts = useMemo(
    () =>
      bookings.filter((b) => {
        const co = parseDate(b.checkOut);
        if (!co) return false;
        return b.status === "active" && isSameDay(co, today);
      }),
    [bookings, today]
  );

  const upcomingBookings = useMemo(
    () =>
      bookings
        .filter((b) => {
          const ci = parseDate(b.checkIn);
          if (!ci) return false;
          return diffInDays(ci, today) >= 0;
        })
        .sort((a, b) => {
          const ca = parseDate(a.checkIn)?.getTime() ?? 0;
          const cb = parseDate(b.checkIn)?.getTime() ?? 0;
          return ca - cb;
        })
        .slice(0, 6),
    [bookings, today]
  );

  const recentOffers = useMemo(() => offers.slice(0, 6), [offers]);

  return (
    <Protected allowedRoles={["hotel"]}>
      <div className="container-page space-y-6">
        {/* Başlık */}
        <section className="space-y-2">
          <h1 className="text-2xl font-semibold">BiddakikaPanel</h1>
          <p className="text-sm text-slate-300 max-w-3xl">
            Otel hesabın için özet panel. Bugünkü giriş–çıkışlar, yaklaşan
            konaklamalar ve verdiğin tekliflerin performansını buradan
            görebilirsin. Detay için üst menüden Gelen talepler, Verdiğim
            teklifler ve Rezervasyonlar sayfalarını kullan.
          </p>
        </section>

        {loading && (
          <p className="text-sm text-slate-400">Panel verileri yükleniyor...</p>
        )}

        {error && (
          <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/40 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        {/* Özet kartlar */}
        {!loading && (
          <section className="grid gap-4 md:grid-cols-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow shadow-slate-950/40">
              <p className="text-[0.75rem] text-slate-400 mb-1">
                Toplam gelir (MVP)
              </p>
              <p className="text-xl font-semibold text-emerald-300">
                {stats.totalRevenue.toLocaleString("tr-TR")} ₺
              </p>
              <p className="text-[0.7rem] text-slate-400 mt-1">
                Online: {stats.onlineRevenue.toLocaleString("tr-TR")} ₺ •
                Otelde: {stats.payAtHotelRevenue.toLocaleString("tr-TR")} ₺
              </p>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow shadow-slate-950/40">
              <p className="text-[0.75rem] text-slate-400 mb-1">
                Rezervasyon sayısı
              </p>
              <p className="text-xl font-semibold text-slate-100">
                {bookings.length}
              </p>
              <p className="text-[0.7rem] text-slate-400 mt-1">
                Yaklaşan: {stats.upcomingCount} • Tamamlanan: {stats.pastCount}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow shadow-slate-950/40">
              <p className="text-[0.75rem] text-slate-400 mb-1">
                Bugünkü hareket
              </p>
              <p className="text-xl font-semibold text-slate-100">
                {todayCheckins.length} giriş • {todayCheckouts.length} çıkış
              </p>
              <p className="text-[0.7rem] text-slate-400 mt-1">
                Giriş ve çıkışların detayını Rezervasyonlar sayfasından
                yönetebilirsin.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow shadow-slate-950/40">
              <p className="text-[0.75rem] text-slate-400 mb-1">
                Teklif performansı
              </p>
              <p className="text-xl font-semibold text-slate-100">
                {stats.acceptedOffers} kabul • {stats.rejectedOffers} red
              </p>
              <p className="text-[0.7rem] text-slate-400 mt-1">
                Aktif teklifler: {stats.activeOffers} / toplam{" "}
                {stats.totalOffers}
              </p>
            </div>
          </section>
        )}

        {/* Bugün & Yaklaşan */}
        {!loading && (
          <section className="grid gap-4 md:grid-cols-2">
            {/* Bugün giriş/çıkış */}
            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow shadow-slate-950/40 text-xs space-y-3">
              <h2 className="text-sm font-semibold text-slate-100 mb-1">
                Bugün giriş / çıkış
              </h2>

              {todayCheckins.length === 0 && todayCheckouts.length === 0 && (
                <p className="text-[0.75rem] text-slate-400">
                  Bugün için planlı giriş veya çıkış görünmüyor.
                </p>
              )}

              {todayCheckins.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[0.75rem] text-emerald-300 font-semibold">
                    Giriş yapacak misafirler
                  </p>
                  <div className="space-y-1">
                    {todayCheckins.map((b) => {
                      const guests =
                        (b.adults ?? 0) + (b.childrenCount ?? 0) > 0
                          ? `${(b.adults ?? 0) + (b.childrenCount ?? 0)} kişi`
                          : "";
                      return (
                        <div
                          key={b.id}
                          className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2"
                        >
                          <p className="text-[0.8rem] text-slate-100">
                            {b.city}
                            {b.district ? ` / ${b.district}` : ""}
                          </p>
                          <p className="text-[0.7rem] text-slate-400">
                            Konaklama: {b.checkIn} – {b.checkOut}
                          </p>
                          <p className="text-[0.7rem] text-slate-400">
                            {guests}{" "}
                            {b.roomTypeName ? `• ${b.roomTypeName}` : ""}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {todayCheckouts.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[0.75rem] text-amber-300 font-semibold mt-2">
                    Çıkış yapacak misafirler
                  </p>
                  <div className="space-y-1">
                    {todayCheckouts.map((b) => {
                      const guests =
                        (b.adults ?? 0) + (b.childrenCount ?? 0) > 0
                          ? `${(b.adults ?? 0) + (b.childrenCount ?? 0)} kişi`
                          : "";
                      return (
                        <div
                          key={b.id}
                          className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2"
                        >
                          <p className="text-[0.8rem] text-slate-100">
                            {b.city}
                            {b.district ? ` / ${b.district}` : ""}
                          </p>
                          <p className="text-[0.7rem] text-slate-400">
                            Konaklama: {b.checkIn} – {b.checkOut}
                          </p>
                          <p className="text-[0.7rem] text-slate-400">
                            {guests}{" "}
                            {b.roomTypeName ? `• ${b.roomTypeName}` : ""}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Yaklaşan konaklamalar */}
            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow shadow-slate-950/40 text-xs space-y-3">
              <h2 className="text-sm font-semibold text-slate-100 mb-1">
                Yaklaşan konaklamalar
              </h2>
              {upcomingBookings.length === 0 ? (
                <p className="text-[0.75rem] text-slate-400">
                  Yaklaşan bir rezervasyon görünmüyor.
                </p>
              ) : (
                <div className="space-y-2">
                  {upcomingBookings.map((b) => {
                    const guests =
                      (b.adults ?? 0) + (b.childrenCount ?? 0) > 0
                        ? `${(b.adults ?? 0) + (b.childrenCount ?? 0)} kişi`
                        : "";
                    const ci = parseDate(b.checkIn);
                    const daysLeft =
                      ci != null ? diffInDays(ci, today) : undefined;
                    return (
                      <div
                        key={b.id}
                        className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2"
                      >
                        <p className="text-[0.8rem] text-slate-100">
                          {b.city}
                          {b.district ? ` / ${b.district}` : ""}
                        </p>
                        <p className="text-[0.7rem] text-slate-400">
                          {b.checkIn} – {b.checkOut}
                          {typeof daysLeft === "number" && daysLeft >= 0 && (
                            <span className="text-emerald-300 ml-1">
                              ({daysLeft} gün kaldı)
                            </span>
                          )}
                        </p>
                        <p className="text-[0.7rem] text-slate-400">
                          {guests}{" "}
                          {b.roomTypeName ? `• ${b.roomTypeName}` : ""}
                        </p>
                        <p className="text-[0.7rem] text-slate-400">
                          Tutar: {b.totalPrice} {b.currency} •{" "}
                          {b.paymentMethod === "card3d"
                            ? "Online ödeme"
                            : b.paymentMethod === "payAtHotel"
                            ? "Otelde ödeme"
                            : b.paymentMethod}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        )}

        {/* Son verilen teklifler */}
        {!loading && (
          <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow shadow-slate-950/40 text-xs space-y-3">
            <h2 className="text-sm font-semibold text-slate-100 mb-1">
              Son verdiğin teklifler
            </h2>
            {recentOffers.length === 0 ? (
              <p className="text-[0.75rem] text-slate-400">
                Henüz bir teklif oluşturmadın. Gelen talepler ekranından yeni
                teklif verebilirsin.
              </p>
            ) : (
              <div className="space-y-1">
                <div className="hidden md:grid grid-cols-[1.2fr_1fr_1fr_1.2fr] bg-slate-900 text-[0.7rem] font-semibold text-slate-100 px-3 py-2 rounded-lg">
                  <div>Talep</div>
                  <div>Teklif tipi</div>
                  <div>Tutar</div>
                  <div>Durum</div>
                </div>

                {recentOffers.map((o) => {
                  const createdStr = o.createdAt
                    ? o.createdAt.toDate().toLocaleString()
                    : "";
                  const statusLabel =
                    o.status === "accepted"
                      ? "Misafir kabul etti"
                      : o.status === "rejected"
                      ? "Reddedildi"
                      : o.status === "countered"
                      ? "Misafir karşı teklif verdi"
                      : "Gönderildi";

                  const statusClass =
                    o.status === "accepted"
                      ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/40"
                      : o.status === "rejected"
                      ? "bg-red-500/10 text-red-300 border-red-500/40"
                      : o.status === "countered"
                      ? "bg-amber-500/10 text-amber-300 border-amber-500/40"
                      : "bg-slate-500/10 text-slate-300 border-slate-500/40";

                  return (
                    <div
                      key={o.id}
                      className="grid md:grid-cols-[1.2fr_1fr_1fr_1.2fr] gap-2 px-3 py-2 border-t border-slate-800 text-[0.75rem]"
                    >
                      <div className="space-y-0.5">
                        <p className="text-slate-100">
                          Talep ID: {o.requestId.slice(0, 8)}...
                        </p>
                        <p className="text-[0.7rem] text-slate-400">
                          {createdStr && `Teklif tarihi: ${createdStr}`}
                        </p>
                      </div>
                      <div className="text-slate-100">
                        {MODE_LABEL[o.mode]}
                      </div>
                      <div className="text-slate-100">
                        {o.totalPrice} {o.currency}
                      </div>
                      <div className="space-y-1">
                        <span
                          className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[0.65rem] ${statusClass}`}
                        >
                          {statusLabel}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>
    </Protected>
  );
}
