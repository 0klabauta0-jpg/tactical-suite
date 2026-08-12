export type Role = "admin" | "commander" | "viewer";

function isRole(value: string): value is Role {
  return value === "admin" || value === "commander" || value === "viewer";
}

export function parseRole(value: unknown): Role {
  if (typeof value !== "string") return "viewer";

  const normalized = value.trim().toLowerCase();
  return isRole(normalized) ? normalized : "viewer";
}

export function canWriteBoard(role: Role): boolean {
  return role === "admin" || role === "commander";
}

export function canAdministerRoom(role: Role): boolean {
  return role === "admin";
}
