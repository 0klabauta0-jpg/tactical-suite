import { parseRoomConfig } from "@/lib/rooms/config";

export type ReleasePreflightError =
  | "FIREBASE_PROJECT_MISSING"
  | "FIREBASE_ADMIN_INCOMPLETE"
  | "ROOM_SETUP_SECRET_WEAK"
  | "AUTH_RATE_LIMIT_SECRET_WEAK"
  | "MOBILE_SESSION_SECRET_WEAK"
  | "APP_ORIGIN_INVALID"
  | "SOURCE_PERMISSION_PENDING";

type Feature = "mobileStatus" | "rockbreaker3d";

function secretStrong(value: string | undefined): boolean {
  return typeof value === "string" && Buffer.byteLength(value, "utf8") >= 32;
}

function originValid(value: string | undefined, expectedOrigin: string): boolean {
  try {
    if (!value) return false;
    const parsed = new URL(value);
    const expected = new URL(expectedOrigin);
    return parsed.origin === expected.origin
      && parsed.pathname === "/"
      && !parsed.search
      && !parsed.hash;
  } catch {
    return false;
  }
}

export function rockbreakerPermissionApproved(noticeText: string): boolean {
  return /public redistribution permission:\s*APPROVED\b/i.test(noticeText)
    && /(?:permission reference|approval reference):\s*\S+/i.test(noticeText);
}

export function evaluateReleasePreflight(input: {
  env: Record<string, string | undefined>;
  requestedFeatures: Feature[];
  noticeText: string;
  expectedOrigin: string;
}) {
  const errors: ReleasePreflightError[] = [];
  const projectPresent = Boolean(input.env.FIREBASE_PROJECT_ID || input.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);
  if (!projectPresent) errors.push("FIREBASE_PROJECT_MISSING");

  const adminFields = ["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"] as const;
  const adminComplete = adminFields.every((name) => Boolean(input.env[name]));
  if (!adminComplete) errors.push("FIREBASE_ADMIN_INCOMPLETE");
  if (!secretStrong(input.env.ROOM_SETUP_SECRET)) errors.push("ROOM_SETUP_SECRET_WEAK");
  if (!secretStrong(input.env.AUTH_RATE_LIMIT_SECRET)) errors.push("AUTH_RATE_LIMIT_SECRET_WEAK");
  if (!secretStrong(input.env.MOBILE_SESSION_SECRET)) errors.push("MOBILE_SESSION_SECRET_WEAK");
  if (!originValid(input.env.NEXT_PUBLIC_APP_ORIGIN, input.expectedOrigin)) errors.push("APP_ORIGIN_INVALID");

  const permissionApproved = rockbreakerPermissionApproved(input.noticeText);
  if (input.requestedFeatures.includes("rockbreaker3d") && !permissionApproved) {
    errors.push("SOURCE_PERMISSION_PENDING");
  }

  const defaults = parseRoomConfig({ sheetUrl: "https://example.test/players.csv" })?.features
    ?? { mobileStatus: false, rockbreaker3d: false };
  return {
    ok: errors.length === 0,
    errors,
    presence: {
      firebaseProject: projectPresent,
      firebaseAdmin: adminComplete,
      roomSetupSecret: secretStrong(input.env.ROOM_SETUP_SECRET),
      authRateLimitSecret: secretStrong(input.env.AUTH_RATE_LIMIT_SECRET),
      mobileSessionSecret: secretStrong(input.env.MOBILE_SESSION_SECRET),
      appOrigin: originValid(input.env.NEXT_PUBLIC_APP_ORIGIN, input.expectedOrigin),
      rockbreakerPermission: permissionApproved,
    },
    featureDefaults: defaults,
  };
}
