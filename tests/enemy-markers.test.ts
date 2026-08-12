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

  it("formats age without mutating the marker", () => {
    expect(enemyMarkerAgeLabel(1000, 31_000)).toBe("<1m");
    expect(enemyMarkerAgeLabel(1000, 181_000)).toBe("3m");
    expect(enemyMarkerAgeLabel(1000, 3_721_000)).toBe("1h2m");
  });

  it("rejects invalid kinds and coordinates", () => {
    expect(normalizeEnemyMarker({ id: "x", type: "marker", kind: "ship", x: 0, y: 0 })).toBeNull();
  });
});
