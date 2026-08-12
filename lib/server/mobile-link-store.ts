import { createConnectionToken, hashConnectionToken, verifyConnectionToken } from "@/lib/mobile-link/token";
import { parseRoomConfig } from "@/lib/rooms/config";

export type MobileLinkRecord = {
  tokenHash: string;
  sessionRevision: number;
  issuedAtMs: number;
  expiresAtMs: number;
  revokedAtMs?: number;
};

export type MobileLinkTransaction = {
  getRoomConfig: (roomId: string) => Promise<unknown>;
  getLink: (roomId: string, playerId: string) => Promise<unknown>;
  setLink: (roomId: string, playerId: string, value: MobileLinkRecord) => Promise<void>;
};

export type MobileLinkTransactionStore = {
  runTransaction: <T>(operation: (transaction: MobileLinkTransaction) => Promise<T>) => Promise<T>;
};

export class MobileLinkStoreError extends Error {
  constructor(public readonly code: "FEATURE_DISABLED" | "INVALID_LINK" | "LINK_EXPIRED") {
    super(code);
  }
}

export function parseMobileLinkRecord(value: unknown): MobileLinkRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.tokenHash !== "string" || !Number.isInteger(record.sessionRevision) || (record.sessionRevision as number) < 1
    || typeof record.issuedAtMs !== "number" || !Number.isFinite(record.issuedAtMs)
    || typeof record.expiresAtMs !== "number" || !Number.isFinite(record.expiresAtMs)) return null;
  return {
    tokenHash: record.tokenHash,
    sessionRevision: record.sessionRevision as number,
    issuedAtMs: record.issuedAtMs,
    expiresAtMs: record.expiresAtMs,
    ...(typeof record.revokedAtMs === "number" && Number.isFinite(record.revokedAtMs) ? { revokedAtMs: record.revokedAtMs } : {}),
  };
}

async function assertFeature(transaction: MobileLinkTransaction, roomId: string) {
  const config = parseRoomConfig(await transaction.getRoomConfig(roomId));
  if (!config?.features.mobileStatus) throw new MobileLinkStoreError("FEATURE_DISABLED");
}

export async function issueMobileLink(
  store: MobileLinkTransactionStore,
  input: { roomId: string; playerId: string; nowMs: number; ttlMs: number },
) {
  const token = createConnectionToken();
  const tokenHash = hashConnectionToken(token);
  return store.runTransaction(async (transaction) => {
    await assertFeature(transaction, input.roomId);
    const current = parseMobileLinkRecord(await transaction.getLink(input.roomId, input.playerId));
    const sessionRevision = (current?.sessionRevision ?? 0) + 1;
    const expiresAtMs = input.nowMs + input.ttlMs;
    await transaction.setLink(input.roomId, input.playerId, {
      tokenHash,
      sessionRevision,
      issuedAtMs: input.nowMs,
      expiresAtMs,
    });
    return { token, sessionRevision, expiresAtMs };
  });
}

export async function revokeMobileLink(
  store: MobileLinkTransactionStore,
  input: { roomId: string; playerId: string; nowMs: number },
) {
  return store.runTransaction(async (transaction) => {
    await assertFeature(transaction, input.roomId);
    const current = parseMobileLinkRecord(await transaction.getLink(input.roomId, input.playerId));
    const sessionRevision = (current?.sessionRevision ?? 0) + 1;
    await transaction.setLink(input.roomId, input.playerId, {
      tokenHash: "",
      sessionRevision,
      issuedAtMs: current?.issuedAtMs ?? input.nowMs,
      expiresAtMs: input.nowMs,
      revokedAtMs: input.nowMs,
    });
    return { sessionRevision };
  });
}

export async function verifyMobileLink(
  transaction: Pick<MobileLinkTransaction, "getRoomConfig" | "getLink">,
  input: { roomId: string; playerId: string; token: string; nowMs: number },
): Promise<MobileLinkRecord> {
  const config = parseRoomConfig(await transaction.getRoomConfig(input.roomId));
  if (!config?.features.mobileStatus) throw new MobileLinkStoreError("FEATURE_DISABLED");
  const link = parseMobileLinkRecord(await transaction.getLink(input.roomId, input.playerId));
  if (!link || link.revokedAtMs || !verifyConnectionToken(input.token, link.tokenHash)) throw new MobileLinkStoreError("INVALID_LINK");
  if (link.expiresAtMs <= input.nowMs) throw new MobileLinkStoreError("LINK_EXPIRED");
  return link;
}
