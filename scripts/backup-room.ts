import { access, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, parse, resolve } from "node:path";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { buildRoomBackup } from "../lib/release/room-backup";
import { getScriptFirestore, getScriptProjectId } from "./firebase-admin-runtime";

async function collectDocument(reference: DocumentReference, documents: Array<{ path: string; data: unknown }>) {
  const snapshot = await reference.get();
  if (snapshot.exists) documents.push({ path: reference.path, data: snapshot.data() });
  const collections = await reference.listCollections();
  for (const collection of collections.sort((left, right) => left.path.localeCompare(right.path))) {
    const children = await collection.get();
    for (const child of children.docs.sort((left, right) => left.ref.path.localeCompare(right.ref.path))) {
      await collectDocument(child.ref, documents);
    }
  }
}

async function collectRoom(firestore: Firestore, roomId: string) {
  const documents: Array<{ path: string; data: unknown }> = [];
  await collectDocument(firestore.doc(`rooms/${roomId}`), documents);
  return documents;
}

function validatedOutputPath(value: string): string {
  if (!isAbsolute(value)) throw new Error("Backup output must be an explicit absolute path.");
  const output = resolve(value);
  const forbidden = [parse(output).root, resolve(homedir()), resolve(process.cwd())];
  if (forbidden.some((path) => path.toLocaleLowerCase() === output.toLocaleLowerCase())) {
    throw new Error("Backup output cannot be a drive, user-profile or repository root.");
  }
  return output;
}

async function main() {
  const args = process.argv.slice(2);
  const valueAfter = (flag: string) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
  const roomId = valueAfter("--room");
  const outputArg = valueAfter("--out");
  if (!roomId || !outputArg) throw new Error("Usage: npm run room:backup -- --room <id> --out <absolute-new-directory>");
  const output = validatedOutputPath(outputArg);
  try {
    await access(output);
    throw new Error("Backup output already exists; refusing to overwrite it.");
  } catch (error) {
    if (error instanceof Error && !error.message.includes("ENOENT")) throw error;
  }

  const documents = await collectRoom(getScriptFirestore(), roomId);
  if (documents.length === 0) throw new Error("Room does not exist or contains no readable documents.");
  const backup = buildRoomBackup({
    projectId: getScriptProjectId(),
    roomId,
    createdAt: new Date().toISOString(),
    documents,
  });
  await mkdir(output, { recursive: false });
  await writeFile(resolve(output, "room-backup.json"), `${JSON.stringify(backup.payload, null, 2)}\n`, { flag: "wx" });
  await writeFile(resolve(output, "manifest.json"), `${JSON.stringify(backup.manifest, null, 2)}\n`, { flag: "wx" });
  await writeFile(resolve(output, "README.txt"), "Sensitive KlabsCom room backup. Keep private and do not commit.\n", { flag: "wx" });
  process.stdout.write(`room=${roomId} documents=${backup.manifest.documentCount} sha256=${backup.manifest.sha256}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
