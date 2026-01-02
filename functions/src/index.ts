import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as crypto from "crypto";
import { getFirebaseAuth } from "@/lib/firebase/client";


admin.initializeApp();
const db = admin.firestore();

function clean(v: any) {
  return String(v ?? "").trim();
}
function digitsOnly(v: any) {
  return String(v ?? "").replace(/\D/g, "");
}
function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}
function randToken(len = 16) {
  return crypto.randomBytes(len).toString("hex"); // 32 char
}

// ✅ 1) Public (login yok) otel talebi oluşturur
export const createPublicHotelRequest = onCall(
  { region: "us-central1" },
  async (request) => {
    const data = (request.data ?? {}) as any;

    const contactName = clean(data.contactName);
    const phoneLocal = digitsOnly(data.contactPhoneLocal);
    const phoneCountryCode = clean(data.contactPhoneCountryCode || "+90");

    const city = clean(data.city);
    const districtRaw = clean(data.district);
    const district = districtRaw ? districtRaw : null;

    const checkIn = clean(data.checkIn);
    const checkOut = clean(data.checkOut);

    const adults = Number(data.adults ?? 1);
    const childrenCount = Number(data.childrenCount ?? 0);
    const roomsCount = Number(data.roomsCount ?? 1);

    const note = clean(data.note);
    const responseDeadlineMinutes = Number(data.responseDeadlineMinutes ?? 60);

    // ---- validation (net) ----
    if (contactName.length < 2) throw new HttpsError("invalid-argument", "contactName required");
    if (!phoneLocal || phoneLocal.length < 10) throw new HttpsError("invalid-argument", "phone invalid");
    if (!city) throw new HttpsError("invalid-argument", "city required");
    if (!checkIn || !checkOut) throw new HttpsError("invalid-argument", "dates required");

    if (!Number.isFinite(adults) || adults < 1) throw new HttpsError("invalid-argument", "adults invalid");
    if (!Number.isFinite(childrenCount) || childrenCount < 0) throw new HttpsError("invalid-argument", "childrenCount invalid");
    if (!Number.isFinite(roomsCount) || roomsCount < 1) throw new HttpsError("invalid-argument", "roomsCount invalid");

    const deadline = Number.isFinite(responseDeadlineMinutes) ? responseDeadlineMinutes : 60;
    const safeDeadline = Math.max(15, Math.min(60 * 24 * 7, deadline)); // min 15dk max 7 gün

    // ---- claim token üret ----
    const claimToken = randToken(16);
    const publicClaimHash = sha256(claimToken);

    const now = admin.firestore.FieldValue.serverTimestamp();

    const requestDoc = {
      type: "hotel",
      isGroup: false,

      // ✅ public lead
      isPublicLead: true,
      publicClaimHash, // sadece hash saklanır
      claimedAt: null,

      // login yok -> guestId yok
      guestId: null,
      guestDisplayName: null,

      contactName,
      contactPhoneCountryCode: phoneCountryCode,
      contactPhoneLocal: phoneLocal,
      contactPhone: `${phoneCountryCode} ${phoneLocal}`,

      // istersen email alanı yok kalsın:
      contactEmail: null,

      city,
      district,

      checkIn,
      checkOut,

      adults,
      childrenCount,
      roomsCount,

      // basit alanlar
      note: note ? note : null,

      responseDeadlineMinutes: safeDeadline,

      status: "open",
      createdAt: now,
    };

    const ref = await db.collection("requests").add(requestDoc);

    // ✅ otellere notification üretmek istersen burada yaparsın (istersen ekleriz)

    return {
      ok: true,
      requestId: ref.id,
      claimToken, // ✅ client bunu localStorage'a yazacak
      expiresHours: 24, // tokenı 24 saat saklayacağız
    };
  }
);

