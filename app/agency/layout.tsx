// app/agency/layout.tsx
"use client";

import { Protected } from "@/components/Protected";

export default function AgencyLayout({ children }: { children: React.ReactNode }) {
  return (
    <Protected allowedRoles={["agency"]}>
      <div className="container-page">
        <main className="min-w-0">{children}</main>
      </div>
    </Protected>
  );
}
