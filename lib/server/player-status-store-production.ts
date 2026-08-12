import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/server/firebase-admin";
import type { PlayerStatus } from "@/lib/player-status/model";
import type { PlayerStatusTransactionStore } from "@/lib/server/player-status-store";

export function createProductionPlayerStatusStore(): PlayerStatusTransactionStore {
  const firestore = getAdminFirestore();
  return {
    runTransaction: (operation) => firestore.runTransaction(async (firestoreTransaction) => operation({
      getBoard: async (roomId) => {
        const snapshot = await firestoreTransaction.get(firestore.doc(`rooms/${roomId}/state/board`));
        return snapshot.exists ? snapshot.data() ?? null : null;
      },
      getStatus: async (roomId, playerId) => {
        const snapshot = await firestoreTransaction.get(firestore.doc(`rooms/${roomId}/playerStatus/${playerId}`));
        return snapshot.exists ? snapshot.data() : null;
      },
      setBoardFields: async (roomId, fields) => {
        firestoreTransaction.set(firestore.doc(`rooms/${roomId}/state/board`), {
          ...fields,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      },
      setStatus: async (roomId, playerId, status: PlayerStatus) => {
        firestoreTransaction.set(firestore.doc(`rooms/${roomId}/playerStatus/${playerId}`), status);
      },
    })),
  };
}
