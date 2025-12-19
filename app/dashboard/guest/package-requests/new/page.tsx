// app/guest/package-requests/new/page.tsx
"use client";

import { Protected } from "@/components/Protected";

export default function NewPackageRequestPage() {
  return (
    <Protected allowedRoles={["guest"]}>
      <div className="container-page max-w-2xl space-y-4">
        <h1 className="text-2xl font-semibold">Paket için talep oluştur</h1>
        <p className="text-sm text-slate-300">
          Buradan sadece otel değil; uçak, transfer, tur gibi hizmetleri de
          kapsayan bir paket talebi açacaksın. Bu talep, sisteme kayıtlı
          acentalara gidecek.
        </p>
        <p className="text-xs text-slate-500">
          Bu ekranda; şehir, tarih aralığı, kişi sayısı, bütçe aralığı ve
          istediğin ekstra hizmetleri (transfer, tur, araç kiralama vb.)
          seçeceğimiz bir form tasarlayacağız. Şimdilik sadece açıklama
          iskeleti duruyor.
        </p>
      </div>
    </Protected>
  );
}
