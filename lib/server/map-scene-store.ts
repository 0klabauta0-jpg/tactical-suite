import { randomUUID } from "node:crypto";
import type { Role } from "@/lib/domain/roles";
import type { WorldPoint } from "@/lib/rockbreaker/coordinates";
import { parseWorldPoint, type SceneObject } from "@/lib/rockbreaker/scene-objects";
import { groupTokenObjectId, orderMarkerObjectId } from "@/lib/rockbreaker/scene-objects";

export type MapSceneActor = { uid: string; role: Role };
export type SceneObjectDraft =
  | { type: "groupToken"; groupId: string; color: string; position: WorldPoint }
  | { type: "orderMarker"; groupId: string; color: string; position: WorldPoint }
  | { type: "enemyMarker"; kind: "infantry" | "ground" | "air"; color: string; position: WorldPoint }
  | { type: "point"; label?: string; color: string; position: WorldPoint };

export type MapSceneTransactionStore = {
  runObjectTransaction: (
    roomId: string,
    sceneId: string,
    objectId: string,
    operation: (context: { object: SceneObject | null; groupIds: ReadonlySet<string> }) => Promise<SceneObject | null>,
  ) => Promise<SceneObject | null>;
};

export class MapSceneStoreError extends Error {
  constructor(
    public readonly code: "FORBIDDEN" | "INVALID_SCENE" | "INVALID_OBJECT" | "OBJECT_NOT_FOUND" | "OBJECT_LOCKED" | "REVISION_CONFLICT" | "LOCK_MISMATCH",
    public readonly currentObject?: SceneObject | null,
  ) { super(code); }
}

function assertWriter(actor: MapSceneActor) {
  if (actor.role !== "admin" && actor.role !== "commander") throw new MapSceneStoreError("FORBIDDEN");
}

function assertBoundary(sceneId: string) {
  if (sceneId !== "nyx--rockbreaker") throw new MapSceneStoreError("INVALID_SCENE");
}

function validDraft(draft: SceneObjectDraft) {
  return /^#[0-9a-fA-F]{6}$/.test(draft.color) && parseWorldPoint(draft.position) !== null;
}

export async function createSceneObject(store: MapSceneTransactionStore, input: {
  roomId: string; sceneId: string; actor: MapSceneActor; draft: SceneObjectDraft; nowMs: number;
}): Promise<SceneObject> {
  assertWriter(input.actor);
  assertBoundary(input.sceneId);
  if (!validDraft(input.draft)) throw new MapSceneStoreError("INVALID_OBJECT");
  const objectId = input.draft.type === "groupToken" ? groupTokenObjectId(input.draft.groupId)
    : input.draft.type === "orderMarker" ? orderMarkerObjectId(input.draft.groupId)
      : `${input.draft.type}--${randomUUID()}`;
  const result = await store.runObjectTransaction(input.roomId, input.sceneId, objectId, async ({ object, groupIds }) => {
    if (object) return object;
    if ((input.draft.type === "groupToken" || input.draft.type === "orderMarker") && !groupIds.has(input.draft.groupId)) {
      throw new MapSceneStoreError("INVALID_OBJECT");
    }
    const base = {
      id: objectId, systemId: "nyx" as const, mapId: "rockbreaker" as const, sceneVersion: 1 as const,
      color: input.draft.color, revision: 0, createdBy: input.actor.uid, createdAtMs: input.nowMs,
      updatedBy: input.actor.uid, updatedAtMs: input.nowMs,
    };
    if (input.draft.type === "groupToken" || input.draft.type === "orderMarker") return { ...base, type: input.draft.type, groupId: input.draft.groupId, position: input.draft.position };
    if (input.draft.type === "enemyMarker") return { ...base, type: "enemyMarker", kind: input.draft.kind, position: input.draft.position };
    return { ...base, type: "point", ...(input.draft.label ? { label: input.draft.label } : {}), position: input.draft.position };
  });
  if (!result) throw new MapSceneStoreError("INVALID_OBJECT");
  return result;
}

export async function acquireSceneObjectLock(store: MapSceneTransactionStore, input: {
  roomId: string; sceneId: string; objectId: string; actor: MapSceneActor; nowMs: number;
}): Promise<SceneObject> {
  assertWriter(input.actor);
  assertBoundary(input.sceneId);
  const result = await store.runObjectTransaction(input.roomId, input.sceneId, input.objectId, async ({ object }) => {
    if (!object) throw new MapSceneStoreError("OBJECT_NOT_FOUND");
    if (object.lockedByUid && object.lockedByUid !== input.actor.uid && (object.lockExpiresAtMs ?? 0) > input.nowMs) {
      throw new MapSceneStoreError("OBJECT_LOCKED", object);
    }
    return {
      ...object,
      lockedByUid: input.actor.uid,
      lockRevision: (object.lockRevision ?? 0) + 1,
      lockExpiresAtMs: input.nowMs + 15_000,
    };
  });
  if (!result) throw new MapSceneStoreError("OBJECT_NOT_FOUND");
  return result;
}

export async function commitSceneObjectMove(store: MapSceneTransactionStore, input: {
  roomId: string; sceneId: string; objectId: string; actor: MapSceneActor;
  expectedRevision: number; expectedLockRevision: number; position: WorldPoint; nowMs: number;
}): Promise<SceneObject> {
  assertWriter(input.actor);
  assertBoundary(input.sceneId);
  if (!parseWorldPoint(input.position)) throw new MapSceneStoreError("INVALID_OBJECT");
  const result = await store.runObjectTransaction(input.roomId, input.sceneId, input.objectId, async ({ object }) => {
    if (!object) throw new MapSceneStoreError("OBJECT_NOT_FOUND");
    if (object.revision !== input.expectedRevision) throw new MapSceneStoreError("REVISION_CONFLICT", object);
    if (object.lockedByUid !== input.actor.uid || object.lockRevision !== input.expectedLockRevision || (object.lockExpiresAtMs ?? 0) <= input.nowMs) {
      throw new MapSceneStoreError("LOCK_MISMATCH", object);
    }
    if (!("position" in object)) throw new MapSceneStoreError("INVALID_OBJECT", object);
    return { ...object, position: input.position, revision: object.revision + 1, updatedBy: input.actor.uid, updatedAtMs: input.nowMs };
  });
  if (!result) throw new MapSceneStoreError("OBJECT_NOT_FOUND");
  return result;
}

export async function deleteSceneObject(store: MapSceneTransactionStore, input: {
  roomId: string; sceneId: string; objectId: string; actor: MapSceneActor;
}): Promise<void> {
  assertWriter(input.actor);
  assertBoundary(input.sceneId);
  await store.runObjectTransaction(input.roomId, input.sceneId, input.objectId, async ({ object }) => {
    if (!object) throw new MapSceneStoreError("OBJECT_NOT_FOUND");
    return null;
  });
}
