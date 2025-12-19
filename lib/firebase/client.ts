// lib/firebase/client.ts
import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  type Auth
} from "firebase/auth";
import {
  getFirestore,
  connectFirestoreEmulator,
  type Firestore
} from "firebase/firestore";

// 🔥 Firebase'in yeni verdiği config'İ BURAYA YAPIŞTIR
const firebaseConfig = {
  apiKey: "AIzaSyBqO-1tbakxvrU895Mlk_Uncx5l_ONpzN4",
  authDomain: "biddakika.firebaseapp.com",
  projectId: "biddakika",
  storageBucket: "biddakika.firebasestorage.app",
  messagingSenderId: "381012495835",
  appId: "1:381012495835:web:6b152a3580e8e9b4386bfe"
};

if (typeof window !== "undefined") {
  console.log("Biddakika Firebase config USED:", firebaseConfig);
}

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;

export function getFirebaseApp() {
  if (!getApps().length) {
    app = initializeApp(firebaseConfig);
  } else {
    app = getApps()[0]!;
  }
  return app;
}


export function getFirebaseAuth() {
  if (!auth) {
    auth = getAuth(getFirebaseApp());
    if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true") {
      try {
        connectAuthEmulator(auth, "http://127.0.0.1:9099");
      } catch {}
    }
  }
  return auth;
}

export function getFirestoreDb() {
  if (!db) {
    db = getFirestore(getFirebaseApp());
    if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true") {
      try {
        connectFirestoreEmulator(db, "127.0.0.1", 8080);
      } catch {}
    }
  }
  return db;
}
