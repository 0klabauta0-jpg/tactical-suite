import { describe, expect, it, vi } from "vitest";
import { releasePositionDrag, releaseStrokeDrag } from "@/lib/rockbreaker/release";
import type { SceneObject, StrokeSceneObject } from "@/lib/rockbreaker/scene-objects";
import type { Vec3, WorldPoint } from "@/lib/rockbreaker/coordinates";

const point = (x: number) => ({ x, y: 0, z: 0, sceneVersion: 1 as const, anchor: { kind: "freeSpace" as const } });

const positioned = (revision: number): Extract<SceneObject, { position: unknown }> => ({
  id: "point--1", type: "point", systemId: "nyx", mapId: "rockbreaker", sceneVersion: 1,
  color: "#22d3ee", position: point(1), revision, createdBy: "u1", createdAtMs: 1, updatedBy: "u1", updatedAtMs: 1,
});

const stroke = (revision: number): StrokeSceneObject => ({
  id: "stroke--1", type: "stroke", systemId: "nyx", mapId: "rockbreaker", sceneVersion: 1,
  color: "#22d3ee", width: 3, points: [point(1), point(2)], revision,
  createdBy: "u1", createdAtMs: 1, updatedBy: "u1", updatedAtMs: 1,
});

const group = (revision: number): Extract<SceneObject, { position: unknown }> => ({
  id: "groupToken--g1", type: "groupToken", groupId: "g1", systemId: "nyx", mapId: "rockbreaker", sceneVersion: 1,
  color: "#3b82f6", position: point(1), revision, createdBy: "u1", createdAtMs: 1, updatedBy: "u1", updatedAtMs: 1,
});

describe("Rockbreaker release orchestration", () => {
  it("preserves the positioned gesture-start revision across a newer lock response", async () => {
    const start = positioned(4);
    const lock = vi.fn(async () => ({ ...start, revision: 5, lockRevision: 11 }));
    const write = vi.fn(async (_object: typeof start, _position: WorldPoint, expectedRevision: number, expectedLockRevision: number) => {
      expect(expectedLockRevision).toBe(11);
      if (expectedRevision !== 4) return;
      throw new Error("Positionskonflikt – Serverstand übernommen.");
    });

    await expect(releasePositionDrag(start, point(3), { lock, write })).rejects.toThrow("Positionskonflikt");
    expect(write).toHaveBeenCalledWith(start, point(3), 4, 11);
  });

  it("uses the same start-revision orchestration for a group-token fallback", async () => {
    const start = group(9);
    const lock = vi.fn(async () => ({ ...start, revision: 10, lockRevision: 13 }));
    const write = vi.fn(async (_object: typeof start, _position: WorldPoint, expectedRevision: number, expectedLockRevision: number) => {
      expect(expectedLockRevision).toBe(13);
      if (expectedRevision !== 9) return;
      throw new Error("Positionskonflikt – Serverstand übernommen.");
    });

    await expect(releasePositionDrag(start, point(5), { lock, write })).rejects.toThrow("Positionskonflikt");
    expect(write).toHaveBeenCalledWith(start, point(5), 9, 13);
  });

  it("preserves the stroke gesture-start revision across a newer lock response", async () => {
    const start = stroke(7);
    const lock = vi.fn(async () => ({ ...start, revision: 8, lockRevision: 12 }));
    const write = vi.fn(async (_object: typeof start, _translation: Vec3, expectedRevision: number, expectedLockRevision: number) => {
      expect(expectedLockRevision).toBe(12);
      if (expectedRevision !== 7) return;
      throw new Error("Positionskonflikt – Serverstand übernommen.");
    });

    await expect(releaseStrokeDrag(start, [1, 2, 3], { lock, write })).rejects.toThrow("Positionskonflikt");
    expect(write).toHaveBeenCalledWith(start, [1, 2, 3], 7, 12);
  });
});
