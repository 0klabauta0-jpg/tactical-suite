import { describe, expect, it } from "vitest";
import {
  acquireSceneObjectLock,
  commitSceneObjectMove,
  commitSceneObjectTranslation,
  createSceneObject,
  deleteSceneObject,
  MapSceneStoreError,
  type MapSceneTransactionStore,
} from "@/lib/server/map-scene-store";
import type { SceneObject } from "@/lib/rockbreaker/scene-objects";
import type { WorldPoint } from "@/lib/rockbreaker/coordinates";
import { freeSpaceWorldPoint } from "@/lib/rockbreaker/drag";

const point = (x: number) => ({ x, y: 0, z: 0, sceneVersion: 1 as const, anchor: { kind: "beltPlane" as const } });
const free = (x: number, y = 0, z = 0): WorldPoint => ({
  x, y, z, sceneVersion: 1, anchor: { kind: "freeSpace" },
});

function groupObject(groupId: string, position: WorldPoint): SceneObject {
  return {
    id: `groupToken--${groupId}`, type: "groupToken", groupId,
    systemId: "nyx", mapId: "rockbreaker", sceneVersion: 1,
    color: "#0ea5e9", position, revision: 0,
    createdBy: "u1", createdAtMs: 1, updatedBy: "u1", updatedAtMs: 1,
  };
}

function createStore(rockbreakerEnabled = true) {
  const objects = new Map<string, SceneObject>();
  const store: MapSceneTransactionStore = {
    runObjectTransaction: async (_roomId, _sceneId, objectId, operation) => {
      const result = await operation({ object: objects.get(objectId) ?? null, groupIds: new Set(["g1"]), rockbreakerEnabled });
      if (result === null) objects.delete(objectId); else objects.set(objectId, result);
      return result;
    },
  };
  return { objects, store };
}

async function createStroke(
  store: MapSceneTransactionStore,
  actor: { uid: string; role: "admin" | "commander" },
  points: WorldPoint[],
) {
  return createSceneObject(store, {
    roomId: "room", sceneId: "nyx--rockbreaker", actor, nowMs: 1,
    draft: { type: "stroke", color: "#22d3ee", width: 3, points },
  });
}

