import { describe, expect, it } from "vitest";
import {
  clampCanvasPoint,
  clampRockbreakerPosition,
  freeSpaceWorldPoint,
  intersectCameraDragPlane,
  isRockbreakerPositionWithinBounds,
} from "@/lib/rockbreaker/drag";

describe("Rockbreaker camera-relative drag", () => {
  it("intersects the frozen camera-facing plane", () => {
    expect(intersectCameraDragPlane(
      { origin: [0, 5, 10], direction: [0, 0, -1] },
      [0, 2, 0],
      [0, 0, -1],
    )).toEqual([0, 5, 0]);
  });

  it("returns null for parallel or non-finite rays", () => {
    expect(intersectCameraDragPlane(
      { origin: [0, 5, 10], direction: [1, 0, 0] },
      [0, 2, 0],
      [0, 0, -1],
    )).toBeNull();
    expect(intersectCameraDragPlane(
      { origin: [0, 5, 10], direction: [0, Number.NaN, -1] },
      [0, 2, 0],
      [0, 0, -1],
    )).toBeNull();
  });

  it("keeps the pointer inside the visible canvas", () => {
    const rect = { left: 10, top: 20, width: 800, height: 600 };
    expect(clampCanvasPoint({ x: -100, y: 900 }, rect)).toEqual({ x: 34, y: 596 });
    expect(clampCanvasPoint({ x: 410, y: 320 }, rect)).toEqual({ x: 410, y: 320 });
  });

  it("clamps every world axis to the shared field bounds", () => {
    expect(clampRockbreakerPosition([-100, 80, 90])).toEqual([-36, 25, 29]);
    expect(clampRockbreakerPosition([100, -80, -90])).toEqual([37, -31, -23]);
    expect(isRockbreakerPositionWithinBounds([37, 25, 29])).toBe(true);
    expect(isRockbreakerPositionWithinBounds([37.01, 25, 29])).toBe(false);
  });

  it("creates a shared free-space world point", () => {
    expect(freeSpaceWorldPoint([1, 2, 3])).toEqual({
      x: 1,
      y: 2,
      z: 3,
      sceneVersion: 1,
      anchor: { kind: "freeSpace" },
    });
  });
});
