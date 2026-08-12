import { describe, expect, it } from "vitest";
import { intersectBeltPlane, resolveWorldPoint, worldPointFromAnchor, worldPointFromHit, type Mat4 } from "@/lib/rockbreaker/coordinates";

const translation = (x: number, y: number, z: number): Mat4 => [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  x, y, z, 1,
];

describe("Rockbreaker shared coordinates", () => {
  it("stores the same global point independent of camera origin", () => {
    expect(intersectBeltPlane({ origin: [0, 10, 10], direction: [0, -1, -1] })).toEqual([0, 0, 0]);
    expect(intersectBeltPlane({ origin: [10, 20, 20], direction: [-10, -20, -20] })).toEqual([0, 0, 0]);
    expect(intersectBeltPlane({ origin: [0, 10, 0], direction: [1, 0, 0] })).toBeNull();
  });

  it("stores an asteroid-local anchor and reconstructs its common world point", () => {
    const matrix = translation(10, 2, -4);
    const point = worldPointFromHit({ asteroidId: "rb-v1-0007", asteroidWorldMatrix: matrix, hitPoint: [10.5, 2.25, -4.75] });
    expect(point).toEqual({
      x: 10.5, y: 2.25, z: -4.75, sceneVersion: 1,
      anchor: { kind: "asteroid", asteroidId: "rb-v1-0007", local: [0.5, 0.25, -0.75] },
    });
    expect(worldPointFromAnchor(point.anchor, new Map([["rb-v1-0007", matrix]]))).toEqual([10.5, 2.25, -4.75]);
  });

  it("prefers an asteroid hit and falls back to the belt plane", () => {
    const hit = { asteroidId: "rb-v1-0001", asteroidWorldMatrix: translation(0, 0, 0), hitPoint: [1, 2, 3] as const };
    expect(resolveWorldPoint({ origin: [0, 1, 0], direction: [0, -1, 0] }, hit)?.anchor.kind).toBe("asteroid");
    expect(resolveWorldPoint({ origin: [1, 1, 2], direction: [0, -1, 0] }, null)).toMatchObject({ x: 1, y: 0, z: 2, anchor: { kind: "beltPlane" } });
  });
});
