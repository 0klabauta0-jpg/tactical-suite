import { describe, expect, it } from "vitest";
import { buildRoomFeatureUpdate, requireConfirmedRoomApply } from "@/lib/release/room-features";

describe("room feature rollout", () => {
  it("uses only feature dot paths and preserves unrelated config fields", () => {
    const result = buildRoomFeatureUpdate(
      { mobileStatus: false, rockbreaker3d: false },
      "mobileStatus=true",
      false,
    );
    expect(result.update).toEqual({ "features.mobileStatus": true });
    expect(result.after).toEqual({ mobileStatus: true, rockbreaker3d: false });
  });

  it("rejects unknown features and gated Rockbreaker activation", () => {
    expect(() => buildRoomFeatureUpdate({ mobileStatus: false, rockbreaker3d: false }, "unknown=true", false)).toThrow("Unknown feature");
    expect(() => buildRoomFeatureUpdate({ mobileStatus: false, rockbreaker3d: false }, "rockbreaker3d=true", false)).toThrow("permission");
    expect(buildRoomFeatureUpdate({ mobileStatus: true, rockbreaker3d: true }, "rockbreaker3d=false", false).after.rockbreaker3d).toBe(false);
  });

  it("requires an exact room confirmation only for apply", () => {
    expect(() => requireConfirmedRoomApply("alpha", true, undefined)).toThrow("confirm-room");
    expect(() => requireConfirmedRoomApply("alpha", true, "beta")).toThrow("confirm-room");
    expect(() => requireConfirmedRoomApply("alpha", false, undefined)).not.toThrow();
    expect(() => requireConfirmedRoomApply("alpha", true, "alpha")).not.toThrow();
  });
});
