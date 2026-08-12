import type { BoardState } from "@/lib/board/state";
import type { BoardPlayerAliveState, BoardPlayerSpawnState } from "@/lib/board/members";
import type { PlayerStatus, PlayerStatusAction, PlayerStatusSource } from "@/lib/player-status/model";

export class PlayerStatusTransitionError extends Error {
  constructor(public readonly code: "INVALID_SPAWN" | "SYSTEM_UNASSIGNED") {
    super(code);
  }
}

export type PlayerStatusTransitionInput = {
  playerId: string;
  currentStatus: PlayerStatus | null;
  action: PlayerStatusAction;
  board: BoardState;
  legacyAliveState: BoardPlayerAliveState;
  legacySpawnState: BoardPlayerSpawnState;
  actorPlayerId: string;
  via: PlayerStatusSource;
  nowMs: number;
};

export type PlayerStatusTransitionResult = {
  status: PlayerStatus;
  board: BoardState;
  legacyAliveState: BoardPlayerAliveState;
  legacySpawnState: BoardPlayerSpawnState;
  logEntry: { ts: number; actorPlayerId: string; targetPlayerId: string; type: string };
};

export function derivePlayerSystem(
  playerId: string,
  board: BoardState,
  currentStatus: PlayerStatus | null,
  legacySpawnState: BoardPlayerSpawnState,
): string | null {
  if (currentStatus?.systemId && board.groups.some((group) => group.systemId === currentStatus.systemId)) {
    return currentStatus.systemId;
  }

  const assignedSystems = new Set(
    board.groups
      .filter((group) => group.systemId && (board.columns[group.id] ?? []).includes(playerId))
      .map((group) => group.systemId as string),
  );
  if (assignedSystems.size === 1) return [...assignedSystems][0];

  const spawnId = currentStatus?.spawnGroupId ?? legacySpawnState[playerId];
  const spawn = spawnId ? board.groups.find((group) => group.id === spawnId && group.isSpawn) : undefined;
  return spawn?.systemId ?? null;
}

function allowedSpawn(board: BoardState, spawnGroupId: string | undefined, systemId: string | null) {
  if (!spawnGroupId || !systemId) return null;
  return board.groups.find((group) => group.id === spawnGroupId && group.isSpawn === true && group.systemId === systemId) ?? null;
}

function resolveSpawn(input: PlayerStatusTransitionInput, systemId: string | null, requested?: string) {
  if (!systemId) throw new PlayerStatusTransitionError("SYSTEM_UNASSIGNED");
  const preferred = requested ?? input.currentStatus?.spawnGroupId ?? input.legacySpawnState[input.playerId];
  const direct = allowedSpawn(input.board, preferred, systemId);
  if (direct) return direct;
  const candidates = input.board.groups.filter((group) => group.isSpawn === true && group.systemId === systemId);
  if (!requested && candidates.length === 1) return candidates[0];
  throw new PlayerStatusTransitionError("INVALID_SPAWN");
}

function movePlayerTo(board: BoardState, playerId: string, groupId: string): BoardState {
  const columns = Object.fromEntries(
    Object.entries(board.columns).map(([id, players]) => [id, players.filter((candidate) => candidate !== playerId)]),
  );
  columns[groupId] = [playerId, ...(columns[groupId] ?? [])];
  return { ...board, columns };
}

export function applyPlayerStatusAction(input: PlayerStatusTransitionInput): PlayerStatusTransitionResult {
  const systemId = derivePlayerSystem(input.playerId, input.board, input.currentStatus, input.legacySpawnState);
  const currentAlive = input.currentStatus?.aliveStatus ?? input.legacyAliveState[input.playerId] ?? "alive";
  let aliveStatus = currentAlive;
  let spawnGroupId = input.currentStatus?.spawnGroupId ?? input.legacySpawnState[input.playerId];
  let board = input.board;

  if (input.action.type === "LIVE") {
    aliveStatus = "alive";
  } else if (input.action.type === "TOT") {
    const spawn = resolveSpawn(input, systemId);
    aliveStatus = "dead";
    spawnGroupId = spawn.id;
    board = movePlayerTo(input.board, input.playerId, spawn.id);
  } else if (input.action.type === "RESPAWN") {
    const spawn = resolveSpawn(input, systemId, input.action.spawnGroupId);
    aliveStatus = "alive";
    spawnGroupId = spawn.id;
    board = movePlayerTo(input.board, input.playerId, spawn.id);
  } else {
    const spawn = resolveSpawn(input, systemId, input.action.spawnGroupId);
    spawnGroupId = spawn.id;
  }

  const legacyAliveState = { ...input.legacyAliveState, [input.playerId]: aliveStatus };
  const legacySpawnState = spawnGroupId
    ? { ...input.legacySpawnState, [input.playerId]: spawnGroupId }
    : { ...input.legacySpawnState };
  const status: PlayerStatus = {
    playerId: input.playerId,
    aliveStatus,
    systemId,
    ...(spawnGroupId ? { spawnGroupId } : {}),
    revision: (input.currentStatus?.revision ?? 0) + 1,
    updatedBy: input.actorPlayerId,
    updatedVia: input.via,
    updatedAtMs: input.nowMs,
  };

  return {
    status,
    board,
    legacyAliveState,
    legacySpawnState,
    logEntry: {
      ts: input.nowMs,
      actorPlayerId: input.actorPlayerId,
      targetPlayerId: input.playerId,
      type: input.action.type.toLowerCase(),
    },
  };
}