// ✅ 2) Login olduktan sonra public talebi kendi hesabına bağlar
export const claimPublicHotelRequest = onCall(
  { region: "us-central1" },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "login required");
    }
    const uid = request.auth.uid;
    const data = (request.data ?? {}) as any;

    const token = clean(data.claimToken);
    if (!token) throw new HttpsError("invalid-argument", "claimToken required");

    const hash = sha256(token);

    // public lead + hash eşleşen 1 kayıt bul
    const snap = await db
      .collection("requests")
      .where("isPublicLead", "==", true)
      .where("publicClaimHash", "==", hash)
      .limit(1)
      .get();

    if (snap.empty) throw new HttpsError("not-found", "request not found");

    const docSnap = snap.docs[0];
    const ref = docSnap.ref;
    const v = docSnap.data() as any;

    // daha önce claim edilmiş mi?
    if (v.guestId) throw new HttpsError("failed-precondition", "already claimed");

    await ref.update({
      guestId: uid,
      guestDisplayName: request.auth.token?.name ?? null,

      isPublicLead: false,
      publicClaimHash: admin.firestore.FieldValue.delete(),
      claimedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { ok: true, requestId: docSnap.id };
  }
);
export const restartGuestRequestAndResetOffers = onCall(
  {
    region: "us-central1",
    cors: true, // ✅ CORS FIX (localhost dahil)
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Login required");
    }

    const guestId = request.auth.uid;
    const requestId = String(request.data?.requestId || "").trim();
    const nextIn = String(request.data?.checkIn || "").trim();   // opsiyonel
    const nextOut = String(request.data?.checkOut || "").trim(); // opsiyonel

    if (!requestId) {
      throw new HttpsError("invalid-argument", "requestId required");
    }

    // yyyy-mm-dd validate
    const isISO = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
    const todayISO = () => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.toISOString().slice(0, 10);
    };
    const notPast = (s: string) => {
      const t = new Date(todayISO()).getTime();
      const x = new Date(s).setHours(0, 0, 0, 0);
      return x >= t;
    };

    if (nextIn) {
      if (!isISO(nextIn) || !notPast(nextIn)) {
        throw new HttpsError("invalid-argument", "checkIn must be today or future (YYYY-MM-DD)");
      }
    }
    if (nextOut) {
      if (!isISO(nextOut)) {
        throw new HttpsError("invalid-argument", "checkOut must be YYYY-MM-DD");
      }
    }
    if (nextIn && nextOut) {
      const a = new Date(nextIn).getTime();
      const b = new Date(nextOut).getTime();
      if (b < a) {
        throw new HttpsError("invalid-argument", "checkOut cannot be before checkIn");
      }
    }

    const reqRef = db.collection("requests").doc(requestId);

    await db.runTransaction(async (tx) => {
      const reqSnap = await tx.get(reqRef);
      if (!reqSnap.exists) {
        throw new HttpsError("not-found", "request not found");
      }
      const req = reqSnap.data() as any;

      const owner = String(req?.guestId || req?.createdById || "");
      if (owner !== guestId) {
        throw new HttpsError("permission-denied", "not your request");
      }

      // 1) request restart
      const reqPatch: any = {
        status: "open",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        restartedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (nextIn) reqPatch.checkIn = nextIn;
      if (nextOut) reqPatch.checkOut = nextOut;
      if (nextIn && nextOut) reqPatch.sameDayStay = nextIn === nextOut;

      tx.update(reqRef, reqPatch);

      // 2) offers reset (accepted olanları elleme)
      const offersSnap = await db.collection("offers").where("requestId", "==", requestId).get();

      offersSnap.docs.forEach((offSnap) => {
        const off = offSnap.data() as any;
        const curStatus = String(off?.status || "sent");
        if (curStatus === "accepted") return;

        tx.update(offSnap.ref, {
          status: "cancelled",
          cancelledBy: "system_restart",
          cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
          guestCounterPrice: null,
          guestCounterAt: null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          priceHistory: admin.firestore.FieldValue.arrayUnion({
            actor: "system",
            kind: "info",
            price: Number(off?.totalPrice ?? 0) || 0,
            currency: String(off?.currency ?? "TRY"),
            note: "Talep yeniden başlatıldı — eski teklifler sıfırlandı.",
            createdAt: admin.firestore.Timestamp.now(),
          }),
        });
      });
    });

    return { ok: true, requestId };
  }
);
