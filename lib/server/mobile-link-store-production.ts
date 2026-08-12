import "server-only";
import { getAdminFirestore } from "@/lib/server/firebase-admin";
import type { MobileLinkTransactionStore } from "@/lib/server/mobile-link-store";

export function createProductionMobileLinkStore(): MobileLinkTransactionStore {
  const firestore = getAdminFirestore();
  return {
    runTransaction: (operation) => firestore.runTransaction(async (firestoreTransaction) => operation({
      getRoomConfig: async (roomId) => {
        const snapshot = await firestoreTransaction.get(firestore.doc(`rooms/${roomId}/config/main`));
        return snapshot.exists ? snapshot.data() : null;
      },
      getLink: async (roomId, playerId) => {
        const snapshot = await firestoreTransaction.get(firestore.doc(`rooms/${roomId}/mobileLinks/${playerId}`));
        return snapshot.exists ? snapshot.data() : null;
      },
      setLink: async (roomId, playerId, value) => {
        firestoreTransaction.set(firestore.doc(`rooms/${roomId}/mobileLinks/${playerId}`), value);
      },
    })),
  };
}
