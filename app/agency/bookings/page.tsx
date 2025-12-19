"use client";

import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { Protected } from "@/components/Protected";
import { useAuth } from "@/context/AuthContext";
import { getFirestoreDb } from "@/lib/firebase/client";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where
} from "firebase/firestore";

type PaymentMethod = "card3d" | "payAtHotel" | string;

type Booking = {
  id: string;

  offerId?: string | null;
  requestId?: string | null;

  hotelId?: string | null;
  hotelName?: string | null;

  guestId?: string | null; // acenta uid
  createdByRole?: "agency" | "guest" | "hotel" | "admin" | string;

  // müşteri (acentanın adına)
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;

  city?: string | null;
  district?: string | null;

  checkIn: string;
  checkOut: string;

  adults?: number | null;
  childrenCount?: number | null;
  childrenAges?: number[] | null;
  roomsCount?: number | null;

  roomTypes?: string[] | null;

  // fiyatlar
  totalPrice: number; // acenta fiyatı
  currency: string;

  originalHotelOfferPrice?: number | null;
  agencyDiscountRate?: number | null;

  paymentMethod?: PaymentMethod;
  paymentStatus?: string;

  status?: string; // active | cancelled | deleted | completed vs
  createdAt?: Timestamp;
};

type BookingMessage = {
  id: string;
  bookingId: string;
  hotelId?: string | null;
  guestId?: string | null;
  senderRole: "guest" | "hotel";
  text: string;
  createdAt?: Timestamp;
  read?: boolean;
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

function normalized(d: Date) {
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return n;
}

function diffInDays(a: Date, b: Date) {
  const ms = normalized(a).getTime() - normalized(b).getTime();
  return Math.floor(ms / 86400000);
}

function calcNights(ci?: string | null, co?: string | null) {
  const a = parseDate(ci);
  const b = parseDate(co);
  if (!a || !b) return 1;
  const d = diffInDays(b, a);
  return d > 0 ? d : 1;
}

function bookingIsPast(b: Booking) {
  const out = parseDate(b.checkOut);
  if (!out) return false;
  return diffInDays(out, new Date()) < 0;
}

function statusText(b: Booking) {
  if (b.status === "cancelled") return "İptal";
  if (b.status === "deleted") return "Silindi";
  if (b.status === "active" && bookingIsPast(b)) return "Tamamlandı";
  if (b.status === "active") return "Aktif";
  return safeStr(b.status, "—");
}

function statusBadgeCls(b: Booking) {
  if (b.status === "cancelled") return "border-red-500/40 bg-red-500/10 text-red-200";
  if (b.status === "deleted") return "border-slate-600 bg-slate-900/60 text-slate-200";
  if (b.status === "active" && bookingIsPast(b)) return "border-slate-600 bg-slate-900/60 text-slate-200";
  if (b.status === "active") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  return "border-slate-600 bg-slate-900/60 text-slate-200";
}

function paymentMethodText(method?: string) {
  if (method === "card3d") return "3D Secure kart";
  if (method === "payAtHotel") return "Otelde ödeme";
  return safeStr(method);
}

function timeUntilCheckIn(b: Booking) {
  const ci = parseDate(b.checkIn);
  if (!ci) return "—";
  const now = new Date();
  const diffMs = ci.getTime() - now.getTime();
  if (diffMs <= 0) return "Giriş zamanı geçti";

  const totalMin = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;

  if (days > 0) return `${days} gün ${hours} sa ${mins} dk`;
  if (hours > 0) return `${hours} sa ${mins} dk`;
  return `${mins} dk`;
}

function canMessageBooking(b: Booking) {
  if (b.status !== "active") return false;
  if (bookingIsPast(b)) return false;
  return true;
}
export default function AgencyBookingsPage() {
  const { profile, loading: authLoading } = useAuth() as any;
  const db = getFirestoreDb();

  const [loading, setLoading] = useState(true);
  const [pageErr, setPageErr] = useState<string | null>(null);

  const [bookings, setBookings] = useState<Booking[]>([]);

  // filters
  const [qText, setQText] = useState("");
  const [statusF, setStatusF] = useState<"all" | "active" | "completed" | "cancelled">("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sortKey, setSortKey] = useState<"new" | "checkin" | "price">("new");

  // modals
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailBooking, setDetailBooking] = useState<Booking | null>(null);

  const [messageOpen, setMessageOpen] = useState(false);
  const [messageBooking, setMessageBooking] = useState<Booking | null>(null);
  const [messageText, setMessageText] = useState("");
  const [messageSending, setMessageSending] = useState(false);
  const [messageErr, setMessageErr] = useState<string | null>(null);
  const [messageOk, setMessageOk] = useState<string | null>(null);

  // load bookings
  useEffect(() => {
    async function load() {
      if (authLoading) return;
      if (!profile || profile.role !== "agency") {
        setLoading(false);
        return;
      }

      setLoading(true);
      setPageErr(null);

      try {
        // ✅ acenta rezervasyonları: guestId == agency uid
        const qBk = query(collection(db, "bookings"), where("guestId", "==", profile.uid));
        const snap = await getDocs(qBk);

        const list: Booking[] = snap.docs
          .map((d) => {
            const v = d.data() as any;
            return {
              id: d.id,
              offerId: v.offerId ?? null,
              requestId: v.requestId ?? null,
              hotelId: v.hotelId ?? null,
              hotelName: v.hotelName ?? null,
              guestId: v.guestId ?? null,
              createdByRole: v.createdByRole ?? null,

              customerName: v.customerName ?? null,
              customerPhone: v.customerPhone ?? null,
              customerEmail: v.customerEmail ?? null,

              city: v.city ?? null,
              district: v.district ?? null,

              checkIn: v.checkIn ?? "",
              checkOut: v.checkOut ?? "",

              adults: v.adults ?? null,
              childrenCount: v.childrenCount ?? null,
              childrenAges: Array.isArray(v.childrenAges) ? v.childrenAges : [],
              roomsCount: v.roomsCount ?? null,
              roomTypes: Array.isArray(v.roomTypes) ? v.roomTypes : [],

              totalPrice: Number(v.totalPrice ?? 0),
              currency: v.currency ?? "TRY",

              originalHotelOfferPrice: v.originalHotelOfferPrice ?? null,
              agencyDiscountRate: v.agencyDiscountRate ?? null,

              paymentMethod: v.paymentMethod ?? null,
              paymentStatus: v.paymentStatus ?? null,

              status: v.status ?? "active",
              createdAt: v.createdAt
            } as Booking;
          })
          .filter((b) => b.status !== "deleted");

        list.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
        setBookings(list);
      } catch (e: any) {
        console.error(e);
        setPageErr(e?.message || "Rezervasyonlar yüklenemedi.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [authLoading, profile, db]);

  const filtered = useMemo(() => {
    let list = [...bookings];

    const q = qText.trim().toLowerCase();
    if (q) {
      list = list.filter((b) => {
        const hay = [
          b.id,
          b.hotelName,
          b.city,
          b.district,
          b.customerName,
          b.customerPhone,
          b.customerEmail
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }

    if (statusF !== "all") {
      if (statusF === "active") list = list.filter((b) => b.status === "active" && !bookingIsPast(b));
      if (statusF === "completed") list = list.filter((b) => b.status === "active" && bookingIsPast(b));
      if (statusF === "cancelled") list = list.filter((b) => b.status === "cancelled");
    }

    const f = parseDate(fromDate);
    if (f) {
      list = list.filter((b) => {
        const d = parseDate(b.checkIn);
        if (!d) return false;
        return normalized(d).getTime() >= normalized(f).getTime();
      });
    }

    const t = parseDate(toDate);
    if (t) {
      list = list.filter((b) => {
        const d = parseDate(b.checkOut);
        if (!d) return false;
        return normalized(d).getTime() <= normalized(t).getTime();
      });
    }

    list.sort((a, b) => {
      if (sortKey === "new") return (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0);
      if (sortKey === "checkin") return (parseDate(a.checkIn)?.getTime() ?? Infinity) - (parseDate(b.checkIn)?.getTime() ?? Infinity);
      if (sortKey === "price") return Number(b.totalPrice ?? 0) - Number(a.totalPrice ?? 0);
      return 0;
    });

    return list;
  }, [bookings, qText, statusF, fromDate, toDate, sortKey]);

  const totalSpend = useMemo(() => {
    return filtered.reduce((sum, b) => {
      if (b.status === "cancelled" || b.status === "deleted") return sum;
      return sum + (b.totalPrice || 0);
    }, 0);
  }, [filtered]);

  function openDetail(b: Booking) {
    setDetailBooking(b);
    setDetailOpen(true);
  }
  function closeDetail() {
    setDetailOpen(false);
    setDetailBooking(null);
  }

  function openMessage(b: Booking) {
    setMessageBooking(b);
    setMessageText("");
    setMessageErr(null);
    setMessageOk(null);
    setMessageOpen(true);
  }
  function closeMessage() {
    setMessageOpen(false);
    setMessageBooking(null);
    setMessageText("");
    setMessageErr(null);
    setMessageOk(null);
  }

  async function sendMessage(e: FormEvent) {
    e.preventDefault();
    if (!profile?.uid || !messageBooking) return;

    const text = messageText.trim();
    if (!text) {
      setMessageErr("Lütfen mesaj yaz.");
      return;
    }

    try {
      setMessageSending(true);
      setMessageErr(null);
      setMessageOk(null);

      await addDoc(collection(db, "bookingMessages"), {
        bookingId: messageBooking.id,
        hotelId: messageBooking.hotelId ?? null,
        guestId: profile.uid,
        senderRole: "guest", // acenta tarafı misafir gibi davranır
        text,
        createdAt: serverTimestamp(),
        read: false
      });

      setMessageText("");
      setMessageOk("Mesaj gönderildi.");
      setTimeout(() => setMessageOk(null), 900);
    } catch (e: any) {
      console.error(e);
      setMessageErr(e?.message || "Mesaj gönderilemedi.");
    } finally {
      setMessageSending(false);
    }
  }

  return (
    <Protected allowedRoles={["agency"]}>
      <div className="container-page space-y-6">
        <section className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-100">Acenta • Rezervasyonlarım</h1>
          <p className="text-sm text-slate-300 max-w-3xl">
            Burada acenta olarak yaptığın rezervasyonları görürsün. Her kayıtta müşteri bilgisi, tesis, tarih, ödeme ve indirim detayları bulunur.
          </p>
          <p className="text-[0.75rem] text-slate-400">
            Filtre sonucuna göre toplam harcama:{" "}
            <span className="font-semibold text-emerald-300">
              {totalSpend.toLocaleString("tr-TR")} ₺
            </span>{" "}
            • Kayıt: <span className="font-semibold">{filtered.length}</span>
          </p>
        </section>

        {pageErr && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-200 text-sm">
            {pageErr}
          </div>
        )}

        {/* Filters */}
        <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow shadow-slate-950/40 space-y-3">
          <div className="grid gap-3 md:grid-cols-12 items-end">
            <div className="md:col-span-4 space-y-1">
              <label className="text-[0.7rem] text-slate-300">Arama</label>
              <input className="input" value={qText} onChange={(e) => setQText(e.target.value)} placeholder="otel, müşteri, şehir, tel..." />
            </div>

            <div className="md:col-span-3 space-y-1">
              <label className="text-[0.7rem] text-slate-300">Durum</label>
              <select className="input" value={statusF} onChange={(e) => setStatusF(e.target.value as any)}>
                <option value="all">Hepsi</option>
                <option value="active">Aktif</option>
                <option value="completed">Tamamlandı</option>
                <option value="cancelled">İptal</option>
              </select>
            </div>

            <div className="md:col-span-2 space-y-1">
              <label className="text-[0.7rem] text-slate-300">Giriş (min)</label>
              <input type="date" className="input" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>

            <div className="md:col-span-2 space-y-1">
              <label className="text-[0.7rem] text-slate-300">Çıkış (max)</label>
              <input type="date" className="input" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>

            <div className="md:col-span-1 space-y-1">
              <label className="text-[0.7rem] text-slate-300">Sırala</label>
              <select className="input" value={sortKey} onChange={(e) => setSortKey(e.target.value as any)}>
                <option value="new">Yeni</option>
                <option value="checkin">Giriş</option>
                <option value="price">Fiyat</option>
              </select>
            </div>

            <div className="md:col-span-12 flex items-center justify-between">
              <span className="text-[0.75rem] text-slate-400">Sonuç: <span className="text-slate-100 font-semibold">{filtered.length}</span></span>
              <button
                type="button"
                onClick={() => {
                  setQText("");
                  setStatusF("all");
                  setFromDate("");
                  setToDate("");
                  setSortKey("new");
                }}
                className="rounded-md border border-slate-700 px-3 py-2 text-[0.75rem] text-slate-200 hover:border-slate-500"
              >
                Temizle
              </button>
            </div>
          </div>
        </section>

        {loading && <p className="text-sm text-slate-400">Yükleniyor...</p>}

        {!loading && filtered.length === 0 && (
          <p className="text-sm text-slate-400">Henüz rezervasyon yok.</p>
        )}

        {!loading && filtered.length > 0 && (
          <section className="rounded-2xl border border-slate-800 bg-slate-950/80 shadow shadow-slate-950/40 overflow-hidden">
            <div className="hidden md:grid grid-cols-[1.6fr_1.4fr_1.2fr_1.2fr_auto] bg-slate-900 px-4 py-2 text-[0.75rem] font-semibold text-slate-100">
              <div>Müşteri / Otel</div>
              <div>Tarih</div>
              <div>Fiyat</div>
              <div>Durum</div>
              <div className="text-right">İşlemler</div>
            </div>

            {filtered.map((b) => {
              const nights = calcNights(b.checkIn, b.checkOut);
              const pax = (b.adults ?? 0) + (b.childrenCount ?? 0);
              const disc = b.agencyDiscountRate ?? null;
              const hotelOffer = b.originalHotelOfferPrice ?? null;

              return (
                <div key={b.id} className="border-t border-slate-800 px-4 py-3 grid md:grid-cols-[1.6fr_1.4fr_1.2fr_1.2fr_auto] gap-2 items-center">
                  <div className="space-y-1">
                    <div className="text-slate-100 font-semibold">
                      {safeStr(b.customerName, "Müşteri")}{" "}
                      <span className="text-slate-500 font-normal">•</span>{" "}
                      {safeStr(b.hotelName, "Otel")}
                    </div>
                    <div className="text-[0.75rem] text-slate-400">
                      {safeStr(b.city)}{b.district ? ` / ${b.district}` : ""} • {safeStr(b.customerPhone)}
                    </div>
                    <div className="text-[0.7rem] text-slate-500">
                      RezNo: {b.id}
                    </div>
                  </div>

                  <div className="space-y-1 text-slate-100">
                    <div className="text-[0.8rem]">
                      {b.checkIn} – {b.checkOut} <span className="text-slate-400 text-[0.7rem]">• {nights} gece</span>
                    </div>
                    <div className="text-[0.75rem] text-slate-300">
                      {pax} kişi • {b.roomsCount ?? 1} oda
                    </div>
                  </div>

                  <div className="space-y-1 text-slate-100">
                    <div className="text-[0.95rem] font-extrabold text-emerald-300">
                      {Number(b.totalPrice ?? 0).toLocaleString("tr-TR")} {b.currency}
                    </div>
                    <div className="text-[0.7rem] text-slate-400">
                      {paymentMethodText(String(b.paymentMethod))} • {safeStr(b.paymentStatus, "—")}
                    </div>
                    {hotelOffer != null && disc != null && (
                      <div className="text-[0.7rem] text-slate-400">
                        Otel: {Number(hotelOffer).toLocaleString("tr-TR")} → %{disc} düşüş
                      </div>
                    )}
                  </div>

                  <div className="space-y-1">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.7rem] ${statusBadgeCls(b)}`}>
                      {statusText(b)}
                    </span>
                    <div className="text-[0.7rem] text-slate-400">
                      Girişe kalan: <span className="text-slate-100">{timeUntilCheckIn(b)}</span>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2">
                    {canMessageBooking(b) && (
                      <button
                        type="button"
                        onClick={() => openMessage(b)}
                        className="rounded-md border border-emerald-500/70 px-3 py-2 text-[0.75rem] text-emerald-200 hover:bg-emerald-500/10"
                      >
                        Mesaj
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openDetail(b)}
                      className="rounded-md bg-sky-500 text-white px-3 py-2 text-[0.75rem] font-semibold hover:bg-sky-400"
                    >
                      Voucher / Detay
                    </button>
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {/* Detail modal */}
        {detailOpen && detailBooking && (
          <AgencyBookingVoucherModal booking={detailBooking} onClose={closeDetail} />
        )}

        {/* Message modal */}
        {messageOpen && messageBooking && profile?.uid && (
          <AgencyBookingMessageModal
            booking={messageBooking}
            currentUserId={profile.uid}
            messageText={messageText}
            setMessageText={setMessageText}
            sending={messageSending}
            error={messageErr}
            success={messageOk}
            onSubmit={sendMessage}
            onClose={closeMessage}
          />
        )}

        <style jsx global>{`
          .input {
            width: 100%;
            border-radius: 0.75rem;
            background: rgba(15, 23, 42, 0.72);
            border: 1px solid rgba(51, 65, 85, 1);
            padding: 0.65rem 0.85rem;
            color: #e5e7eb;
            outline: none;
            font-size: 0.9rem;
          }
          .input:focus { border-color: rgba(52, 211, 153, 0.8); }
        `}</style>
      </div>
    </Protected>
  );
}
function AgencyBookingVoucherModal({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const nights = calcNights(booking.checkIn, booking.checkOut);
  const pax = (booking.adults ?? 0) + (booking.childrenCount ?? 0);

  const voucherText = useMemo(() => {
    const lines: string[] = [];
    lines.push("Biddakika • Acenta Rezervasyon Voucher");
    lines.push(`Rezervasyon No: ${booking.id}`);
    lines.push("");
    lines.push(`Otel: ${safeStr(booking.hotelName)}`);
    lines.push(`Konum: ${safeStr(booking.city)}${booking.district ? " / " + booking.district : ""}`);
    lines.push(`Tarih: ${booking.checkIn} – ${booking.checkOut} (${nights} gece)`);
    lines.push(`Kişi/Oda: ${pax} kişi • ${booking.roomsCount ?? 1} oda`);
    if (booking.childrenAges?.length) lines.push(`Çocuk yaşları: ${booking.childrenAges.join(", ")}`);
    lines.push("");
    lines.push(`Müşteri: ${safeStr(booking.customerName)} • Tel: ${safeStr(booking.customerPhone)}`);
    if (booking.customerEmail) lines.push(`E-posta: ${booking.customerEmail}`);
    lines.push("");
    lines.push(`Acenta fiyatı: ${Number(booking.totalPrice ?? 0).toLocaleString("tr-TR")} ${booking.currency}`);
    if (booking.originalHotelOfferPrice != null && booking.agencyDiscountRate != null) {
      lines.push(`Otel teklifi: ${Number(booking.originalHotelOfferPrice).toLocaleString("tr-TR")} (${booking.currency})`);
      lines.push(`Acenta indirim oranı: %${booking.agencyDiscountRate}`);
    }
    lines.push(`Ödeme: ${paymentMethodText(String(booking.paymentMethod))} • Durum: ${safeStr(booking.paymentStatus)}`);
    lines.push(`Rezervasyon durumu: ${statusText(booking)}`);
    return lines.join("\n");
  }, [booking, nights, pax]);

  function handlePrint() {
    if (typeof window === "undefined") return;
    window.print();
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(voucherText);
      alert("Voucher metni kopyalandı.");
    } catch {
      alert("Kopyalanamadı.");
    }
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-start justify-center bg-black/60">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative mt-12 w-full max-w-4xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-xl max-h-[86vh] overflow-y-auto space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Rezervasyon Voucher / Detay</h2>
            <p className="text-[0.75rem] text-slate-400">#{booking.id}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handlePrint} className="rounded-md bg-slate-100 text-slate-900 px-3 py-2 text-xs font-semibold hover:bg-white">
              Yazdır / PDF
            </button>
            <button onClick={handleCopy} className="rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-slate-500">
              Metni kopyala
            </button>
            <button onClick={onClose} className="rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-emerald-400">
              Kapat ✕
            </button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <MiniCard label="Otel" value={safeStr(booking.hotelName)} sub={`${safeStr(booking.city)}${booking.district ? " / " + booking.district : ""}`} />
          <MiniCard label="Tarih" value={`${booking.checkIn} – ${booking.checkOut}`} sub={`${nights} gece • ${pax} kişi • ${booking.roomsCount ?? 1} oda`} />
          <MiniCard
            label="Acenta fiyatı"
            value={`${Number(booking.totalPrice ?? 0).toLocaleString("tr-TR")} ${booking.currency}`}
            sub={`${paymentMethodText(String(booking.paymentMethod))} • ${safeStr(booking.paymentStatus)}`}
            highlight
          />
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-2">
          <p className="text-sm font-semibold text-slate-100">Müşteri bilgileri</p>
          <div className="grid gap-2 md:grid-cols-3">
            <MiniCard label="Ad Soyad" value={safeStr(booking.customerName)} />
            <MiniCard label="Telefon" value={safeStr(booking.customerPhone)} />
            <MiniCard label="E-posta" value={safeStr(booking.customerEmail)} />
          </div>
        </div>

        {(booking.originalHotelOfferPrice != null || booking.agencyDiscountRate != null) && (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-2">
            <p className="text-sm font-semibold text-slate-100">İndirim / kaynak fiyat</p>
            <div className="grid gap-2 md:grid-cols-3">
              <MiniCard label="Otel teklifi" value={booking.originalHotelOfferPrice != null ? `${Number(booking.originalHotelOfferPrice).toLocaleString("tr-TR")} ${booking.currency}` : "—"} />
              <MiniCard label="Acenta indirim oranı" value={booking.agencyDiscountRate != null ? `%${booking.agencyDiscountRate}` : "—"} />
              <MiniCard label="Acenta fiyatı" value={`${Number(booking.totalPrice ?? 0).toLocaleString("tr-TR")} ${booking.currency}`} highlight />
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <p className="text-[0.75rem] text-slate-500 whitespace-pre-wrap">{voucherText}</p>
        </div>
      </div>
    </div>
  );
}

function MiniCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border border-slate-800 bg-slate-950/60 p-3 ${highlight ? "ring-1 ring-emerald-500/30" : ""}`}>
      <p className="text-[0.7rem] text-slate-400">{label}</p>
      <p className={`mt-1 font-semibold ${highlight ? "text-emerald-300" : "text-slate-100"}`}>{value}</p>
      {sub ? <p className="mt-1 text-[0.7rem] text-slate-400">{sub}</p> : null}
    </div>
  );
}

/* -------------------- MESAJ MODALI (ACENTA) -------------------- */
function AgencyBookingMessageModal({
  booking,
  currentUserId,
  messageText,
  setMessageText,
  sending,
  error,
  success,
  onSubmit,
  onClose
}: {
  booking: Booking;
  currentUserId: string;
  messageText: string;
  setMessageText: (v: string) => void;
  sending: boolean;
  error: string | null;
  success: string | null;
  onSubmit: (e: FormEvent) => void;
  onClose: () => void;
}) {
  const db = getFirestoreDb();
  const [messages, setMessages] = useState<BookingMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, "bookingMessages"),
      where("bookingId", "==", booking.id),
      orderBy("createdAt", "asc")
    );

    const unsub = onSnapshot(
      q,
      async (snap) => {
        const msgs: BookingMessage[] = snap.docs.map((d) => {
          const v = d.data() as any;
          return {
            id: d.id,
            bookingId: v.bookingId,
            hotelId: v.hotelId ?? null,
            guestId: v.guestId ?? null,
            senderRole: v.senderRole,
            text: v.text,
            createdAt: v.createdAt,
            read: v.read
          };
        });

        setMessages(msgs);
        setLoadingMessages(false);

        // otelden gelen okunmamış mesajları okundu işaretle
        const unread = snap.docs.filter((d) => {
          const v = d.data() as any;
          return v.senderRole === "hotel" && v.read === false;
        });

        for (const dSnap of unread) {
          try {
            await updateDoc(dSnap.ref, { read: true });
          } catch {}
        }
      },
      () => setLoadingMessages(false)
    );

    return () => unsub();
  }, [db, booking.id]);

  return (
    <div className="fixed inset-0 z-[95] flex items-start justify-center bg-black/60">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative mt-16 w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Otel ile mesajlaş</h2>
            <p className="text-[0.7rem] text-slate-400">{safeStr(booking.hotelName)} • {booking.checkIn} – {booking.checkOut}</p>
          </div>
          <button onClick={onClose} className="text-[0.75rem] text-slate-400 hover:text-slate-200">✕</button>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 h-60 overflow-y-auto px-3 py-2 space-y-2">
          {loadingMessages && <p className="text-[0.75rem] text-slate-400">Mesajlar yükleniyor...</p>}
          {!loadingMessages && messages.length === 0 && <p className="text-[0.75rem] text-slate-400">Henüz mesaj yok.</p>}

          {messages.map((m) => {
            const isMe = m.senderRole === "guest";
            const t = m.createdAt?.toDate ? m.createdAt.toDate().toLocaleString("tr-TR") : "";
            return (
              <div key={m.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[82%] rounded-xl px-3 py-2 text-[0.75rem] shadow ${
                  isMe ? "bg-emerald-500 text-slate-950 rounded-br-none" : "bg-slate-800 text-slate-100 rounded-bl-none"
                }`}>
                  <div className="whitespace-pre-wrap">{m.text}</div>
                  <div className="mt-1 text-[0.6rem] opacity-70">{t}</div>
                </div>
              </div>
            );
          })}
        </div>

        <form onSubmit={onSubmit} className="space-y-2">
          <textarea
            rows={3}
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 text-xs resize-none focus:border-emerald-400 outline-none"
            placeholder="Mesaj yaz..."
          />

          {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-200 text-xs">{error}</div>}
          {success && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-emerald-200 text-xs">{success}</div>}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-slate-500">
              Kapat
            </button>
            <button disabled={sending} className="rounded-md bg-emerald-500 text-slate-950 px-3 py-2 text-xs font-semibold hover:bg-emerald-400 disabled:opacity-60">
              {sending ? "Gönderiliyor..." : "Gönder"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
