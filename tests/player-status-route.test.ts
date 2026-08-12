import { describe, expect, it } from "vitest";
import { createPlayerStatusHandler } from "@/app/api/rooms/[roomId]/player-status/[playerId]/route";
import { RoomAuthError } from "@/lib/server/room-auth";
import { PlayerStatusStoreError } from "@/lib/server/player-status-store";

const context = { params: Promise.resolve({ roomId: "alpha", playerId: "p2" }) };

describe("player status route", () => {
  it("uses the authenticated member and a validated action", async () => {
    const calls: unknown[] = [];
    const handler = createPlayerStatusHandler({
      requireMember: async () => ({ uid: "u1", playerId: "p1", name: "Ada", role: "commander", authVersion: 1, verifiedAtMs: 1 }),
      changeStatus: async (input) => { calls.push(input); return { status: { revision: 2 } as never }; },
      now: () => 123,
    });
    const response = await handler(new Request("https://app.test", {
      method: "POST", body: JSON.stringify({ action: { type: "RESPAWN", spawnGroupId: "spawn" }, expectedRevision: 1, role: "admin" }),
    }), context);
    expect(response.status).toBe(200);
    expect(calls).toEqual([{
      roomId: "alpha", targetPlayerId: "p2",
      actor: { playerId: "p1", role: "commander", via: "desktop" },
      action: { type: "RESPAWN", spawnGroupId: "spawn" }, expectedRevision: 1, nowMs: 123,
    }]);
  });

  it("maps authentication, revision and spawn errors", async () => {
    const unauthenticated = createPlayerStatusHandler({
      requireMember: async () => { throw new RoomAuthError("UNAUTHENTICATED"); },
      changeStatus: async () => { throw new Error("unexpected"); }, now: Date.now,
    });
    expect((await unauthenticated(new Request("https://app.test", { method: "POST", body: JSON.stringify({ action: { type: "LIVE" } }) }), context)).status).toBe(401);

    const conflict = createPlayerStatusHandler({
      requireMember: async () => ({ uid: "u1", playerId: "p1", name: "Ada", role: "viewer", authVersion: 1, verifiedAtMs: 1 }),
      changeStatus: async () => { throw new PlayerStatusStoreError("REVISION_CONFLICT", null); }, now: Date.now,
    });
    expect((await conflict(new Request("https://app.test", { method: "POST", body: JSON.stringify({ action: { type: "LIVE" } }) }), context)).status).toBe(409);

    const invalidSpawn = createPlayerStatusHandler({
      requireMember: async () => ({ uid: "u1", playerId: "p1", name: "Ada", role: "viewer", authVersion: 1, verifiedAtMs: 1 }),
      changeStatus: async () => { throw new PlayerStatusStoreError("INVALID_SPAWN"); }, now: Date.now,
    });
    expect((await invalidSpawn(new Request("https://app.test", { method: "POST", body: JSON.stringify({ action: { type: "LIVE" } }) }), context)).status).toBe(422);
  });

  it("rejects unknown actions before writing", async () => {
    let changed = false;
    const handler = createPlayerStatusHandler({
      requireMember: async () => ({ uid: "u1", playerId: "p1", name: "Ada", role: "admin", authVersion: 1, verifiedAtMs: 1 }),
      changeStatus: async () => { changed = true; throw new Error("unexpected"); }, now: Date.now,
    });
    const response = await handler(new Request("https://app.test", { method: "POST", body: JSON.stringify({ action: { type: "DELETE" } }) }), context);
    expect(response.status).toBe(400);
    expect(changed).toBe(false);
  });
});
