import "server-only";
import { parseBoardState } from "@/lib/board/state";
import { parseRoomConfig } from "@/lib/rooms/config";
import { parseSceneObject } from "@/lib/rockbreaker/scene-objects";
import { getAdminFirestore } from "@/lib/server/firebase-admin";
import type { MapSceneTransactionStore } from "@/lib/server/map-scene-store";

export function createFirestoreMapSceneStore(): MapSceneTransactionStore {
  const firestore = getAdminFirestore();
  return {
    runObjectTransaction: (roomId, sceneId, objectId, operation) => firestore.runTransaction(async (transaction) => {
      const objectRef = firestore.doc(`rooms/${roomId}/mapScenes/${sceneId}/objects/${objectId}`);
      const boardRef = firestore.doc(`rooms/${roomId}/state/board`);
      const configRef = firestore.doc(`rooms/${roomId}/config/main`);
      const [objectSnapshot, boardSnapshot, configSnapshot] = await Promise.all([
        transaction.get(objectRef), transaction.get(boardRef), transaction.get(configRef),
      ]);
      const object = objectSnapshot.exists ? parseSceneObject(objectSnapshot.data()) : null;
      const board = boardSnapshot.exists ? parseBoardState(boardSnapshot.data(), []) : { groups: [], columns: {} };
      const config = configSnapshot.exists ? parseRoomConfig(configSnapshot.data()) : null;
      const result = await operation({
        object,
        groupIds: new Set(board.groups.map((group) => group.id)),
        rockbreakerEnabled: config?.features.rockbreaker3d === true,
      });
      if (result === null) transaction.delete(objectRef);
      else transaction.set(objectRef, result);
      return result;
    }),
  };
}
