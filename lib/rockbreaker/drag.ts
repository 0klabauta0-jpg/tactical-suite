import type { Ray3, Vec3, WorldPoint } from "@/lib/rockbreaker/coordinates";

export const ROCKBREAKER_MOVEMENT_BOUNDS = {
  x: { min: -36, max: 37 },
  y: { min: -31, max: 25 },
  z: { min: -23, max: 29 },
} as const;

const finiteVec3 = (value: Vec3) => value.length === 3 && value.every(Number.isFinite);
const dot = (left: Vec3, right: Vec3) => left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
const clamp = (value: number, minimum: number, maximum: number) => Math.min(Math.max(value, minimum), maximum);

export function intersectCameraDragPlane(ray: Ray3, planePoint: Vec3, planeNormal: Vec3): Vec3 | null {
  if (!finiteVec3(ray.origin) || !finiteVec3(ray.direction) || !finiteVec3(planePoint) || !finiteVec3(planeNormal)) return null;
  const denominator = dot(ray.direction, planeNormal);
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-8) return null;
  const offset: Vec3 = [
    planePoint[0] - ray.origin[0],
    planePoint[1] - ray.origin[1],
    planePoint[2] - ray.origin[2],
  ];
  const distance = dot(offset, planeNormal) / denominator;
  if (!Number.isFinite(distance) || distance < 0) return null;
  const point: Vec3 = [
    ray.origin[0] + ray.direction[0] * distance,
    ray.origin[1] + ray.direction[1] * distance,
    ray.origin[2] + ray.direction[2] * distance,
  ];
  return finiteVec3(point) ? point : null;
}

export function clampCanvasPoint(
  point: { x: number; y: number },
  rect: { left: number; top: number; width: number; height: number },
  inset = 24,
) {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const minimumX = rect.width >= inset * 2 ? rect.left + inset : centerX;
  const maximumX = rect.width >= inset * 2 ? rect.left + rect.width - inset : centerX;
  const minimumY = rect.height >= inset * 2 ? rect.top + inset : centerY;
  const maximumY = rect.height >= inset * 2 ? rect.top + rect.height - inset : centerY;
  return {
    x: clamp(Number.isFinite(point.x) ? point.x : centerX, minimumX, maximumX),
    y: clamp(Number.isFinite(point.y) ? point.y : centerY, minimumY, maximumY),
  };
}

function isCoordinateRecord(
  position: Vec3 | Pick<WorldPoint, "x" | "y" | "z">,
): position is Pick<WorldPoint, "x" | "y" | "z"> {
  return !Array.isArray(position) && "x" in position && "y" in position && "z" in position;
}

function vector(position: Vec3 | Pick<WorldPoint, "x" | "y" | "z">): Vec3 {
  return isCoordinateRecord(position)
    ? [position.x, position.y, position.z]
    : position;
}

export function clampRockbreakerPosition(position: Vec3 | Pick<WorldPoint, "x" | "y" | "z">): Vec3 {
  const [x, y, z] = vector(position);
  return [
    clamp(Number.isFinite(x) ? x : 0, ROCKBREAKER_MOVEMENT_BOUNDS.x.min, ROCKBREAKER_MOVEMENT_BOUNDS.x.max),
    clamp(Number.isFinite(y) ? y : 0, ROCKBREAKER_MOVEMENT_BOUNDS.y.min, ROCKBREAKER_MOVEMENT_BOUNDS.y.max),
    clamp(Number.isFinite(z) ? z : 0, ROCKBREAKER_MOVEMENT_BOUNDS.z.min, ROCKBREAKER_MOVEMENT_BOUNDS.z.max),
  ];
}

export function isRockbreakerPositionWithinBounds(position: Vec3 | Pick<WorldPoint, "x" | "y" | "z">): boolean {
  const [x, y, z] = vector(position);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
    && x >= ROCKBREAKER_MOVEMENT_BOUNDS.x.min && x <= ROCKBREAKER_MOVEMENT_BOUNDS.x.max
    && y >= ROCKBREAKER_MOVEMENT_BOUNDS.y.min && y <= ROCKBREAKER_MOVEMENT_BOUNDS.y.max
    && z >= ROCKBREAKER_MOVEMENT_BOUNDS.z.min && z <= ROCKBREAKER_MOVEMENT_BOUNDS.z.max;
}

export function freeSpaceWorldPoint(position: Vec3 | Pick<WorldPoint, "x" | "y" | "z">): WorldPoint {
  const [x, y, z] = clampRockbreakerPosition(position);
  return { x, y, z, sceneVersion: 1, anchor: { kind: "freeSpace" } };
}
