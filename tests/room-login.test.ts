import { describe, expect, it } from "vitest";
import { hashRoomPassword } from "@/lib/server/password-hash";
import { authenticateRoomPlayer, roomPlayerUid, type RoomLoginDependencies } from "@/lib/server/room-login";

async function dependencies(overrides: Partial<RoomLoginDependencies> = {}): Promise<RoomLoginDependencies> {
  const secret = await hashRoomPassword("team-password");
  return {
    getConfig: async () => ({ sheetUrl: "https://sheet.test", roomName: "Test Room",
      features: { mobileStatus: false, rockbreaker3d: false } }),
    getSecret: async () => secret,
    getLegacyPassword: async () => null,
    loadPlayers: async () => [{
      id: "p1", name: "Ada", appRole: "viewer", area: "Air", role: "Flight",
      squadron: "CER", status: "ready", ampel: "green", homeLocation: "Checkmate", icon: "pilot",
    }],
    getProtectedRole: async () => ({ role: "commander", lastSheetRole: "viewer" }),
    saveRoleTracking: async () => undefined,
    createCustomToken: async (uid, claims) => `token:${uid}:${claims.roomId}:${claims.playerId}`,
    writeMember: async () => undefined,
    ...overrides,
  };
}

describe("room login", () => {
  it("authenticates a validated sheet player and applies the protected role", async () => {
    const written: unknown[] = [];
    const deps = await dependencies({ writeMember: async (member) => { written.push(member); } });
    const result = await authenticateRoomPlayer(deps, {
      roomId: "alpha", handle: " ada ", password: "team-password", nowMs: 123,
    });

    expect(result).toMatchObject({
      player: {
        id: "p1", name: "Ada", role: "commander",
        profile: {
          area: "Air", role: "Flight", squadron: "CER", status: "ready",
          ampel: "green", homeLocation: "Checkmate", icon: "pilot",
        },
      },
      room: { name: "Test Room", features: { mobileStatus: false, rockbreaker3d: false } },
      legacyAuth: false,
    });
    expect(result.customToken).toContain(":alpha:p1");
    expect(written).toEqual([{ uid: roomPlayerUid("alpha", "p1"), playerId: "p1", name: "Ada",
      role: "commander", authVersion: 1, verifiedAtMs: 123 }]);
  });

  it("returns the same generic rejection for a wrong password and unknown handle", async () => {
    const deps = await dependencies();
    await expect(authenticateRoomPlayer(deps, {
      roomId: "alpha", handle: "Ada", password: "wrong", nowMs: 1,
    })).rejects.toMatchObject({ code: "INVALID_LOGIN" });
    await expect(authenticateRoomPlayer(deps, {
      roomId: "alpha", handle: "Grace", password: "team-password", nowMs: 1,
    })).rejects.toMatchObject({ code: "INVALID_LOGIN" });
  });

  it("fails closed when the sheet cannot supply fresh players", async () => {
    const deps = await dependencies({ loadPlayers: async () => { throw new Error("offline"); } });
    await expect(authenticateRoomPlayer(deps, {
      roomId: "alpha", handle: "Ada", password: "team-password", nowMs: 1,
    })).rejects.toMatchObject({ code: "PLAYER_SOURCE_UNAVAILABLE" });
  });

  it("marks a temporary legacy password login", async () => {
    const deps = await dependencies({ getSecret: async () => null, getLegacyPassword: async () => "legacy" });
    const result = await authenticateRoomPlayer(deps, {
      roomId: "alpha", handle: "Ada", password: "legacy", nowMs: 1,
    });
    expect(result.legacyAuth).toBe(true);
  });
});
