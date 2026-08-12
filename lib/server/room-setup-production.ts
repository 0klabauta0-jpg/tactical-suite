import "server-only";
import { timingSafeEqual } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { loadPlayersFromSheet } from "@/lib/players/sheet-loader";
import { getRoomSetupSecret } from "@/lib/server/env";
import { getAdminFirestore } from "@/lib/server/firebase-admin";
import { hashRoomPassword } from "@/lib/server/password-hash";
import { RoomSetupError } from "@/app/api/rooms/[roomId]/setup/route";

function sameSecret(actual: string, expected: string): boolean {
  const left = Buffer.from(actual, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function setupRoomProduction(input: {
  roomId: string; setupSecret: string; sheetUrl: string; password: string; roomName: string;
  sheetShareUrl: string; adminHandle: string; nowMs: number;
}) {
  if (!sameSecret(input.setupSecret, getRoomSetupSecret())) throw new RoomSetupError("UNAUTHORIZED");
  const loaded = await loadPlayersFromSheet(input.sheetUrl, []);
  if (loaded.source !== "sheet") throw new RoomSetupError("PLAYER_SOURCE_UNAVAILABLE");
  const handle = input.adminHandle.toLocaleLowerCase("de-DE");
  const matches = loaded.players.filter((player) => player.name.trim().toLocaleLowerCase("de-DE") === handle);
  if (matches.length !== 1) throw new RoomSetupError("ADMIN_NOT_FOUND");
  const admin = matches[0];
  const secret = await hashRoomPassword(input.password);
  const firestore = getAdminFirestore();
  const configRef = firestore.doc(`rooms/${input.roomId}/config/main`);
  await firestore.runTransaction(async (transaction) => {
    const existing = await transaction.get(configRef);
    if (existing.exists) throw new RoomSetupError("ROOM_EXISTS");
    transaction.create(configRef, {
      sheetUrl: input.sheetUrl,
      sheetShareUrl: input.sheetShareUrl,
      roomName: input.roomName,
      features: { mobileStatus: false, rockbreaker3d: false },
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(firestore.doc(`rooms/${input.roomId}/private/auth`), {
      ...secret,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(firestore.doc(`rooms/${input.roomId}/roles/${admin.id}`), {
      role: "admin",
      lastSheetRole: admin.appRole,
      updatedBy: "room-setup",
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return { roomName: input.roomName, adminPlayerId: admin.id };
}
