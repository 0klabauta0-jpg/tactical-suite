import { describe, expect, it } from "vitest";
import { planRoomSecurityMigration } from "@/lib/release/room-security-migration";

describe("room security migration", () => {
  const players = [
    { id: "p1", name: "Ada", appRole: "admin" as const },
    { id: "p2", name: "Bob", appRole: "commander" as const },
    { id: "p3", name: "Cy", appRole: "viewer" as const },
  ];

  it("plans password hashing, protected roles and removal of legacy role fields", () => {
    const plan = planRoomSecurityMigration({
      config: { password: "room-secret" },
      overrides: { p1: { appRole: "commander", lastSheetAppRole: "admin", area: "A" }, p2: { area: "B" } },
      existingSecret: null,
      existingRoles: new Map(),
      players,
    });
    expect(plan).toMatchObject({ passwordToHash: "room-secret", removeLegacyPassword: true });
    expect(plan.roles).toEqual([
      { playerId: "p1", role: "admin" },
      { playerId: "p2", role: "commander" },
      { playerId: "p3", role: "viewer" },
    ]);
    expect(plan.cleanedOverrides).toEqual({ p1: { area: "A" }, p2: { area: "B" } });
  });

  it("keeps existing protected state and is idempotent", () => {
    const existingRoles = new Map(players.map((player) => [player.id, { role: player.appRole, lastSheetRole: player.appRole }]));
    const plan = planRoomSecurityMigration({
      config: { roomName: "Alpha" },
      overrides: { p1: { area: "A" } },
      existingSecret: { version: 1, passwordHash: "hash", salt: "salt", keyLength: 64, cost: 16_384, blockSize: 8, parallelization: 1 },
      existingRoles,
      players,
    });
    expect(plan.passwordToHash).toBeNull();
    expect(plan.roles).toEqual([]);
    expect(plan.removeLegacyPassword).toBe(false);
    expect(plan.overridesChanged).toBe(false);
  });

  it("stops when no valid secret exists or no admin can be established", () => {
    expect(() => planRoomSecurityMigration({ config: {}, overrides: {}, existingSecret: null, existingRoles: new Map(), players })).toThrow("password");
    expect(() => planRoomSecurityMigration({
      config: { password: "secret" }, overrides: {}, existingSecret: null, existingRoles: new Map(),
      players: players.map((player) => ({ ...player, appRole: "viewer" as const })),
    })).toThrow("admin");
  });
});
