// app/guest/packages/page.tsx
"use client";

import { Protected } from "@/components/Protected";

export default function ReadyPackagesPage() {
  return (
    <Protected allowedRoles={["guest"]}>
      <div className="container-page space-y-4">
        <h1 className="text-2xl font-semibold">Hazır paketler</h1>
        <p className="text-sm text-slate-300 max-w-2xl">
          Acentalar tarafından oluşturulan, tarih ve içerik bazında hazır
          paketleri burada listeleyeceğiz. Paket detayına girip direkt satın
          alabileceksin.
        </p>
        <p className="text-xs text-slate-500">
          İlerleyen fazda, bu sayfayı acentaların oluşturduğu
          <code>packages</code> koleksiyonuna bağlayacağız.
        </p>
      </div>
    </Protected>
  );
}
