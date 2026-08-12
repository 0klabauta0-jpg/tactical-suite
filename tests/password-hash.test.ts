import { describe, expect, it } from "vitest";
import { hashRoomPassword, needsPasswordRehash, verifyRoomPassword } from "@/lib/server/password-hash";

describe("room password hashing", () => {
  it("creates salted hashes and verifies only the correct password", async () => {
    const first = await hashRoomPassword("correct horse battery staple");
    const second = await hashRoomPassword("correct horse battery staple");

    expect(first.salt).not.toBe(second.salt);
    await expect(verifyRoomPassword("correct horse battery staple", first)).resolves.toBe(true);
    await expect(verifyRoomPassword("wrong", first)).resolves.toBe(false);
  });

  it("rejects empty passwords and malformed parameters", async () => {
    await expect(hashRoomPassword("   ")).rejects.toThrow(/empty/i);
    await expect(verifyRoomPassword("password", { version: 1, salt: "bad", passwordHash: "bad",
      keyLength: 64, cost: 3, blockSize: 8, parallelization: 1 })).resolves.toBe(false);
  });

  it("marks old parameter sets for rehashing", async () => {
    const current = await hashRoomPassword("password");
    expect(needsPasswordRehash(current)).toBe(false);
    expect(needsPasswordRehash({ ...current, cost: 8192 })).toBe(true);
  });
});
