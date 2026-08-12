import type { BoardToken, BoardPoi } from "@/lib/board/collections";
import type { BoardGroup } from "@/lib/board/state";
import { ROCKBREAKER_SCENE_ID, type TokenLocation } from "@/lib/map/token-transfer";
import type { SceneObject } from "@/lib/rockbreaker/scene-objects";

export type GroupLocation = TokenLocation | { kind: "ambiguous" };
export type GroupLocationBadge = { groupId: string; color: string; label: string };

export function locateGroup(
  groupId: string,
  systemTokens: readonly BoardToken[],
  sceneObjects: readonly SceneObject[],
): GroupLocation {
  const mapTokens = systemTokens.filter((token) => token.groupId === groupId);
  const sceneTokens = sceneObjects.filter((object) => object.type === "groupToken" && object.groupId === groupId);
  if (mapTokens.length + sceneTokens.length === 0) return { kind: "unplaced" };
  if (mapTokens.length + sceneTokens.length !== 1) return { kind: "ambiguous" };
  if (mapTokens.length === 1) {
    const token = mapTokens[0];
    return { kind: "map2d", mapId: token.mapId ?? "main", x: token.x, y: token.y };
  }
  return { kind: "rockbreaker3d", sceneId: ROCKBREAKER_SCENE_ID, revision: sceneTokens[0].revision };
}

export function buildGroupLocations(
  groupIds: readonly string[],
  systemTokens: readonly BoardToken[],
  sceneObjects: readonly SceneObject[],
): Record<string, GroupLocation> {
  return Object.fromEntries(groupIds.map((groupId) => [groupId, locateGroup(groupId, systemTokens, sceneObjects)]));
}

function descendantIds(markerId: string, pois: readonly BoardPoi[]): Set<string> {
  const result = new Set<string>([markerId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const poi of pois) {
      if (result.has(poi.parentMapId) && !result.has(poi.id)) {
        result.add(poi.id);
        changed = true;
      }
    }
  }
  return result;
}

function badgeColor(group: BoardGroup): string {
  if (!group.color) return "#3b82f6";
  return group.color.startsWith("#") ? group.color : `#${group.color}`;
}

export function groupsForLocationMarker(
  markerId: string,
  groups: readonly BoardGroup[],
  systemTokens: readonly BoardToken[],
  pois: readonly BoardPoi[],
  sceneObjects: readonly SceneObject[],
): GroupLocationBadge[] {
  const activeGroupIds = new Set<string>();
  if (markerId === "rockbreaker") {
    for (const object of sceneObjects) if (object.type === "groupToken") activeGroupIds.add(object.groupId);
  } else {
    const locationIds = descendantIds(markerId, pois);
    for (const token of systemTokens) {
      if (locationIds.has(token.mapId ?? "main")) activeGroupIds.add(token.groupId);
    }
  }
  return groups.flatMap((group) => activeGroupIds.has(group.id)
    ? [{ groupId: group.id, label: group.label, color: badgeColor(group) }]
    : []);
}
