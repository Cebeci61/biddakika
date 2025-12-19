"use client";

import { Protected } from "@/components/Protected";

export default function AdminHome() {
  return (
    <Protected allowedRoles={["admin"]}>
      <div className="container-page space-y-4">
        <h1 className="text-2xl font-semibold">Admin Paneli</h1>
        <p className="text-sm text-slate-300">
          Burada; özellik checkbox listesini yönetme, kullanıcı rolleri, taleplerin ve tekliflerin
          genel görünümü gibi fonksiyonları yavaş yavaş ekleyeceğiz.
        </p>
      </div>
    </Protected>
  );
}
