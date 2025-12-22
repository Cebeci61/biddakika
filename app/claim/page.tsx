"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getFirebaseAuth } from "@/lib/firebase/client";

const LS_KEY = "bdk_public_claim_token_v1";
const LS_KEY_TIME = "bdk_public_claim_token_ts_v1";

export default function ClaimPublicRequestPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "ok" | "no-token" | "error">("loading");
  const [msg, setMsg] = useState<string>("");

  const callable = useMemo(() => {
    const auth = getFirebaseAuth();
    const app = (auth as any).app;
    const functions = getFunctions(app, "us-central1");
    return httpsCallable(functions, "claimPublicHotelRequest");
  }, []);

  useEffect(() => {
    async function run() {
      const auth = getFirebaseAuth();
      const user = auth.currentUser;

      if (!user) {
        // login yoksa login'e yönlendir
        router.replace("/auth/login?next=/claim");
        return;
      }

      const token = localStorage.getItem(LS_KEY);
      const ts = Number(localStorage.getItem(LS_KEY_TIME) || 0);

      // token yoksa: bu cihazda public talep yok
      if (!token) {
        setStatus("no-token");
        setMsg("Bu cihazda sana ait kayıt dışı talep bulunamadı.");
        return;
      }

      // 24 saat sınırı (isteğe bağlı)
      const ageHours = (Date.now() - ts) / (1000 * 60 * 60);
      if (ts && ageHours > 24) {
        localStorage.removeItem(LS_KEY);
        localStorage.removeItem(LS_KEY_TIME);
        setStatus("no-token");
        setMsg("Talep bağlantısı süresi dolmuş. Yeni talep oluştur.");
        return;
      }

      try {
        const res: any = await callable({ claimToken: token });
        const data = res?.data as any;

        // token artık kullanılmasın
        localStorage.removeItem(LS_KEY);
        localStorage.removeItem(LS_KEY_TIME);

        setStatus("ok");
        setMsg("Talebin hesabına bağlandı. Taleplerim sayfasına yönlendiriliyorsun…");

        setTimeout(() => {
          router.replace("/guest/offers");
        }, 900);
      } catch (e: any) {
        console.error("claim error:", e);
        setStatus("error");
        setMsg(`${e?.code || "error"}: ${e?.message || "Talep bağlanamadı"}`);
      }
    }

    run();
  }, [router, callable]);

  return (
    <div className="container-page max-w-xl py-16">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h1 className="text-xl font-semibold text-white">Talep bağlantısı</h1>
        <p className="mt-2 text-sm text-slate-300">
          Kayıt dışı oluşturduğun talebi hesabına bağlıyoruz.
        </p>

        <div className="mt-4 rounded-xl border border-white/10 bg-black/10 p-4 text-sm text-slate-200">
          {status === "loading" && "Kontrol ediliyor…"}
          {status === "ok" && msg}
          {status === "no-token" && msg}
          {status === "error" && msg}
        </div>

        {status === "no-token" && (
          <button
            onClick={() => router.replace("/otel-talebi")}
            className="mt-4 w-full rounded-xl bg-emerald-500 px-4 py-3 font-semibold text-slate-950 hover:bg-emerald-400"
          >
            Yeni talep oluştur
          </button>
        )}
      </div>
    </div>
  );
}
