"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { getFirebaseAuth, getFirestoreDb } from "@/lib/firebase/client"; // sende isimler farklıysa uyarlarsın

type Role = "guest" | "hotel" | "admin" | "agency";

export type AppProfile = {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  role: Role;
};

type AuthContextValue = {
  user: FirebaseUser | null;
  profile: AppProfile | null;
  loading: boolean;          // ✅ rol dahil her şey hazır mı?
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  loading: true
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const auth = getFirebaseAuth();
  const db = getFirestoreDb();

  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<AppProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      // ✅ route geçişlerinde 1 frame eski profil görünmesin diye
      setLoading(true);
      setUser(u);
      setProfile(null);

      if (!u) {
        setLoading(false);
        return;
      }

      try {
        const snap = await getDoc(doc(db, "users", u.uid));
        const data = snap.exists() ? (snap.data() as any) : null;

        const role: Role =
          (data?.role as Role) ||
          (data?.userRole as Role) || // sende farklı alan varsa
          "guest";

        setProfile({
          uid: u.uid,
          email: u.email,
          displayName: data?.displayName || u.displayName || null,
          role
        });
      } catch (e) {
        // profil okunamadıysa güvenli tarafta kal: guest
        setProfile({
          uid: u.uid,
          email: u.email,
          displayName: u.displayName || null,
          role: "guest"
        });
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, [auth, db]);

  const value = useMemo(() => ({ user, profile, loading }), [user, profile, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
