export const ROCKBREAKER_SCENE_ID = "nyx--rockbreaker" as const;

export type TokenLocation =
  | { kind: "unplaced" }
  | { kind: "map2d"; mapId: string; x: number; y: number }
  | { kind: "rockbreaker3d"; sceneId: typeof ROCKBREAKER_SCENE_ID; revision: number };

export type TokenTransferIntent =
  | { kind: "place2d"; mapId: string; x: number; y: number }
  | { kind: "enterChild"; childId: string }
  | { kind: "moveUp" }
  | { kind: "remove" };

export type TokenTransferCommand = {
  operationId: string;
  systemId: string;
  groupId: string;
  expectedSource: TokenLocation;
  intent: TokenTransferIntent;
};

export type TokenTransferResult = {
  operationId: string;
  groupId: string;
  systemId: string;
  location: TokenLocation;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const validOperationId = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const validCoordinate = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

export function parseTokenLocation(value: unknown): TokenLocation | null {
  if (!isRecord(value)) return null;
  if (value.kind === "unplaced") return { kind: "unplaced" };
  if (value.kind === "map2d" && validId(value.mapId) && validCoordinate(value.x) && validCoordinate(value.y)) {
    return { kind: "map2d", mapId: value.mapId, x: value.x, y: value.y };
  }
  if (value.kind === "rockbreaker3d" && value.sceneId === ROCKBREAKER_SCENE_ID
    && Number.isInteger(value.revision) && (value.revision as number) >= 0) {
    return { kind: "rockbreaker3d", sceneId: ROCKBREAKER_SCENE_ID, revision: value.revision as number };
  }
  return null;
}

function parseIntent(value: unknown): TokenTransferIntent | null {
  if (!isRecord(value)) return null;
  if (value.kind === "remove") return { kind: "remove" };
  if (value.kind === "moveUp") return { kind: "moveUp" };
  if (value.kind === "enterChild" && validId(value.childId)) return { kind: "enterChild", childId: value.childId };
  if (value.kind === "place2d" && validId(value.mapId) && validCoordinate(value.x) && validCoordinate(value.y)) {
    return { kind: "place2d", mapId: value.mapId, x: value.x, y: value.y };
  }
  return null;
}

export function parseTokenTransferCommand(value: unknown): TokenTransferCommand | null {
  if (!isRecord(value) || !validOperationId(value.operationId) || !validId(value.systemId) || !validId(value.groupId)) return null;
  const expectedSource = parseTokenLocation(value.expectedSource);
  const intent = parseIntent(value.intent);
  return expectedSource && intent ? {
    operationId: value.operationId,
    systemId: value.systemId,
    groupId: value.groupId,
    expectedSource,
    intent,
  } : null;
}
