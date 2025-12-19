// lib/firebase/auth.ts
"use client";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { getFirebaseAuth, getFirestoreDb } from "./client";
import type { UserRole, BkUser } from "@/types/biddakika";

interface RegisterParams {
  email: string;
  password: string;
  displayName: string;
  role: UserRole;
  profileData?: Partial<BkUser>;
}

export async function registerUser({
  email,
  password,
  displayName,
  role,
  profileData
}: RegisterParams) {
  const auth = getFirebaseAuth();
  const db = getFirestoreDb();

  const cred = await createUserWithEmailAndPassword(auth, email, password);

  if (displayName) {
    await updateProfile(cred.user, { displayName });
  }

  const userDoc: Partial<BkUser> = {
    uid: cred.user.uid,
    email,
    displayName,
    role,
    createdAt: serverTimestamp() as any
  } as any;

  // rol bazlı profili ekle
  if (profileData?.guestProfile) {
    (userDoc as any).guestProfile = profileData.guestProfile;
  }
  if (profileData?.hotelProfile) {
    (userDoc as any).hotelProfile = profileData.hotelProfile;
  }
  if (profileData?.agencyProfile) {
    (userDoc as any).agencyProfile = profileData.agencyProfile;
  }

  await setDoc(doc(db, "users", cred.user.uid), userDoc);

  return cred.user;
}

export async function loginUser(email: string, password: string) {
  const auth = getFirebaseAuth();
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function logoutUser() {
  const auth = getFirebaseAuth();
  await signOut(auth);
}
