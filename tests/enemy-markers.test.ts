import { describe, expect, it } from "vitest";
import { enemyMarkerAgeLabel, normalizeEnemyMarker } from "@/lib/map/enemy-markers";

describe("enemy markers", () => {
  it("ignores stored fade values and stays fully visible", () => {
    expect(normalizeEnemyMarker({ id: "e1", type: "marker", kind: "ground", x: 0.2, y: 0.7,
      color: "#ef4444", opacity: 0.05, createdAt: 1000 })).toEqual({
      id: "e1", type: "marker", kind: "ground", x: 0.2, y: 0.7,
      color: "#ef4444", opacity: 1, createdAt: 1000,
    });
  });

  it("keeps a marker that is one year old without expiration", () => {
    const oneYearMs = 365 * 24 * 60 * 60 * 1000;
    const marker = normalizeEnemyMarker({
      id: "old-enemy",
      type: "marker",
      kind: "air",
      x: 0.35,
      y: 0.45,
      opacity: 0,
      createdAt: 1_000,
      expiresAt: 1_000 + 60_000,
    });
    expect(marker).toMatchObject({ id: "old-enemy", opacity: 1, createdAt: 1_000 });
    expect(enemyMarkerAgeLabel(marker!.createdAt, marker!.createdAt + oneYearMs)).toBe("8760h");
  });

  it("formats age without mutating the marker", () => {
    expect(enemyMarkerAgeLabel(1000, 31_000)).toBe("<1m");
    expect(enemyMarkerAgeLabel(1000, 181_000)).toBe("3m");
    expect(enemyMarkerAgeLabel(1000, 3_721_000)).toBe("1h2m");
  });

  it("rejects invalid kinds and coordinates", () => {
    expect(normalizeEnemyMarker({ id: "x", type: "marker", kind: "ship", x: 0, y: 0 })).toBeNull();
  });
});
