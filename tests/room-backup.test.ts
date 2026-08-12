import { describe, expect, it } from "vitest";
import { buildRoomBackup, serializeBackupValue, verifyRoomBackup } from "@/lib/release/room-backup";

describe("room backup", () => {
  it("serializes Firestore values deterministically and rejects undefined", () => {
    const timestamp = { seconds: 10, nanoseconds: 20, toDate: () => new Date("2026-08-12T10:00:00.000Z") };
    expect(serializeBackupValue({
      z: new Uint8Array([1, 2, 3]),
      point: { latitude: 50.1, longitude: 6.9 },
      reference: { path: "rooms/alpha/state/board", firestore: {} },
      timestamp,
    })).toEqual({
      point: { __type: "geopoint", latitude: 50.1, longitude: 6.9 },
      reference: { __type: "reference", path: "rooms/alpha/state/board" },
      timestamp: { __type: "timestamp", iso: "2026-08-12T10:00:00.000Z", nanoseconds: 20, seconds: 10 },
      z: { __type: "bytes", base64: "AQID" },
    });
    expect(() => serializeBackupValue({ broken: undefined })).toThrow("undefined");
  });

  it("sorts recursive document paths and creates a verifiable manifest", () => {
    const backup = buildRoomBackup({
      projectId: "tactical-suite-2a5db",
      roomId: "alpha",
      createdAt: "2026-08-12T10:00:00.000Z",
      documents: [
        { path: "rooms/alpha/state/board", data: { revision: 2 } },
        { path: "rooms/alpha/config/main", data: { roomName: "Alpha" } },
        { path: "rooms/alpha/mapScenes/nyx/objects/token", data: { x: 1 } },
      ],
    });
    expect(backup.payload.documents.map((document) => document.path)).toEqual([
      "rooms/alpha/config/main",
      "rooms/alpha/mapScenes/nyx/objects/token",
      "rooms/alpha/state/board",
    ]);
    expect(backup.manifest).toMatchObject({ roomId: "alpha", documentCount: 3, projectId: "tactical-suite-2a5db" });
    expect(verifyRoomBackup(backup.manifest, backup.payload)).toEqual([]);
  });

  it("detects removed documents and a manipulated hash", () => {
    const backup = buildRoomBackup({
      projectId: "project",
      roomId: "alpha",
      createdAt: "2026-08-12T10:00:00.000Z",
      documents: [{ path: "rooms/alpha/config/main", data: { ok: true } }],
    });
    const missing = { ...backup.payload, documents: [] };
    expect(verifyRoomBackup(backup.manifest, missing)).toEqual(expect.arrayContaining(["DOCUMENT_COUNT_MISMATCH", "SHA256_MISMATCH"]));
    expect(verifyRoomBackup({ ...backup.manifest, sha256: "0".repeat(64) }, backup.payload)).toContain("SHA256_MISMATCH");
  });
});
