"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { createPortal } from "react-dom";
import { signOut, getAuth } from "firebase/auth";

type Role = "guest" | "hotel" | "agency" | "admin";
type NavLinkT = { type: "link"; href: string; label: string };
type NavGroupT = { type: "group"; label: string; items: { href: string; label: string }[] };
type NavEntry = NavLinkT | NavGroupT;

function roleLabelOf(role: Role) {
  if (role === "guest") return "Misafir";
  if (role === "hotel") return "Otel";
  if (role === "agency") return "Acenta";
  if (role === "admin") return "Admin";
  return "Kullanıcı";
}

function getNavForRole(role: Role): NavEntry[] {
  if (role === "hotel") {
    return [
      { type: "link", href: "/hotel/dashboard", label: "Anasayfa" },
      { type: "link", href: "/hotel/requests/inbox", label: "Gelen talepler" },
      { type: "link", href: "/hotel/offers", label: "Verdiğim teklifler" },
      { type: "link", href: "/hotel/bookings", label: "Rezervasyonlar" },
      { type: "link", href: "/hotel/accounting", label: "Faturalarım" },
      { type: "link", href: "/hotel/profile", label: "Otel profilim" }
    ];
  }

  if (role === "agency") {
    return [
      {
        type: "group",
        label: "Talep",
        items: [
          { href: "/agency/requests/hotel/new", label: "Otel talebi" },
          { href: "/agency/requests/group/new", label: "Grup talebi" },
          { href: "/agency/requests/package/new", label: "Paket talebi" }
        ]
      },
      { type: "link", href: "/agency/requests", label: "Taleplerim" },
      { type: "link", href: "/agency/packages/inbox", label: "Gelen paket talepleri" },
      { type: "link", href: "/agency/packages/offers", label: "Verdiğim paket teklifleri" },
      { type: "link", href: "/agency/bookings", label: "Rezervasyonlar" },
      { type: "link", href: "/agency/accounting", label: "Faturalar" },
      { type: "link", href: "/agency/business", label: "İşletmem" }
    ];
  }

  if (role === "admin") {
    return [{ type: "link", href: "/admin", label: "Admin Panel" }];
  }

  return [
    { type: "link", href: "/dashboard/guest", label: "Anasayfa" },
    { type: "link", href: "/guest/requests/new", label: "Otel talebi" },
    { type: "link", href: "/guest/group-request", label: "Grup talebi" },
    { type: "link", href: "/guest/package-requests/new", label: "Paket talebi" },
    { type: "link", href: "/guest/offers", label: "Taleplerim" },
    { type: "link", href: "/guest/bookings", label: "Rezervasyonlarım" }
  ];
}

