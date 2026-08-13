import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Vec3, WorldPoint } from "@/lib/rockbreaker/coordinates";
import { parseSceneObject, type SceneObject, type StrokeSceneObject } from "@/lib/rockbreaker/scene-objects";
import type { SceneObjectDraft } from "@/lib/server/map-scene-store";

export function subscribeSceneObjects(roomId: string, sceneId: string, onChange: (objects: SceneObject[]) => void) {
  return onSnapshot(collection(db, "rooms", roomId, "mapScenes", sceneId, "objects"), (snapshot) => {
    onChange(snapshot.docs.flatMap((document) => {
      const object = parseSceneObject(document.data());
      return object ? [object] : [];
    }));
  });
}

async function api<T>(path: string, method: string, getIdToken: () => Promise<string>, body?: unknown): Promise<T> {
  const token = await getIdToken();
  const response = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    cache: "no-store",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !result) throw new Error(result?.error ?? "3D-Objekt konnte nicht geändert werden.");
  return result;
}

const base = (roomId: string, sceneId: string) => `/api/rooms/${encodeURIComponent(roomId)}/map-scenes/${encodeURIComponent(sceneId)}`;

export const createMapSceneObject = (roomId: string, sceneId: string, draft: SceneObjectDraft, getIdToken: () => Promise<string>) =>
  api<SceneObject>(`${base(roomId, sceneId)}/objects`, "POST", getIdToken, draft);

export const lockMapSceneObject = (roomId: string, sceneId: string, objectId: string, getIdToken: () => Promise<string>) =>
  api<SceneObject>(`${base(roomId, sceneId)}/objects/${encodeURIComponent(objectId)}/lock`, "POST", getIdToken);

export const moveMapSceneObject = (
  roomId: string, sceneId: string, objectId: string, position: WorldPoint,
  expectedRevision: number, expectedLockRevision: number, getIdToken: () => Promise<string>,
) => api<SceneObject>(`${base(roomId, sceneId)}/objects/${encodeURIComponent(objectId)}`, "PATCH", getIdToken, {
  position, expectedRevision, expectedLockRevision,
});

export const translateMapSceneObject = (
  roomId: string,
  sceneId: string,
  objectId: string,
  translation: Vec3,
  expectedRevision: number,
  expectedLockRevision: number,
  getIdToken: () => Promise<string>,
) => api<StrokeSceneObject>(
  `${base(roomId, sceneId)}/objects/${encodeURIComponent(objectId)}`,
  "PATCH",
  getIdToken,
  { translation, expectedRevision, expectedLockRevision },
);

export const removeMapSceneObject = (roomId: string, sceneId: string, objectId: string, getIdToken: () => Promise<string>) =>
  api<{ deleted: true }>(`${base(roomId, sceneId)}/objects/${encodeURIComponent(objectId)}`, "DELETE", getIdToken);