describe("map scene store", () => {
  it("protects group-token creation and deletion for the transfer service", async () => {
    const { objects, store } = createStore();
    const actor = { uid: "u1", role: "commander" as const };
    await expect(createSceneObject(store, {
      roomId: "room",
      sceneId: "nyx--rockbreaker",
      actor,
      draft: { type: "groupToken", groupId: "g1", color: "#0ea5e9", position: point(1) },
      nowMs: 1,
    })).rejects.toMatchObject({ code: "PROTECTED_OBJECT" });
    objects.set("groupToken--g1", groupObject("g1", point(1)));
    await expect(deleteSceneObject(store, { roomId: "room", sceneId: "nyx--rockbreaker", objectId: "groupToken--g1", actor }))
      .rejects.toMatchObject({ code: "PROTECTED_OBJECT" });
  });

  it("deduplicates order markers and locks them for the current commander", async () => {
    const { store } = createStore();
    const actor = { uid: "u1", role: "commander" as const };
    const first = await createSceneObject(store, { roomId: "room", sceneId: "nyx--rockbreaker", actor, draft: { type: "orderMarker", groupId: "g1", color: "#0ea5e9", position: point(1) }, nowMs: 1 });
    const second = await createSceneObject(store, { roomId: "room", sceneId: "nyx--rockbreaker", actor, draft: { type: "orderMarker", groupId: "g1", color: "#ffffff", position: point(2) }, nowMs: 2 });
    expect(second).toEqual(first);
    const locked = await acquireSceneObjectLock(store, { roomId: "room", sceneId: "nyx--rockbreaker", objectId: first.id, actor, nowMs: 10 });
    expect(locked).toMatchObject({ lockedByUid: "u1", lockRevision: 1, lockExpiresAtMs: 15_010 });
  });

  it("rejects a competing lock and stale move revision", async () => {
    const { store } = createStore();
    const first = await createSceneObject(store, { roomId: "room", sceneId: "nyx--rockbreaker", actor: { uid: "u1", role: "admin" }, draft: { type: "orderMarker", groupId: "g1", color: "#0ea5e9", position: point(1) }, nowMs: 1 });
    const locked = await acquireSceneObjectLock(store, { roomId: "room", sceneId: "nyx--rockbreaker", objectId: first.id, actor: { uid: "u1", role: "admin" }, nowMs: 10 });
    await expect(acquireSceneObjectLock(store, { roomId: "room", sceneId: "nyx--rockbreaker", objectId: first.id, actor: { uid: "u2", role: "commander" }, nowMs: 11 }))
      .rejects.toEqual(new MapSceneStoreError("OBJECT_LOCKED", locked));
    await expect(commitSceneObjectMove(store, { roomId: "room", sceneId: "nyx--rockbreaker", objectId: first.id, actor: { uid: "u1", role: "admin" }, expectedRevision: 9, expectedLockRevision: 1, position: point(3), nowMs: 12 }))
      .rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });

  it("commits only the locked object with a new revision", async () => {
    const { store } = createStore();
    const actor = { uid: "u1", role: "commander" as const };
    const first = await createSceneObject(store, { roomId: "room", sceneId: "nyx--rockbreaker", actor, draft: { type: "orderMarker", groupId: "g1", color: "#0ea5e9", position: point(1) }, nowMs: 1 });
    const locked = await acquireSceneObjectLock(store, { roomId: "room", sceneId: "nyx--rockbreaker", objectId: first.id, actor, nowMs: 2 });
    const moved = await commitSceneObjectMove(store, { roomId: "room", sceneId: "nyx--rockbreaker", objectId: first.id, actor, expectedRevision: first.revision, expectedLockRevision: locked.lockRevision!, position: point(4), nowMs: 3 });
    expect(moved).toMatchObject({ revision: 1, position: point(4) });
  });

  it("rejects out-of-bounds positioned object moves without changing other scene objects", async () => {
    const { objects, store } = createStore();
    const actor = { uid: "u1", role: "commander" as const };
    objects.set("groupToken--g1", {
      id: "groupToken--g1", type: "groupToken", groupId: "g1", systemId: "nyx", mapId: "rockbreaker",
      sceneVersion: 1, color: "#0ea5e9", position: freeSpaceWorldPoint([1, 2, 3]), revision: 0,
      createdBy: "u1", createdAtMs: 1, updatedBy: "u1", updatedAtMs: 1,
    });
    const lockedGroup = await acquireSceneObjectLock(store, {
      roomId: "room", sceneId: "nyx--rockbreaker", objectId: "groupToken--g1", actor, nowMs: 2,
    });

    await expect(commitSceneObjectMove(store, {
      roomId: "room", sceneId: "nyx--rockbreaker", objectId: lockedGroup.id, actor,
      expectedRevision: lockedGroup.revision, expectedLockRevision: lockedGroup.lockRevision!,
      position: { ...freeSpaceWorldPoint([37, 0, 0]), x: 38 }, nowMs: 3,
    })).rejects.toMatchObject({ code: "OUT_OF_BOUNDS" });

    const enemy = await createSceneObject(store, {
      roomId: "room", sceneId: "nyx--rockbreaker", actor,
      draft: { type: "enemyMarker", kind: "ground", color: "#ef4444", position: point(1) }, nowMs: 4,
    });
    const lockedEnemy = await acquireSceneObjectLock(store, {
      roomId: "room", sceneId: "nyx--rockbreaker", objectId: enemy.id, actor, nowMs: 5,
    });
    await expect(commitSceneObjectMove(store, {
      roomId: "room", sceneId: "nyx--rockbreaker", objectId: enemy.id, actor,
      expectedRevision: enemy.revision, expectedLockRevision: lockedEnemy.lockRevision!, position: free(100), nowMs: 6,
    })).rejects.toMatchObject({ code: "OUT_OF_BOUNDS" });
  });

  it("creates one atomic stroke and rejects an out-of-bounds point", async () => {
    const { store } = createStore();
    const actor = { uid: "u1", role: "commander" as const };
    const stroke = await createSceneObject(store, {
      roomId: "room", sceneId: "nyx--rockbreaker", actor, nowMs: 1,
      draft: { type: "stroke", color: "#22d3ee", width: 3, points: [free(1), free(2, 1)] },
    });
    expect(stroke).toMatchObject({ type: "stroke", revision: 0, createdBy: "u1" });
    await expect(createSceneObject(store, {
      roomId: "room", sceneId: "nyx--rockbreaker", actor, nowMs: 2,
      draft: { type: "point", color: "#ffffff", position: free(99) },
    })).rejects.toMatchObject({ code: "OUT_OF_BOUNDS" });
  });

  it("translates the authoritative locked stroke and preserves its shape", async () => {
    const { store } = createStore();
    const actor = { uid: "u1", role: "commander" as const };
    const created = await createStroke(store, actor, [free(1), free(3, 2)]);
    const locked = await acquireSceneObjectLock(store, {
      roomId: "room", sceneId: "nyx--rockbreaker", objectId: created.id, actor, nowMs: 2,
    });
    const moved = await commitSceneObjectTranslation(store, {
      roomId: "room", sceneId: "nyx--rockbreaker", objectId: created.id, actor,
      expectedRevision: created.revision, expectedLockRevision: locked.lockRevision!,
      translation: [2, 4, -1], nowMs: 3,
    });
    expect(moved).toMatchObject({ revision: 1, points: [free(3, 4, -1), free(5, 6, -1)] });
  });

  it("rejects stale and out-of-bounds stroke translations", async () => {
    const { store } = createStore();
    const actor = { uid: "u1", role: "commander" as const };
    const created = await createStroke(store, actor, [free(35), free(36)]);
    const locked = await acquireSceneObjectLock(store, {
      roomId: "room", sceneId: "nyx--rockbreaker", objectId: created.id, actor, nowMs: 2,
    });
    const base = {
      roomId: "room", sceneId: "nyx--rockbreaker", objectId: created.id, actor,
      expectedLockRevision: locked.lockRevision!, nowMs: 3,
    };
    await expect(commitSceneObjectTranslation(store, {
      ...base, expectedRevision: 99, translation: [1, 0, 0],
    })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await expect(commitSceneObjectTranslation(store, {
      ...base, expectedRevision: created.revision, translation: [2, 0, 0],
    })).rejects.toMatchObject({ code: "OUT_OF_BOUNDS" });
  });

  it("bounds enemy marker movement on x y z", async () => {
    const { store } = createStore();
    const actor = { uid: "u1", role: "commander" as const };
    const enemy = await createSceneObject(store, {
      roomId: "room", sceneId: "nyx--rockbreaker", actor, nowMs: 1,
      draft: { type: "enemyMarker", kind: "ground", color: "#ef4444", position: free(1) },
    });
    const locked = await acquireSceneObjectLock(store, {
      roomId: "room", sceneId: "nyx--rockbreaker", objectId: enemy.id, actor, nowMs: 2,
    });
    await expect(commitSceneObjectMove(store, {
      roomId: "room", sceneId: "nyx--rockbreaker", objectId: enemy.id, actor,
      expectedRevision: enemy.revision, expectedLockRevision: locked.lockRevision!,
      position: free(100, 40, -50), nowMs: 3,
    })).rejects.toMatchObject({ code: "OUT_OF_BOUNDS" });
  });

  it("deletes strokes but keeps troop tokens protected", async () => {
    const { objects, store } = createStore();
    const actor = { uid: "u1", role: "admin" as const };
    const stroke = await createStroke(store, actor, [free(1), free(2)]);
    await deleteSceneObject(store, {
      roomId: "room", sceneId: "nyx--rockbreaker", objectId: stroke.id, actor,
    });
    expect(objects.has(stroke.id)).toBe(false);
    objects.set("groupToken--g1", groupObject("g1", free(1)));
    await expect(deleteSceneObject(store, {
      roomId: "room", sceneId: "nyx--rockbreaker", objectId: "groupToken--g1", actor,
    })).rejects.toMatchObject({ code: "PROTECTED_OBJECT" });
  });

  it("rejects scene writes while Rockbreaker is disabled for the room", async () => {
    const { store } = createStore(false);
    await expect(createSceneObject(store, {
      roomId: "room",
      sceneId: "nyx--rockbreaker",
      actor: { uid: "u1", role: "admin" },
      draft: { type: "enemyMarker", kind: "ground", color: "#0ea5e9", position: point(1) },
      nowMs: 1,
    })).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
  });

  it("rejects viewer writes before touching scene state", async () => {
    const { objects, store } = createStore();
    await expect(createSceneObject(store, {
      roomId: "room",
      sceneId: "nyx--rockbreaker",
      actor: { uid: "viewer", role: "viewer" },
      draft: { type: "groupToken", groupId: "g1", color: "#0ea5e9", position: point(1) },
      nowMs: 1,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(objects.size).toBe(0);
  });
});
