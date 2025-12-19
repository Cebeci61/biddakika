"use client";

import { Protected } from "@/components/Protected";
import { useAuth } from "@/context/AuthContext";

export default function AgencyDashboard() {
  const { profile } = useAuth();

  return (
    <Protected allowedRoles={["agency"]}>
      <div className="container-page space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Acenta Paneli</h1>
          <p className="text-sm text-slate-300">
            Hoş geldiniz {profile?.displayName || "acentacı"}. İlerleyen sürümlerde burada
            müşterileriniz için toplu talepler açabilecek, çoklu otel tekliflerini tek panelden
            yöneteceksiniz. Şimdilik profilinizi tamamlayarak başlayın.
          </p>
        </div>
      </div>
    </Protected>
  );
}
