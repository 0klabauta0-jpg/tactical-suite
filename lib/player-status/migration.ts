import { parseBoardState } from "@/lib/board/state";
import { parsePlayerStatus, type PlayerStatus } from "@/lib/player-status/model";
import { derivePlayerSystem } from "@/lib/player-status/transition";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function planPlayerStatusMigration(
  boardDocument: unknown,
  existingDocuments: ReadonlyMap<string, unknown>,
  nowMs: number,
) {
  const raw = isRecord(boardDocument) ? boardDocument : {};
  const board = parseBoardState(raw, []);
  const alive = isRecord(raw.aliveState) ? raw.aliveState : {};
  const spawn = isRecord(raw.spawnState) ? raw.spawnState : {};
  const playerIds = new Set<string>([
    ...Object.values(board.columns).flat(),
    ...Object.keys(alive),
    ...Object.keys(spawn),
  ]);
  const writes: Array<{ playerId: string; status: PlayerStatus }> = [];
  const warnings: string[] = [];

  for (const playerId of playerIds) {
    if (parsePlayerStatus(existingDocuments.get(playerId))) continue;
    const rawAlive = alive[playerId];
    const aliveStatus = rawAlive === "dead" || rawAlive === "alive" ? rawAlive : "alive";
    if (rawAlive !== undefined && rawAlive !== "dead" && rawAlive !== "alive") warnings.push(`${playerId}: invalid alive status`);
    const rawSpawn = typeof spawn[playerId] === "string" ? spawn[playerId] : undefined;
    const validSpawn = rawSpawn ? board.groups.find((group) => group.id === rawSpawn && group.isSpawn === true) : undefined;
    if (rawSpawn && !validSpawn) warnings.push(`${playerId}: invalid spawn group`);
    const legacySpawn = validSpawn ? { [playerId]: validSpawn.id } : {};
    const systemId = derivePlayerSystem(playerId, board, null, legacySpawn);
    writes.push({
      playerId,
      status: {
        playerId,
        aliveStatus,
        systemId,
        ...(validSpawn ? { spawnGroupId: validSpawn.id } : {}),
        revision: 0,
        updatedBy: "migration",
        updatedVia: "migration",
        updatedAtMs: nowMs,
      },
    });
  }
  return { writes, warnings };
}
