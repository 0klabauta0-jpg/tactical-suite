import { createHash } from "node:crypto";

type BackupDocumentInput = { path: string; data: unknown };
export type RoomBackupPayload = { formatVersion: 1; documents: BackupDocumentInput[] };
export type RoomBackupManifest = {
  formatVersion: 1;
  projectId: string;
  roomId: string;
  createdAt: string;
  documentCount: number;
  sha256: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function serializeBackupValue(value: unknown): unknown {
  if (value === undefined) throw new Error("Backup cannot serialize undefined values.");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Backup cannot serialize non-finite numbers.");
    return value;
  }
  if (typeof value === "bigint") return { __type: "bigint", value: value.toString() };
  if (value instanceof Date) return { __type: "date", iso: value.toISOString() };
  if (value instanceof Uint8Array) return { __type: "bytes", base64: Buffer.from(value).toString("base64") };
  if (Array.isArray(value)) return value.map(serializeBackupValue);
  if (!isRecord(value)) throw new Error(`Backup cannot serialize ${typeof value}.`);

  if (typeof value.seconds === "number" && typeof value.nanoseconds === "number" && typeof value.toDate === "function") {
    return {
      __type: "timestamp",
      iso: (value.toDate as () => Date)().toISOString(),
      nanoseconds: value.nanoseconds,
      seconds: value.seconds,
    };
  }
  if (typeof value.latitude === "number" && typeof value.longitude === "number") {
    return { __type: "geopoint", latitude: value.latitude, longitude: value.longitude };
  }
  if (typeof value.path === "string" && "firestore" in value) {
    return { __type: "reference", path: value.path };
  }

  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, serializeBackupValue(value[key])]));
}

function payloadHash(payload: RoomBackupPayload): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function buildRoomBackup(input: {
  projectId: string;
  roomId: string;
  createdAt: string;
  documents: BackupDocumentInput[];
}) {
  const payload: RoomBackupPayload = {
    formatVersion: 1,
    documents: [...input.documents]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((document) => ({ path: document.path, data: serializeBackupValue(document.data) })),
  };
  const manifest: RoomBackupManifest = {
    formatVersion: 1,
    projectId: input.projectId,
    roomId: input.roomId,
    createdAt: input.createdAt,
    documentCount: payload.documents.length,
    sha256: payloadHash(payload),
  };
  return { manifest, payload };
}

export function verifyRoomBackup(manifest: RoomBackupManifest, payload: RoomBackupPayload): string[] {
  const errors: string[] = [];
  if (manifest.formatVersion !== 1 || payload.formatVersion !== 1) errors.push("FORMAT_VERSION_INVALID");
  if (manifest.documentCount !== payload.documents.length) errors.push("DOCUMENT_COUNT_MISMATCH");
  if (manifest.sha256 !== payloadHash(payload)) errors.push("SHA256_MISMATCH");
  const sorted = [...payload.documents].sort((left, right) => left.path.localeCompare(right.path));
  if (JSON.stringify(sorted) !== JSON.stringify(payload.documents)) errors.push("DOCUMENT_ORDER_INVALID");
  return errors;
}
