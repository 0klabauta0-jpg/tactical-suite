import { writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { auditTokenLocations } from "../lib/release/token-location-audit";
import { getScriptFirestore, getScriptProjectId } from "./firebase-admin-runtime";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function requiredAbsoluteOutput(value: string | undefined) {
  if (!value || !isAbsolute(value)) throw new Error("Audit output must be an explicit absolute new file path.");
  return resolve(value);
}

function countRawTokens(board: unknown) {
  if (!isRecord(board)) return 0;
  if (isRecord(board.tokensBySystem)) {
    return Object.values(board.tokensBySystem).reduce<number>((count, value) => count + (Array.isArray(value) ? value.length : 0), 0);
  }
  return Array.isArray(board.tokens) ? board.tokens.length : 0;
}

async function main() {
  const args = process.argv.slice(2);
  const valueAfter = (flag: string) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
  const roomId = valueAfter("--room");
  const output = requiredAbsoluteOutput(valueAfter("--out"));
  if (!roomId) throw new Error("Usage: npm run room:audit-tokens -- --room <id> --out <absolute-new-file>");

  const firestore = getScriptFirestore();
  const boardPath = `rooms/${roomId}/state/board`;
  const scenePath = `rooms/${roomId}/mapScenes/nyx--rockbreaker`;
  const [boardSnapshot, sceneSnapshot, objectsSnapshot] = await Promise.all([
    firestore.doc(boardPath).get(),
    firestore.doc(scenePath).get(),
    firestore.collection(`${scenePath}/objects`).get(),
  ]);
  if (!boardSnapshot.exists) throw new Error(`Board document does not exist: ${boardPath}`);

  const boardDocument = boardSnapshot.data();
  const sceneDocuments = objectsSnapshot.docs.map((document) => ({ path: document.ref.path, data: document.data() }));
  const issues = auditTokenLocations({
    roomId,
    boardDocument,
    sceneMetadata: sceneSnapshot.exists ? sceneSnapshot.data() : null,
    sceneDocuments,
  });
  const report = {
    roomId,
    projectId: getScriptProjectId(),
    createdAt: new Date().toISOString(),
    counts: {
      groups: isRecord(boardDocument) && Array.isArray(boardDocument.groups) ? boardDocument.groups.length : 0,
      raw2dTokens: countRawTokens(boardDocument),
      sceneObjects: sceneDocuments.length,
      blockingIssues: issues.length,
    },
    issues,
  };
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`room=${roomId} issues=${issues.length} output=${output}\n`);
  if (issues.length > 0) process.exitCode = 2;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
