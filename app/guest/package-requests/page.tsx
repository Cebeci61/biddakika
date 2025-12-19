"use client";

import { useEffect, useMemo, useState } from "react";
import { Protected } from "@/components/Protected";
import { useAuth } from "@/context/AuthContext";
import { getFirestoreDb } from "@/lib/firebase/client";
import { collection, getDocs, query, where, Timestamp } from "firebase/firestore";
import Link from "next/link";

type IncludeKey = "hotel" | "transfer" | "tour" | "guide" | "insurance";

type PackageRequest = {
  id: string;
  createdByRole: "guest" | "agency";
  createdById: string;

  title?: string | null;
  city: string;
  district?: string | null;

  dateFrom: string;
  dateTo: string;
  nights?: number;

  paxAdults: number;
  paxChildren?: number;
  childrenAges?: number[];

  include?: Partial<Record<IncludeKey, boolean>>;

  budgetMin?: number | null;
  budgetMax?: number | null;

  responseDeadlineMinutes?: number | null;
  notes?: string | null;

  status?: "open" | "expired" | "accepted" | "cancelled";
  createdAt?: Timestamp;
};

function safeStr(v: any, fallback = "—") {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s.length ? s : fallback;
}

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function calcNights(from?: string, to?: string) {
  const a = parseDate(from);
  const b = parseDate(to);
  if (!a || !b) return 1;
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  const diff = Math.floor((b.getTime() - a.getTime()) / 86400000);
  return diff > 0 ? diff : 1;
}

function includesLabel(include?: Partial<Record<IncludeKey, boolean>>) {
  const inc = include || {};
  const on: string[] = [];
  if (inc.hotel) on.push("Otel");
  if (inc.transfer) on.push("Transfer");
  if (inc.tour) on.push("Tur");
  if (inc.guide) on.push("Rehber");
  if (inc.insurance) on.push("Sigorta");
  return on.length ? on.join(" • ") : "—";
}

export default function GuestPackageRequestsPage() {
  const { profile, loading: authLoading } = useAuth() as any;
  const db = getFirestoreDb();

  const [rows, setRows] = useState<PackageRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (authLoading) return;
      if (!profile?.uid) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setErr(null);

      try {
        const qReq = query(
          collection(db, "packageRequests"),
          where("createdByRole", "==", "guest"),
          where("createdById", "==", profile.uid)
        );

        const snap = await getDocs(qReq);

        const list: PackageRequest[] = snap.docs.map((d) => {
          const v = d.data() as any;
          return {
            id: d.id,
            createdByRole: v.createdByRole ?? "guest",
            createdById: v.createdById ?? "",

            title: v.title ?? null,
            city: v.city ?? "",
            district: v.district ?? null,

            dateFrom: v.dateFrom ?? "",
            dateTo: v.dateTo ?? "",
            nights: v.nights ?? null,

            paxAdults: Number(v.paxAdults ?? 0),
            paxChildren: Number(v.paxChildren ?? 0),
            childrenAges: Array.isArray(v.childrenAges) ? v.childrenAges : [],

            include: v.include ?? {},

            budgetMin: v.budgetMin ?? null,
            budgetMax: v.budgetMax ?? null,

            responseDeadlineMinutes: v.responseDeadlineMinutes ?? 120,
            notes: v.notes ?? null,

            status: v.status ?? "open",
            createdAt: v.createdAt
          };
        });

        list.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
        setRows(list);
      } catch (e: any) {
        console.error(e);
        setErr(e?.message || "Paket taleplerin yüklenemedi.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [authLoading, profile, db]);

  const openCount = useMemo(() => rows.filter((r) => r.status === "open").length, [rows]);

  return (
    <Protected allowedRoles={["guest"]}>
      <div className="container-page space-y-6">
        <section className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-100">Paket Taleplerim</h1>
          <p className="text-sm text-slate-300">
            Buradaki talepleri <b>sadece acentalar</b> görür ve teklif verebilir.
          </p>
          <p className="text-[0.75rem] text-slate-400">
            Açık talep sayısı: <span className="text-emerald-300 font-semibold">{openCount}</span>
          </p>
        </section>

        {err && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-200 text-sm">
            {err}
          </div>
        )}

        {loading && <p className="text-sm text-slate-400">Yükleniyor...</p>}

        {!loading && rows.length === 0 && (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5 text-slate-300">
            Henüz paket talebin yok.{" "}
            <Link className="text-emerald-300 hover:text-emerald-200" href="/guest/package-requests/new">
              Yeni paket talebi oluştur →
            </Link>
          </div>
        )}

        {!loading && rows.length > 0 && (
          <section className="space-y-3">
            {rows.map((r) => {
              const nights = r.nights ?? calcNights(r.dateFrom, r.dateTo);
              const pax = r.paxAdults + (r.paxChildren ?? 0);

              return (
                <div key={r.id} className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow shadow-slate-950/40">
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-1 text-[0.7rem] text-sky-200">
                          PAKET TALEBİ
                        </span>
                        <span className="text-[0.7rem] text-slate-500">#{r.id}</span>
                      </div>

                      <div className="text-slate-100 font-semibold">
                        {safeStr(r.title, `${r.city}${r.district ? " / " + r.district : ""} Paket Talebi`)}
                      </div>

                      <div className="text-[0.8rem] text-slate-300">
                        {r.city}{r.district ? ` / ${r.district}` : ""} • {r.dateFrom} – {r.dateTo} • {nights} gece
                      </div>

                      <div className="text-[0.75rem] text-slate-400">
                        {pax} kişi • {includesLabel(r.include)}
                      </div>

                      {(r.budgetMin != null || r.budgetMax != null) && (
                        <div className="text-[0.75rem] text-slate-400">
                          Bütçe:{" "}
                          <span className="text-slate-200">
                            {r.budgetMin != null ? `${r.budgetMin.toLocaleString("tr-TR")} ₺` : "—"} –{" "}
                            {r.budgetMax != null ? `${r.budgetMax.toLocaleString("tr-TR")} ₺` : "—"}
                          </span>
                        </div>
                      )}

                      {r.notes && (
                        <div className="mt-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-[0.75rem] text-slate-300">
                          <span className="text-slate-400">Not:</span> {r.notes}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <span className="text-[0.75rem] text-slate-400">Durum: <span className="text-slate-200">{safeStr(r.status)}</span></span>

                      {/* Teklifleri göster sayfasını bir sonraki adımda yapacağız */}
                      <button
                        type="button"
                        onClick={() => alert("Sıradaki adım: Bu talebe gelen acenta tekliflerini listeleyeceğimiz sayfa.")}
                        className="rounded-md bg-emerald-500 text-slate-950 px-4 py-2 text-[0.85rem] font-semibold hover:bg-emerald-400"
                      >
                        Teklifleri gör
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </section>
        )}
      </div>
    </Protected>
  );
}
