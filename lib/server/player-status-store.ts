import type { Role } from "@/lib/domain/roles";
import { parseBoardState } from "@/lib/board/state";
import { parseAliveState, parseSpawnState } from "@/lib/board/members";
import { parsePlayerStatus, type PlayerStatus, type PlayerStatusAction } from "@/lib/player-status/model";
import { applyPlayerStatusAction, PlayerStatusTransitionError } from "@/lib/player-status/transition";

export type PlayerStatusTransaction = {
  getBoard: (roomId: string) => Promise<Record<string, unknown> | null>;
  getStatus: (roomId: string, playerId: string) => Promise<unknown>;
  setBoardFields: (roomId: string, fields: Record<string, unknown>) => Promise<void>;
  setStatus: (roomId: string, playerId: string, status: PlayerStatus) => Promise<void>;
};

export type PlayerStatusTransactionStore = {
  runTransaction: <T>(operation: (transaction: PlayerStatusTransaction) => Promise<T>) => Promise<T>;
};

export type PlayerStatusActor = {
  playerId: string;
  role: Role;
  via: "desktop" | "mobile";
};

export type ChangePlayerStatusInput = {
  roomId: string;
  targetPlayerId: string;
  actor: PlayerStatusActor;
  action: PlayerStatusAction;
  expectedRevision?: number;
  nowMs: number;
};

export class PlayerStatusStoreError extends Error {
  constructor(
    public readonly code: "FORBIDDEN" | "BOARD_NOT_FOUND" | "REVISION_CONFLICT" | "INVALID_SPAWN" | "SYSTEM_UNASSIGNED",
    public readonly currentStatus?: PlayerStatus | null,
  ) {
    super(code);
  }
}

function assertActor(input: ChangePlayerStatusInput) {
  if (input.actor.via === "mobile" && input.actor.playerId !== input.targetPlayerId) {
    throw new PlayerStatusStoreError("FORBIDDEN");
  }
  if (input.actor.via === "desktop" && input.actor.playerId !== input.targetPlayerId
    && input.actor.role !== "commander" && input.actor.role !== "admin") {
    throw new PlayerStatusStoreError("FORBIDDEN");
  }
}

export async function changePlayerStatus(
  store: PlayerStatusTransactionStore,
  input: ChangePlayerStatusInput,
) {
  assertActor(input);
  return store.runTransaction(async (transaction) => {
    const [boardDocument, rawStatus] = await Promise.all([
      transaction.getBoard(input.roomId),
      transaction.getStatus(input.roomId, input.targetPlayerId),
    ]);
    if (!boardDocument) throw new PlayerStatusStoreError("BOARD_NOT_FOUND");

    const currentStatus = parsePlayerStatus(rawStatus);
    const currentRevision = currentStatus?.revision ?? 0;
    if (input.expectedRevision !== undefined && input.expectedRevision !== currentRevision) {
      throw new PlayerStatusStoreError("REVISION_CONFLICT", currentStatus);
    }

    const board = parseBoardState(boardDocument, []);
    try {
      const transition = applyPlayerStatusAction({
        playerId: input.targetPlayerId,
        currentStatus,
        action: input.action,
        board,
        legacyAliveState: parseAliveState(boardDocument.aliveState),
        legacySpawnState: parseSpawnState(boardDocument.spawnState),
        actorPlayerId: input.actor.playerId,
        via: input.actor.via,
        nowMs: input.nowMs,
      });
      const priorLog = Array.isArray(boardDocument.opLogEntries) ? boardDocument.opLogEntries : [];
      const opLogEntries = [...priorLog, transition.logEntry].slice(-1000);

      await transaction.setBoardFields(input.roomId, {
        columns: transition.board.columns,
        aliveState: transition.legacyAliveState,
        spawnState: transition.legacySpawnState,
        opLogEntries,
      });
      await transaction.setStatus(input.roomId, input.targetPlayerId, transition.status);
      return { status: transition.status };
    } catch (error) {
      if (error instanceof PlayerStatusTransitionError) {
        throw new PlayerStatusStoreError(error.code);
      }
      throw error;
    }
  });
}
