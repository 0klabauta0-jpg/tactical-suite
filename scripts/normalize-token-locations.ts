import { FieldValue } from "firebase-admin/firestore";
import { buildTokenLocationNormalization } from "../lib/release/token-location-normalization";
import { requireConfirmedRoomApply } from "../lib/release/room-features";
import { getScriptFirestore, getScriptProjectId } from "./firebase-admin-runtime";

async function main() {
  const args = process.argv.slice(2);
  const valueAfter = (flag: string) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const roomId = valueAfter("--room");
  const apply = args.includes("--apply");
  if (!roomId) throw new Error("Usage: npm run room:normalize-tokens -- --room <id> [--apply --confirm-room <id>]");
  requireConfirmedRoomApply(roomId, apply, valueAfter("--confirm-room"));

  const firestore = getScriptFirestore();
  const reference = firestore.doc(`rooms/${roomId}/state/board`);
  const beforeSnapshot = await reference.get();
  if (!beforeSnapshot.exists) throw new Error("Board document does not exist.");
  const preview = buildTokenLocationNormalization(beforeSnapshot.data());
  process.stdout.write(`${JSON.stringify({
    roomId,
    projectId: getScriptProjectId(),
    mode: apply ? "apply" : "dry-run",
    removals: preview.removals,
    unresolved: preview.unresolved,
  })}\n`);
  if (preview.unresolved.length > 0) throw new Error("Token normalization contains unresolved locations; no write was performed.");
  if (!apply) return;

  await firestore.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(reference);
    if (!currentSnapshot.exists) throw new Error("Board document does not exist.");
    const current = buildTokenLocationNormalization(currentSnapshot.data());
    if (current.unresolved.length > 0) throw new Error("Token locations changed to an unresolved state; no write was performed.");
    if (current.removals.length > 0) {
      transaction.update(reference, {
        tokensBySystem: current.tokensBySystem,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });

  const verified = buildTokenLocationNormalization((await reference.get()).data());
  if (verified.removals.length > 0 || verified.unresolved.length > 0) {
    throw new Error("Token normalization verification failed.");
  }
  process.stdout.write(`${JSON.stringify({ roomId, verified: true })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
