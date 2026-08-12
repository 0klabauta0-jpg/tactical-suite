import "server-only";
import { parseAppOrigin, parseFirebaseAdminEnv, requireServerSecret } from "@/lib/server/env-values";

export function getFirebaseAdminEnvironment() {
  return parseFirebaseAdminEnv(process.env);
}

export function getRoomSetupSecret(): string {
  return requireServerSecret(process.env, "ROOM_SETUP_SECRET");
}

export function getAuthRateLimitSecret(): string {
  return requireServerSecret(process.env, "AUTH_RATE_LIMIT_SECRET");
}

export function getMobileSessionSecret(): string {
  return requireServerSecret(process.env, "MOBILE_SESSION_SECRET");
}

export function getAppOrigin(): URL {
  return parseAppOrigin(process.env.NEXT_PUBLIC_APP_ORIGIN);
}
