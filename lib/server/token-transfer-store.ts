import type { Role } from "@/lib/domain/roles";
import { parseMapEntries, parsePois, parseTokens, type BoardMapEntry, type BoardPoi, type BoardToken } from "@/lib/board/collections";
import { parseBoardState } from "@/lib/board/state";
import { locateGroup, type GroupLocation } from "@/lib/map/token-occupancy";
import { resolveChildLocation, resolveParentLocation, selectEntry2dPosition, selectReturn2dPosition } from "@/lib/map/token-placement";
import {
  ROCKBREAKER_SCENE_ID,
  parseTokenLocation,
  parseTokenTransferCommand,
  type TokenLocation,
  type TokenTransferCommand,
  type TokenTransferResult,
} from "@/lib/map/token-transfer";
import { parseRockbreakerSceneConfig, selectRockbreakerEntryPoint } from "@/lib/rockbreaker/scene-config";
import { groupTokenObjectId, type SceneObject } from "@/lib/rockbreaker/scene-objects";
import { parseRoomConfig } from "@/lib/rooms/config";

export type TokenTransferActor = { uid: string; role: Role };

export type ExecuteTokenTransferInput = {
  roomId: string;
  actor: TokenTransferActor;
  command: TokenTransferCommand;
  nowMs: number;
};

export type TokenTransferReceipt = {
  operationId: string;
  command: TokenTransferCommand;
  result: TokenTransferResult;
  actorUid: string;
  completedAtMs: number;
  expiresAtMs: number;
};

export type TokenTransferSnapshot = {
  boardDocument: Record<string, unknown> | null;
  roomConfig: unknown;
  sceneMetadata: unknown;
  sceneObjects: SceneObject[];
  receipt: TokenTransferReceipt | null;
};

export type TokenTransferTransaction = {
  readSnapshot(roomId: string, operationId: string): Promise<TokenTransferSnapshot>;
  setTokensBySystem(roomId: string, value: Record<string, unknown>): Promise<void>;
  setSceneGroup(roomId: string, object: SceneObject): Promise<void>;
  deleteSceneGroup(roomId: string, objectId: string): Promise<void>;
  setReceipt(roomId: string, receipt: TokenTransferReceipt): Promise<void>;
};

export type TokenTransferTransactionStore = {
  runTransaction<T>(operation: (transaction: TokenTransferTransaction) => Promise<T>): Promise<T>;
};

export type TokenTransferStoreErrorCode =
  | "FORBIDDEN"
  | "BOARD_NOT_FOUND"
  | "FEATURE_DISABLED"
  | "INVALID_GROUP"
  | "INVALID_TARGET"
  | "SOURCE_CONFLICT"
  | "AMBIGUOUS_SOURCE"
  | "ENTRY_FULL"
  | "OPERATION_CONFLICT";

export class TokenTransferStoreError extends Error {
  constructor(
    public readonly code: TokenTransferStoreErrorCode,
    public readonly currentLocation?: TokenLocation,
  ) {
    super(code);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function parseTokenTransferReceipt(value: unknown): TokenTransferReceipt | null {
  if (!isRecord(value) || typeof value.actorUid !== "string" || !value.actorUid
    || typeof value.completedAtMs !== "number" || !Number.isFinite(value.completedAtMs)
    || typeof value.expiresAtMs !== "number" || !Number.isFinite(value.expiresAtMs)
    || value.expiresAtMs < value.completedAtMs) return null;
  const command = parseTokenTransferCommand(value.command);
  const rawResult = isRecord(value.result) ? value.result : null;
  const location = rawResult ? parseTokenLocation(rawResult.location) : null;
  if (!command || !rawResult || !location
    || rawResult.operationId !== command.operationId
    || rawResult.groupId !== command.groupId
    || rawResult.systemId !== command.systemId
    || value.operationId !== command.operationId) return null;
  return {
    operationId: command.operationId,
    command,
    result: {
      operationId: command.operationId,
      groupId: command.groupId,
      systemId: command.systemId,
      location,
    },
    actorUid: value.actorUid,
    completedAtMs: value.completedAtMs,
    expiresAtMs: value.expiresAtMs,
  };
}

function tokenState(board: Record<string, unknown>, systemId: string) {
  const stored = isRecord(board.tokensBySystem) ? { ...board.tokensBySystem } : {};
  if (!Object.hasOwn(stored, systemId) && systemId === "pyro" && Array.isArray(board.tokens)) stored.pyro = board.tokens;
  return { stored, tokens: parseTokens(stored[systemId]) };
}

function systemMaps(board: Record<string, unknown>, systemId: string): BoardMapEntry[] {
  const bySystem = isRecord(board.mapsBySystem) ? board.mapsBySystem : {};
  const raw = bySystem[systemId] ?? (systemId === "pyro" ? board.maps : undefined);
  const parsed = parseMapEntries(raw);
  const maps = parsed.some((map) => map.id === "main")
    ? parsed
    : [{ id: "main", label: systemId, image: "", renderer: "image2d" as const }, ...parsed];
  if (systemId === "nyx" && !maps.some((map) => map.id === "rockbreaker")) {
    maps.push({
      id: "rockbreaker",
      label: "Rockbreaker",
      image: "",
      renderer: "rockbreaker3d",
      sceneId: ROCKBREAKER_SCENE_ID,
      x: 0.5,
      y: 0.5,
    });
  }
  return maps;
}

function systemPois(board: Record<string, unknown>, systemId: string): BoardPoi[] {
  const bySystem = isRecord(board.poisBySystem) ? board.poisBySystem : {};
  return parsePois(bySystem[systemId] ?? (systemId === "pyro" ? board.pois : undefined));
}

function sameLocation(left: TokenLocation, right: TokenLocation): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "unplaced" && right.kind === "unplaced") return true;
  if (left.kind === "map2d" && right.kind === "map2d") {
    return left.mapId === right.mapId && left.x === right.x && left.y === right.y;
  }
  return left.kind === "rockbreaker3d" && right.kind === "rockbreaker3d"
    && left.sceneId === right.sceneId && left.revision === right.revision;
}

