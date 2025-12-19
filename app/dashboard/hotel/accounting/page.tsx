"use client";

import { Protected } from "@/components/Protected";

export default function HotelAccountingPage() {
  return (
    <Protected allowedRoles={["hotel"]}>
      <div className="container-page space-y-4">
        <h1 className="text-2xl font-semibold">Muhasebe & raporlar</h1>
        <p className="text-sm text-slate-300 max-w-2xl">
          Biddakika üzerinden gerçekleşen rezervasyonlarınızın komisyon tutarları,
          net geliriniz, iptal oranlarınız ve dönemsel performans raporları bu
          ekranda toplanacak.
        </p>
        <p className="text-xs text-slate-500">
          MVP&apos;de bu sayfa iskelet seviyesinde bırakıldı. İlerleyen aşamada,
          &quot;offers&quot; ve &quot;bookings&quot; verilerinden aylık ve haftalık
          raporlar oluşturacağız.
        </p>
      </div>
    </Protected>
  );
}
