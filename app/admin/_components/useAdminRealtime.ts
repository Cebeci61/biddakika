"use client";

import { useEffect, useMemo, useState } from "react";
import { subscribeCollection, WithId, tsToDate } from "./firestoreAdmin";
import { orderBy, where, limit } from "firebase/firestore";

export function useRealtimeList<T>(
  colName: string,
  opts?: {
    createdAtField?: string;
    whereEq?: { field: string; value: any }[];
    take?: number;
    orderDesc?: boolean;
  }
) {
  const createdAtField = opts?.createdAtField ?? "createdAt";
  const take = opts?.take ?? 200;
  const orderDesc = opts?.orderDesc ?? true;

  const constraints = useMemo(() => {
    const arr: any[] = [];
    for (const w of opts?.whereEq ?? []) arr.push(where(w.field, "==", w.value));
    arr.push(orderBy(createdAtField, orderDesc ? "desc" : "asc"));
    arr.push(limit(take));
    return arr;
  }, [opts?.whereEq, createdAtField, take, orderDesc]);

  const [rows, setRows] = useState<WithId<T>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setErr(null);
    const unsub = subscribeCollection<T>(
      colName,
      constraints,
      (data) => {
        setRows(data);
        setLoading(false);
      },
      (e) => {
        setErr(String(e?.message ?? e));
        setLoading(false);
      }
    );
    return () => unsub();
  }, [colName, constraints]);

  return { rows, loading, error };
}

export function isToday(v: any) {
  const d = tsToDate(v);
  if (!d) return false;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}
