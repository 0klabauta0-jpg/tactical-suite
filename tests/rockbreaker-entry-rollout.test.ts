import { describe, expect, it } from "vitest";
import { buildRockbreakerEntryUpdate } from "@/lib/release/rockbreaker-entry-rollout";
import { DEFAULT_ROCKBREAKER_ENTRY, parseRockbreakerSceneConfig } from "@/lib/rockbreaker/scene-config";

describe("Rockbreaker entry rollout", () => {
  it("builds only the canonical fixed shared entry metadata", () => {
    const update = buildRockbreakerEntryUpdate({ renderer: "legacy", secret: "must-not-copy", updatedBy: "old" });
    expect(update).toEqual({
      systemId: "nyx",
      mapId: "rockbreaker",
      renderer: "rockbreaker3d",
      sceneVersion: 1,
      troopEntry: DEFAULT_ROCKBREAKER_ENTRY,
    });
    expect(Object.keys(update).sort()).toEqual(["mapId", "renderer", "sceneVersion", "systemId", "troopEntry"]);
    expect(parseRockbreakerSceneConfig(update)).not.toBeNull();
  });

  it("does not expose the default slots to mutation", () => {
    const update = buildRockbreakerEntryUpdate(null);
    update.troopEntry.slots[0].x = 99;
    expect(DEFAULT_ROCKBREAKER_ENTRY.slots[0].x).toBe(-34);
  });
});
