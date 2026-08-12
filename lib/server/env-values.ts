export type FirebaseAdminEnvironment =
  | { kind: "application-default" }
  | { kind: "service-account"; projectId: string; clientEmail: string; privateKey: string };

type Environment = Record<string, string | undefined>;

export function parseFirebaseAdminEnv(env: Environment): FirebaseAdminEnvironment {
  const projectId = env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = env.FIREBASE_PRIVATE_KEY?.trim();
  const supplied = [projectId, clientEmail, privateKey].filter(Boolean).length;

  if (supplied === 0) return { kind: "application-default" };
  if (supplied !== 3) throw new Error("Firebase Admin service-account environment is incomplete.");

  return {
    kind: "service-account",
    projectId: projectId!,
    clientEmail: clientEmail!,
    privateKey: privateKey!.replace(/\\n/g, "\n"),
  };
}

export function requireServerSecret(env: Environment, name: string, minimumBytes = 32): string {
  const value = env[name];
  if (!value || Buffer.byteLength(value, "utf8") < minimumBytes) {
    throw new Error(`${name} must contain at least ${minimumBytes} bytes.`);
  }
  return value;
}

export function parseAppOrigin(value: string | undefined): URL {
  if (!value) throw new Error("NEXT_PUBLIC_APP_ORIGIN must be configured as an exact origin.");
  const parsed = new URL(value);
  const isLocalhost = parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  if (parsed.protocol !== "https:" && !isLocalhost) throw new Error("Application origin must use https.");
  if (parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error("Application URL must contain only an origin.");
  }
  return parsed;
}
