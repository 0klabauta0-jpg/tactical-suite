import { createHash, timingSafeEqual } from "node:crypto";
import type { Player } from "@/lib/domain/player";
import type { Role } from "@/lib/domain/roles";
import type { RoomConfig } from "@/lib/rooms/config";
import type { RoomPasswordHash } from "@/lib/server/password-hash";
import { verifyRoomPassword } from "@/lib/server/password-hash";
import type { ProtectedRoleOverride } from "@/lib/server/protected-roles";
import { resolveProtectedRole } from "@/lib/server/protected-roles";

export type RoomMember = {
  uid: string;
  playerId: string;
  name: string;
  role: Role;
  authVersion: 1;
  verifiedAtMs: number;
};

export type RoomLoginClaims = { authVersion: 1; roomId: string; playerId: string };

export type RoomLoginDependencies = {
  getConfig: (roomId: string) => Promise<RoomConfig | null>;
  getSecret: (roomId: string) => Promise<RoomPasswordHash | null>;
  getLegacyPassword: (roomId: string) => Promise<string | null>;
  loadPlayers: (config: RoomConfig) => Promise<Player[]>;
  getProtectedRole: (roomId: string, playerId: string) => Promise<ProtectedRoleOverride | null>;
  saveRoleTracking: (roomId: string, playerId: string, role: Role) => Promise<void>;
  createCustomToken: (uid: string, claims: RoomLoginClaims) => Promise<string>;
  writeMember: (member: RoomMember) => Promise<void>;
};

export class RoomLoginError extends Error {
  constructor(public readonly code: "INVALID_LOGIN" | "ROOM_NOT_FOUND" | "PLAYER_SOURCE_UNAVAILABLE") {
    super(code);
  }
}

export function roomPlayerUid(roomId: string, playerId: string): string {
  return `kc_${createHash("sha256").update(`${roomId}\u0000${playerId}`).digest("hex").slice(0, 28)}`;
}

function legacyPasswordMatches(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(actual, "utf8");
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

export async function authenticateRoomPlayer(
  dependencies: RoomLoginDependencies,
  input: { roomId: string; handle: string; password: string; nowMs: number },
) {
  const config = await dependencies.getConfig(input.roomId);
  if (!config) throw new RoomLoginError("ROOM_NOT_FOUND");

  const secret = await dependencies.getSecret(input.roomId);
  const legacyPassword = secret ? null : await dependencies.getLegacyPassword(input.roomId);
  const passwordValid = secret
    ? await verifyRoomPassword(input.password, secret)
    : legacyPassword !== null && legacyPasswordMatches(legacyPassword, input.password);
  if (!passwordValid) throw new RoomLoginError("INVALID_LOGIN");

  let players: Player[];
  try {
    players = await dependencies.loadPlayers(config);
  } catch {
    throw new RoomLoginError("PLAYER_SOURCE_UNAVAILABLE");
  }
  const normalizedHandle = input.handle.trim().toLocaleLowerCase("de-DE");
  const matches = players.filter((player) => player.name.trim().toLocaleLowerCase("de-DE") === normalizedHandle);
  if (matches.length !== 1) throw new RoomLoginError("INVALID_LOGIN");

  const player = matches[0];
  const roleOverride = await dependencies.getProtectedRole(input.roomId, player.id);
  const resolved = resolveProtectedRole(player.appRole, roleOverride);
  if (roleOverride?.lastSheetRole !== resolved.trackingRole) {
    await dependencies.saveRoleTracking(input.roomId, player.id, resolved.trackingRole);
  }

  const uid = roomPlayerUid(input.roomId, player.id);
  const member: RoomMember = {
    uid,
    playerId: player.id,
    name: player.name,
    role: resolved.role,
    authVersion: 1,
    verifiedAtMs: input.nowMs,
  };
  await dependencies.writeMember(member);
  const customToken = await dependencies.createCustomToken(uid, {
    authVersion: 1,
    roomId: input.roomId,
    playerId: player.id,
  });

  return {
    customToken,
    player: {
      id: player.id,
      name: player.name,
      role: resolved.role,
      profile: {
        area: player.area ?? "",
        role: player.role ?? "",
        squadron: player.squadron ?? "",
        status: player.status ?? "",
        ampel: player.ampel ?? "",
        homeLocation: player.homeLocation ?? "",
        ...(player.icon ? { icon: player.icon } : {}),
      },
    },
    room: { name: config.roomName ?? input.roomId, features: config.features },
    legacyAuth: secret === null,
  };
}
