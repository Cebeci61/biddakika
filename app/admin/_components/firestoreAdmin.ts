"use client";

import {
  collection,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  where,
  limit,
  Timestamp,
  DocumentData,
  QueryConstraint,
} from "firebase/firestore";
import { getApp, getApps, initializeApp } from "firebase/app";

// Eğer projende zaten firebase init dosyan varsa BUNU kullan.
// Ben burada güvenli fallback bıraktım (çakışma yapmasın diye).
function getDb() {
  // ⚠️ Eğer sende firebase init zaten varsa:
  // import { getFirestoreDb } from "@/lib/firebase";
  // return getFirestoreDb();
  try {
    const app = getApps().length ? getApp() : initializeApp({} as any);
    return getFirestore(app);
  } catch {
    // Senin projede zaten init vardır; burası sadece TS kırılmasın diye.
    return getFirestore();
  }
}

/** 🔧 Burayı SENİN Firestore koleksiyonlarına göre ayarlayacağız */
export const COLLECTIONS = {
  users: "users",
  offers: "offers",
  // sende “requests” farklı adla olabilir. Örn: "groupRequests" vs.
  requests: "requests",
  bookings: "bookings",
  notifications: "notifications",
  packageOffers: "packageOffers",
} as const;

export type WithId<T> = T & { id: string };

export function tsToDate(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (v instanceof Timestamp) return v.toDate();
  if (typeof v === "number") return new Date(v);
  if (typeof v === "string") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function subscribeCollection<T = DocumentData>(
  colName: string,
  constraints: QueryConstraint[],
  onData: (rows: WithId<T>[]) => void,
  onError?: (e: any) => void
) {
  const db = getDb();
  const colRef = collection(db, colName);

  const q = query(colRef, ...constraints);
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as T) })) as WithId<T>[];
      onData(rows);
    },
    (err) => onError?.(err)
  );
}

/** Dashboard için: son hareketler örnek */
export function subscribeLatest<T = DocumentData>(
  colName: string,
  createdAtField = "createdAt",
  take = 10,
  onData: (rows: WithId<T>[]) => void,
  onError?: (e: any) => void
) {
  return subscribeCollection<T>(
    colName,
    [orderBy(createdAtField as any, "desc"), limit(take)],
    onData,
    onError
  );
}
