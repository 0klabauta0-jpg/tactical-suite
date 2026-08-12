import type { Vec3, WorldAnchor, WorldPoint } from "@/lib/rockbreaker/coordinates";

type SceneObjectBase = {
  id: string;
  systemId: "nyx";
  mapId: "rockbreaker";
  sceneVersion: 1;
  color: string;
  revision: number;
  createdBy: string;
  createdAtMs: number;
  updatedBy: string;
  updatedAtMs: number;
  lockedByUid?: string;
  lockRevision?: number;
  lockExpiresAtMs?: number;
};

export type SceneObject = SceneObjectBase & (
  | { type: "groupToken" | "orderMarker"; groupId: string; position: WorldPoint }
  | { type: "enemyMarker"; kind: "infantry" | "ground" | "air"; position: WorldPoint }
  | { type: "point"; label?: string; position: WorldPoint }
  | { type: "line"; start: WorldPoint; end: WorldPoint }
);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function parseVec3(value: unknown): Vec3 | null {
  return Array.isArray(value) && value.length === 3 && value.every(finite) ? value as unknown as Vec3 : null;
}

function parseAnchor(value: unknown): WorldAnchor | null {
  if (!isRecord(value)) return null;
  if (value.kind === "beltPlane") return { kind: "beltPlane" };
  const local = parseVec3(value.local);
  if (value.kind === "asteroid" && typeof value.asteroidId === "string" && value.asteroidId && local) {
    return { kind: "asteroid", asteroidId: value.asteroidId, local };
  }
  return null;
}

export function parseWorldPoint(value: unknown): WorldPoint | null {
  if (!isRecord(value) || !finite(value.x) || !finite(value.y) || !finite(value.z) || value.sceneVersion !== 1) return null;
  const anchor = parseAnchor(value.anchor);
  return anchor ? { x: value.x, y: value.y, z: value.z, sceneVersion: 1, anchor } : null;
}

function common(value: Record<string, unknown>): SceneObjectBase | null {
  if (typeof value.id !== "string" || !value.id || value.systemId !== "nyx" || value.mapId !== "rockbreaker"
    || value.sceneVersion !== 1 || typeof value.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value.color)
    || !Number.isInteger(value.revision) || (value.revision as number) < 0
    || typeof value.createdBy !== "string" || typeof value.updatedBy !== "string"
    || !finite(value.createdAtMs) || !finite(value.updatedAtMs)) return null;
  return {
    id: value.id,
    systemId: "nyx",
    mapId: "rockbreaker",
    sceneVersion: 1,
    color: value.color,
    revision: value.revision as number,
    createdBy: value.createdBy,
    createdAtMs: value.createdAtMs,
    updatedBy: value.updatedBy,
    updatedAtMs: value.updatedAtMs,
    ...(typeof value.lockedByUid === "string" ? { lockedByUid: value.lockedByUid } : {}),
    ...(Number.isInteger(value.lockRevision) && (value.lockRevision as number) >= 0 ? { lockRevision: value.lockRevision as number } : {}),
    ...(finite(value.lockExpiresAtMs) ? { lockExpiresAtMs: value.lockExpiresAtMs } : {}),
  };
}

export function parseSceneObject(value: unknown): SceneObject | null {
  if (!isRecord(value)) return null;
  const base = common(value);
  if (!base) return null;
  if (value.type === "line") {
    const start = parseWorldPoint(value.start);
    const end = parseWorldPoint(value.end);
    return start && end ? { ...base, type: "line", start, end } : null;
  }
  const position = parseWorldPoint(value.position);
  if (!position) return null;
  if ((value.type === "groupToken" || value.type === "orderMarker") && typeof value.groupId === "string" && value.groupId) {
    return { ...base, type: value.type, groupId: value.groupId, position };
  }
  if (value.type === "enemyMarker" && (value.kind === "infantry" || value.kind === "ground" || value.kind === "air")) {
    return { ...base, type: "enemyMarker", kind: value.kind, position };
  }
  if (value.type === "point") {
    return { ...base, type: "point", ...(typeof value.label === "string" ? { label: value.label } : {}), position };
  }
  return null;
}

export const groupTokenObjectId = (groupId: string) => `groupToken--${encodeURIComponent(groupId)}`;
export const orderMarkerObjectId = (groupId: string) => `orderMarker--${encodeURIComponent(groupId)}`;
