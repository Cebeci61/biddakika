import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as crypto from "crypto";

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
