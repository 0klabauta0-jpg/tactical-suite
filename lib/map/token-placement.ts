import type { BoardMapEntry, BoardPoi, BoardToken } from "@/lib/board/collections";
import { ROCKBREAKER_SCENE_ID } from "@/lib/map/token-transfer";

export type ResolvedChildLocation =
  | { kind: "map2d"; mapId: string; parentMapId: string }
  | { kind: "rockbreaker3d"; sceneId: typeof ROCKBREAKER_SCENE_ID; parentMapId: "main" };

export type ResolvedParentLocation = {
  parentMapId: string;
  marker: { x: number; y: number };
};

const coordinate = (value: number | undefined) => typeof value === "number" && Number.isFinite(value) ? value : 0.5;

export function resolveChildLocation(
  systemId: string,
  childId: string,
  maps: readonly BoardMapEntry[],
  pois: readonly BoardPoi[],
  rockbreakerEnabled: boolean,
): ResolvedChildLocation | null {
  if (childId === "main") return null;
  if (childId === "rockbreaker") {
    return systemId === "nyx" && rockbreakerEnabled
      ? { kind: "rockbreaker3d", sceneId: ROCKBREAKER_SCENE_ID, parentMapId: "main" }
      : null;
  }
  const poi = pois.find((candidate) => candidate.id === childId);
  if (poi) return { kind: "map2d", mapId: poi.id, parentMapId: poi.parentMapId };
  const map = maps.find((candidate) => candidate.id === childId && candidate.id !== "main" && candidate.renderer === "image2d");
  return map ? { kind: "map2d", mapId: map.id, parentMapId: "main" } : null;
}

export function resolveParentLocation(
  currentMapId: string,
  maps: readonly BoardMapEntry[],
  pois: readonly BoardPoi[],
): ResolvedParentLocation | null {
  if (currentMapId === "main") return null;
  const poi = pois.find((candidate) => candidate.id === currentMapId);
  if (poi) return {
    parentMapId: poi.parentMapId,
    marker: { x: coordinate(poi.x), y: coordinate(poi.y) },
  };
  const map = maps.find((candidate) => candidate.id === currentMapId);
  return map ? {
    parentMapId: "main",
    marker: { x: coordinate(map.x), y: coordinate(map.y) },
  } : null;
}

const distance = (left: { x: number; y: number }, right: { x: number; y: number }) =>
  Math.hypot(left.x - right.x, left.y - right.y);
const clamp = (value: number) => Math.max(0.02, Math.min(0.98, value));

function entryCandidates() {
  const result: Array<{ x: number; y: number }> = [];
  for (let column = 0; column < 8; column += 1) {
    for (let row = 0; row < 11; row += 1) {
      result.push({ x: Number((0.08 + column * 0.06).toFixed(2)), y: Number((0.16 + row * 0.08).toFixed(2)) });
    }
  }
  return result;
}

export function selectEntry2dPosition(mapId: string, tokens: readonly BoardToken[]) {
  const occupied = tokens.filter((token) => (token.mapId ?? "main") === mapId);
  const candidates = entryCandidates();
  return candidates.find((candidate) => occupied.every((token) => distance(candidate, token) >= 0.025))
    ?? candidates.reduce((best, candidate) => {
      const clearance = Math.min(...occupied.map((token) => distance(candidate, token)));
      const bestClearance = Math.min(...occupied.map((token) => distance(best, token)));
      return clearance > bestClearance ? candidate : best;
    }, candidates[0]);
}

const RETURN_OFFSETS = [
  { x: 0.04, y: 0 }, { x: -0.04, y: 0 }, { x: 0, y: 0.05 }, { x: 0, y: -0.05 },
  { x: 0.04, y: 0.05 }, { x: -0.04, y: 0.05 }, { x: 0.04, y: -0.05 }, { x: -0.04, y: -0.05 },
] as const;

export function selectReturn2dPosition(marker: { x: number; y: number }, occupied: readonly BoardToken[]) {
  const candidates = RETURN_OFFSETS.map((offset) => ({
    x: clamp(marker.x + offset.x),
    y: clamp(marker.y + offset.y),
  }));
  return candidates.find((candidate) => occupied.every((token) => distance(candidate, token) >= 0.025)) ?? candidates[0];
}
