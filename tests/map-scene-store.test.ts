import { describe, expect, it } from "vitest";
import { acquireSceneObjectLock, commitSceneObjectMove, createSceneObject, MapSceneStoreError, type MapSceneTransactionStore } from "@/lib/server/map-scene-store";
import type { SceneObject } from "@/lib/rockbreaker/scene-objects";

const point = (x: number) => ({ x, y: 0, z: 0, sceneVersion: 1 as const, anchor: { kind: "beltPlane" as const } });

function createStore() {
  const objects = new Map<string, SceneObject>();
  const store: MapSceneTransactionStore = {
    runObjectTransaction: async (_roomId, _sceneId, objectId, operation) => {
      const result = await operation({ object: objects.get(objectId) ?? null, groupIds: new Set(["g1"]) });
      if (result === null) objects.delete(objectId); else objects.set(objectId, result);
      return result;
    },
  };
  return { objects, store };
}

describe("map scene store", () => {
  it("deduplicates group tokens and locks them for the current commander", async () => {
    const { store } = createStore();
    const actor = { uid: "u1", role: "commander" as const };
    const first = await createSceneObject(store, { roomId: "room", sceneId: "nyx--rockbreaker", actor, draft: { type: "groupToken", groupId: "g1", color: "#0ea5e9", position: point(1) }, nowMs: 1 });
    const second = await createSceneObject(store, { roomId: "room", sceneId: "nyx--rockbreaker", actor, draft: { type: "groupToken", groupId: "g1", color: "#ffffff", position: point(2) }, nowMs: 2 });
    expect(second).toEqual(first);
    const locked = await acquireSceneObjectLock(store, { roomId: "room", sceneId: "nyx--rockbreaker", objectId: first.id, actor, nowMs: 10 });
    expect(locked).toMatchObject({ lockedByUid: "u1", lockRevision: 1, lockExpiresAtMs: 15_010 });
  });

  it("rejects a competing lock and stale move revision", async () => {
    const { store } = createStore();
    const first = await createSceneObject(store, { roomId: "room", sceneId: "nyx--rockbreaker", actor: { uid: "u1", role: "admin" }, draft: { type: "groupToken", groupId: "g1", color: "#0ea5e9", position: point(1) }, nowMs: 1 });
    const locked = await acquireSceneObjectLock(store, { roomId: "room", sceneId: "nyx--rockbreaker", objectId: first.id, actor: { uid: "u1", role: "admin" }, nowMs: 10 });
    await expect(acquireSceneObjectLock(store, { roomId: "room", sceneId: "nyx--rockbreaker", objectId: first.id, actor: { uid: "u2", role: "commander" }, nowMs: 11 }))
      .rejects.toEqual(new MapSceneStoreError("OBJECT_LOCKED", locked));
    await expect(commitSceneObjectMove(store, { roomId: "room", sceneId: "nyx--rockbreaker", objectId: first.id, actor: { uid: "u1", role: "admin" }, expectedRevision: 9, expectedLockRevision: 1, position: point(3), nowMs: 12 }))
      .rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });

  it("commits only the locked object with a new revision", async () => {
    const { store } = createStore();
    const actor = { uid: "u1", role: "commander" as const };
    const first = await createSceneObject(store, { roomId: "room", sceneId: "nyx--rockbreaker", actor, draft: { type: "groupToken", groupId: "g1", color: "#0ea5e9", position: point(1) }, nowMs: 1 });
    const locked = await acquireSceneObjectLock(store, { roomId: "room", sceneId: "nyx--rockbreaker", objectId: first.id, actor, nowMs: 2 });
    const moved = await commitSceneObjectMove(store, { roomId: "room", sceneId: "nyx--rockbreaker", objectId: first.id, actor, expectedRevision: first.revision, expectedLockRevision: locked.lockRevision!, position: point(4), nowMs: 3 });
    expect(moved).toMatchObject({ revision: 1, position: point(4) });
  });
});
