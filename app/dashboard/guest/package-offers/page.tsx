// app/guest/package-offers/page.tsx
"use client";

import { Protected } from "@/components/Protected";

export default function PackageOffersPage() {
  return (
    <Protected allowedRoles={["guest"]}>
      <div className="container-page space-y-4">
        <h1 className="text-2xl font-semibold">Paket için gelen teklifler</h1>
        <p className="text-sm text-slate-300 max-w-2xl">
          Açtığın paket taleplerine acentalardan gelen tüm teklifleri burada
          toplayacağız. Paket içeriği, toplam fiyat, dahil olan hizmetler ve
          tarih bilgilerini karşılaştırabileceksin.
        </p>
        <p className="text-xs text-slate-500">
          Bu ekranı, ileride <code>packageOffers</code> koleksiyonundaki
          verilerle besleyeceğiz.
        </p>
      </div>
    </Protected>
  );
}
