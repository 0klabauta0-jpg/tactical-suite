import type { RoomPasswordHash } from "@/lib/server/password-hash";

export function parseRoomAuthSecret(value: unknown): RoomPasswordHash | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1
    || typeof record.passwordHash !== "string"
    || typeof record.salt !== "string"
    || record.keyLength !== 64
    || typeof record.cost !== "number"
    || typeof record.blockSize !== "number"
    || typeof record.parallelization !== "number") return null;
  return {
    version: 1,
    passwordHash: record.passwordHash,
    salt: record.salt,
    keyLength: 64,
    cost: record.cost,
    blockSize: record.blockSize,
    parallelization: record.parallelization,
  };
}
