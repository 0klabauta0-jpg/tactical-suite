import type { Vec3, WorldPoint } from "@/lib/rockbreaker/coordinates";
import { ROCKBREAKER_MOVEMENT_BOUNDS } from "@/lib/rockbreaker/drag";
import type { SceneObject } from "@/lib/rockbreaker/scene-objects";

export type RockbreakerDrawingTool = "pointer" | "point" | "stroke" | "move" | "delete";
export type StrokeSample = { screen: { x: number; y: number }; world: WorldPoint };

const distanceToSegment = (point: WorldPoint, start: WorldPoint, end: WorldPoint) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  const projection = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0,
    ((point.x - start.x) * dx + (point.y - start.y) * dy + (point.z - start.z) * dz) / lengthSquared,
  ));
  return Math.hypot(point.x - start.x - dx * projection, point.y - start.y - dy * projection, point.z - start.z - dz * projection);
};

export function appendStrokeSample(
  samples: readonly StrokeSample[], next: StrokeSample, minimumScreenDistance = 4,
): StrokeSample[] {
  const last = samples.at(-1);
  if (last && Math.hypot(next.screen.x - last.screen.x, next.screen.y - last.screen.y) < minimumScreenDistance) {
    return [...samples];
  }
  return [...samples, next];
}

export function simplifyStrokePoints(
  points: readonly WorldPoint[], tolerance = 0.08,
): WorldPoint[] {
  if (points.length <= 2) return [...points];

  const retained = new Set<number>([0, points.length - 1]);
  const simplifySegment = (startIndex: number, endIndex: number): void => {
    let greatestDistance = tolerance;
    let greatestIndex = -1;
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const distance = distanceToSegment(points[index], points[startIndex], points[endIndex]);
      if (distance > greatestDistance) {
        greatestDistance = distance;
        greatestIndex = index;
      }
    }
    if (greatestIndex >= 0) {
      retained.add(greatestIndex);
      simplifySegment(startIndex, greatestIndex);
      simplifySegment(greatestIndex, endIndex);
    }
  };

  simplifySegment(0, points.length - 1);
  const simplified = [...retained].sort((left, right) => left - right).map((index) => points[index]);
  if (simplified.length <= 512) return simplified;
  return Array.from({ length: 512 }, (_, index) => simplified[Math.round(index * (simplified.length - 1) / 511)]);
}

export function translateStrokePoints(points: readonly WorldPoint[], delta: Vec3): WorldPoint[] {
  return points.map((point) => ({
    x: point.x + delta[0],
    y: point.y + delta[1],
    z: point.z + delta[2],
    sceneVersion: 1,
    anchor: { kind: "freeSpace" },
  }));
}

export function clampStrokeTranslation(points: readonly WorldPoint[], desired: Vec3): Vec3 {
  if (points.length === 0) return [desired[0], desired[1], desired[2]];
  const clampAxis = (axis: "x" | "y" | "z", desiredDelta: number) => {
    const coordinates = points.map((point) => point[axis]);
    const bounds = ROCKBREAKER_MOVEMENT_BOUNDS[axis];
    const minimum = bounds.min - Math.min(...coordinates);
    const maximum = bounds.max - Math.max(...coordinates);
    return Math.min(Math.max(desiredDelta, minimum), maximum);
  };
  return [clampAxis("x", desired[0]), clampAxis("y", desired[1]), clampAxis("z", desired[2])];
}

export function latestOwnDrawingObject(objects: readonly SceneObject[], uid: string): SceneObject | null {
  return objects.reduce<SceneObject | null>((latest, object) => (
    object.createdBy === uid && (object.type === "point" || object.type === "stroke")
      && (!latest || object.createdAtMs > latest.createdAtMs)
      ? object
      : latest
  ), null);
}
