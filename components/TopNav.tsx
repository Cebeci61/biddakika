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

  // guest
  return [
    { type: "link", href: "/dashboard/guest", label: "Anasayfa" },
    { type: "link", href: "/guest/requests/new", label: "Otel talebi" },
    { type: "link", href: "/guest/group-request", label: "Grup talebi" },
    { type: "link", href: "/guest/package-requests/new", label: "Paket talebi" },
    { type: "link", href: "/guest/offers", label: "Taleplerim" },
    { type: "link", href: "/guest/bookings", label: "Rezervasyonlarım" }
  ];
}

export default function TopNav() {
  const { profile, loading, logout } = useAuth() as any;
  const router = useRouter();
  const pathname = usePathname();

  // ✅ hooks en üstte
  const [mounted, setMounted] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [agencyGroupOpen, setAgencyGroupOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setMounted(true), []);

  const role: Role = (profile?.role ?? "guest") as Role;
  const roleLabel = roleLabelOf(role);

  const nav = useMemo(() => getNavForRole(role), [role]);
  const flatLinks = useMemo(() => nav.filter((x) => x.type === "link") as NavLinkT[], [nav]);
  const agencyGroup = useMemo(() => nav.find((x) => x.type === "group") as NavGroupT | undefined, [nav]);

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

  useEffect(() => {
    setProfileOpen(false);
    setAgencyGroupOpen(false);
    setMobileOpen(false);
  }, [pathname]);

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

  if (loading) return null;

  // ✅ PUBLIC: SADECE Logo + 3 tab (Müşteri/Otel/Acenta). Başka hiçbir şey yok.
  if (!profile) {
    const Tab = ({
      label,
      hint,
      onClick
    }: {
      label: string;
      hint: string;
      onClick: () => void;
    }) => (
      <button
        type="button"
        onClick={onClick}
        className="group inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/40 px-4 py-2 text-xs text-slate-100 hover:border-emerald-400 hover:bg-slate-900/70 transition"
      >
        <span className="font-semibold">{label}</span>
        <span className="text-[0.65rem] text-slate-400 group-hover:text-slate-300">{hint}</span>
      </button>
    );

    return (
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <div ref={rootRef} className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-white/5 transition"
          >
            <span className="text-sm font-semibold text-emerald-400 tracking-wide">Biddakika</span>
          </button>

          {/* Desktop tabs */}
          <div className="hidden md:flex items-center gap-2">
            <Tab label="Müşteri" hint="talep aç" onClick={() => router.push("/auth/register")} />
            <Tab label="Otel" hint="teklif ver" onClick={() => router.push("/auth/register")} />
            <Tab label="Acenta" hint="paket sat" onClick={() => router.push("/auth/register")} />
          </div>

          {/* Mobile hamburger */}
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className="md:hidden inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-slate-100 hover:border-emerald-400 transition"
            aria-label="Menüyü aç"
            aria-expanded={mobileOpen}
          >
            <span className="text-sm">☰</span>
          </button>

          {/* Mobile drawer */}
          {mounted && mobileOpen
            ? createPortal(
                <div className="fixed inset-0 z-[9999] md:hidden">
                  <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
                  <div
                    className="absolute right-0 top-0 h-full w-[86%] max-w-[380px] border-l border-white/10 bg-slate-950/92 backdrop-blur-xl shadow-2xl shadow-black/60 ring-1 ring-white/5 overflow-hidden"
                    style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
                  >
                    <div className="p-4 border-b border-white/10 flex items-center justify-between">
                      <p className="text-sm font-semibold text-white">Menü</p>
                      <button
                        onClick={() => setMobileOpen(false)}
                        className="rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-200 hover:border-emerald-400 transition"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="p-4 space-y-2">
                      <button
                        className="w-full rounded-2xl border border-white/10 px-4 py-3 text-left text-slate-100 hover:bg-white/5"
                        onClick={() => { setMobileOpen(false); router.push("/auth/register"); }}
                      >
                        Müşteri (talep aç)
                      </button>
                      <button
                        className="w-full rounded-2xl border border-white/10 px-4 py-3 text-left text-slate-100 hover:bg-white/5"
                        onClick={() => { setMobileOpen(false); router.push("/auth/register"); }}
                      >
                        Otel (teklif ver)
                      </button>
                      <button
                        className="w-full rounded-2xl border border-white/10 px-4 py-3 text-left text-slate-100 hover:bg-white/5"
                        onClick={() => { setMobileOpen(false); router.push("/auth/register"); }}
                      >
                        Acenta (paket sat)
                      </button>

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
                    </div>
                  </div>
                </div>,
                document.body
              )
            : null}
        </div>
      </header>
    );
  }

  // ✅ LOGIN VARSA: rol bazlı nav + profil menüsü
  const displayName = profile.displayName || profile.email || "Hesabım";

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <div ref={rootRef} className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-white/5 transition"
          >
            <span className="text-sm font-semibold text-emerald-400 tracking-wide">Biddakika</span>
          </button>

          <nav className="hidden md:flex items-center gap-6 text-sm text-slate-200">
            {role === "agency" && agencyGroup ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setAgencyGroupOpen((v) => !v)}
                  className={`transition-colors ${agencyGroupOpen ? "text-emerald-400" : "text-slate-200 hover:text-emerald-400"}`}
                >
                  {agencyGroup.label} ▾
                </button>
                {agencyGroupOpen && (
                  <div className="absolute left-0 mt-2 w-56 rounded-2xl border border-slate-800 bg-slate-950/95 p-2 text-xs shadow-lg z-50">
                    {agencyGroup.items.map((it) => (
                      <button
                        key={it.href}
                        type="button"
                        onClick={() => go(it.href)}
                        className={`w-full text-left rounded-xl px-3 py-2 hover:bg-white/5 transition ${
                          pathname === it.href ? "text-emerald-300" : "text-slate-100"
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
              className="md:hidden inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-slate-100 hover:border-emerald-400 transition"
            >
              <span className="text-sm">☰</span>
            </button>

            <div className="relative hidden md:block">
              <button
                type="button"
                onClick={() => setProfileOpen((v) => !v)}
                className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs text-slate-100 hover:border-emerald-400 transition"
              >
                <span className="font-semibold truncate max-w-[140px]">{displayName}</span>
                <span className="rounded-full bg-slate-800/80 px-2 py-0.5 text-[0.65rem] text-slate-300">{roleLabel}</span>
                <span className={`ml-0.5 text-[0.7rem] text-slate-400 transition ${profileOpen ? "rotate-180" : ""}`}>▾</span>
              </button>

              {profileOpen && (
                <div className="absolute right-0 mt-2 w-64 z-50 overflow-hidden rounded-2xl border border-white/10 bg-slate-950/90 backdrop-blur-xl shadow-2xl shadow-black/55 ring-1 ring-white/5">
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
        </div>
      </header>
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
      className={`text-sm transition-colors ${active ? "text-emerald-400" : "text-slate-200 hover:text-emerald-400"}`}
    >
      {children}
    </Link>
  );
}
