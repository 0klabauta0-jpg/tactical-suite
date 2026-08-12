import { describe, expect, it } from "vitest";
import { parseRoomAuthSecret } from "@/lib/server/room-auth-secret";

describe("room auth secret parser", () => {
  it("accepts the versioned password hash fields", () => {
    expect(parseRoomAuthSecret({
      version: 1,
      passwordHash: "hash",
      salt: "salt",
      keyLength: 64,
      cost: 16_384,
      blockSize: 8,
      parallelization: 1,
    })).toEqual({
      version: 1,
      passwordHash: "hash",
      salt: "salt",
      keyLength: 64,
      cost: 16_384,
      blockSize: 8,
      parallelization: 1,
    });
  });

  it("rejects incomplete or unexpected versions", () => {
    expect(parseRoomAuthSecret({ version: 2 })).toBeNull();
    expect(parseRoomAuthSecret({ version: 1, keyLength: 64 })).toBeNull();
  });
});
