"use client";


// Importiert die Firebase-Kern-Funktionen
import { initializeApp, getApps } from "firebase/app";


// Importiert Firestore (Datenbank)
import { getFirestore } from "firebase/firestore";


// Importiert Authentication (Login)
import { getAuth } from "firebase/auth";


// Liest die Zugangsdaten aus den Umgebungsvariablen
const firebaseConfig = {
  apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};


// Verhindert doppelte Initialisierung (wichtig in Next.js)
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);


// Exportiert die Instanzen fur Verwendung in anderen Dateien
export const db   = getFirestore(app);  // Datenbank
export const auth = getAuth(app);        // Authentication
