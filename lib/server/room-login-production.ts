import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { mergeWithOverrides } from "@/lib/players/merge-overrides";
import { parsePlayerOverrides } from "@/lib/players/overrides";
import { loadPlayersFromSheet } from "@/lib/players/sheet-loader";
import { parseRoomConfig } from "@/lib/rooms/config";
import { getAdminAuth, getAdminFirestore } from "@/lib/server/firebase-admin";
import { authenticateRoomPlayer, type RoomLoginDependencies } from "@/lib/server/room-login";
import { parseRoomAuthSecret } from "@/lib/server/room-auth-secret";
import { parseProtectedRoleOverride } from "@/lib/server/protected-roles";

function withoutRoleFields(value: unknown) {
  const parsed = parsePlayerOverrides(value);
  return Object.fromEntries(Object.entries(parsed).map(([playerId, override]) => {
    const safe = { ...override };
    delete safe.appRole;
    delete safe.lastSheetAppRole;
    return [playerId, safe];
  }));
}

function productionDependencies(targetRoomId: string): RoomLoginDependencies {
  const firestore = getAdminFirestore();
  const auth = getAdminAuth();
  return {
    getConfig: async (roomId) => {
      const snapshot = await firestore.doc(`rooms/${roomId}/config/main`).get();
      return snapshot.exists ? parseRoomConfig(snapshot.data()) : null;
    },
    getSecret: async (roomId) => {
      const snapshot = await firestore.doc(`rooms/${roomId}/private/auth`).get();
      return snapshot.exists ? parseRoomAuthSecret(snapshot.data()) : null;
    },
    getLegacyPassword: async (roomId) => {
      const snapshot = await firestore.doc(`rooms/${roomId}/config/main`).get();
      const value = snapshot.data()?.password;
      return typeof value === "string" ? value : null;
    },
    loadPlayers: async (config) => {
      const loaded = await loadPlayersFromSheet(config.sheetUrl, []);
      if (loaded.source !== "sheet") throw new Error(loaded.warning ?? "Player source unavailable");
      const overrides = await firestore.doc(`rooms/${targetRoomId}/config/playerOverrides`).get();
      return mergeWithOverrides(loaded.players, withoutRoleFields(overrides.data()));
    },
    getProtectedRole: async (roomId, playerId) => {
      const snapshot = await firestore.doc(`rooms/${roomId}/roles/${playerId}`).get();
      return snapshot.exists ? parseProtectedRoleOverride(snapshot.data()) : null;
    },
    saveRoleTracking: async (roomId, playerId, role) => {
      await firestore.doc(`rooms/${roomId}/roles/${playerId}`).set({ lastSheetRole: role, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    },
    createCustomToken: (uid, claims) => auth.createCustomToken(uid, claims),
    writeMember: async (member) => {
      const { uid, verifiedAtMs, ...stored } = member;
      await firestore.doc(`rooms/${targetRoomId}/members/${uid}`).set({
        ...stored,
        verifiedAt: new Date(verifiedAtMs),
      }, { merge: true });
    },
  };
}

export async function authenticateRoomPlayerProduction(input: {
  roomId: string; handle: string; password: string; nowMs: number;
}) {
  return authenticateRoomPlayer(productionDependencies(input.roomId), input);
}
