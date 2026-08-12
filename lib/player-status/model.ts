export type AliveStatus = "alive" | "dead";
export type PlayerStatusSource = "desktop" | "mobile" | "migration";

export type PlayerStatus = {
  playerId: string;
  aliveStatus: AliveStatus;
  systemId: string | null;
  spawnGroupId?: string;
  revision: number;
  updatedBy: string;
  updatedVia: PlayerStatusSource;
  updatedAtMs: number;
};

export type PlayerStatusAction =
  | { type: "LIVE" }
  | { type: "TOT" }
  | { type: "RESPAWN"; spawnGroupId: string }
  | { type: "SET_SPAWN"; spawnGroupId: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePlayerStatus(value: unknown): PlayerStatus | null {
  if (!isRecord(value)) return null;
  if (typeof value.playerId !== "string" || !value.playerId.trim()) return null;
  if (value.aliveStatus !== "alive" && value.aliveStatus !== "dead") return null;
  if (value.systemId !== null && (typeof value.systemId !== "string" || !value.systemId.trim())) return null;
  if (value.spawnGroupId !== undefined && (typeof value.spawnGroupId !== "string" || !value.spawnGroupId.trim())) return null;
  if (!Number.isInteger(value.revision) || (value.revision as number) < 0) return null;
  if (typeof value.updatedBy !== "string" || !value.updatedBy.trim()) return null;
  if (value.updatedVia !== "desktop" && value.updatedVia !== "mobile" && value.updatedVia !== "migration") return null;
  if (typeof value.updatedAtMs !== "number" || !Number.isFinite(value.updatedAtMs) || value.updatedAtMs < 0) return null;
  return {
    playerId: value.playerId,
    aliveStatus: value.aliveStatus,
    systemId: value.systemId,
    ...(typeof value.spawnGroupId === "string" ? { spawnGroupId: value.spawnGroupId } : {}),
    revision: value.revision as number,
    updatedBy: value.updatedBy,
    updatedVia: value.updatedVia,
    updatedAtMs: value.updatedAtMs,
  };
}

export function parsePlayerStatusAction(value: unknown): PlayerStatusAction | null {
  if (!isRecord(value)) return null;
  if (value.type === "LIVE" || value.type === "TOT") return { type: value.type };
  if ((value.type === "RESPAWN" || value.type === "SET_SPAWN")
    && typeof value.spawnGroupId === "string" && value.spawnGroupId.trim()) {
    return { type: value.type, spawnGroupId: value.spawnGroupId };
  }
  return null;
}
