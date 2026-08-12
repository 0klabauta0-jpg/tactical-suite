import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { parseFirebaseAdminEnv } from "../lib/server/env-values";

export function getScriptFirestore() {
  const environment = parseFirebaseAdminEnv(process.env);
  const app = getApps()[0] ?? initializeApp({
    credential: environment.kind === "service-account"
      ? cert({ projectId: environment.projectId, clientEmail: environment.clientEmail, privateKey: environment.privateKey })
      : applicationDefault(),
    ...(environment.kind === "service-account" ? { projectId: environment.projectId } : {}),
  });
  return getFirestore(app);
}

export function getScriptProjectId(): string {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim() || process.env.GOOGLE_CLOUD_PROJECT?.trim();
  if (!projectId) throw new Error("FIREBASE_PROJECT_ID is required for release scripts.");
  return projectId;
}
