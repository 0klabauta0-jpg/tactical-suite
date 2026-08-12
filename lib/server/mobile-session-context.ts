import "server-only";
import { parseBoardState } from "@/lib/board/state";
import { parseAliveState, parseSpawnState } from "@/lib/board/members";
import { MOBILE_SESSION_COOKIE, verifyMobileSession } from "@/lib/mobile-link/session";
import { parsePlayerStatus, type PlayerStatus } from "@/lib/player-status/model";
import { derivePlayerSystem } from "@/lib/player-status/transition";
import { parseRoomConfig } from "@/lib/rooms/config";
import { getMobileSessionSecret } from "@/lib/server/env";
import { getAdminFirestore } from "@/lib/server/firebase-admin";
import { parseMobileLinkRecord } from "@/lib/server/mobile-link-store";

export type MobileStatusContext = {
  roomId: string;
  roomName: string;
  playerId: string;
  playerName: string;
  sessionRevision: number;
  status: PlayerStatus;
  spawns: Array<{ id: string; label: string }>;
  systemUnassigned: boolean;
};

export class MobileSessionContextError extends Error {
  constructor() { super("INVALID_MOBILE_SESSION"); }
}

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export async function getMobileSessionContext(request: Request, nowMs = Date.now()): Promise<MobileStatusContext> {
  const cookie = cookieValue(request, MOBILE_SESSION_COOKIE);
  const session = cookie ? verifyMobileSession(cookie, getMobileSessionSecret(), nowMs) : null;
  if (!session) throw new MobileSessionContextError();

  const firestore = getAdminFirestore();
  const [configSnapshot, linkSnapshot, statusSnapshot, boardSnapshot, memberSnapshot] = await Promise.all([
    firestore.doc(`rooms/${session.roomId}/config/main`).get(),
    firestore.doc(`rooms/${session.roomId}/mobileLinks/${session.playerId}`).get(),
    firestore.doc(`rooms/${session.roomId}/playerStatus/${session.playerId}`).get(),
    firestore.doc(`rooms/${session.roomId}/state/board`).get(),
    firestore.collection(`rooms/${session.roomId}/members`).where("playerId", "==", session.playerId).limit(1).get(),
  ]);
  const config = configSnapshot.exists ? parseRoomConfig(configSnapshot.data()) : null;
  const link = linkSnapshot.exists ? parseMobileLinkRecord(linkSnapshot.data()) : null;
  if (!config?.features.mobileStatus || !link || link.revokedAtMs || link.expiresAtMs <= nowMs
    || link.sessionRevision !== session.sessionRevision || !boardSnapshot.exists || memberSnapshot.empty) {
    throw new MobileSessionContextError();
  }

  const boardDocument = boardSnapshot.data() ?? {};
  const board = parseBoardState(boardDocument, []);
  const legacyAlive = parseAliveState(boardDocument.aliveState);
  const legacySpawn = parseSpawnState(boardDocument.spawnState);
  const canonical = statusSnapshot.exists ? parsePlayerStatus(statusSnapshot.data()) : null;
  const systemId = derivePlayerSystem(session.playerId, board, canonical, legacySpawn);
  const status: PlayerStatus = canonical
    ? { ...canonical, systemId }
    : {
        playerId: session.playerId,
        aliveStatus: legacyAlive[session.playerId] ?? "alive",
        systemId,
        ...(legacySpawn[session.playerId] ? { spawnGroupId: legacySpawn[session.playerId] } : {}),
        revision: 0,
        updatedBy: session.playerId,
        updatedVia: "migration",
        updatedAtMs: 0,
      };
  const memberData = memberSnapshot.docs[0].data();
  if (typeof memberData.name !== "string" || !memberData.name.trim()) throw new MobileSessionContextError();

  return {
    roomId: session.roomId,
    roomName: config.roomName ?? session.roomId,
    playerId: session.playerId,
    playerName: memberData.name,
    sessionRevision: session.sessionRevision,
    status,
    spawns: systemId
      ? board.groups.filter((group) => group.isSpawn === true && group.systemId === systemId).map((group) => ({ id: group.id, label: group.label }))
      : [],
    systemUnassigned: !systemId,
  };
}
