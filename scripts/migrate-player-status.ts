import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { planPlayerStatusMigration } from "../lib/player-status/migration";
import { parseFirebaseAdminEnv } from "../lib/server/env-values";

async function main() {
  const args = process.argv.slice(2);
  const valueAfter = (flag: string) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const roomId = valueAfter("--room");
  const apply = args.includes("--apply");
  const confirmRoom = valueAfter("--confirm-room");
  if (!roomId) throw new Error("Usage: npm run migrate:player-status -- --room <id> --dry-run");
  if (apply && confirmRoom !== roomId) throw new Error("Apply requires --confirm-room with the exact same room ID.");

  const environment = parseFirebaseAdminEnv(process.env);
  const app = getApps()[0] ?? initializeApp({
    credential: environment.kind === "service-account"
      ? cert({
        projectId: environment.projectId,
        clientEmail: environment.clientEmail,
        privateKey: environment.privateKey,
      })
      : applicationDefault(),
  });
  const firestore = getFirestore(app);
  const [boardSnapshot, statusSnapshot] = await Promise.all([
    firestore.doc(`rooms/${roomId}/state/board`).get(),
    firestore.collection(`rooms/${roomId}/playerStatus`).get(),
  ]);
  if (!boardSnapshot.exists) throw new Error("Board document not found.");
  const existing = new Map(statusSnapshot.docs.map((document) => [document.id, document.data()]));
  const plan = planPlayerStatusMigration(boardSnapshot.data(), existing, Date.now());
  process.stdout.write(`room=${roomId} writes=${plan.writes.length} warnings=${plan.warnings.length} mode=${apply ? "apply" : "dry-run"}\n`);
  for (const warning of plan.warnings) process.stdout.write(`warning ${warning}\n`);

  if (apply) {
    for (let offset = 0; offset < plan.writes.length; offset += 400) {
      const batch = firestore.batch();
      for (const write of plan.writes.slice(offset, offset + 400)) {
        batch.create(firestore.doc(`rooms/${roomId}/playerStatus/${write.playerId}`), write.status);
      }
      await batch.commit();
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
