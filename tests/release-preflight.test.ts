import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { evaluateReleasePreflight } from "@/lib/release/preflight";

const strong = "x".repeat(32);
const completeEnv = {
  FIREBASE_PROJECT_ID: "tactical-suite-2a5db",
  FIREBASE_CLIENT_EMAIL: "server@example.test",
  FIREBASE_PRIVATE_KEY: "private-key",
  ROOM_SETUP_SECRET: strong,
  AUTH_RATE_LIMIT_SECRET: strong,
  MOBILE_SESSION_SECRET: strong,
  NEXT_PUBLIC_APP_ORIGIN: "https://klabscom.vercel.app",
};

describe("release preflight", () => {
  it("reports missing project, incomplete admin credentials and weak secrets without leaking values", () => {
    const result = evaluateReleasePreflight({
      env: { ROOM_SETUP_SECRET: "short", FIREBASE_CLIENT_EMAIL: "secret@example.test" },
      requestedFeatures: ["mobileStatus"],
      noticeText: "Permission status: PENDING",
      expectedOrigin: "https://klabscom.vercel.app",
    });
    expect(result.errors).toEqual(expect.arrayContaining([
      "FIREBASE_PROJECT_MISSING",
      "FIREBASE_ADMIN_INCOMPLETE",
      "ROOM_SETUP_SECRET_WEAK",
      "AUTH_RATE_LIMIT_SECRET_WEAK",
      "MOBILE_SESSION_SECRET_WEAK",
      "APP_ORIGIN_INVALID",
    ]));
    const printed = JSON.stringify(result);
    expect(printed).not.toContain("short");
    expect(printed).not.toContain("secret@example.test");
  });

  it("blocks Rockbreaker while permission is pending and confirms safe defaults", () => {
    const result = evaluateReleasePreflight({
      env: completeEnv,
      requestedFeatures: ["mobileStatus", "rockbreaker3d"],
      noticeText: "Permission status: PENDING",
      expectedOrigin: "https://klabscom.vercel.app",
    });
    expect(result.errors).toContain("SOURCE_PERMISSION_PENDING");
    expect(result.featureDefaults).toEqual({ mobileStatus: false, rockbreaker3d: false });
  });

  it("passes a complete mobile-only release configuration", () => {
    const result = evaluateReleasePreflight({
      env: completeEnv,
      requestedFeatures: ["mobileStatus"],
      noticeText: "Permission status: PENDING",
      expectedOrigin: "https://klabscom.vercel.app",
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts the documented Rockbreaker approval for the public release", async () => {
    const noticeText = await readFile(new URL("../lib/rockbreaker/NOTICE.md", import.meta.url), "utf8");
    const result = evaluateReleasePreflight({
      env: completeEnv,
      requestedFeatures: ["rockbreaker3d"],
      noticeText,
      expectedOrigin: "https://klabscom.vercel.app",
    });

    expect(result.ok).toBe(true);
    expect(result.presence.rockbreakerPermission).toBe(true);
  });
});
