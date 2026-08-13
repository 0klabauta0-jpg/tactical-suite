import { describe, expect, it } from "vitest";
import type { SceneObject } from "@/lib/rockbreaker/scene-objects";
import {
  appendStrokeSample,
  clampStrokeTranslation,
  latestOwnDrawingObject,
  simplifyStrokePoints,
  translateStrokePoints,
} from "@/lib/rockbreaker/drawing";

const free = (x: number, y = 0, z = 0) => ({
  x, y, z, sceneVersion: 1 as const, anchor: { kind: "freeSpace" as const },
});
const drawingBase = (id: string, uid: string, createdAtMs: number) => ({
  id, systemId: "nyx" as const, mapId: "rockbreaker" as const, sceneVersion: 1 as const,
  color: "#22d3ee", revision: 0, createdBy: uid, createdAtMs,
  updatedBy: uid, updatedAtMs: createdAtMs,
});
const scenePoint = (id: string, uid: string, createdAtMs: number): SceneObject => ({
  ...drawingBase(id, uid, createdAtMs), type: "point", position: free(0),
});
const sceneStroke = (id: string, uid: string, createdAtMs: number): SceneObject => ({
  ...drawingBase(id, uid, createdAtMs), type: "stroke", width: 3, points: [free(0), free(1)],
});
const sceneEnemy = (id: string, uid: string, createdAtMs: number): SceneObject => ({
  ...drawingBase(id, uid, createdAtMs), type: "enemyMarker", kind: "ground", position: free(0),
});

describe("Rockbreaker drawing geometry", () => {
  it("samples by screen distance and simplifies a 3d path", () => {
    const samples = [
      { screen: { x: 10, y: 10 }, world: free(0) },
      { screen: { x: 11, y: 11 }, world: free(0.01) },
    ];
    expect(appendStrokeSample(samples, { screen: { x: 12, y: 12 }, world: free(0.02) }, 4)).toHaveLength(2);
    const appended = appendStrokeSample(samples, { screen: { x: 20, y: 10 }, world: free(1) }, 4);
    expect(appended).toHaveLength(3);
    expect(simplifyStrokePoints([free(0), free(1, 0.01), free(2)], 0.05)).toEqual([free(0), free(2)]);
  });

  it("clamps one translation for the complete path and preserves shape", () => {
    const points = [free(35, 4, -2), free(36, 7, 1)];
    const delta = clampStrokeTranslation(points, [10, -2, 4]);
    expect(delta).toEqual([1, -2, 4]);
    expect(translateStrokePoints(points, delta).map(({ x, y, z }) => [x, y, z]))
      .toEqual([[36, 2, 2], [37, 5, 5]]);
    expect(translateStrokePoints([
      { x: 0, y: 0, z: 0, sceneVersion: 1, anchor: { kind: "beltPlane" as const } },
    ], [1, 2, 3])[0].anchor).toEqual({ kind: "freeSpace" });
  });

  it("caps an unsimplifiable path while retaining its endpoints", () => {
    const points = Array.from({ length: 513 }, (_, index) => free(index, index % 2));
    const simplified = simplifyStrokePoints(points, 0.1);
    expect(simplified).toHaveLength(512);
    expect(simplified[0]).toEqual(free(0, 0));
    expect(simplified.at(-1)).toEqual(free(512, 0));
  });

  it("selects only the current user's latest drawing for undo", () => {
    expect(latestOwnDrawingObject([
      scenePoint("other", "u2", 20),
      sceneStroke("mine-old", "u1", 10),
      sceneStroke("mine-new", "u1", 30),
      sceneEnemy("enemy", "u1", 40),
    ], "u1")?.id).toBe("mine-new");
  });
});
