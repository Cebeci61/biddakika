// app/hotel/offers/page.tsx
"use client";

import { useEffect, useState } from "react";
import { Protected } from "@/components/Protected";
import { useAuth } from "@/context/AuthContext";
import { getFirebaseAuth, getFirestoreDb } from "@/lib/firebase/client";
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  Timestamp
} from "firebase/firestore";

interface HotelOffer {
  id: string;
  requestId: string;
  totalPrice: number;
  currency: string;
  mode: "simple" | "refreshable" | "negotiable";
  note?: string | null;
  status: string;
  createdAt?: Timestamp;
}

export default function HotelOffersPage() {
  const { profile } = useAuth();
  const auth = getFirebaseAuth();
  const db = getFirestoreDb();
  const [offers, setOffers] = useState<HotelOffer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const user = auth.currentUser;
      if (!user) return;
      setLoading(true);
      try {
        const q = query(
          collection(db, "offers"),
          where("hotelId", "==", user.uid),
          orderBy("createdAt", "desc")
        );
        const snap = await getDocs(q);
        const data: HotelOffer[] = snap.docs.map((d) => {
          const v = d.data() as any;
          return {
            id: d.id,
            requestId: v.requestId,
            totalPrice: v.totalPrice,
            currency: v.currency,
            mode: v.mode,
            note: v.note ?? null,
            status: v.status ?? "sent",
            createdAt: v.createdAt
          };
        });
        setOffers(data);
      } catch (err) {
        console.error("Teklifler yüklenirken hata:", err);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [auth, db]);

  return (
    <Protected allowedRoles={["hotel"]}>
      <div className="container-page space-y-4">
        <h1 className="text-2xl font-semibold">Verdiğim teklifler</h1>
        <p className="text-sm text-slate-300 max-w-2xl">
          Biddakika üzerinden misafir taleplerine verdiğiniz tüm teklifleri burada
          görürsünüz. İlerleyen aşamada, misafir tarafında kabul edilen teklifler
          &quot;rezervasyon&quot;a dönecek ve statüleri güncellenecek.
        </p>

        {loading && <p className="text-sm text-slate-400">Teklifler yükleniyor...</p>}

        {!loading && offers.length === 0 && (
          <p className="text-sm text-slate-400">
            Henüz gönderilmiş bir teklifiniz yok. Önce &quot;Gelen talepler&quot;den bir
            talep seçip teklif verebilirsiniz.
          </p>
        )}

        <div className="space-y-3 text-xs">
          {offers.map((o) => (
            <div
              key={o.id}
              className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 space-y-1"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-100">
                  Talep ID: {o.requestId.slice(0, 8)}…
                </span>
                <span className="text-[0.65rem] text-slate-400">
                  Durum: {o.status || "sent"}
                </span>
              </div>
              <p className="text-slate-200">
                {o.totalPrice} {o.currency} •{" "}
                {o.mode === "simple"
                  ? "%8 Standart"
                  : o.mode === "refreshable"
                  ? "%10 Yenilenebilir"
                  : "%15 Pazarlıklı"}
              </p>
              {o.note && (
                <p className="text-[0.7rem] text-slate-400">
                  Misafire not: {o.note}
                </p>
              )}
              {o.createdAt && (
                <p className="text-[0.65rem] text-slate-500">
                  {o.createdAt.toDate().toLocaleString()}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </Protected>
  );
}
