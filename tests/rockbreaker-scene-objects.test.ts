import { describe, expect, it } from "vitest";
import { confirmedObjectPosition, groupTokenObjectId, orderMarkerObjectId, parseSceneObject } from "@/lib/rockbreaker/scene-objects";

const position = { x: 1, y: 2, z: 3, sceneVersion: 1 as const, anchor: { kind: "beltPlane" as const } };
const common = { systemId: "nyx", mapId: "rockbreaker", sceneVersion: 1, color: "#0ea5e9", revision: 2, createdBy: "u1", createdAtMs: 1, updatedBy: "u1", updatedAtMs: 2 };

describe("Rockbreaker scene objects", () => {
  it("creates deterministic IDs for shared tactical objects", () => {
    expect(groupTokenObjectId("g/a")).toBe("groupToken--g%2Fa");
    expect(orderMarkerObjectId("g/a")).toBe("orderMarker--g%2Fa");
  });

  it("validates group and enemy objects and ignores legacy opacity", () => {
    expect(parseSceneObject({ id: "groupToken--g1", type: "groupToken", groupId: "g1", position, ...common })).not.toBeNull();
    expect(parseSceneObject({ id: "enemy", type: "enemyMarker", kind: "air", position, opacity: 0.01, ...common }))
      .not.toHaveProperty("opacity");
  });

  it("rejects non-finite positions and invalid scene boundaries", () => {
    expect(parseSceneObject({ id: "bad", type: "groupToken", groupId: "g1", position: { ...position, x: Number.NaN }, ...common })).toBeNull();
    expect(parseSceneObject({ id: "bad", type: "groupToken", groupId: "g1", position, ...common, systemId: "pyro" })).toBeNull();
  });

  it("accepts free-space positions and rejects unknown anchors", () => {
    expect(parseSceneObject({
      id: "groupToken--g1",
      type: "groupToken",
      groupId: "g1",
      position: { x: 1, y: 2, z: 3, sceneVersion: 1, anchor: { kind: "freeSpace" } },
      ...common,
    })).toMatchObject({ position: { y: 2, anchor: { kind: "freeSpace" } } });
    expect(parseSceneObject({
      id: "groupToken--g1",
      type: "groupToken",
      groupId: "g1",
      position: { x: 1, y: 2, z: 3, sceneVersion: 1, anchor: { kind: "unknown" } },
      ...common,
    })).toBeNull();
  });

  it("parses one bounded stroke object", () => {
    const free = (x: number, y = 0, z = 0) => ({
      x, y, z, sceneVersion: 1 as const, anchor: { kind: "freeSpace" as const },
    });

    expect(parseSceneObject({
      ...common, id: "stroke--1", type: "stroke", width: 3,
      points: [free(1), free(2, 1)],
    })).toMatchObject({ type: "stroke", width: 3, points: [{ x: 1 }, { x: 2, y: 1 }] });
  });

  it.each([
    { width: 0, points: [{ ...position, anchor: { kind: "freeSpace" } }, { ...position, x: 2, anchor: { kind: "freeSpace" } }] },
    { width: 2, points: [{ ...position, anchor: { kind: "freeSpace" } }, { ...position, x: 2, anchor: { kind: "freeSpace" } }] },
    { width: 3, points: [{ ...position, anchor: { kind: "freeSpace" } }] },
    { width: 3, points: Array.from({ length: 513 }, (_, index) => ({ x: index / 20, y: 0, z: 0, sceneVersion: 1, anchor: { kind: "freeSpace" } })) },
    { width: 3, points: [{ ...position, anchor: { kind: "freeSpace" } }, { ...position, x: Number.NaN, anchor: { kind: "freeSpace" } }] },
  ])("rejects malformed strokes", (stroke) => {
    expect(parseSceneObject({ ...common, id: "bad", type: "stroke", ...stroke })).toBeNull();
  });

  it("restores the latest confirmed position after a rejected drag", () => {
    const confirmed = parseSceneObject({
      id: "groupToken--g1", type: "groupToken", groupId: "g1", systemId: "nyx", mapId: "rockbreaker",
      sceneVersion: 1, color: "#0ea5e9", position,
      revision: 2, createdBy: "u1", createdAtMs: 1, updatedBy: "u2", updatedAtMs: 2,
    });
    const fallback = { ...position, x: 99 };

    expect(confirmedObjectPosition(confirmed ? [confirmed] : [], "groupToken--g1", fallback)).toEqual(position);
    expect(confirmedObjectPosition([], "missing", fallback)).toEqual(fallback);
  });
});
