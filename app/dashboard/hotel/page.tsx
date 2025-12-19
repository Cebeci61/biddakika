// app/dashboard/hotel/page.tsx
"use client";

import { Protected } from "@/components/Protected";
import { useAuth } from "@/context/AuthContext";

export default function HotelDashboard() {
  const { profile } = useAuth();

  return (
    <Protected allowedRoles={["hotel"]}>
      <div className="container-page space-y-8">
        {/* Başlık + özet */}
        <section className="rounded-2xl border border-slate-800 bg-slate-950/80 px-6 py-5 shadow shadow-slate-950/50">
          <h1 className="text-2xl md:text-3xl font-semibold mb-1">
            Hoş geldiniz, {profile?.displayName || "otel yetkilisi"} 👋
          </h1>
          <p className="text-sm text-slate-300 max-w-2xl">
            Biddakika otel panelinde; gelen misafir taleplerini görebilir, her talep
            için canlı teklif verebilir, verdiğiniz teklifleri takip edebilir,
            onaylanan rezervasyonlarınızı ve ileride muhasebe verilerinizi buradan
            yönetebilirsiniz.
          </p>
        </section>

        {/* Hızlı istatistik kartları (MVP: statik açıklama / ileride Firestore sayım bağlanacak) */}
        <section className="grid gap-4 md:grid-cols-4 text-xs">
          <div className="rounded-2xl border border-emerald-500/50 bg-emerald-500/10 p-4">
            <p className="text-slate-200 font-semibold">Bugünkü yeni talepler</p>
            <p className="text-2xl font-bold text-emerald-200 mt-1">–</p>
            <p className="text-[0.7rem] text-emerald-100/80 mt-1">
              İleride, bulunduğun şehre düşen bugünkü talep sayısı burada gözükecek.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/90 p-4">
            <p className="text-slate-200 font-semibold">Aktif açık talepler</p>
            <p className="text-2xl font-bold text-slate-100 mt-1">–</p>
            <p className="text-[0.7rem] text-slate-400 mt-1">
              Açık durumdaki, cevap süresi henüz dolmamış taleplerin sayısı.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/90 p-4">
            <p className="text-slate-200 font-semibold">Bugün verdiğiniz teklifler</p>
            <p className="text-2xl font-bold text-slate-100 mt-1">–</p>
            <p className="text-[0.7rem] text-slate-400 mt-1">
              Bugün biddakika üzerinden göndermiş olduğunuz teklif adedi.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/90 p-4">
            <p className="text-slate-200 font-semibold">Bugünkü girişler / çıkışlar</p>
            <p className="text-2xl font-bold text-slate-100 mt-1">–</p>
            <p className="text-[0.7rem] text-slate-400 mt-1">
              Rezervasyonlar bölümünde dolacak; bugün giriş/çıkış yapan misafirleriniz.
            </p>
          </div>
        </section>

        {/* Ana navigasyon kartları */}
        <section className="grid gap-4 md:grid-cols-3 text-xs">
          <a
            href="/hotel/requests/inbox"
            className="rounded-2xl border border-emerald-500/50 bg-emerald-500/10 p-4 hover:border-emerald-300 transition shadow-sm shadow-emerald-500/20"
          >
            <h2 className="text-sm font-semibold text-emerald-100 flex items-center gap-2">
              <span>📥</span> Gelen talepler
            </h2>
            <p className="mt-1 text-emerald-50/90">
              Şehrinizdeki ve segmentinizdeki misafir taleplerini görün, her talep için
              komisyon modelinizi seçerek teklif verin.
            </p>
          </a>

          <a
            href="/hotel/offers"
            className="rounded-2xl border border-slate-800 bg-slate-950/90 p-4 hover:border-emerald-400 transition"
          >
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <span>📤</span> Verdiğim teklifler
            </h2>
            <p className="mt-1 text-slate-300">
              Gönderdiğiniz tüm teklifleri; durumuna göre (beklemede, onaylandı, reddedildi)
              burada takip edeceksiniz.
            </p>
          </a>

          <a
            href="/hotel/bookings"
            className="rounded-2xl border border-slate-800 bg-slate-950/90 p-4 hover:border-emerald-400 transition"
          >
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <span>📅</span> Rezervasyon listesi
            </h2>
            <p className="mt-1 text-slate-300">
              Onaylanan tekliflerin rezervasyona dönüştüğü ve giriş/çıkış tarihlerinin
              listelendiği alan.
            </p>
          </a>
        </section>

        <section className="grid gap-4 md:grid-cols-2 text-xs">
          <a
            href="/hotel/accounting"
            className="rounded-2xl border border-slate-800 bg-slate-950/90 p-4 hover:border-emerald-400 transition"
          >
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <span>💰</span> Muhasebe & raporlar
            </h2>
            <p className="mt-1 text-slate-300">
              Komisyon tutarları, net geliriniz, iptal oranlarınız ve dönemsel performans
              raporları burada toplanacak.
            </p>
          </a>
          <a
            href="/hotel/profile"
            className="rounded-2xl border border-slate-800 bg-slate-950/90 p-4 hover:border-emerald-400 transition"
          >
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <span>🏨</span> Otel profilim
            </h2>
            <p className="mt-1 text-slate-300">
              Otel adınız, adresiniz, oda tipleriniz ve özellikleriniz. Doğru eşleşme için
              profilinizi güncel tutun.
            </p>
          </a>
        </section>
      </div>
    </Protected>
  );
}
