"use client";

import { useMemo, useState } from "react";
import DashboardPanel from "./DashboardPanel";
import RequestsPanel from "./RequestsPanel";
import OffersPanel from "./OffersPanel";
import UsersAccountingPanel from "./UsersAccountingPanel";

export type AdminTabKey = "dashboard" | "requests" | "offers" | "users_accounting";

const TABS: {
  key: AdminTabKey;
  label: string;
  desc: string;
  icon: string;
  group: "Operasyon" | "Muhasebe";
}[] = [
  { key: "dashboard", label: "Genel Bakış", desc: "KPI, analiz, sistem sağlığı", icon: "📊", group: "Operasyon" },
  { key: "requests", label: "Talepler", desc: "Talep → teklif → rezervasyon akışı", icon: "🧾", group: "Operasyon" },
  { key: "offers", label: "Teklifler", desc: "İlan tarihi, indirim, gizle/göster", icon: "💬", group: "Operasyon" },
  { key: "users_accounting", label: "Üyeler & Muhasebe", desc: "Kullanıcı, cari, komisyon, rapor", icon: "🏦", group: "Muhasebe" },
];

export default function AdminShell() {
  const [activeTab, setActiveTab] = useState<AdminTabKey>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");

  const { title, subtitle } = useMemo(() => {
    const tab = TABS.find((t) => t.key === activeTab);
    return {
      title: tab?.label ?? "Admin Panel",
      subtitle: tab?.desc ?? "Yönetim",
    };
  }, [activeTab]);

  const content = useMemo(() => {
    switch (activeTab) {
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
  }, [activeTab]);

  const opTabs = TABS.filter((t) => t.group === "Operasyon");
  const finTabs = TABS.filter((t) => t.group === "Muhasebe");

  return (
    <div className="min-h-[100dvh] bg-[#070A12] text-slate-100">
      {/* BACKDROP */}
      <div className="pointer-events-none fixed inset-0 opacity-45">
        <div className="absolute -top-24 left-[12%] h-80 w-80 rounded-full bg-indigo-500 blur-[110px]" />
        <div className="absolute top-24 right-[12%] h-80 w-80 rounded-full bg-cyan-500 blur-[110px]" />
        <div className="absolute bottom-10 left-[40%] h-80 w-80 rounded-full bg-fuchsia-500 blur-[110px]" />
      </div>

      {/* TOP NAV */}
      <header className="relative z-20 border-b border-white/10 bg-black/20 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 md:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen((s) => !s)}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm hover:bg-white/[0.06] md:hidden"
            >
              Menü
            </button>

            <div className="flex items-center gap-2">
              <div className="text-lg font-semibold tracking-tight">Biddakika</div>
              <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[11px] text-slate-300">
                Admin
              </span>
            </div>

            <div className="hidden text-xs text-slate-400 md:block">• Yönetim Konsolu</div>
          </div>

          <div className="hidden flex-1 md:block">
            <div className="mx-auto max-w-xl">
              <div className="relative">
                <input
                  value={globalSearch}
                  onChange={(e) => setGlobalSearch(e.target.value)}
                  placeholder="Global ara (ID, misafir, otel, il/ilçe...)"
                  className="w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm outline-none focus:border-white/20"
                />
                <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                  ⌘K
                </div>
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                (Şimdilik UI) Sonraki adım: aktif sekmeye göre filtreyi otomatik doldursun.
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm hover:bg-white/[0.06]">
              Hızlı Filtre
            </button>
            <button className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm hover:bg-white/[0.06]">
              Rapor Al
            </button>
          </div>
        </div>
      </header>

      {/* LAYOUT */}
      <div className="relative mx-auto grid max-w-7xl grid-cols-1 gap-4 px-4 py-6 md:grid-cols-[320px_1fr] md:px-6">
        {/* SIDEBAR (desktop) */}
        <aside className="hidden md:block">
          <Sidebar
            activeTab={activeTab}
            setActiveTab={(t) => setActiveTab(t)}
            opTabs={opTabs}
            finTabs={finTabs}
          />
        </aside>

        {/* SIDEBAR (mobile overlay) */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-30 bg-black/70 md:hidden">
            <div className="h-full w-[86%] max-w-[360px] border-r border-white/10 bg-[#070A12] p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold">Menü</div>
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm hover:bg-white/[0.06]"
                >
                  Kapat
                </button>
              </div>

              <Sidebar
                activeTab={activeTab}
                setActiveTab={(t) => {
                  setActiveTab(t);
                  setSidebarOpen(false);
                }}
                opTabs={opTabs}
                finTabs={finTabs}
              />
            </div>
          </div>
        )}

        {/* MAIN */}
        <main className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl md:p-6">
          {/* Breadcrumb + Title */}
          <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-xs text-slate-400">
                Biddakika <span className="mx-1">›</span> Yönetim <span className="mx-1">›</span>{" "}
                <span className="text-slate-200">{title}</span>
              </div>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
              <div className="mt-1 text-sm text-slate-300">{subtitle}</div>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-300">
                Realtime: Açık
              </span>
              <span className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-300">
                Güvenlik: Rules
              </span>
            </div>
          </div>

          {/* CONTENT */}
          <div>{content}</div>
        </main>
      </div>
    </div>
  );
}

function Sidebar({
  activeTab,
  setActiveTab,
  opTabs,
  finTabs,
}: {
  activeTab: AdminTabKey;
  setActiveTab: (k: AdminTabKey) => void;
  opTabs: typeof TABS;
  finTabs: typeof TABS;
}) {
  return (
    <div className="sticky top-24 space-y-3">
      {/* Brand card */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl">
        <div className="text-lg font-semibold">Admin Paneli</div>
        <div className="mt-1 text-xs text-slate-300">Talepler • Teklifler • Rezervasyon • Muhasebe</div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <MiniStat label="Sistem" value="Stabil" />
          <MiniStat label="Mod" value="Prod" />
        </div>
      </div>

      {/* Groups */}
      <Group title="Operasyon">
        {opTabs.map((t) => (
          <SideButton key={t.key} tab={t} active={t.key === activeTab} onClick={() => setActiveTab(t.key)} />
        ))}
      </Group>

      <Group title="Muhasebe">
        {finTabs.map((t) => (
          <SideButton key={t.key} tab={t} active={t.key === activeTab} onClick={() => setActiveTab(t.key)} />
        ))}
      </Group>

      {/* Note */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="text-xs font-semibold text-slate-200">Premium Not</div>
        <div className="mt-1 text-xs text-slate-300">
          Bu panel “kurumsal dashboard” seviyesine yükseltildi. Bundan sonra hedef: rapor/PDF/Excel, log sistemi ve
          otomatik uyarılar.
        </div>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 backdrop-blur-xl">
      <div className="mb-2 text-xs font-semibold text-slate-300">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function SideButton({
  tab,
  active,
  onClick,
}: {
  tab: { key: AdminTabKey; label: string; desc: string; icon: string };
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "group w-full rounded-2xl border p-3 text-left transition",
        active ? "border-white/20 bg-white/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-lg">{tab.icon}</div>
        <div className="flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">{tab.label}</div>
            {active ? <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[11px] text-slate-300">Aktif</span> : null}
          </div>
          <div className="text-xs text-slate-300">{tab.desc}</div>
        </div>
      </div>
    </button>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}
