import { describe, expect, it } from "vitest";
import { groupsForLocationMarker, locateGroup } from "@/lib/map/token-occupancy";
import type { SceneObject } from "@/lib/rockbreaker/scene-objects";

function groupSceneObject(groupId: string, revision: number): SceneObject {
  return {
    id: `groupToken--${groupId}`,
    type: "groupToken",
    groupId,
    systemId: "nyx",
    mapId: "rockbreaker",
    sceneVersion: 1,
    color: "#3b82f6",
    position: { x: -34, y: 0, z: 0, sceneVersion: 1, anchor: { kind: "beltPlane" } },
    revision,
    createdBy: "u1",
    createdAtMs: 1,
    updatedBy: "u1",
    updatedAtMs: 1,
  };
}

describe("token occupancy", () => {
  it("distinguishes unplaced, one 2D location, one 3D location and ambiguity", () => {
    expect(locateGroup("g1", [], [])).toEqual({ kind: "unplaced" });
    expect(locateGroup("g1", [{ groupId: "g1", mapId: "main", x: 0.2, y: 0.3 }], []))
      .toEqual({ kind: "map2d", mapId: "main", x: 0.2, y: 0.3 });
    expect(locateGroup("g1", [], [groupSceneObject("g1", 4)]))
      .toEqual({ kind: "rockbreaker3d", sceneId: "nyx--rockbreaker", revision: 4 });
    expect(locateGroup("g1", [{ groupId: "g1", mapId: "main", x: 0.2, y: 0.3 }], [groupSceneObject("g1", 4)]))
      .toEqual({ kind: "ambiguous" });
    expect(locateGroup("g1", [
      { groupId: "g1", mapId: "main", x: 0.2, y: 0.3 },
      { groupId: "g1", mapId: "cap", x: 0.4, y: 0.5 },
    ], [])).toEqual({ kind: "ambiguous" });
  });

  it("derives recursive 2D badges without duplicate locations", () => {
    const groups = [
      { id: "g1", label: "Fight Team", color: "0ea5e9" },
      { id: "g2", label: "Air Team" },
    ];
    const tokens = [
      { groupId: "g1", mapId: "cap", x: 0.2, y: 0.3 },
      { groupId: "g2", mapId: "poi-deep", x: 0.4, y: 0.5 },
    ];
    const pois = [
      { id: "poi-a", label: "A", image: "", parentMapId: "cap" },
      { id: "poi-deep", label: "Deep", image: "", parentMapId: "poi-a" },
    ];
    expect(groupsForLocationMarker("cap", groups, tokens, pois, [])).toEqual([
      { groupId: "g1", label: "Fight Team", color: "#0ea5e9" },
      { groupId: "g2", label: "Air Team", color: "#3b82f6" },
    ]);
  });

  it("derives the Rockbreaker badge from scene objects only", () => {
    const groups = [{ id: "g1", label: "Fight Team", color: "ef4444" }];
    expect(groupsForLocationMarker("rockbreaker", groups, [], [], [groupSceneObject("g1", 2)]))
      .toEqual([{ groupId: "g1", label: "Fight Team", color: "#ef4444" }]);
  });
});
