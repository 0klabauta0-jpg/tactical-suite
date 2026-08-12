import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

describe.skipIf(!emulatorAvailable)("Firestore mobile and scene rules", () => {
  let environment: RulesTestEnvironment;

  beforeAll(async () => {
    environment = await initializeTestEnvironment({
      projectId: "klabscom-rules-test",
      firestore: { rules: readFileSync(resolve("firestore.rules"), "utf8") },
    });
    await environment.withSecurityRulesDisabled(async (context) => {
      const database = context.firestore();
      await setDoc(doc(database, "rooms/alpha/config/main"), { sheetUrl: "https://example.test", features: { mobileStatus: true, rockbreaker3d: false } });
      await setDoc(doc(database, "rooms/alpha/members/viewer-uid"), { playerId: "p1", role: "viewer", authVersion: 1 });
      await setDoc(doc(database, "rooms/alpha/members/commander-uid"), { playerId: "p2", role: "commander", authVersion: 1 });
      await setDoc(doc(database, "rooms/alpha/state/board"), {
        groups: [],
        columns: {},
        tokensBySystem: { nyx: [{ groupId: "g1", mapId: "main", x: 0.4, y: 0.6 }] },
      });
      await setDoc(doc(database, "rooms/alpha/playerStatus/p1"), { aliveStatus: "alive" });
      await setDoc(doc(database, "rooms/alpha/config/playerOverrides"), { p1: { area: "A" } });
      await setDoc(doc(database, "rooms/alpha/mobileLinks/p1"), { tokenHash: "secret" });
      await setDoc(doc(database, "rooms/alpha/mapScenes/nyx--rockbreaker/objects/groupToken--g1"), { type: "groupToken" });
    });
  });

  afterAll(async () => { await environment.cleanup(); });

  const auth = (uid: string, playerId: string) => environment.authenticatedContext(uid, { roomId: "alpha", playerId, authVersion: 1 }).firestore();

  it("allows the public room config but not protected link data", async () => {
    await assertSucceeds(getDoc(doc(environment.unauthenticatedContext().firestore(), "rooms/alpha/config/main")));
    await assertFails(getDoc(doc(auth("viewer-uid", "p1"), "rooms/alpha/mobileLinks/p1")));
  });

  it("allows room reads while denying direct status and scene writes", async () => {
    const viewer = auth("viewer-uid", "p1");
    await assertSucceeds(getDoc(doc(viewer, "rooms/alpha/playerStatus/p1")));
    await assertSucceeds(getDoc(doc(viewer, "rooms/alpha/mapScenes/nyx--rockbreaker/objects/groupToken--g1")));
    await assertFails(setDoc(doc(viewer, "rooms/alpha/playerStatus/p1"), { aliveStatus: "dead" }));
    await assertFails(setDoc(doc(viewer, "rooms/alpha/mapScenes/nyx--rockbreaker/objects/groupToken--g1"), { type: "point" }));
  });

  it("keeps board writes for commanders and admins", async () => {
    await assertFails(setDoc(doc(auth("viewer-uid", "p1"), "rooms/alpha/state/board"), { groups: [], columns: {} }));
    await assertSucceeds(updateDoc(doc(auth("commander-uid", "p2"), "rooms/alpha/state/board"), { notesText: "command note" }));
    await assertFails(setDoc(doc(auth("viewer-uid", "p1"), "rooms/alpha/config/playerOverrides"), { p1: { area: "B" } }));
    await assertSucceeds(setDoc(doc(auth("commander-uid", "p2"), "rooms/alpha/config/playerOverrides"), { p1: { area: "B" } }));
    expect(true).toBe(true);
  });

  it("reserves troop locations and transfer receipts for the server", async () => {
    const commander = auth("commander-uid", "p2");
    const board = doc(commander, "rooms/alpha/state/board");

    await assertFails(updateDoc(board, {
      tokensBySystem: { nyx: [{ groupId: "g1", mapId: "main", x: 0.9, y: 0.9 }] },
    }));
    await assertFails(updateDoc(board, {
      tokens: [{ groupId: "g1", mapId: "main", x: 0.9, y: 0.9 }],
    }));
    await assertSucceeds(updateDoc(board, { notesText: "authorized non-token update" }));

    await assertFails(setDoc(board, { groups: [], columns: {} }));
    await assertFails(deleteDoc(board));
    await assertFails(setDoc(doc(commander, "rooms/alpha/tokenTransferOperations/fake-operation"), {
      operationId: "fake-operation",
    }));
  });
});
