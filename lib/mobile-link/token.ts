import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

function decodeToken(token: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(token)) throw new Error("Invalid connection token.");
  const decoded = Buffer.from(token, "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== token) throw new Error("Invalid connection token.");
  return decoded;
}

export function createConnectionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashConnectionToken(token: string): string {
  return createHash("sha256").update(decodeToken(token)).digest("hex");
}

export function verifyConnectionToken(token: string, expectedHash: string): boolean {
  try {
    if (!/^[a-f0-9]{64}$/.test(expectedHash)) return false;
    const actual = Buffer.from(hashConnectionToken(token), "hex");
    const expected = Buffer.from(expectedHash, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
