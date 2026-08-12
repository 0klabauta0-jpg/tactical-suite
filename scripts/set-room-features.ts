import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildRoomFeatureUpdate, requireConfirmedRoomApply } from "../lib/release/room-features";
import { rockbreakerPermissionApproved } from "../lib/release/preflight";
import { parseRoomConfig } from "../lib/rooms/config";
import { getScriptFirestore } from "./firebase-admin-runtime";

async function main() {
  const args = process.argv.slice(2);
  const valueAfter = (flag: string) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
  const roomId = valueAfter("--room");
  const assignments = valueAfter("--set");
  const apply = args.includes("--apply");
  if (!roomId || !assignments) throw new Error("Usage: npm run room:features -- --room <id> --set mobileStatus=true [--apply --confirm-room <id>]");
  requireConfirmedRoomApply(roomId, apply, valueAfter("--confirm-room"));

  const firestore = getScriptFirestore();
  const reference = firestore.doc(`rooms/${roomId}/config/main`);
  const snapshot = await reference.get();
  const config = snapshot.exists ? parseRoomConfig(snapshot.data()) : null;
  if (!config) throw new Error("Room config does not exist or is invalid.");
  const notice = await readFile(resolve("lib/rockbreaker/NOTICE.md"), "utf8");
  const plan = buildRoomFeatureUpdate(config.features, assignments, rockbreakerPermissionApproved(notice));
  process.stdout.write(`${JSON.stringify({ roomId, mode: apply ? "apply" : "dry-run", before: config.features, after: plan.after })}\n`);
  if (!apply) return;

  await reference.update(plan.update);
  const verified = parseRoomConfig((await reference.get()).data());
  if (!verified || Object.entries(plan.after).some(([name, value]) => verified.features[name as keyof typeof plan.after] !== value)) {
    throw new Error("Feature update verification failed.");
  }
  process.stdout.write(`${JSON.stringify({ roomId, verified: true, features: verified.features })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
