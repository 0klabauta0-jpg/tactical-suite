import { FieldValue } from "firebase-admin/firestore";
import { loadPlayersFromSheet } from "../lib/players/sheet-loader";
import { planRoomSecurityMigration } from "../lib/release/room-security-migration";
import { hashRoomPassword } from "../lib/server/password-hash";
import { parseRoomAuthSecret } from "../lib/server/room-auth-secret";
import { getScriptFirestore } from "./firebase-admin-runtime";

async function main() {
  const args = process.argv.slice(2);
  const valueAfter = (flag: string) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
  const roomId = valueAfter("--room");
  const apply = args.includes("--apply");
  if (!roomId) throw new Error("Usage: npm run migrate:room-security -- --room <id> [--apply --confirm-room <id>]");
  if (apply && valueAfter("--confirm-room") !== roomId) throw new Error("Apply requires --confirm-room with the exact same room ID.");

  const firestore = getScriptFirestore();
  const configRef = firestore.doc(`rooms/${roomId}/config/main`);
  const overridesRef = firestore.doc(`rooms/${roomId}/config/playerOverrides`);
  const secretRef = firestore.doc(`rooms/${roomId}/private/auth`);
  const [configSnapshot, overridesSnapshot, secretSnapshot, rolesSnapshot] = await Promise.all([
    configRef.get(),
    overridesRef.get(),
    secretRef.get(),
    firestore.collection(`rooms/${roomId}/roles`).get(),
  ]);
  if (!configSnapshot.exists) throw new Error("Room config does not exist.");
  const config = configSnapshot.data() ?? {};
  const sheetUrl = typeof config.sheetUrl === "string" ? config.sheetUrl : "";
  const loaded = await loadPlayersFromSheet(sheetUrl, []);
  if (loaded.source !== "sheet") throw new Error("Player source unavailable; migration stopped.");
  const plan = planRoomSecurityMigration({
    config,
    overrides: overridesSnapshot.data(),
    existingSecret: parseRoomAuthSecret(secretSnapshot.data()),
    existingRoles: new Map(rolesSnapshot.docs.map((document) => [document.id, document.data()])),
    players: loaded.players.map((player) => ({ id: player.id, name: player.name, appRole: player.appRole ?? "viewer" })),
  });
  process.stdout.write(`${JSON.stringify({
    roomId,
    mode: apply ? "apply" : "dry-run",
    passwordToHash: plan.passwordToHash !== null,
    rolesToProtect: plan.roles.length,
    removeLegacyPassword: plan.removeLegacyPassword,
    cleanLegacyOverrideRoles: plan.overridesChanged,
  })}\n`);
  if (!apply) return;

  const passwordHash = plan.passwordToHash ? await hashRoomPassword(plan.passwordToHash) : null;
  await firestore.runTransaction(async (transaction) => {
    const [freshConfig, freshSecret] = await Promise.all([transaction.get(configRef), transaction.get(secretRef)]);
    if (!freshConfig.exists) throw new Error("Room config disappeared during migration.");
    if (passwordHash && !freshSecret.exists) transaction.create(secretRef, { ...passwordHash, updatedAt: FieldValue.serverTimestamp() });
    for (const role of plan.roles) {
      const reference = firestore.doc(`rooms/${roomId}/roles/${role.playerId}`);
      const current = await transaction.get(reference);
      if (!current.exists) transaction.create(reference, {
        role: role.role,
        lastSheetRole: role.role,
        updatedBy: "room-security-migration",
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    if (plan.overridesChanged) transaction.set(overridesRef, plan.cleanedOverrides);
    if (plan.removeLegacyPassword) transaction.update(configRef, { password: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
  });

  const [verifiedConfig, verifiedSecret, verifiedRoles] = await Promise.all([
    configRef.get(), secretRef.get(), firestore.collection(`rooms/${roomId}/roles`).get(),
  ]);
  if (typeof verifiedConfig.data()?.password === "string" || !parseRoomAuthSecret(verifiedSecret.data())
    || !verifiedRoles.docs.some((document) => document.data().role === "admin")) {
    throw new Error("Room security migration verification failed.");
  }
  process.stdout.write(`${JSON.stringify({ roomId, verified: true })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
