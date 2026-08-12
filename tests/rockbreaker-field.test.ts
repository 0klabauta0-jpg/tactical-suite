import { describe, expect, it } from "vitest";
import { loadRockbreakerField, ROCKBREAKER_SCENE_VERSION } from "@/lib/rockbreaker/field";

describe("Rockbreaker field v1", () => {
  it("contains exactly 944 stable and finite asteroids", () => {
    const field = loadRockbreakerField();
    expect(ROCKBREAKER_SCENE_VERSION).toBe(1);
    expect(field).toHaveLength(944);
    expect(new Set(field.map((asteroid) => asteroid.id)).size).toBe(944);
    expect(field.every((asteroid) => asteroid.position.every(Number.isFinite))).toBe(true);
    expect(field.every((asteroid) => asteroid.scale.every((value) => Number.isFinite(value) && value > 0))).toBe(true);
  });
});
