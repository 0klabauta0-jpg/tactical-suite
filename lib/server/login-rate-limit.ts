import "server-only";
import { createHmac } from "node:crypto";
import { getAdminFirestore } from "@/lib/server/firebase-admin";
import { getAuthRateLimitSecret } from "@/lib/server/env";
import { advanceLoginRateLimit, parseLoginRateLimitState } from "@/lib/server/login-rate-limit-state";

export type LoginRateLimitInput = {
  roomId: string;
  handle: string;
  ipAddress: string;
  nowMs: number;
};

const DEFAULT_LIMITS = {
  maxAttempts: 10,
  windowMs: 10 * 60 * 1_000,
  blockMs: 15 * 60 * 1_000,
};

function documentId(input: Omit<LoginRateLimitInput, "nowMs">): string {
  return createHmac("sha256", getAuthRateLimitSecret())
    .update(`${input.ipAddress}\u0000${input.roomId}\u0000${input.handle.trim().toLocaleLowerCase("de-DE")}`)
    .digest("hex");
}

export async function consumeRoomLoginAttempt(input: LoginRateLimitInput): Promise<boolean> {
  const firestore = getAdminFirestore();
  const reference = firestore.doc(`loginRateLimits/${documentId(input)}`);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const result = advanceLoginRateLimit(parseLoginRateLimitState(snapshot.data()), input.nowMs, DEFAULT_LIMITS);
    transaction.set(reference, result.state);
    return result.allowed;
  });
}

export async function resetRoomLoginAttempts(input: LoginRateLimitInput): Promise<void> {
  await getAdminFirestore().doc(`loginRateLimits/${documentId(input)}`).delete();
}
