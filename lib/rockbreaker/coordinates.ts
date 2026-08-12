import { Matrix4, Vector3 } from "three";

export type Vec3 = readonly [number, number, number];
export type Mat4 = readonly [number, number, number, number, number, number, number, number,
  number, number, number, number, number, number, number, number];
export type Ray3 = { origin: Vec3; direction: Vec3 };
export type WorldAnchor =
  | { kind: "asteroid"; asteroidId: string; local: Vec3 }
  | { kind: "beltPlane" };
export type WorldPoint = { x: number; y: number; z: number; sceneVersion: 1; anchor: WorldAnchor };
export type AsteroidHit = { asteroidId: string; asteroidWorldMatrix: Mat4; hitPoint: Vec3 };

const finite3 = (value: Vec3) => value.length === 3 && value.every(Number.isFinite);

export function intersectBeltPlane(ray: Ray3): Vec3 | null {
  if (!finite3(ray.origin) || !finite3(ray.direction) || Math.abs(ray.direction[1]) < Number.EPSILON) return null;
  const distance = -ray.origin[1] / ray.direction[1];
  if (!Number.isFinite(distance) || distance < 0) return null;
  const point: Vec3 = [
    ray.origin[0] + ray.direction[0] * distance,
    0,
    ray.origin[2] + ray.direction[2] * distance,
  ];
  return finite3(point) ? point : null;
}

export function worldPointFromHit(hit: AsteroidHit): WorldPoint {
  if (!hit.asteroidId || !finite3(hit.hitPoint) || !hit.asteroidWorldMatrix.every(Number.isFinite)) {
    throw new Error("Invalid asteroid hit.");
  }
  const matrix = new Matrix4().fromArray([...hit.asteroidWorldMatrix]);
  const inverse = matrix.clone().invert();
  const localVector = new Vector3(...hit.hitPoint).applyMatrix4(inverse);
  const local: Vec3 = [localVector.x, localVector.y, localVector.z];
  if (!finite3(local)) throw new Error("Invalid asteroid transform.");
  return {
    x: hit.hitPoint[0], y: hit.hitPoint[1], z: hit.hitPoint[2], sceneVersion: 1,
    anchor: { kind: "asteroid", asteroidId: hit.asteroidId, local },
  };
}

export function worldPointFromAnchor(anchor: WorldAnchor, matrices: ReadonlyMap<string, Mat4>): Vec3 | null {
  if (anchor.kind === "beltPlane") return null;
  const matrix = matrices.get(anchor.asteroidId);
  if (!matrix || !finite3(anchor.local) || !matrix.every(Number.isFinite)) return null;
  const world = new Vector3(...anchor.local).applyMatrix4(new Matrix4().fromArray([...matrix]));
  const point: Vec3 = [world.x, world.y, world.z];
  return finite3(point) ? point : null;
}

export function resolveWorldPoint(ray: Ray3, hit: AsteroidHit | null): WorldPoint | null {
  if (hit) return worldPointFromHit(hit);
  const point = intersectBeltPlane(ray);
  return point ? { x: point[0], y: point[1], z: point[2], sceneVersion: 1, anchor: { kind: "beltPlane" } } : null;
}
