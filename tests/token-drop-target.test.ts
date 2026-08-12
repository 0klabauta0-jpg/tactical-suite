import { describe, expect, it } from "vitest";
import { tokenDropIntentForTargets } from "@/app/components/map/token-transfer-controls";

describe("token drop target priority", () => {
  it("prefers a child target behind the surrounding map", () => {
    expect(tokenDropIntentForTargets(["map2d:main", "child:rockbreaker"]))
      .toEqual({ kind: "enterChild", childId: "rockbreaker" });
  });

  it("prefers a parent target behind the surrounding map", () => {
    expect(tokenDropIntentForTargets(["map2d:rockbreaker", "parent"]))
      .toEqual({ kind: "moveUp" });
  });

  it("ignores a plain 2D map target", () => {
    expect(tokenDropIntentForTargets(["map2d:main"])).toBeNull();
  });
});
