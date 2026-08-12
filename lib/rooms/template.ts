import { parseMapEntries, parsePois } from "@/lib/board/collections";
import { parseBoardState, type BoardGroup } from "@/lib/board/state";

type StarSystem = { id: string; label: string; x: number; y: number };
type RoomTemplateCopy = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSystems(value: unknown): StarSystem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!isRecord(candidate)
      || typeof candidate.id !== "string"
      || typeof candidate.label !== "string"
      || typeof candidate.x !== "number"
      || typeof candidate.y !== "number") return [];
    return [{ id: candidate.id, label: candidate.label, x: candidate.x, y: candidate.y }];
  });
}

function parseSystemCollections<T>(
  value: unknown,
  parseCollection: (collection: unknown) => T[],
): Record<string, T[]> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([systemId, collection]) => [systemId, parseCollection(collection)]),
  );
}

export function buildRoomTemplateCopy(value: unknown): RoomTemplateCopy {
  if (!isRecord(value)) return {};
  const copy: RoomTemplateCopy = {};

  const board = parseBoardState(value, [] as BoardGroup[]);
  if (board.groups.length > 0) {
    copy.groups = board.groups;
    copy.columns = board.columns;
  }

  const systems = parseSystems(value.systems);
  if (systems.length > 0) copy.systems = systems;

  if (Array.isArray(value.maps)) {
    const maps = parseMapEntries(value.maps);
    if (maps.length > 0) copy.maps = maps;
  }
  if (Array.isArray(value.pois)) {
    const pois = parsePois(value.pois);
    if (pois.length > 0) copy.pois = pois;
  }

  if (isRecord(value.mapsBySystem)) copy.mapsBySystem = parseSystemCollections(value.mapsBySystem, parseMapEntries);
  if (isRecord(value.poisBySystem)) copy.poisBySystem = parseSystemCollections(value.poisBySystem, parsePois);

  return copy;
}
