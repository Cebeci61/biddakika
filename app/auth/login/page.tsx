"use client";

import { FormEvent, useState } from "react";
import { loginUser } from "@/lib/firebase/auth";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function LoginPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const formData = new FormData(form);
    const email = String(formData.get("email") || "");
    const password = String(formData.get("password") || "");

    try {
      setLoading(true);
      await loginUser(email, password);
      const role = profile?.role;
      if (role === "hotel") router.push("/dashboard/hotel");
      else if (role === "agency") router.push("/dashboard/agency");
      else if (role === "admin") router.push("/admin");
      else router.push("/dashboard/guest");
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Giriş sırasında bir hata oluştu.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container-page flex min-h-[calc(100vh-80px)] items-center justify-center">
      <div className="w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-950/80 p-6 md:p-8 shadow-xl shadow-slate-950/60 grid gap-8 md:grid-cols-[1.1fr_minmax(0,1fr)]">
        {/* Sol blok */}
        <div className="space-y-3">
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
            Tek panelden konaklamanı yönet.
          </h1>
          <p className="text-xs md:text-sm text-slate-300 max-w-md">
            Misafir, otel ya da acenta olarak; taleplerini, tekliflerini ve rezervasyonlarını
            Biddakika üzerinden takip et. Tek hesap, çok rol.
          </p>
          <ul className="space-y-1 text-[0.75rem] text-slate-300">
            <li>• Misafir: Talep aç, otellerden fiyat topla.</li>
            <li>• Otel: Paritesiz, stok zorunluluğu olmadan teklif ver.</li>
            <li>• Acenta: İleride çoklu otel ve kurumsal modülle güçlenecek.</li>
          </ul>
          <p className="text-[0.7rem] text-slate-500">
            Henüz hesabın yok mu?{" "}
            <a href="/auth/register" className="text-emerald-400 hover:text-emerald-300">
              Hemen kayıt ol
            </a>
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-slate-200">E-posta</label>
            <input
              name="email"
              type="email"
              required
              className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
              placeholder="ornek@mail.com"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-200">Şifre</label>
            <input
              name="password"
              type="password"
              required
              className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
            />
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/40 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full rounded-md bg-emerald-500 text-slate-950 text-sm font-medium py-2.5 shadow shadow-emerald-500/30 hover:bg-emerald-400 disabled:opacity-60"
          >
            {loading ? "Giriş yapılıyor..." : "Giriş Yap"}
          </button>

          <p className="text-[0.7rem] text-slate-500 text-right">
            Şifreni unuttuysan, şimdilik support üzerinden sıfırlayacağız. (Sonra burada
            “Şifremi Unuttum” akışını açacağız.)
          </p>
        </form>
      </div>
    </div>
  );
}
