import { describe, expect, it } from "vitest";
import { createConnectionToken, hashConnectionToken, verifyConnectionToken } from "@/lib/mobile-link/token";

describe("mobile connection tokens", () => {
  it("creates 256-bit base64url tokens and verifies only the matching hash", () => {
    const token = createConnectionToken();
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    const hash = hashConnectionToken(token);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyConnectionToken(token, hash)).toBe(true);
    expect(verifyConnectionToken(`${token}x`, hash)).toBe(false);
  });

  it("rejects malformed token and hash values", () => {
    expect(() => hashConnectionToken("not base64url!")) .toThrow();
    expect(verifyConnectionToken("short", "broken")).toBe(false);
  });
});
