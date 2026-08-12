import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { parseSceneObject } from "@/lib/rockbreaker/scene-objects";
import { getAdminFirestore } from "@/lib/server/firebase-admin";
import {
  parseTokenTransferReceipt,
  type TokenTransferTransactionStore,
} from "@/lib/server/token-transfer-store";

export function createProductionTokenTransferStore(): TokenTransferTransactionStore {
  const firestore = getAdminFirestore();
  return {
    runTransaction: (operation) => firestore.runTransaction(async (firestoreTransaction) => operation({
      readSnapshot: async (roomId, operationId) => {
        const boardRef = firestore.doc(`rooms/${roomId}/state/board`);
        const configRef = firestore.doc(`rooms/${roomId}/config/main`);
        const sceneRef = firestore.doc(`rooms/${roomId}/mapScenes/nyx--rockbreaker`);
        const objectsQuery = firestore.collection(`rooms/${roomId}/mapScenes/nyx--rockbreaker/objects`);
        const receiptRef = firestore.doc(`rooms/${roomId}/tokenTransferOperations/${operationId}`);
        const [board, config, scene, objects, receipt] = await Promise.all([
          firestoreTransaction.get(boardRef),
          firestoreTransaction.get(configRef),
          firestoreTransaction.get(sceneRef),
          firestoreTransaction.get(objectsQuery),
          firestoreTransaction.get(receiptRef),
        ]);
        return {
          boardDocument: board.exists ? board.data() ?? null : null,
          roomConfig: config.exists ? config.data() : null,
          sceneMetadata: scene.exists ? scene.data() : null,
          sceneObjects: objects.docs.flatMap((document) => {
            const parsed = parseSceneObject(document.data());
            return parsed ? [parsed] : [];
          }),
          receipt: receipt.exists ? parseTokenTransferReceipt(receipt.data()) : null,
        };
      },
      setTokensBySystem: async (roomId, value) => {
        firestoreTransaction.set(firestore.doc(`rooms/${roomId}/state/board`), {
          tokensBySystem: value,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      },
      setSceneGroup: async (roomId, object) => {
        firestoreTransaction.set(
          firestore.doc(`rooms/${roomId}/mapScenes/nyx--rockbreaker/objects/${object.id}`),
          object,
        );
      },
      deleteSceneGroup: async (roomId, objectId) => {
        firestoreTransaction.delete(firestore.doc(`rooms/${roomId}/mapScenes/nyx--rockbreaker/objects/${objectId}`));
      },
      setReceipt: async (roomId, receipt) => {
        firestoreTransaction.set(firestore.doc(`rooms/${roomId}/tokenTransferOperations/${receipt.operationId}`), {
          ...receipt,
          expiresAt: Timestamp.fromMillis(receipt.expiresAtMs),
        });
      },
    })),
  };
}
