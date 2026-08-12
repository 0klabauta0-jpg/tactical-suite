import "server-only";
import { applicationDefault, cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getFirebaseAdminEnvironment } from "@/lib/server/env";

export function getAdminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;

  const environment = getFirebaseAdminEnvironment();
  return initializeApp({
    credential: environment.kind === "service-account"
      ? cert({
        projectId: environment.projectId,
        clientEmail: environment.clientEmail,
        privateKey: environment.privateKey,
      })
      : applicationDefault(),
  });
}

export function getAdminAuth() {
  return getAuth(getAdminApp());
}

export function getAdminFirestore() {
  return getFirestore(getAdminApp());
}
