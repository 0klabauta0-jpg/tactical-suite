import { createHmac, timingSafeEqual } from "node:crypto";

export const MOBILE_SESSION_COOKIE = "klabscom_mobile";

export type MobileSessionPayload = {
  v: 1;
  roomId: string;
  playerId: string;
  sessionRevision: number;
  issuedAtMs: number;
  expiresAtMs: number;
};

type SessionInput = Omit<MobileSessionPayload, "v">;

function validatedSecret(secret: string): Buffer {
  const value = Buffer.from(secret, "utf8");
  if (value.length < 32) throw new Error("Mobile session secret must contain at least 32 bytes.");
  return value;
}

function signature(encodedPayload: string, secret: string): Buffer {
  return createHmac("sha256", validatedSecret(secret)).update(encodedPayload).digest();
}

export function createMobileSession(input: SessionInput, secret: string): string {
  const payload: MobileSessionPayload = { v: 1, ...input };
  if (!payload.roomId || !payload.playerId || !Number.isInteger(payload.sessionRevision) || payload.sessionRevision < 0
    || !Number.isFinite(payload.issuedAtMs) || !Number.isFinite(payload.expiresAtMs)
    || payload.expiresAtMs <= payload.issuedAtMs) {
    throw new Error("Invalid mobile session payload.");
  }
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signature(encoded, secret).toString("base64url")}`;
}

export function verifyMobileSession(value: string, secret: string, nowMs: number): MobileSessionPayload | null {
  try {
    const [encoded, encodedSignature, extra] = value.split(".");
    if (!encoded || !encodedSignature || extra !== undefined) return null;
    const actual = Buffer.from(encodedSignature, "base64url");
    const expected = signature(encoded, secret);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<string, unknown>;
    if (payload.v !== 1 || typeof payload.roomId !== "string" || !payload.roomId
      || typeof payload.playerId !== "string" || !payload.playerId
      || !Number.isInteger(payload.sessionRevision) || (payload.sessionRevision as number) < 0
      || typeof payload.issuedAtMs !== "number" || !Number.isFinite(payload.issuedAtMs)
      || typeof payload.expiresAtMs !== "number" || !Number.isFinite(payload.expiresAtMs)
      || (payload.expiresAtMs as number) <= nowMs || (payload.expiresAtMs as number) <= (payload.issuedAtMs as number)) {
      return null;
    }
    return payload as MobileSessionPayload;
  } catch {
    return null;
  }
}

export function mobileSessionCookieOptions(environment: string | undefined, maxAge: number) {
  return {
    httpOnly: true,
    secure: environment === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge,
  };
}
