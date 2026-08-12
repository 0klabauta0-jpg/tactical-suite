import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { verifyRoomBackup, type RoomBackupManifest, type RoomBackupPayload } from "../lib/release/room-backup";

async function main() {
  const args = process.argv.slice(2);
  const index = args.indexOf("--manifest");
  const manifestArg = index >= 0 ? args[index + 1] : undefined;
  if (!manifestArg || !isAbsolute(manifestArg)) throw new Error("Usage: npm run room:backup:verify -- --manifest <absolute-manifest-path>");
  const manifestPath = resolve(manifestArg);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as RoomBackupManifest;
  const payload = JSON.parse(await readFile(resolve(dirname(manifestPath), "room-backup.json"), "utf8")) as RoomBackupPayload;
  const errors = verifyRoomBackup(manifest, payload);
  if (errors.length > 0) throw new Error(`Backup verification failed: ${errors.join(", ")}`);
  process.stdout.write(`room=${manifest.roomId} documents=${manifest.documentCount} sha256=${manifest.sha256} verified=true\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
