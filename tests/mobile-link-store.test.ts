import { describe, expect, it } from "vitest";
import { issueMobileLink, revokeMobileLink, MobileLinkStoreError, type MobileLinkTransaction, type MobileLinkTransactionStore } from "@/lib/server/mobile-link-store";

function createStore(featureEnabled = true) {
  const state = { link: null as Record<string, unknown> | null, writes: [] as Record<string, unknown>[] };
  const transaction: MobileLinkTransaction = {
    getRoomConfig: async () => ({ sheetUrl: "https://sheet.test", features: { mobileStatus: featureEnabled, rockbreaker3d: false } }),
    getLink: async () => state.link,
    setLink: async (_roomId, _playerId, value) => { state.link = value; state.writes.push(value); },
  };
  const store: MobileLinkTransactionStore = { runTransaction: (operation) => operation(transaction) };
  return { state, store };
}

describe("mobile link store", () => {
  it("stores only a token hash and renews the session revision", async () => {
    const { state, store } = createStore();
    const first = await issueMobileLink(store, { roomId: "room", playerId: "p1", nowMs: 1_000, ttlMs: 60_000 });
    expect(first.token).toBeTruthy();
    expect(JSON.stringify(state.link)).not.toContain(first.token);
    expect(state.link).toMatchObject({ sessionRevision: 1, tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/) });

    const second = await issueMobileLink(store, { roomId: "room", playerId: "p1", nowMs: 2_000, ttlMs: 60_000 });
    expect(second.sessionRevision).toBe(2);
    expect(second.token).not.toBe(first.token);
  });

  it("fails closed when the feature is disabled", async () => {
    const { state, store } = createStore(false);
    await expect(issueMobileLink(store, { roomId: "room", playerId: "p1", nowMs: 1, ttlMs: 10 }))
      .rejects.toEqual(new MobileLinkStoreError("FEATURE_DISABLED"));
    expect(state.writes).toHaveLength(0);
  });

  it("revokes links by increasing the revision", async () => {
    const { state, store } = createStore();
    await issueMobileLink(store, { roomId: "room", playerId: "p1", nowMs: 1_000, ttlMs: 60_000 });
    const result = await revokeMobileLink(store, { roomId: "room", playerId: "p1", nowMs: 2_000 });
    expect(result.sessionRevision).toBe(2);
    expect(state.link).toMatchObject({ revokedAtMs: 2_000, tokenHash: "" });
  });
});
