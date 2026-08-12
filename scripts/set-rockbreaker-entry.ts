import { buildRockbreakerEntryUpdate } from "../lib/release/rockbreaker-entry-rollout";
import { requireConfirmedRoomApply } from "../lib/release/room-features";
import { parseRockbreakerSceneConfig } from "../lib/rockbreaker/scene-config";
import { getScriptFirestore, getScriptProjectId } from "./firebase-admin-runtime";

async function main() {
  const args = process.argv.slice(2);
  const valueAfter = (flag: string) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
  const roomId = valueAfter("--room");
  const apply = args.includes("--apply");
  if (!roomId) throw new Error("Usage: npm run room:rockbreaker-entry -- --room <id> [--apply --confirm-room <id>]");
  requireConfirmedRoomApply(roomId, apply, valueAfter("--confirm-room"));

  const reference = getScriptFirestore().doc(`rooms/${roomId}/mapScenes/nyx--rockbreaker`);
  const beforeSnapshot = await reference.get();
  const before = beforeSnapshot.exists ? beforeSnapshot.data() : null;
  const update = buildRockbreakerEntryUpdate(before);
  process.stdout.write(`${JSON.stringify({
    roomId,
    projectId: getScriptProjectId(),
    mode: apply ? "apply" : "dry-run",
    beforeValid: parseRockbreakerSceneConfig(before) !== null,
    update,
  })}\n`);
  if (!apply) return;

  await reference.set(update, { merge: true });
  const verified = parseRockbreakerSceneConfig((await reference.get()).data());
  if (!verified || JSON.stringify(verified) !== JSON.stringify(update)) {
    throw new Error("Rockbreaker entry verification failed.");
  }
  process.stdout.write(`${JSON.stringify({ roomId, verified: true, slotCount: verified.troopEntry.slots.length })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
