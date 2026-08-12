import { describe, expect, it } from "vitest";
import { parseProtectedRoleOverride, resolveProtectedRole } from "@/lib/server/protected-roles";

describe("protected room roles", () => {
  it("uses a protected override while the sheet role is unchanged", () => {
    expect(resolveProtectedRole("viewer", { role: "commander", lastSheetRole: "viewer" }))
      .toEqual({ role: "commander", trackingRole: "viewer" });
  });

  it("lets a changed sheet role win and advances tracking", () => {
    expect(resolveProtectedRole("admin", { role: "commander", lastSheetRole: "viewer" }))
      .toEqual({ role: "admin", trackingRole: "admin" });
  });

  it("falls back to viewer and rejects malformed protected values", () => {
    expect(resolveProtectedRole("owner", null)).toEqual({ role: "viewer", trackingRole: "viewer" });
    expect(parseProtectedRoleOverride({ role: "owner", lastSheetRole: "admin" }))
      .toEqual({ lastSheetRole: "admin" });
  });
});
