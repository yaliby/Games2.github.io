// src/services/firebase.ts
import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const fallbackFirebaseConfig = {
  apiKey: "AIzaSyBbdqsAsZ9PWW8LBgnyq1IOsYxSKtFyiGA",
  authDomain: "gameshub-99479.firebaseapp.com",
  projectId: "gameshub-99479",
  storageBucket: "gameshub-99479.firebasestorage.app",
  messagingSenderId: "225729897472",
  appId: "1:225729897472:web:b360048a54124778bb64e5",
  measurementId: "G-XMXSEQP164",
};

const pickEnv = (value: unknown, fallback: string): string => {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  if (!normalized || normalized === "undefined" || normalized === "null") {
    return fallback;
  }
  return normalized;
};

const firebaseConfig = {
  apiKey: pickEnv(import.meta.env.VITE_FIREBASE_API_KEY, fallbackFirebaseConfig.apiKey),
  authDomain: pickEnv(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN, fallbackFirebaseConfig.authDomain),
  projectId: pickEnv(import.meta.env.VITE_FIREBASE_PROJECT_ID, fallbackFirebaseConfig.projectId),
  storageBucket: pickEnv(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET, fallbackFirebaseConfig.storageBucket),
  messagingSenderId: pickEnv(
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    fallbackFirebaseConfig.messagingSenderId,
  ),
  appId: pickEnv(import.meta.env.VITE_FIREBASE_APP_ID, fallbackFirebaseConfig.appId),
  measurementId: pickEnv(import.meta.env.VITE_FIREBASE_MEASUREMENT_ID, fallbackFirebaseConfig.measurementId),
};

export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
