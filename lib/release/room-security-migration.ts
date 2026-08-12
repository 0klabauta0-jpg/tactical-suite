import type { Role } from "@/lib/domain/roles";
import { parsePlayerOverrides } from "@/lib/players/overrides";
import type { RoomPasswordHash } from "@/lib/server/password-hash";
import { parseProtectedRoleOverride } from "@/lib/server/protected-roles";

type MigrationPlayer = { id: string; name: string; appRole: Role };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function planRoomSecurityMigration(input: {
  config: unknown;
  overrides: unknown;
  existingSecret: RoomPasswordHash | null;
  existingRoles: ReadonlyMap<string, unknown>;
  players: MigrationPlayer[];
}) {
  const config = isRecord(input.config) ? input.config : {};
  const legacyPassword = typeof config.password === "string" && config.password.length > 0 ? config.password : null;
  if (!input.existingSecret && !legacyPassword) throw new Error("No valid protected or legacy room password exists.");

  const parsedOverrides = parsePlayerOverrides(input.overrides);
  const resolvedRoles = new Map<string, Role>();
  for (const player of input.players) {
    const existing = parseProtectedRoleOverride(input.existingRoles.get(player.id));
    const legacyOverride = parsedOverrides[player.id];
    const sheetRoleChanged = legacyOverride?.lastSheetAppRole !== undefined
      && player.appRole !== legacyOverride.lastSheetAppRole;
    const legacyRole = sheetRoleChanged ? player.appRole : (legacyOverride?.appRole ?? player.appRole);
    const role = existing?.role ?? legacyRole;
    const priorRole = resolvedRoles.get(player.id);
    if (priorRole && priorRole !== role) throw new Error(`Player ${player.id} has conflicting roles.`);
    resolvedRoles.set(player.id, role);
  }
  const adminCount = [...resolvedRoles.values()].filter((role) => role === "admin").length;
  if (adminCount === 0) throw new Error("Migration requires at least one unambiguous admin.");
  const roles = [...resolvedRoles].flatMap(([playerId, role]) => (
    parseProtectedRoleOverride(input.existingRoles.get(playerId))?.role ? [] : [{ playerId, role }]
  ));

  let overridesChanged = false;
  const cleanedOverrides = Object.fromEntries(Object.entries(parsedOverrides).map(([playerId, override]) => {
    const safe = { ...override } as Record<string, unknown>;
    if ("appRole" in safe || "lastSheetAppRole" in safe) overridesChanged = true;
    delete safe.appRole;
    delete safe.lastSheetAppRole;
    return [playerId, safe];
  }));

  return {
    passwordToHash: input.existingSecret ? null : legacyPassword,
    removeLegacyPassword: legacyPassword !== null,
    roles,
    cleanedOverrides,
    overridesChanged,
  };
}

type MigrationDocumentState = { exists: boolean };

export async function applyRoomSecurityMigrationWrites<Reference>(input: {
  configRef: Reference;
  secretRef: Reference;
  overridesRef: Reference;
  roleRefs: Array<{ playerId: string; ref: Reference }>;
  plan: ReturnType<typeof planRoomSecurityMigration>;
  passwordHash: object | null;
  updatedAt: unknown;
  deletedValue: unknown;
  readAll: (refs: readonly Reference[]) => Promise<ReadonlyArray<MigrationDocumentState>>;
  create: (ref: Reference, data: Record<string, unknown>) => void;
  set: (ref: Reference, data: Record<string, unknown>) => void;
  update: (ref: Reference, data: Record<string, unknown>) => void;
}) {
  const roleRefsByPlayer = new Map(input.roleRefs.map(({ playerId, ref }) => [playerId, ref]));
  const orderedRoleRefs = input.plan.roles.map(({ playerId }) => {
    const reference = roleRefsByPlayer.get(playerId);
    if (!reference) throw new Error(`Missing role reference for ${playerId}.`);
    return reference;
  });
  const [freshConfig, freshSecret, ...freshRoles] = await input.readAll([
    input.configRef,
    input.secretRef,
    ...orderedRoleRefs,
  ]);
  if (!freshConfig?.exists) throw new Error("Room config disappeared during migration.");
  if (freshRoles.length !== orderedRoleRefs.length) throw new Error("Migration read returned an incomplete role set.");

  if (input.passwordHash && !freshSecret?.exists) {
    input.create(input.secretRef, { ...input.passwordHash, updatedAt: input.updatedAt });
  }
  input.plan.roles.forEach((role, index) => {
    if (freshRoles[index]?.exists) return;
    input.create(orderedRoleRefs[index], {
      role: role.role,
      lastSheetRole: role.role,
      updatedBy: "room-security-migration",
      updatedAt: input.updatedAt,
    });
  });
  if (input.plan.overridesChanged) input.set(input.overridesRef, input.plan.cleanedOverrides);
  if (input.plan.removeLegacyPassword) {
    input.update(input.configRef, { password: input.deletedValue, updatedAt: input.updatedAt });
  }
}
