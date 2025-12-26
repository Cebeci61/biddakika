"use client";

import { addDoc, collection, getFirestore, serverTimestamp } from "firebase/firestore";

export type ActivityType =
  | "request_created"
  | "offer_created"
  | "offer_updated"
  | "offer_hidden"
  | "booking_created"
  | "invoice_paid"
  | "dispute_created"
  | "dispute_resolved"
  | "user_created";

export type ActorRole = "admin" | "guest" | "hotel" | "agency";

export async function logActivity(payload: {
  type: ActivityType;
  actorRole: ActorRole;
  actorId: string;
  actorName?: string;
  city?: string;
  district?: string;
  ref?: { collection: string; id: string };
  message: string;
  meta?: Record<string, any>;
}) {
  const db = getFirestore();
  await addDoc(collection(db, "activityLogs"), {
    type: payload.type,
    actorRole: payload.actorRole,
    actorId: payload.actorId,
    actorName: payload.actorName ?? "",
    city: payload.city ?? "",
    district: payload.district ?? "",
    ref: payload.ref ?? null,
    message: payload.message,
    meta: payload.meta ?? null,
    createdAt: serverTimestamp(),
  });
}
