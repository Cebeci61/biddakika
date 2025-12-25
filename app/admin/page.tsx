"use client";

import { useMemo, useState } from "react";
import { Protected } from "@/components/Protected";

import AdminShell, { AdminTabKey } from "./_components/AdminShell";
import DashboardPanel from "./_components/DashboardPanel";
import RequestsPanel from "./_components/RequestsPanel";
import OffersPanel from "./_components/OffersPanel";
import UsersAccountingPanel from "./_components/UsersAccountingPanel";

export default function AdminHome() {
  const [tab, setTab] = useState<AdminTabKey>("dashboard");

  const content = useMemo(() => {
    switch (tab) {
      case "dashboard":
        return <DashboardPanel />;
      case "requests":
        return <RequestsPanel />;
      case "offers":
        return <OffersPanel />;
      case "users_accounting":
        return <UsersAccountingPanel />;
      default:
        return <DashboardPanel />;
    }
  }, [tab]);

   return (
    <Protected allowedRoles={["admin"]}>
      <AdminShell />
    </Protected>
  );
}
