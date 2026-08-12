export type BoardToken = { groupId: string; x: number; y: number; mapId?: string };
export type BoardOrderMarker = { groupId: string; x: number; y: number; mapId: string };
export type BoardMapEntry = { id: string; label: string; image: string; x?: number; y?: number };
export type BoardPoi = { id: string; label: string; image: string; parentMapId: string; x?: number; y?: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasCoordinates(value: Record<string, unknown>): value is Record<string, unknown> & { x: number; y: number } {
  return typeof value.x === "number" && Number.isFinite(value.x)
    && typeof value.y === "number" && Number.isFinite(value.y);
}

function parseMapId(value: unknown): string {
  return typeof value === "string" && value ? value : "main";
}

function parseOptionalCoordinates(value: Record<string, unknown>): Pick<BoardMapEntry, "x" | "y"> {
  return hasCoordinates(value) ? { x: value.x, y: value.y } : {};
}

export function parseTokens(value: unknown): BoardToken[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!isRecord(candidate) || typeof candidate.groupId !== "string" || !hasCoordinates(candidate)) return [];
    return [{ groupId: candidate.groupId, x: candidate.x, y: candidate.y, mapId: parseMapId(candidate.mapId) }];
  });
}

export function parseOrderMarkers(value: unknown): BoardOrderMarker[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!isRecord(candidate) || typeof candidate.groupId !== "string" || !hasCoordinates(candidate)) return [];
    return [{ groupId: candidate.groupId, x: candidate.x, y: candidate.y, mapId: parseMapId(candidate.mapId) }];
  });
}

export function parseMapEntries(value: unknown): BoardMapEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || typeof candidate.label !== "string" || typeof candidate.image !== "string") return [];
    return [{ id: candidate.id, label: candidate.label, image: candidate.image, ...parseOptionalCoordinates(candidate) }];
  });
}

export function parsePois(value: unknown): BoardPoi[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || typeof candidate.label !== "string" || typeof candidate.image !== "string" || typeof candidate.parentMapId !== "string") return [];
    return [{ id: candidate.id, label: candidate.label, image: candidate.image, parentMapId: candidate.parentMapId, ...parseOptionalCoordinates(candidate) }];
  });
}
