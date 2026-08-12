import { describe, expect, it } from "vitest";
import { createMobileSession, mobileSessionCookieOptions, verifyMobileSession } from "@/lib/mobile-link/session";

const secret = "s".repeat(32);

describe("mobile session", () => {
  it("round-trips a scoped unexpired payload", () => {
    const value = createMobileSession({
      roomId: "room", playerId: "p1", sessionRevision: 2,
      issuedAtMs: 1_000, expiresAtMs: 61_000,
    }, secret);
    expect(verifyMobileSession(value, secret, 30_000)).toEqual({
      v: 1, roomId: "room", playerId: "p1", sessionRevision: 2,
      issuedAtMs: 1_000, expiresAtMs: 61_000,
    });
  });

  it("rejects tampering, expiry and short secrets", () => {
    const value = createMobileSession({
      roomId: "room", playerId: "p1", sessionRevision: 1,
      issuedAtMs: 1_000, expiresAtMs: 2_000,
    }, secret);
    expect(verifyMobileSession(`${value}x`, secret, 1_500)).toBeNull();
    expect(verifyMobileSession(value, secret, 2_001)).toBeNull();
    expect(() => createMobileSession({ roomId: "r", playerId: "p", sessionRevision: 1, issuedAtMs: 0, expiresAtMs: 1 }, "short")).toThrow();
  });

  it("uses a strict HttpOnly production cookie", () => {
    expect(mobileSessionCookieOptions("production", 3_600)).toEqual({
      httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 3_600,
    });
    expect(mobileSessionCookieOptions("development", 60).secure).toBe(false);
  });
});
