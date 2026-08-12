import { describe, expect, it } from "vitest";
import { auditTokenLocations } from "@/lib/release/token-location-audit";
import { DEFAULT_ROCKBREAKER_ENTRY } from "@/lib/rockbreaker/scene-config";

const boardPath = "rooms/Pyro_Template/state/board";
const scenePath = "rooms/Pyro_Template/mapScenes/nyx--rockbreaker";
const validMetadata = {
  systemId: "nyx",
  mapId: "rockbreaker",
  renderer: "rockbreaker3d",
  sceneVersion: 1,
  troopEntry: DEFAULT_ROCKBREAKER_ENTRY,
};
const common = {
  systemId: "nyx",
  mapId: "rockbreaker",
  sceneVersion: 1,
  color: "#3b82f6",
  revision: 2,
  createdBy: "u1",
  createdAtMs: 1,
  updatedBy: "u1",
  updatedAtMs: 2,
};

describe("token location audit", () => {
  it("accepts unplaced groups and exactly one valid 2D or 3D location", () => {
    expect(auditTokenLocations({
      roomId: "Pyro_Template",
      boardDocument: {
        groups: [
          { id: "unplaced", label: "Unplaced", systemId: "nyx" },
          { id: "map-group", label: "Map", systemId: "nyx" },
          { id: "scene-group", label: "Scene", systemId: "nyx" },
        ],
        columns: {},
        tokensBySystem: { nyx: [{ groupId: "map-group", mapId: "main", x: 0.2, y: 0.4 }] },
      },
      sceneMetadata: validMetadata,
      sceneDocuments: [{
        path: `${scenePath}/objects/groupToken--scene-group`,
        data: { id: "groupToken--scene-group", type: "groupToken", groupId: "scene-group", position: DEFAULT_ROCKBREAKER_ENTRY.slots[0], ...common },
      }],
    })).toEqual([]);
  });

  it("reports every blocking location issue with paths without mutating input", () => {
    const input = {
      roomId: "Pyro_Template",
      boardDocument: {
        groups: [{ id: "g1", label: "Fight Team", systemId: "nyx" }],
        columns: {},
        tokensBySystem: { nyx: [
          { groupId: "g1", mapId: "main", x: 0.2, y: 0.4 },
          { groupId: "g1", mapId: "cap", x: 0.3, y: 0.5 },
          { groupId: "ghost", mapId: "main", x: 0.1, y: 0.1 },
          { groupId: "g1", mapId: "main", x: 4, y: Number.NaN },
        ] },
      },
      sceneMetadata: { ...validMetadata, troopEntry: { slots: [] } },
      sceneDocuments: [
        {
          path: `${scenePath}/objects/groupToken--g1`,
          data: { id: "groupToken--g1", type: "groupToken", groupId: "g1", position: DEFAULT_ROCKBREAKER_ENTRY.slots[0], ...common },
        },
        { path: `${scenePath}/objects/broken`, data: { type: "enemyMarker", kind: "air" } },
      ],
    };
    const before = structuredClone(input);
    const issues = auditTokenLocations(input);

    expect(new Set(issues.map((issue) => issue.code))).toEqual(new Set([
      "INVALID_TOKEN",
      "UNKNOWN_GROUP",
      "DUPLICATE_2D_LOCATION",
      "CROSS_RENDERER_DUPLICATE",
      "INVALID_SCENE_OBJECT",
      "ENTRY_CONFIG_INVALID",
    ]));
    expect(issues).toContainEqual(expect.objectContaining({
      code: "DUPLICATE_2D_LOCATION",
      documentPath: boardPath,
      groupId: "g1",
    }));
    expect(issues).toContainEqual(expect.objectContaining({
      code: "INVALID_SCENE_OBJECT",
      documentPath: `${scenePath}/objects/broken`,
    }));
    expect(input).toEqual(before);
  });

  it("distinguishes missing entry configuration from invalid metadata", () => {
    expect(auditTokenLocations({
      roomId: "Pyro_Template",
      boardDocument: { groups: [], columns: {}, tokensBySystem: {} },
      sceneMetadata: { systemId: "nyx", mapId: "rockbreaker" },
      sceneDocuments: [],
    })).toContainEqual(expect.objectContaining({
      code: "ENTRY_CONFIG_MISSING",
      documentPath: scenePath,
    }));
  });
});