/** ✅ Scroll: aşağı inerken soluklaş + yukarı kay, yukarı çıkarken görün */
function useSmartHeader() {
  const [s, setS] = useState({ condensed: false, hidden: false, opacity: 1 });

  useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;

    const onScroll = () => {
      if (ticking) return;
      ticking = true;

      window.requestAnimationFrame(() => {
        const y = window.scrollY;
        const down = y > lastY;

        const condensed = y > 10;
        const hidden = down && y > 90;

        // y büyüdükçe opaklık azalsın ama tamamen yok olmasın
        const opacity = hidden ? 0.22 : condensed ? 0.88 : 1;

        setS({ condensed, hidden, opacity });
        lastY = y;
        ticking = false;
      });
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return s;
}

/** ✅ Mobil drawer açıkken body scroll kapat */
function useLockBodyScroll(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [locked]);
}
export default function TopNav() {
  const { profile, loading, logout } = useAuth() as any;
  const router = useRouter();
  const pathname = usePathname();

  const { condensed, hidden, opacity } = useSmartHeader();

  const [mounted, setMounted] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [agencyGroupOpen, setAgencyGroupOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setMounted(true), []);
  useLockBodyScroll(mobileOpen);

  // dışarı tıkla kapat
  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      const el = e.target as HTMLElement;
      if (!rootRef.current) return;
      if (!rootRef.current.contains(el)) {
        setProfileOpen(false);
        setAgencyGroupOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  // ESC kapat
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setProfileOpen(false);
        setAgencyGroupOpen(false);
        setMobileOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // route değişince kapat
  useEffect(() => {
    setProfileOpen(false);
    setAgencyGroupOpen(false);
    setMobileOpen(false);
  }, [pathname]);

  // ✅ redirect bug fix:
  // PUBLIC tablar auth/register’a gitmeyecek.
  // Auth butonları sadece login/register için kullanılacak.

  const role: Role = (profile?.role ?? "guest") as Role;
  const roleLabel = roleLabelOf(role);

  const nav = useMemo(() => getNavForRole(role), [role]);
  const flatLinks = useMemo(() => nav.filter((x) => x.type === "link") as NavLinkT[], [nav]);
  const agencyGroup = useMemo(() => nav.find((x) => x.type === "group") as NavGroupT | undefined, [nav]);

  function go(href: string) {
    setProfileOpen(false);
    setAgencyGroupOpen(false);
    setMobileOpen(false);
    router.push(href);
  }

  async function handleLogout() {
    try {
      setProfileOpen(false);
      setAgencyGroupOpen(false);
      setMobileOpen(false);
      if (typeof logout === "function") await logout();
      else await signOut(getAuth());
      router.replace("/");
    } catch (err) {
      console.error("Logout error:", err);
      router.replace("/");
    }
  }

  const isAuthed = !!profile; // loading olsa bile profile varsa authed say
  const showPublic = !isAuthed; // ✅ public branch

  // ✅ navbar geç gelmesin: loading’de bile public nav göster
  const headerCls =
    "sticky top-0 z-50 w-full border-b border-white/10 backdrop-blur-xl transition-all duration-200 " +
    (condensed ? "bg-slate-950/40" : "bg-slate-950/70");

  const translate = hidden ? "-10px" : "0px";
  const padY = condensed ? "py-2" : "py-3";

  const maxW = "max-w-6xl";
  const navGap = condensed ? "gap-4" : "gap-6";

  // TopNav.tsx içinde publicTabs
const publicTabs = [
  { label: "Müşteri", hint: "otel talebi", href: "/otel-talebi" }, // ✅ burası
  { label: "Otel", hint: "demo panel", href: "/demo/otel-gelen-talepler" },
  { label: "Acenta", hint: "demo paket", href: "/demo/acentaya-gelen-paketler" }
];

  const displayName = profile?.displayName || profile?.email || "Hesabım";

  return (
    <>
      <header
        className={headerCls}
        style={{
          paddingTop: "env(safe-area-inset-top)",
          transform: `translateY(${translate})`,
          opacity
        }}
      >
        <div ref={rootRef} className={`mx-auto flex ${maxW} items-center justify-between px-4 ${padY}`}>
          {/* ✅ Tek logo: 🏨 Biddakika */}
          <button
            type="button"
            onClick={() => router.push("/")}
            className="flex items-center gap-2 rounded-xl px-2 py-1 hover:bg-white/5 transition"
            aria-label="Biddakika anasayfa"
          >
            <span className="text-base leading-none">🏨</span>
            <span className="text-sm md:text-base font-semibold text-emerald-400 tracking-wide">
              Biddakika
            </span>
          </button>

          {/* CENTER */}
          {showPublic ? (
            <>
              <nav className={`hidden md:flex items-center ${navGap} text-sm text-slate-200`}>
                {publicTabs.map((t) => (
                  <button
                    key={t.href}
                    type="button"
                    onClick={() => go(t.href)}
                    className="group inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-slate-100 hover:bg-white/10 transition"
                  >
                    <span className="font-semibold">{t.label}</span>
                    <span className="text-[0.65rem] text-slate-400 group-hover:text-slate-300">{t.hint}</span>
                  </button>
                ))}
              </nav>

              <div className="flex items-center gap-2">
                {/* mobile hamburger */}
                <button
                  type="button"
                  onClick={() => setMobileOpen((v) => !v)}
                  className="md:hidden inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-slate-100 hover:bg-white/10 transition"
                  aria-label="Menüyü aç"
                  aria-expanded={mobileOpen}
                >
                  ☰
                </button>

                {/* desktop auth buttons */}
                <Link
                  href="/auth/login"
                  className="hidden md:inline-flex rounded-full border border-white/10 bg-white/0 px-4 py-2 text-xs text-slate-200 hover:bg-white/5"
                >
                  Giriş yap
                </Link>
                <Link
                  href="/auth/register"
                  className="hidden md:inline-flex rounded-full bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
                >
                  Kayıt ol
                </Link>
              </div>
            </>
          ) : (
            <>
              <nav className={`hidden md:flex items-center ${navGap} text-sm text-slate-200`}>
                {role === "agency" && agencyGroup ? (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setAgencyGroupOpen((v) => !v)}
                      className={`transition-colors ${agencyGroupOpen ? "text-emerald-300" : "text-slate-200 hover:text-emerald-300"}`}
                    >
                      {agencyGroup.label} ▾
                    </button>

                    {agencyGroupOpen && (
                      <div className="absolute left-0 mt-2 w-56 rounded-2xl border border-white/10 bg-slate-950/80 backdrop-blur-xl p-2 text-xs shadow-2xl z-[70]">
                        {agencyGroup.items.map((it) => (
                          <button
                            key={it.href}
                            type="button"
                            onClick={() => go(it.href)}
                            className={`w-full text-left rounded-xl px-3 py-2 hover:bg-white/5 transition ${
                              pathname === it.href ? "text-emerald-200" : "text-slate-100"
                            }`}
                          >
                            {it.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}

                {flatLinks.map((l) => (
                  <TopNavLink key={l.href} href={l.href} pathname={pathname}>
                    {l.label}
                  </TopNavLink>
                ))}
              </nav>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMobileOpen((v) => !v)}
                  className="md:hidden inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-slate-100 hover:bg-white/10 transition"
                  aria-label="Menüyü aç"
                  aria-expanded={mobileOpen}
                >
                  ☰
                </button>

                {/* desktop profile */}
                <div className="relative hidden md:block">
                  <button
                    type="button"
                    onClick={() => setProfileOpen((v) => !v)}
                    aria-haspopup="menu"
                    aria-expanded={profileOpen}
                    className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-100 hover:bg-white/10 transition"
                  >
                    <span className="font-semibold truncate max-w-[160px]">{displayName}</span>
                    <span className="rounded-full bg-white/5 px-2 py-0.5 text-[0.65rem] text-slate-300">{roleLabel}</span>
                    <span className={`ml-0.5 text-[0.7rem] text-slate-400 transition ${profileOpen ? "rotate-180" : ""}`}>▾</span>
                  </button>

                  {profileOpen && (
                    <div className="absolute right-0 mt-2 w-64 z-[80] overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80 backdrop-blur-xl shadow-2xl">
                      <div className="p-3">
                        <p className="mb-2 border-b border-white/10 pb-2 text-[0.7rem] text-slate-300">
                          Rolün: <span className="font-semibold text-white">{roleLabel}</span>
                        </p>

                        <div className="space-y-1">
                          {flatLinks.map((l) => (
                            <button
                              key={l.href}
                              type="button"
                              onClick={() => go(l.href)}
                              className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition ${
                                pathname === l.href ? "bg-emerald-500/10 text-emerald-200" : "text-slate-100 hover:bg-white/5"
                              }`}
                            >
                              <span>{l.label}</span>
                            </button>
                          ))}
                        </div>

                        <div className="mt-3 border-t border-white/10 pt-2">
                          <button
                            type="button"
                            onClick={handleLogout}
                            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-red-300 hover:bg-red-500/10 hover:text-red-200 transition"
                          >
                            <span>Çıkış yap</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </header>
      {/* ✅ MOBILE DRAWER */}
      {mounted && mobileOpen
        ? createPortal(
            <div className="fixed inset-0 z-[9999] md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
              {/* overlay */}
              <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />

              {/* panel */}
              <div className="absolute right-0 top-0 h-full w-[86%] max-w-[380px] border-l border-white/10 bg-slate-950/92 backdrop-blur-xl shadow-2xl">
                <div className="p-4 border-b border-white/10 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🏨</span>
                    <p className="text-sm font-semibold text-white">Biddakika</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMobileOpen(false)}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
                  >
                    ✕
                  </button>
                </div>

                <div className="p-4 space-y-2 overflow-y-auto h-[calc(100%-72px)]">
                  {showPublic ? (
                    <>
                      {publicTabs.map((t) => (
                        <MobileItem
                          key={t.href}
                          title={t.label}
                          desc={t.hint}
                          onClick={() => {
                            setMobileOpen(false);
                            router.push(t.href);
                          }}
                        />
                      ))}

                      <div className="pt-2 grid gap-2">
                        <Link
                          href="/auth/login"
                          onClick={() => setMobileOpen(false)}
                          className="rounded-2xl border border-white/10 px-4 py-3 text-slate-100 hover:bg-white/5"
                        >
                          Giriş yap
                        </Link>
                        <Link
                          href="/auth/register"
                          onClick={() => setMobileOpen(false)}
                          className="rounded-2xl bg-emerald-500 px-4 py-3 font-semibold text-slate-950 hover:bg-emerald-400"
                        >
                          Kayıt ol
                        </Link>
                      </div>
                    </>
                  ) : (
                    <>
                      {role === "agency" && agencyGroup ? (
                        <div className="rounded-2xl border border-white/10 overflow-hidden">
                          <div className="px-4 py-3 bg-white/5 text-sm font-semibold text-slate-100">
                            {agencyGroup.label}
                          </div>
                          <div className="p-3 space-y-2">
                            {agencyGroup.items.map((it) => (
                              <MobileNavBtn
                                key={it.href}
                                active={pathname === it.href}
                                onClick={() => go(it.href)}
                                label={it.label}
                              />
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <div className="space-y-2">
                        {flatLinks.map((l) => (
                          <MobileNavBtn
                            key={l.href}
                            active={pathname === l.href}
                            onClick={() => go(l.href)}
                            label={l.label}
                          />
                        ))}
                      </div>

                      <div className="pt-2">
                        <button
                          type="button"
                          onClick={handleLogout}
                          className="w-full rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-left text-red-200 hover:bg-red-500/15"
                        >
                          Çıkış yap
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function TopNavLink({
  href,
  pathname,
  children
}: {
  href: string;
  pathname: string | null;
  children: React.ReactNode;
}) {
  const active = pathname === href;
  return (
    <Link
      href={href}
      className={`text-sm transition-colors ${
        active ? "text-emerald-300" : "text-slate-200 hover:text-emerald-300"
      }`}
    >
      {children}
    </Link>
  );
}

function MobileItem({ title, desc, onClick }: { title: string; desc: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-2xl border border-white/10 bg-white/0 px-4 py-3 text-left text-slate-100 hover:bg-white/5"
    >
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-[0.75rem] text-slate-400">{desc}</div>
    </button>
  );
}

function MobileNavBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl px-4 py-3 text-left border transition ${
        active
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
          : "border-white/10 bg-white/0 text-slate-100 hover:bg-white/5"
      }`}
    >
      <div className="text-sm font-semibold">{label}</div>
    </button>
  );
}
