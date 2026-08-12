import { DEFAULT_ROCKBREAKER_ENTRY, type RockbreakerSceneConfig } from "@/lib/rockbreaker/scene-config";

export function buildRockbreakerEntryUpdate(currentMetadata: unknown): RockbreakerSceneConfig {
  void currentMetadata;
  return {
    systemId: "nyx",
    mapId: "rockbreaker",
    renderer: "rockbreaker3d",
    sceneVersion: 1,
    troopEntry: {
      slots: DEFAULT_ROCKBREAKER_ENTRY.slots.map((slot) => ({
        ...slot,
        anchor: slot.anchor.kind === "beltPlane"
          ? { kind: "beltPlane" as const }
          : { ...slot.anchor, local: [...slot.anchor.local] },
      })),
    },
  };
}
