import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { parseRole, type Role } from "@/lib/domain/roles";
import { loadPlayersFromSheet } from "@/lib/players/sheet-loader";
import { parseRoomConfig } from "@/lib/rooms/config";
import { getAdminAuth, getAdminFirestore } from "@/lib/server/firebase-admin";
import { requireRoomMemberWith, type RoomAuthDependencies } from "@/lib/server/room-auth";
import type { RoomMember } from "@/lib/server/room-login";
import { parseProtectedRoleOverride, resolveProtectedRole } from "@/lib/server/protected-roles";

function parseMember(uid: string, value: unknown): RoomMember | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const verifiedAt = record.verifiedAt;
  if (typeof record.playerId !== "string" || typeof record.name !== "string" || record.authVersion !== 1) return null;
  return {
    uid,
    playerId: record.playerId,
    name: record.name,
    role: parseRole(record.role),
    authVersion: 1,
    verifiedAtMs: verifiedAt instanceof Timestamp ? verifiedAt.toMillis() : 0,
  };
}

function dependencies(): RoomAuthDependencies {
  const firestore = getAdminFirestore();
  return {
    verifyIdToken: async (token) => {
      const decoded = await getAdminAuth().verifyIdToken(token, true);
      return { uid: decoded.uid, roomId: decoded.roomId, playerId: decoded.playerId, authVersion: decoded.authVersion };
    },
    getMember: async (roomId, uid) => {
      const snapshot = await firestore.doc(`rooms/${roomId}/members/${uid}`).get();
      return snapshot.exists ? parseMember(uid, snapshot.data()) : null;
    },
    refreshMember: async (member, roomId) => {
      const configSnapshot = await firestore.doc(`rooms/${roomId}/config/main`).get();
      const config = configSnapshot.exists ? parseRoomConfig(configSnapshot.data()) : null;
      if (!config) return { ...member, role: "viewer" };
      const loaded = await loadPlayersFromSheet(config.sheetUrl, []);
      if (loaded.source !== "sheet") return { ...member, role: "viewer" };
      const player = loaded.players.find((candidate) => candidate.id === member.playerId);
      if (!player) return { ...member, role: "viewer" };
      const roleSnapshot = await firestore.doc(`rooms/${roomId}/roles/${member.playerId}`).get();
      const override = roleSnapshot.exists ? parseProtectedRoleOverride(roleSnapshot.data()) : null;
      const resolved = resolveProtectedRole(player.appRole, override);
      const refreshed = { ...member, name: player.name, role: resolved.role, verifiedAtMs: Date.now() };
      await firestore.doc(`rooms/${roomId}/members/${member.uid}`).set({
        playerId: refreshed.playerId,
        name: refreshed.name,
        role: refreshed.role,
        authVersion: 1,
        verifiedAt: Timestamp.fromMillis(refreshed.verifiedAtMs),
      }, { merge: true });
      return refreshed;
    },
  };
}

export function requireRoomMember(request: Request, roomId: string, options?: { roles?: Role[]; freshRole?: boolean }) {
  return requireRoomMemberWith(dependencies(), request, roomId, options);
}
