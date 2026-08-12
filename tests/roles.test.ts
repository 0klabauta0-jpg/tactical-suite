import { describe, expect, it } from "vitest";
import { canAdministerRoom, canWriteBoard, parseRole } from "@/lib/domain/roles";

describe("parseRole", () => {
  it("keeps each supported role", () => {
    expect(parseRole("admin")).toBe("admin");
    expect(parseRole("commander")).toBe("commander");
    expect(parseRole("viewer")).toBe("viewer");
  });

  it("normalizes casing and surrounding whitespace", () => {
    expect(parseRole(" ADMIN ")).toBe("admin");
    expect(parseRole("Commander")).toBe("commander");
  });

  it("defaults missing or unknown values to viewer", () => {
    expect(parseRole(undefined)).toBe("viewer");
    expect(parseRole("owner")).toBe("viewer");
    expect(parseRole({ role: "admin" })).toBe("viewer");
  });
});

describe("role permissions", () => {
  it("allows board writes only for admins and commanders", () => {
    expect(canWriteBoard("admin")).toBe(true);
    expect(canWriteBoard("commander")).toBe(true);
    expect(canWriteBoard("viewer")).toBe(false);
  });

  it("allows room administration only for admins", () => {
    expect(canAdministerRoom("admin")).toBe(true);
    expect(canAdministerRoom("commander")).toBe(false);
    expect(canAdministerRoom("viewer")).toBe(false);
  });
});
