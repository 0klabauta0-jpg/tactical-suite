import { parseRole, type Role } from "@/lib/domain/roles";

export type ProtectedRoleOverride = {
  role?: Role;
  lastSheetRole?: Role;
};

export function parseProtectedRoleOverride(value: unknown): ProtectedRoleOverride | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const parsed: ProtectedRoleOverride = {};
  if (record.role === "admin" || record.role === "commander" || record.role === "viewer") parsed.role = record.role;
  if (record.lastSheetRole === "admin" || record.lastSheetRole === "commander" || record.lastSheetRole === "viewer") {
    parsed.lastSheetRole = record.lastSheetRole;
  }
  return parsed;
}

export function resolveProtectedRole(
  sheetValue: unknown,
  override: ProtectedRoleOverride | null,
): { role: Role; trackingRole: Role } {
  const sheetRole = parseRole(sheetValue);
  if (!override?.role) return { role: sheetRole, trackingRole: sheetRole };
  if (override.lastSheetRole !== undefined && sheetRole !== override.lastSheetRole) {
    return { role: sheetRole, trackingRole: sheetRole };
  }
  return { role: override.role, trackingRole: override.lastSheetRole ?? sheetRole };
}
