import { describe, expect, it } from "vitest";
import { parseAppOrigin, parseFirebaseAdminEnv, requireServerSecret } from "@/lib/server/env-values";

describe("server environment", () => {
  it("normalizes an explicit Firebase service account", () => {
    expect(parseFirebaseAdminEnv({
      FIREBASE_PROJECT_ID: "project",
      FIREBASE_CLIENT_EMAIL: "svc@example.test",
      FIREBASE_PRIVATE_KEY: "line1\\nline2",
    })).toEqual({
      kind: "service-account",
      projectId: "project",
      clientEmail: "svc@example.test",
      privateKey: "line1\nline2",
    });
  });

  it("uses application default credentials only when the full service account is absent", () => {
    expect(parseFirebaseAdminEnv({})).toEqual({ kind: "application-default" });
    expect(() => parseFirebaseAdminEnv({ FIREBASE_PROJECT_ID: "project" })).toThrow(/incomplete/i);
  });

  it("requires server secrets with at least 32 bytes", () => {
    expect(requireServerSecret({ AUTH_RATE_LIMIT_SECRET: "x".repeat(32) }, "AUTH_RATE_LIMIT_SECRET"))
      .toBe("x".repeat(32));
    expect(() => requireServerSecret({ ROOM_SETUP_SECRET: "short" }, "ROOM_SETUP_SECRET"))
      .toThrow(/32 bytes/i);
  });

  it("accepts an exact https origin and localhost development origin", () => {
    expect(parseAppOrigin("https://klabs.example").href).toBe("https://klabs.example/");
    expect(parseAppOrigin("http://localhost:3000").href).toBe("http://localhost:3000/");
    expect(() => parseAppOrigin("https://klabs.example/path")).toThrow(/origin/i);
    expect(() => parseAppOrigin("http://klabs.example")).toThrow(/https/i);
  });
});