function matchingReceipt(receipt: TokenTransferReceipt, command: TokenTransferCommand): boolean {
  return JSON.stringify(receipt.command) === JSON.stringify(command);
}

function normalizedColor(value: string | undefined): string {
  if (!value) return "#3b82f6";
  const color = value.startsWith("#") ? value : `#${value}`;
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#3b82f6";
}

function known2dMap(mapId: string, maps: readonly BoardMapEntry[], pois: readonly BoardPoi[]) {
  return mapId === "main"
    || maps.some((map) => map.id === mapId && map.renderer === "image2d")
    || pois.some((poi) => poi.id === mapId);
}

function currentTokenLocation(location: GroupLocation): TokenLocation {
  if (location.kind === "ambiguous") throw new TokenTransferStoreError("AMBIGUOUS_SOURCE");
  return location;
}

export async function executeTokenTransfer(
  store: TokenTransferTransactionStore,
  input: ExecuteTokenTransferInput,
): Promise<TokenTransferResult> {
  if (input.actor.role !== "admin" && input.actor.role !== "commander") {
    throw new TokenTransferStoreError("FORBIDDEN");
  }

  return store.runTransaction(async (transaction) => {
    const snapshot = await transaction.readSnapshot(input.roomId, input.command.operationId);
    if (snapshot.receipt) {
      if (!matchingReceipt(snapshot.receipt, input.command)) throw new TokenTransferStoreError("OPERATION_CONFLICT");
      return snapshot.receipt.result;
    }
    if (!snapshot.boardDocument) throw new TokenTransferStoreError("BOARD_NOT_FOUND");

    const config = parseRoomConfig(snapshot.roomConfig);
    const board = parseBoardState(snapshot.boardDocument, []);
    const group = board.groups.find((candidate) => candidate.id === input.command.groupId);
    if (!group || group.isSpawn || group.systemId !== input.command.systemId) {
      throw new TokenTransferStoreError("INVALID_GROUP");
    }

    const { stored: tokensBySystem, tokens } = tokenState(snapshot.boardDocument, input.command.systemId);
    const actual = currentTokenLocation(locateGroup(input.command.groupId, tokens, snapshot.sceneObjects));
    if (!sameLocation(actual, input.command.expectedSource)) {
      throw new TokenTransferStoreError("SOURCE_CONFLICT", actual);
    }

    const maps = systemMaps(snapshot.boardDocument, input.command.systemId);
    const pois = systemPois(snapshot.boardDocument, input.command.systemId);
    const remainingTokens = tokens.filter((token) => token.groupId !== input.command.groupId);
    let nextTokens = remainingTokens;
    let nextLocation: TokenLocation = { kind: "unplaced" };
    let sceneWrite: SceneObject | null | undefined;

    switch (input.command.intent.kind) {
      case "remove":
        if (actual.kind === "rockbreaker3d") sceneWrite = null;
        break;
      case "place2d": {
        const intent = input.command.intent;
        if (!known2dMap(intent.mapId, maps, pois)
          || (actual.kind !== "unplaced" && (actual.kind !== "map2d" || actual.mapId !== intent.mapId))) {
          throw new TokenTransferStoreError("INVALID_TARGET");
        }
        const token: BoardToken = { groupId: group.id, mapId: intent.mapId, x: intent.x, y: intent.y };
        nextTokens = [...remainingTokens, token];
        nextLocation = { kind: "map2d", mapId: intent.mapId, x: intent.x, y: intent.y };
        break;
      }
      case "enterChild": {
        const child = resolveChildLocation(
          input.command.systemId,
          input.command.intent.childId,
          maps,
          pois,
          config?.features.rockbreaker3d === true,
        );
        if (!child) {
          if (input.command.intent.childId === "rockbreaker" && config?.features.rockbreaker3d !== true) {
            throw new TokenTransferStoreError("FEATURE_DISABLED");
          }
          throw new TokenTransferStoreError("INVALID_TARGET");
        }
        if (actual.kind !== "unplaced" && (actual.kind !== "map2d" || actual.mapId !== child.parentMapId)) {
          throw new TokenTransferStoreError("INVALID_TARGET");
        }
        if (child.kind === "map2d") {
          const position = selectEntry2dPosition(child.mapId, remainingTokens);
          nextTokens = [...remainingTokens, { groupId: group.id, mapId: child.mapId, ...position }];
          nextLocation = { kind: "map2d", mapId: child.mapId, ...position };
        } else {
          const sceneConfig = parseRockbreakerSceneConfig(snapshot.sceneMetadata);
          if (!sceneConfig) throw new TokenTransferStoreError("INVALID_TARGET");
          const occupied = snapshot.sceneObjects.flatMap((object) => object.type === "groupToken" ? [object.position] : []);
          const position = selectRockbreakerEntryPoint(sceneConfig, occupied);
          if (!position) throw new TokenTransferStoreError("ENTRY_FULL");
          const object: SceneObject = {
            id: groupTokenObjectId(group.id),
            type: "groupToken",
            groupId: group.id,
            systemId: "nyx",
            mapId: "rockbreaker",
            sceneVersion: 1,
            color: normalizedColor(group.color),
            position,
            revision: 0,
            createdBy: input.actor.uid,
            createdAtMs: input.nowMs,
            updatedBy: input.actor.uid,
            updatedAtMs: input.nowMs,
          };
          sceneWrite = object;
          nextLocation = { kind: "rockbreaker3d", sceneId: ROCKBREAKER_SCENE_ID, revision: 0 };
        }
        break;
      }
      case "moveUp": {
        const currentMapId = actual.kind === "rockbreaker3d" ? "rockbreaker"
          : actual.kind === "map2d" ? actual.mapId : "main";
        const parent = resolveParentLocation(currentMapId, maps, pois);
        if (!parent) throw new TokenTransferStoreError("INVALID_TARGET");
        const occupiedAtParent = remainingTokens.filter((token) => (token.mapId ?? "main") === parent.parentMapId);
        const position = selectReturn2dPosition(parent.marker, occupiedAtParent);
        nextTokens = [...remainingTokens, { groupId: group.id, mapId: parent.parentMapId, ...position }];
        nextLocation = { kind: "map2d", mapId: parent.parentMapId, ...position };
        if (actual.kind === "rockbreaker3d") sceneWrite = null;
        break;
      }
    }

    if (JSON.stringify(nextTokens) !== JSON.stringify(tokens)) {
      tokensBySystem[input.command.systemId] = nextTokens;
      await transaction.setTokensBySystem(input.roomId, tokensBySystem);
    }
    if (sceneWrite === null) await transaction.deleteSceneGroup(input.roomId, groupTokenObjectId(group.id));
    else if (sceneWrite) await transaction.setSceneGroup(input.roomId, sceneWrite);

    const result: TokenTransferResult = {
      operationId: input.command.operationId,
      groupId: group.id,
      systemId: input.command.systemId,
      location: nextLocation,
    };
    await transaction.setReceipt(input.roomId, {
      operationId: input.command.operationId,
      command: input.command,
      result,
      actorUid: input.actor.uid,
      completedAtMs: input.nowMs,
      expiresAtMs: input.nowMs + 7 * 24 * 60 * 60 * 1000,
    });
    return result;
  });
}
