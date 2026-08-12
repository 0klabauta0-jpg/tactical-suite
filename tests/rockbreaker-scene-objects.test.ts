import { describe, expect, it } from "vitest";
import { groupTokenObjectId, orderMarkerObjectId, parseSceneObject } from "@/lib/rockbreaker/scene-objects";

const position = { x: 1, y: 2, z: 3, sceneVersion: 1, anchor: { kind: "beltPlane" } };
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
});
