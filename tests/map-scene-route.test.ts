import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/rooms/[roomId]/map-scenes/[sceneId]/objects/route";
import { PATCH } from "@/app/api/rooms/[roomId]/map-scenes/[sceneId]/objects/[objectId]/route";
import { moveMapSceneObject, translateMapSceneObject } from "@/lib/map-scene/client";
import {
  acquireSceneObjectLock,
  createSceneObject,
  type MapSceneTransactionStore,
} from "@/lib/server/map-scene-store";
import type { SceneObject, StrokeSceneObject } from "@/lib/rockbreaker/scene-objects";

const harness = vi.hoisted(() => ({ store: undefined as unknown as MapSceneTransactionStore }));

vi.mock("@/lib/server/room-auth-production", () => ({
  requireRoomMember: vi.fn(async () => ({ uid: "u1", role: "commander" })),
}));

vi.mock("@/lib/server/firestore-map-scene-store", () => ({
  createFirestoreMapSceneStore: () => harness.store,
}));

vi.mock("firebase/firestore", () => ({ collection: vi.fn(), onSnapshot: vi.fn() }));
vi.mock("@/lib/firebase", () => ({ db: {} }));

const free = (x: number, y = 0, z = 0) => ({
  x, y, z, sceneVersion: 1 as const, anchor: { kind: "freeSpace" as const },
});
const postContext = { params: Promise.resolve({ roomId: "r", sceneId: "nyx--rockbreaker" }) };
let memoryStore: MapSceneTransactionStore;

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(3);
  const objects = new Map<string, SceneObject>();
  memoryStore = {
    runObjectTransaction: async (_roomId, _sceneId, objectId, operation) => {
      const result = await operation({
        object: objects.get(objectId) ?? null,
        groupIds: new Set(["g1"]),
        rockbreakerEnabled: true,
      });
      if (result === null) objects.delete(objectId); else objects.set(objectId, result);
      return result;
    },
  };
  harness.store = memoryStore;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const requestWith = (body: unknown) => new Request("https://app.test/api", {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

describe("map scene routes", () => {
  it("accepts a validated stroke POST for a commander", async () => {
    const response = await POST(new Request("https://app.test/api/rooms/r/map-scenes/nyx--rockbreaker/objects", {
      method: "POST",
      body: JSON.stringify({ type: "stroke", color: "#22d3ee", width: 3, points: [free(1), free(2)] }),
    }), postContext);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ type: "stroke", width: 3 });
  });

  it("rejects malformed stroke POSTs", async () => {
    const response = await POST(requestWith({ type: "stroke", color: "#22d3ee", width: 2, points: [free(1)] }), postContext);

    expect(response.status).toBe(400);
  });

  it("translates one locked stroke through PATCH", async () => {
    const actor = { uid: "u1", role: "commander" as const };
    const created = await createSceneObject(memoryStore, {
      roomId: "r", sceneId: "nyx--rockbreaker", actor, nowMs: 1,
      draft: { type: "stroke", color: "#22d3ee", width: 3, points: [free(1), free(2)] },
    });
    const locked = await acquireSceneObjectLock(memoryStore, {
      roomId: "r", sceneId: "nyx--rockbreaker", objectId: created.id, actor, nowMs: 2,
    });

    const response = await PATCH(requestWith({
      translation: [1, 2, 3], expectedRevision: created.revision, expectedLockRevision: locked.lockRevision,
    }), { params: Promise.resolve({ roomId: "r", sceneId: "nyx--rockbreaker", objectId: created.id }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ type: "stroke", revision: 1 });
  });

  it("maps an out-of-bounds translation to 400 and a stale revision to 409", async () => {
    const actor = { uid: "u1", role: "commander" as const };
    const created = await createSceneObject(memoryStore, {
      roomId: "r", sceneId: "nyx--rockbreaker", actor, nowMs: 1,
      draft: { type: "stroke", color: "#22d3ee", width: 3, points: [free(35), free(36)] },
    });
    const locked = await acquireSceneObjectLock(memoryStore, {
      roomId: "r", sceneId: "nyx--rockbreaker", objectId: created.id, actor, nowMs: 2,
    });
    const context = { params: Promise.resolve({ roomId: "r", sceneId: "nyx--rockbreaker", objectId: created.id }) };

    const stale = await PATCH(requestWith({
      translation: [1, 0, 0], expectedRevision: 99, expectedLockRevision: locked.lockRevision,
    }), context);
    expect(stale.status).toBe(409);

    const outside = await PATCH(requestWith({
      translation: [2, 0, 0], expectedRevision: created.revision, expectedLockRevision: locked.lockRevision,
    }), context);
    expect(outside.status).toBe(400);
  });

  it("sends a stroke translation with its revision and lock revision", async () => {
    const object: StrokeSceneObject = {
      id: "stroke--1", type: "stroke", systemId: "nyx", mapId: "rockbreaker", sceneVersion: 1,
      color: "#22d3ee", width: 3, points: [free(1), free(2)], revision: 7,
      createdBy: "u1", createdAtMs: 1, updatedBy: "u1", updatedAtMs: 1,
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(object), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchImpl);
    await expect(translateMapSceneObject("r", "nyx--rockbreaker", object.id, [1, 2, 3], object.revision, 4, async () => "id-token"))
      .resolves.toMatchObject({ id: "stroke--1", type: "stroke" });
    expect(fetchImpl).toHaveBeenCalledWith("/api/rooms/r/map-scenes/nyx--rockbreaker/objects/stroke--1", expect.objectContaining({
      method: "PATCH",
      headers: { Authorization: "Bearer id-token", "Content-Type": "application/json" },
      body: JSON.stringify({ translation: [1, 2, 3], expectedRevision: 7, expectedLockRevision: 4 }),
    }));
  });

  it("keeps the gesture-start revision when a positioned object's server revision is already ahead", async () => {
    const fetchImpl = vi.fn(async (_path: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { expectedRevision: number };
      return new Response(JSON.stringify(body.expectedRevision === 3
        ? { error: "Positionskonflikt – Serverstand übernommen." }
        : { id: "point--1" }), {
        status: body.expectedRevision === 3 ? 409 : 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchImpl);

    await expect(moveMapSceneObject(
      "r", "nyx--rockbreaker", "point--1", free(4), 3, 8, async () => "id-token",
    )).rejects.toThrow("Positionskonflikt");
    expect(fetchImpl).toHaveBeenCalledWith("/api/rooms/r/map-scenes/nyx--rockbreaker/objects/point--1", expect.objectContaining({
      body: JSON.stringify({ position: free(4), expectedRevision: 3, expectedLockRevision: 8 }),
    }));
  });

  it("keeps the gesture-start revision when a stroke server revision is already ahead", async () => {
    const fetchImpl = vi.fn(async (_path: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { expectedRevision: number };
      return new Response(JSON.stringify(body.expectedRevision === 5
        ? { error: "Positionskonflikt – Serverstand übernommen." }
        : { id: "stroke--stale" }), {
        status: body.expectedRevision === 5 ? 409 : 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchImpl);

    await expect(translateMapSceneObject(
      "r", "nyx--rockbreaker", "stroke--stale", [1, 0, 0], 5, 9, async () => "id-token",
    )).rejects.toThrow("Positionskonflikt");
    expect(fetchImpl).toHaveBeenCalledWith("/api/rooms/r/map-scenes/nyx--rockbreaker/objects/stroke--stale", expect.objectContaining({
      body: JSON.stringify({ translation: [1, 0, 0], expectedRevision: 5, expectedLockRevision: 9 }),
    }));
  });
});
