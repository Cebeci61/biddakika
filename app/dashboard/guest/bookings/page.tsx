// app/guest/bookings/page.tsx
"use client";

import { Protected } from "@/components/Protected";

export default function GuestBookingsPage() {
  return (
    <Protected allowedRoles={["guest"]}>
      <div className="container-page space-y-4">
        <h1 className="text-2xl font-semibold">Rezervasyonlarım</h1>
        <p className="text-sm text-slate-300 max-w-2xl">
          Burada tamamlanmış ve yaklaşan tüm rezervasyonlarını listeleyeceğiz.
          Her rezervasyon için otel adı, tarih aralığı, toplam tutar, ödeme
          durumu ve iptal koşullarını göstereceğiz.
        </p>
        <p className="text-xs text-slate-500">
          Şimdilik sadece iskelet hazır. Bir sonraki adımda otel ve paket
          rezervasyonlarını Firestore&apos;dan çekip burada göstereceğiz.
        </p>
      </div>
    </Protected>
  );
}
