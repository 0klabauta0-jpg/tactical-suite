import { describe, expect, it } from "vitest";

import { getErrorCode, getErrorMessage } from "@/lib/error-details";

describe("error details", () => {
  it("uses an Error message and otherwise preserves a safe fallback", () => {
    expect(getErrorMessage(new Error("offline"), "Laden fehlgeschlagen.")).toBe("offline");
    expect(getErrorMessage({ message: 42 }, "Laden fehlgeschlagen.")).toBe("Laden fehlgeschlagen.");
  });

  it("reads only string error codes", () => {
    expect(getErrorCode({ code: "auth/invalid-credential" })).toBe("auth/invalid-credential");
    expect(getErrorCode({ code: 403 })).toBe("");
  });
});
