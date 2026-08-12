import { describe, expect, it } from "vitest";
import { createTokenTransferHandler } from "@/app/api/rooms/[roomId]/token-transfers/route";
import { RoomAuthError } from "@/lib/server/room-auth";
import { TokenTransferStoreError } from "@/lib/server/token-transfer-store";
import type { TokenTransferCommand } from "@/lib/map/token-transfer";

const validCommand: TokenTransferCommand = {
  operationId: "3f7f4d48-93ce-4b34-8102-58ccdf530111",
  systemId: "nyx",
  groupId: "g1",
  expectedSource: { kind: "unplaced" },
  intent: { kind: "place2d", mapId: "main", x: 0.2, y: 0.3 },
};
const context = { params: Promise.resolve({ roomId: "alpha" }) };
const request = (body: unknown) => new Request("https://app.test/api/rooms/alpha/token-transfers", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

describe("token transfer route", () => {
  it("uses the authenticated writer and ignores body role fields", async () => {
    const calls: unknown[] = [];
    const handler = createTokenTransferHandler({
      requireWriter: async () => ({ uid: "u1", playerId: "p1", name: "Ada", role: "commander", authVersion: 1, verifiedAtMs: 1 }),
      transfer: async (input) => {
        calls.push(input);
        return { operationId: validCommand.operationId, groupId: "g1", systemId: "nyx", location: { kind: "map2d", mapId: "main", x: 0.2, y: 0.3 } };
      },
      now: () => 123,
    });
    const response = await handler(request({ ...validCommand, role: "admin" }), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ result: { location: { kind: "map2d", mapId: "main" } } });
    expect(calls).toEqual([{
      roomId: "alpha",
      actor: { uid: "u1", role: "commander" },
      command: validCommand,
      nowMs: 123,
    }]);
  });

  it("rejects invalid commands before authenticating or writing", async () => {
    let authenticated = false;
    const handler = createTokenTransferHandler({
      requireWriter: async () => { authenticated = true; throw new Error("unexpected"); },
      transfer: async () => { throw new Error("unexpected"); },
      now: Date.now,
    });
    const response = await handler(request({ ...validCommand, expectedSource: { kind: "map2d", mapId: "main", x: 5, y: 0 } }), context);
    expect(response.status).toBe(400);
    expect(authenticated).toBe(false);
  });

  it("maps authentication, source and validation errors", async () => {
    const failing = (error: Error) => createTokenTransferHandler({
      requireWriter: async () => {
        if (error instanceof RoomAuthError) throw error;
        return { uid: "u1", playerId: "p1", name: "Ada", role: "commander", authVersion: 1, verifiedAtMs: 1 };
      },
      transfer: async () => { throw error; },
      now: Date.now,
    });
    expect((await failing(new RoomAuthError("UNAUTHENTICATED"))(request(validCommand), context)).status).toBe(401);
    expect((await failing(new RoomAuthError("FORBIDDEN"))(request(validCommand), context)).status).toBe(403);

    const conflict = await failing(new TokenTransferStoreError("SOURCE_CONFLICT", { kind: "map2d", mapId: "main", x: 0.8, y: 0.9 }))(request(validCommand), context);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: "Trupp wurde inzwischen von einem anderen Teilnehmer verschoben.", currentLocation: { x: 0.8 } });
    expect((await failing(new TokenTransferStoreError("INVALID_TARGET"))(request(validCommand), context)).status).toBe(422);
    expect((await failing(new TokenTransferStoreError("BOARD_NOT_FOUND"))(request(validCommand), context)).status).toBe(404);
    expect((await failing(new TokenTransferStoreError("ENTRY_FULL"))(request(validCommand), context)).status).toBe(409);
  });
});
