import { describe, expect, it } from "vitest";
import { advanceAuthoritativeEpoch, operationEpochIsCurrent } from "@/lib/rockbreaker/authoritative-epoch";

describe("Rockbreaker authoritative epoch", () => {
  it("keeps identical initialization snapshots current", () => {
    const initial = { signature: '[{"id":"one","revision":1}]', epoch: 4 };
    const next = advanceAuthoritativeEpoch(initial, initial.signature);
    expect(next).toBe(initial);
    expect(operationEpochIsCurrent(4, next)).toBe(true);
  });

  it("invalidates an operation synchronously when the semantic snapshot changes", () => {
    const initial = { signature: '[{"id":"one","revision":1}]', epoch: 4 };
    const next = advanceAuthoritativeEpoch(initial, '[{"id":"one","revision":2}]');
    expect(next).toEqual({ signature: '[{"id":"one","revision":2}]', epoch: 5 });
    expect(operationEpochIsCurrent(4, next)).toBe(false);
  });
});
