// app/guest/package-requests/page.tsx
"use client";

import { Protected } from "@/components/Protected";

export default function PackageRequestsListPage() {
  return (
    <Protected allowedRoles={["guest"]}>
      <div className="container-page space-y-4">
        <h1 className="text-2xl font-semibold">Paket taleplerim</h1>
        <p className="text-sm text-slate-300">
          Açtığın tüm paket taleplerini burada listeleyeceğiz. Her talep için
          durum (açık, teklifler geliyor, kapandı), gelen teklif sayısı ve
          son tarih bilgilerini göreceksin.
        </p>
        <p className="text-xs text-slate-500">
          Bir sonraki aşamada bu sayfayı Firestore&apos;daki
          <code>packageRequests</code> koleksiyonuna bağlayacağız.
        </p>
      </div>
    </Protected>
  );
}
