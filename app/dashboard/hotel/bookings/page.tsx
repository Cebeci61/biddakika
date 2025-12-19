"use client";

import { Protected } from "@/components/Protected";

export default function HotelBookingsPage() {
  return (
    <Protected allowedRoles={["hotel"]}>
      <div className="container-page space-y-4">
        <h1 className="text-2xl font-semibold">Rezervasyon listesi</h1>
        <p className="text-sm text-slate-300 max-w-2xl">
          Misafir tarafından kabul edilen ve rezervasyona dönüşen tüm konaklamalar
          burada listelenecek. Giriş/çıkış tarihleri, oda tipleri, kişi sayıları ve
          komisyon bilgileri bu ekranda olacak.
        </p>
        <p className="text-xs text-slate-500">
          Bir sonraki aşamada, &quot;offers&quot; ve &quot;bookings&quot; koleksiyonları
          üzerinden bu ekranı gerçek veriye bağlayacağız.
        </p>
      </div>
    </Protected>
  );
}
