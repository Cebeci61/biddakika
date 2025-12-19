"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

type Role = "guest" | "hotel" | "admin" | "agency";

export function Protected({
  allowedRoles,
  children
}: {
  allowedRoles: Role[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { profile, loading } = useAuth();

  // ✅ kritik: loading bitmeden redirect/rendere izin verme
  useEffect(() => {
    if (loading) return;

    // giriş yoksa
    if (!profile) {
      router.replace("/auth/login");
      return;
    }

    // rol uyumsuzsa
    if (!allowedRoles.includes(profile.role)) {
      // rolüne göre doğru panele at
      const target =
        profile.role === "hotel"
          ? "/hotel/requests/inbox"
          : profile.role === "admin"
          ? "/admin"
          : "/guest/offers";

      if (pathname !== target) router.replace(target);
    }
  }, [loading, profile, router, pathname, allowedRoles]);

  if (loading) {
    return (
      <div className="container-page">
        <p className="text-sm text-slate-400">Oturum kontrol ediliyor...</p>
      </div>
    );
  }

  // loading bitti ama profile yoksa (redirect beklerken)
  if (!profile) return null;

  // rol uyumsuzsa (redirect beklerken)
  if (!allowedRoles.includes(profile.role)) return null;

  return <>{children}</>;
}
