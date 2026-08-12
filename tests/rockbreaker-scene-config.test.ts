import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROCKBREAKER_ENTRY,
  parseRockbreakerSceneConfig,
  selectRockbreakerEntryPoint,
} from "@/lib/rockbreaker/scene-config";

describe("Rockbreaker scene configuration", () => {
  it("provides 24 fixed shared slots at the scene edge", () => {
    expect(DEFAULT_ROCKBREAKER_ENTRY.slots).toHaveLength(24);
    expect(DEFAULT_ROCKBREAKER_ENTRY.slots[0]).toEqual({
      x: -34,
      y: 0,
      z: -11,
      sceneVersion: 1,
      anchor: { kind: "beltPlane" },
    });
  });

  it("parses belt-plane slots and chooses the first free one", () => {
    const config = parseRockbreakerSceneConfig({
      systemId: "nyx",
      mapId: "rockbreaker",
      renderer: "rockbreaker3d",
      sceneVersion: 1,
      troopEntry: {
        slots: [
          { x: -34, y: 0, z: -3, sceneVersion: 1, anchor: { kind: "beltPlane" } },
          { x: -34, y: 0, z: -1, sceneVersion: 1, anchor: { kind: "beltPlane" } },
        ],
      },
    });
    expect(config).not.toBeNull();
    expect(selectRockbreakerEntryPoint(config!, [{ x: -34, y: 0, z: -3 }])).toMatchObject({ x: -34, z: -1 });
  });

  it("rejects invalid metadata and reports a full entry area", () => {
    expect(parseRockbreakerSceneConfig({ systemId: "nyx", troopEntry: { slots: [] } })).toBeNull();
    const config = parseRockbreakerSceneConfig({
      systemId: "nyx",
      mapId: "rockbreaker",
      renderer: "rockbreaker3d",
      sceneVersion: 1,
      troopEntry: { slots: [{ x: -34, y: 0, z: 0, sceneVersion: 1, anchor: { kind: "beltPlane" } }] },
    });
    expect(selectRockbreakerEntryPoint(config!, [{ x: -34, y: 0, z: 0.1 }])).toBeNull();
  });
});
