import { parseWorldPoint } from "@/lib/rockbreaker/scene-objects";
import type { WorldPoint } from "@/lib/rockbreaker/coordinates";

export type RockbreakerSceneConfig = {
  systemId: "nyx";
  mapId: "rockbreaker";
  renderer: "rockbreaker3d";
  sceneVersion: 1;
  troopEntry: { slots: WorldPoint[] };
};

const point = (x: number, z: number): WorldPoint => ({
  x,
  y: 0,
  z,
  sceneVersion: 1,
  anchor: { kind: "beltPlane" },
});

export const DEFAULT_ROCKBREAKER_ENTRY: RockbreakerSceneConfig["troopEntry"] = {
  slots: [
    ...Array.from({ length: 12 }, (_, index) => point(-34, -11 + index * 2)),
    ...Array.from({ length: 12 }, (_, index) => point(-31.5, -11 + index * 2)),
  ],
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function parseRockbreakerSceneConfig(value: unknown): RockbreakerSceneConfig | null {
  if (!isRecord(value) || value.systemId !== "nyx" || value.mapId !== "rockbreaker"
    || value.renderer !== "rockbreaker3d" || value.sceneVersion !== 1 || !isRecord(value.troopEntry)) return null;
  const rawSlots = value.troopEntry.slots;
  if (!Array.isArray(rawSlots) || rawSlots.length < 1 || rawSlots.length > 64) return null;
  const slots = rawSlots.map(parseWorldPoint);
  if (slots.some((slot) => slot === null || slot.anchor.kind !== "beltPlane")) return null;
  return {
    systemId: "nyx",
    mapId: "rockbreaker",
    renderer: "rockbreaker3d",
    sceneVersion: 1,
    troopEntry: { slots: slots as WorldPoint[] },
  };
}

export function selectRockbreakerEntryPoint(
  config: RockbreakerSceneConfig,
  occupied: ReadonlyArray<{ x: number; y: number; z: number }>,
): WorldPoint | null {
  return config.troopEntry.slots.find((slot) => occupied.every((position) =>
    Math.hypot(slot.x - position.x, slot.y - position.y, slot.z - position.z) > 0.75,
  )) ?? null;
}
