# Raum-Authentifizierung und Rollen-Sicherheit – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raumkennwörter, Setup-Rechte und rollenrelevante Firestore-Daten verlassen den Browser; KlabsCom stellt nach serverseitiger Prüfung eine eng zugeordnete Firebase-Sitzung aus und verhindert direkte Selbstbeförderung.

**Architecture:** Eine Serverroute prüft Raumkennwort, Spielerhandle, Sheetdaten und geschützte Rollenquelle und stellt anschließend ein Firebase Custom Token mit Raum-/Spielerbindung aus. Der Browser liest kein Raumkennwort mehr aus Firestore und erstellt keine Auth-Accounts selbst. Rollen-Overrides liegen pro Spieler in einer server-only Collection; allgemeine Spieler-Overrides dürfen keine Autorisierungsquelle sein. Setup und Rollenänderungen laufen über Admin SDK. Eine idempotente Migration verschiebt bestehende Klartextkennwörter/Rollen vor dem Rules-Cutover.

**Tech Stack:** Next.js App Router, Firebase Admin/Client SDK, Firestore, Node `crypto.scrypt`, Vitest, Firestore Rules Emulator.

## Aktueller Risikobefund und Grenze

- `rooms/{roomId}/config/main.password` wird heute vor Authentifizierung in den Browser geladen und dort verglichen.
- Spieleraccounts werden clientseitig aus vorhersehbarer synthetischer E-Mail plus gemeinsamem Raumpasswort erstellt.
- `NEXT_PUBLIC_SETUP_KEY` einschließlich Defaultwert läuft im Browser; damit darf keine Adminrolle vergeben werden.
- `members/{uid}.role` wird aktuell vom Client geschrieben.
- `playerOverrides.appRole`/`lastSheetAppRole` liegen in einem allgemeinen Overrideobjekt und dürfen nicht als Server-Autorisierungsquelle dienen.

Dieser Plan schützt Kennwort, Setup und Rollen technisch. Das Produkt bleibt bewusst ein Team-Login: Wer das gemeinsame Raumkennwort kennt und einen fremden Handle absichtlich auswählt, kann diesen Handle weiterhin imitieren. Echte individuelle Identität würde persönliche Credentials/SSO verlangen und ist nicht Teil der bestätigten Funktion. Vor einer Nutzung außerhalb einer vertrauenswürdigen Gruppe ist dafür ein separates Auth-Design erforderlich.

## Datenmodell

Öffentliche/raumlesbare Konfiguration:

`rooms/{roomId}/config/main`

```ts
type PublicRoomConfig = {
  sheetUrl: string;
  roomName?: string;
  sheetShareUrl?: string;
  features: { rockbreaker3d: boolean; mobileStatus: boolean };
};
```

Server-only Geheimnis:

`rooms/{roomId}/private/auth`

```ts
type RoomAuthSecret = {
  version: 1;
  passwordHash: string;
  salt: string;
  keyLength: 64;
  cost: 16384;
  blockSize: 8;
  parallelization: 1;
  updatedAt: Timestamp;
};
```

Geschützter Rollenoverride:

`rooms/{roomId}/roles/{playerId}`

```ts
type ProtectedRoleOverride = {
  role?: "admin" | "commander" | "viewer";
  lastSheetRole?: "admin" | "commander" | "viewer";
  updatedBy: string;
  updatedAt: Timestamp;
};
```

Geschützte Mitgliedschaft:

`rooms/{roomId}/members/{uid}`

```ts
type RoomMember = {
  playerId: string;
  name: string;
  role: "admin" | "commander" | "viewer";
  authVersion: 1;
  verifiedAt: Timestamp;
};
```

---

### Task 1: Firebase Admin und server-only Konfiguration bereitstellen

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `lib/server/firebase-admin.ts`
- Create: `lib/server/env.ts`
- Create: `tests/server-env.test.ts`
- Create or Modify: `.env.example`

- [ ] **Step 1: Abhängigkeiten installieren**

Run: `npm install firebase-admin@^13.5.0`
Run: `npm install --save-dev @firebase/rules-unit-testing@^5.0.0 tsx`
Expected: Lockfile aktualisiert; keine Credentialdatei im Repository.

- [ ] **Step 2: Failing Envtests schreiben**

Test: vollständiges Service-Account-Set, `\\n`-Normalisierung im Private Key, unvollständiges Set schlägt geschlossen fehl, `ROOM_SETUP_SECRET` mindestens 32 Bytes, niemals `NEXT_PUBLIC_SETUP_KEY` akzeptieren.

- [ ] **Step 3: Erwartetes Fehlschlagen bestätigen**

Run: `npm test -- --run tests/server-env.test.ts`
Expected: FAIL, Module fehlen.

- [ ] **Step 4: Server-only Module implementieren**

Beide Module beginnen mit `import "server-only"`. Admininitialisierung verwendet vorhandene App, vollständige explizite Credentials oder Application Default Credentials. Parserausgaben/Fehler enthalten nur Feldnamen, nie Secretwerte.

`.env.example`:

```dotenv
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
ROOM_SETUP_SECRET=
AUTH_RATE_LIMIT_SECRET=
MOBILE_SESSION_SECRET=
NEXT_PUBLIC_APP_ORIGIN=http://localhost:3000
```

- [ ] **Step 5: Tests und Commit**

Run: `npm test -- --run tests/server-env.test.ts`
Expected: PASS.

```powershell
git add package.json package-lock.json lib/server/firebase-admin.ts lib/server/env.ts tests/server-env.test.ts .env.example
git commit -m "feat: add secure Firebase server runtime"
```

### Task 2: Öffentliche Raumkonfiguration von Auth-Geheimnissen trennen

**Files:**
- Modify: `lib/rooms/config.ts`
- Create: `lib/server/room-auth-secret.ts`
- Modify: `tests/room-config.test.ts`
- Create: `tests/room-auth-secret.test.ts`
- Modify: `app/page.tsx` nur für Typkompatibilität; Loginverhalten folgt Task 7.

- [ ] **Step 1: Failing Parsertests schreiben**

```ts
expect(parseRoomConfig({ sheetUrl: "https://sheet", roomName: "Test" })).toMatchObject({
  sheetUrl: "https://sheet",
  features: { rockbreaker3d: false, mobileStatus: false },
});
expect(parseRoomConfig({ sheetUrl: "https://sheet", password: "legacy" })).not.toHaveProperty("password");
expect(parseRoomAuthSecret({ version: 1, passwordHash: "...", salt: "...", keyLength: 64,
  cost: 16384, blockSize: 8, parallelization: 1 })).not.toBeNull();
```

- [ ] **Step 2: Erwartetes Fehlschlagen bestätigen**

Run: `npm test -- --run tests/room-config.test.ts tests/room-auth-secret.test.ts`
Expected: FAIL.

- [ ] **Step 3: Parser implementieren**

`RoomConfig` enthält kein Passwort mehr. Während des Übergangs darf Firestore noch ein unbekanntes `password`-Feld liefern; der öffentliche Parser verwirft es. Ausschließlich das server-only Modul darf `private/auth` lesen. Featurewerte defaulten `false`.

- [ ] **Step 4: Tests und Commit**

Run: `npm test -- --run tests/room-config.test.ts tests/room-auth-secret.test.ts`
Expected: PASS.

```powershell
git add lib/rooms/config.ts lib/server/room-auth-secret.ts tests/room-config.test.ts tests/room-auth-secret.test.ts app/page.tsx
git commit -m "refactor: separate room config from auth secrets"
```

### Task 3: Raumkennwort mit versioniertem scrypt-Format prüfen

**Files:**
- Create: `lib/server/password-hash.ts`
- Create: `tests/password-hash.test.ts`

**Interfaces:**
- Produces: `hashRoomPassword`, `verifyRoomPassword`, `needsPasswordRehash`.

- [ ] **Step 1: Failing Kryptografietests schreiben**

Pflichtfälle: zufällige Salts erzeugen verschiedene Hashes; korrektes Kennwort verifiziert; falsches Kennwort nicht; Vergleich timing-safe; malformed Parameter abgelehnt; zu kurzes/leeres Raumkennwort abgelehnt; ältere Parametersätze melden `needsPasswordRehash`.

- [ ] **Step 2: Erwartetes Fehlschlagen bestätigen**

Run: `npm test -- --run tests/password-hash.test.ts`
Expected: FAIL.

- [ ] **Step 3: Async-scrypt implementieren**

`randomBytes(16)` Salt, `scrypt` mit den versionierten Feldern, 64-Byte-Key, Base64url. Keine Klartextwerte in Exceptions/Logs. Limits verhindern extrem teure, aus Firestore manipulierte Parameter.

- [ ] **Step 4: Tests und Commit**

Run: `npm test -- --run tests/password-hash.test.ts`
Expected: PASS.

```powershell
git add lib/server/password-hash.ts tests/password-hash.test.ts
git commit -m "feat: hash room passwords server-side"
```

### Task 4: Geschützte Rollenquelle und bestehende Merge-Semantik bauen

**Files:**
- Create: `lib/server/protected-roles.ts`
- Create: `tests/protected-roles.test.ts`

**Interfaces:**
- Produces: `parseProtectedRoleOverride`, `resolveProtectedRole`, `ProtectedRoleStore`.
- Consumes: `parseRole` und Sheetrolle.

- [ ] **Step 1: Failing Mergetests schreiben**

- keine Override: sichere Sheetrolle;
- unbekannte Werte: Viewer;
- geschützter Override gewinnt, solange Sheetrolle gleich `lastSheetRole` ist;
- Sheetrollenänderung seit `lastSheetRole` gewinnt einmalig und aktualisiert serverseitig den Trackingwert;
- allgemeines `playerOverrides.appRole` wird vollständig ignoriert;
- Client kann `updatedBy` nicht vorgeben.

- [ ] **Step 2: Erwartetes Fehlschlagen bestätigen**

Run: `npm test -- --run tests/protected-roles.test.ts`
Expected: FAIL.

- [ ] **Step 3: Rollenmodul implementieren**

Jede Spielerrolle liegt als separates Dokument, damit Adminänderungen nicht das gesamte Overrideobjekt überschreiben. Der Resolver gibt zusätzlich eine optionale, serverseitig auszuführende Trackingmutation zurück; reine Reads führen keine versteckten Writes aus.

- [ ] **Step 4: Tests und Commit**

Run: `npm test -- --run tests/protected-roles.test.ts`
Expected: PASS.

```powershell
git add lib/server/protected-roles.ts tests/protected-roles.test.ts
git commit -m "feat: protect room role overrides"
```

### Task 5: Serverlogin und Firebase Custom Token

**Files:**
- Create: `lib/server/room-login.ts`
- Create: `lib/server/room-auth.ts`
- Create: `lib/server/login-rate-limit.ts`
- Create: `app/api/rooms/[roomId]/login/route.ts`
- Create: `tests/room-login.test.ts`
- Create: `tests/room-login-route.test.ts`
- Create: `tests/room-auth.test.ts`
- Create: `tests/login-rate-limit.test.ts`

**Interfaces:**
- Consumes: Room-Secret, Sheetloader, allgemeine nichtrollenbezogene Overrides, geschützte Rollen.
- Produces: `{ customToken, player:{ id,name,role }, room:{ name,features } }` mit `Cache-Control:no-store`.

- [ ] **Step 1: Failing Loginfälle schreiben**

1. falsches Kennwort: generische 401 ohne Hinweis auf Handleexistenz;
2. korrektes Kennwort, Handle nicht im validierten Sheet: dieselbe generische 401;
3. Sheetfehler: 503, keine Cache-Spieler als neue Authgrundlage;
4. gültig: Custom Token Claims `authVersion:1`, `roomId`, `playerId`; keine Rolle im Clientbody vertrauen;
5. unbekannte Rolle: Viewer;
6. Feature-/Raumdaten enthalten kein Kennwort, Sheetlink oder Overrides;
7. Rate-Limit-Adapter blockiert wiederholte Fehlversuche pro IP+Raum mit 429;
8. Legacyraum ohne `private/auth` kann nur im zeitlich begrenzten Migrationsmodus serverseitig das alte Configkennwort prüfen; Antwort markiert `legacyAuth:true` und erzeugt Warnlog ohne Klartext.

Autorisierungshelper:

9. fehlender/malformed Bearer Header oder ungültiges Firebase-ID-Token: 401;
10. Tokenclaim `roomId`/`playerId` passt nicht zur Route/Mitgliedschaft: 403;
11. `roles:["admin","commander"]` lehnt Viewer ab;
12. `freshRole:true` löst Sheet plus geschützten Rollenoverride neu auf, aktualisiert Mitgliedschaft serverseitig und vertraut keiner alten Claimrolle.

Rate Limit: Firestore-Adapter zählt Fehlversuche pro HMAC aus IP+Raum in einem 15-Minuten-Fenster, blockiert nach konfigurierter Schwelle, setzt nach erfolgreichem Login zurück und speichert weder Klartext-IP noch Kennwort/Handle. Dokumente liegen server-only unter `rooms/{roomId}/loginRateLimits/{keyHash}` und erhalten ein Ablaufdatum für TTL-Bereinigung.

- [ ] **Step 2: Erwartetes Fehlschlagen bestätigen**

Run: `npm test -- --run tests/room-login.test.ts tests/room-login-route.test.ts tests/room-auth.test.ts tests/login-rate-limit.test.ts`
Expected: FAIL.

- [ ] **Step 3: Dienst und Route implementieren**

Der Dienst lädt Sheet plus allgemeine Overrides, nutzt für Autorisierung ausschließlich die geschützte Rollenquelle, erstellt einen stabilen Firebase-UID aus einem serverseitigen SHA-256 von `roomId/playerId` und stellt mit Admin Auth ein Custom Token aus. Das zugehörige Mitgliedsdokument wird mit Admin SDK geschrieben. Authfehler verwenden einheitliche Texte und konstante Mindestlaufzeit; Logs enthalten nur Raum-ID, Ergebniscode und Request-ID.

Der Legacypfad ist nur aktiv, wenn das neue Secretdokument fehlt und das alte Configfeld existiert. Er wird nach erfolgreicher Migration durch Rules/fehlendes Feld unmöglich; kein Feature-Cutover darf bei `legacyAuth:true` erfolgen.

`requireRoomMember(request, roomId, { roles?, freshRole? })` dekodiert den Bearer-Token, vergleicht signierte Raum-/Spielerclaims mit dem servergeschriebenen Mitgliedsdokument und gibt eine normalisierte Mitgliedschaft zurück. Für privilegierte Mutationen ist `freshRole:true` Pflicht; der Helper lädt dann Sheet und geschützten Rollenoverride neu oder verwendet höchstens 60 Sekunden alten serverinternen Cache. Clientclaims enthalten keine maßgebliche Rolle.

- [ ] **Step 4: Tests und Commit**

Run: `npm test -- --run tests/room-login.test.ts tests/room-login-route.test.ts tests/room-auth.test.ts tests/login-rate-limit.test.ts`
Expected: PASS.

```powershell
git add lib/server/room-login.ts lib/server/room-auth.ts lib/server/login-rate-limit.ts app/api/rooms/[roomId]/login/route.ts tests/room-login.test.ts tests/room-login-route.test.ts tests/room-auth.test.ts tests/login-rate-limit.test.ts
git commit -m "feat: authenticate room players on the server"
```

### Task 6: Setup und Rollenänderungen aus dem Browser entfernen

**Files:**
- Create: `app/api/rooms/[roomId]/setup/route.ts`
- Create: `app/api/rooms/[roomId]/roles/route.ts`
- Create: `app/api/rooms/[roomId]/roles/[playerId]/route.ts`
- Create: `tests/room-setup-route.test.ts`
- Create: `tests/room-role-route.test.ts`
- Modify: `app/page.tsx`

- [ ] **Step 1: Failing Setup-/Rollenfälle schreiben**

Setup:

- kein/falscher `ROOM_SETUP_SECRET`: 401;
- bereits konfigurierter Raum: 409, kein Überschreiben;
- gültig: öffentliche Config ohne Passwort, gehashtes `private/auth`, geschützter Adminrollenoverride;
- Klartextkennwort erscheint in keinem geschriebenen öffentlichen Dokument und keiner Antwort.

Rolle:

- nur frisch verifizierter Admin darf ändern;
- Admin kann sich nicht als letzten Admin entfernen, ohne einen zweiten Admin zu benennen;
- Body akzeptiert ausschließlich `role`;
- Update schreibt ein einzelnes `roles/{playerId}`-Dokument;
- allgemeiner Viewer/Commander: 403.
- GET der Rollenübersicht verlangt gültige Raum-Sitzung und liefert nur Spieler-ID plus aufgelöste Rolle, keine Sheet-/Override-Rohdaten.

- [ ] **Step 2: Erwartetes Fehlschlagen bestätigen**

Run: `npm test -- --run tests/room-setup-route.test.ts tests/room-role-route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Routen implementieren und unsichere Clientpfade entfernen**

Aus `app/page.tsx` entfernen:

- `NEXT_PUBLIC_SETUP_KEY` und Default `tcs-setup`;
- Login-Feld zur spontanen Admin-Hochstufung;
- technische `__setup__`-Anmeldung und direkte Setup-Firestorewrites;
- direkte Rollewrites in `playerOverrides`;
- direkte `members/{uid}.role`-Writes.

Setupformular sendet den vom Operator eingegebenen Setupschlüssel ausschließlich per TLS an die Serverroute. Rollen-UI lädt die geschützte Rollenübersicht und ruft mit Firebase-ID-Token die Rollenroute auf. Allgemeine Profil-Overrides bleiben fachlich getrennt und beeinflussen niemals `canWriteBoard`/`canAdministerRoom`.

- [ ] **Step 4: Tests, Lint, Build und Commit**

Run: `npm test -- --run tests/room-setup-route.test.ts tests/room-role-route.test.ts`
Run: `npm run lint`
Run: `npm run build`
Expected: alles PASS.

```powershell
git add app/api/rooms/[roomId]/setup/route.ts app/api/rooms/[roomId]/roles/route.ts app/api/rooms/[roomId]/roles/[playerId]/route.ts tests/room-setup-route.test.ts tests/room-role-route.test.ts app/page.tsx
git commit -m "security: move setup and role writes server-side"
```

### Task 7: Clientlogin vollständig auf Custom Token umstellen

**Files:**
- Create: `lib/auth/room-login-client.ts`
- Create: `tests/room-login-client.test.ts`
- Modify: `app/page.tsx`

- [ ] **Step 1: Failing Clienttests schreiben**

- sendet `{ handle,password }` nur an die Raumloginroute;
- signiert mit zurückgegebenem Custom Token via `signInWithCustomToken`;
- speichert Raumkennwort weder State über Login hinaus noch LocalStorage;
- zeigt Sheet-/Authfehler verständlich, aber ohne Handleenumeration;
- vertraut Rolle/Player nur aus signierter Serverantwort/Sitzungsabgleich;
- verwendet nicht `signInWithEmailAndPassword` oder `createUserWithEmailAndPassword`.

- [ ] **Step 2: Erwartetes Fehlschlagen bestätigen**

Run: `npm test -- --run tests/room-login-client.test.ts`
Expected: FAIL.

- [ ] **Step 3: Client und UI umstellen**

`loadRoomConfig` dient nur noch Raumname/Features nach Auth bzw. einer kennwortfreien Existenzanzeige. Alle Login-/Auto-Loginpfade verwenden dieselbe Serverroute. Nach `signInWithCustomToken` wird das Mitgliedsdokument gelesen und Spieler-ID/UID-Abgleich geprüft, bevor Boardlistener starten. Die Rollenübersicht kommt über die geschützte GET-Route und ersetzt `appRole` nur für UI-Darstellung; Schreibrechte des aktuellen Nutzers stammen ausschließlich aus der verifizierten Mitgliedschaft.

- [ ] **Step 4: Regressionssuite und Commit**

Run: `npm test`
Run: `npm run lint`
Run: `npm run build`
Expected: PASS; Repositorysuche findet keine aktive Client-Account-Erstellung und kein `NEXT_PUBLIC_SETUP_KEY`.

```powershell
git add lib/auth/room-login-client.ts tests/room-login-client.test.ts app/page.tsx
git commit -m "security: use server-issued room sessions"
```

### Task 8: Bestehende Kennwörter und Rollen idempotent migrieren

**Files:**
- Create: `lib/server/room-security-migration.ts`
- Create: `scripts/migrate-room-security.ts`
- Create: `tests/room-security-migration.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Failing Migrationstests schreiben**

- Dry-run zeigt `passwordToHash`, `rolesToProtect`, `legacyFieldsToRemove`, schreibt nichts;
- Apply erzeugt Secret zuerst, liest/verifiziert Hash, erzeugt Rollen, prüft mindestens einen Admin und entfernt erst danach `config/main.password` sowie rollenrelevante Felder aus allgemeinen Overrides;
- bestehendes valides Secret/Role gewinnt und wird nicht überschrieben;
- fehlendes Kennwort oder uneindeutige Rollen stoppt vor Löschung;
- zweiter Lauf ergibt null Änderungen;
- unbekannte Rolle wird nicht automatisch Admin, sondern Warnung/Viewer;
- kein Klartextkennwort in Konsole/Evidenz.

- [ ] **Step 2: Erwartetes Fehlschlagen bestätigen**

Run: `npm test -- --run tests/room-security-migration.test.ts`
Expected: FAIL.

- [ ] **Step 3: Migration und npm-Skript implementieren**

```json
{
  "scripts": {
    "migrate:room-security": "tsx scripts/migrate-room-security.ts"
  }
}
```

CLI:

```text
npm run migrate:room-security -- --room <roomId> --dry-run
npm run migrate:room-security -- --room <roomId> --apply --confirm-room <roomId>
```

Apply setzt eine vorher verifizierte Raumsicherung voraus; der Operatorpfad und die Reihenfolge stehen im Cutover-Plan.

- [ ] **Step 4: Tests und Commit**

Run: `npm test -- --run tests/room-security-migration.test.ts`
Expected: PASS.

```powershell
git add lib/server/room-security-migration.ts scripts/migrate-room-security.ts tests/room-security-migration.test.ts package.json
git commit -m "security: migrate room secrets and roles"
```

### Task 9: Vollständige Firestore-Regeln sichern und Authgrenzen emulieren

**Files:**
- Create or Modify after export: `firestore.rules`
- Create or Modify: `firebase.json`
- Create: `tests/firestore-rules/room-auth.test.ts`
- Create: `docs/superpowers/evidence/firestore-rules-baseline.md`

- [ ] **Step 1: Deployten vollständigen Regelstand read-only sichern**

Projekt-ID, Ruleset-ID/Hash und Exportweg dokumentieren. Wenn der aktuelle vollständige Stand nicht eindeutig beschafft werden kann: stoppen; keine Teilregeln deployen.

- [ ] **Step 2: Failing Emulator-Matrix schreiben**

| Aktion | unauth | Raum-Viewer | Commander | Admin | Admin SDK |
|---|---:|---:|---:|---:|---:|
| `config/main.password` lesen | nein/nicht vorhanden | nein/nicht vorhanden | nein | nein | ja |
| `private/*` lesen/schreiben | nein | nein | nein | nein | ja |
| `roles/*` schreiben | nein | nein | nein | nein | ja |
| `members/*` schreiben | nein | nein | nein | nein | ja |
| `loginRateLimits/*` lesen/schreiben | nein | nein | nein | nein | ja |
| allgemeine Overrides mit Rollenwirkung | keine Autorisierungswirkung | keine | keine | keine | n/a |
| bestehende erlaubte Boardlesewege | nein | ja | ja | ja | ja |

Zusatz: Tokenclaim für Raum A darf nicht Raum B lesen; manipuliertes `members.role`-Write wird abgelehnt.

- [ ] **Step 3: Baselinefehler bestätigen, Regeln minimal härten**

Run: `npx firebase-tools emulators:exec --only firestore "npm test -- --run tests/firestore-rules/room-auth.test.ts"`
Expected vor Änderung: mindestens neue Authgrenzen FAIL. Danach vollständige Baseline nur gezielt ergänzen.

- [ ] **Step 4: Gesamte Matrix, Suite und Commit**

Run: Emulatorbefehl erneut
Run: `npm test`
Run: `npm run lint`
Run: `npm run build`
Expected: alles PASS.

```powershell
git add firestore.rules firebase.json tests/firestore-rules/room-auth.test.ts docs/superpowers/evidence/firestore-rules-baseline.md
git commit -m "security: enforce room auth and role boundaries"
```

## Fertigkriterien dieses Teilplans

- Browser erhält nie das gespeicherte Raumkennwort, Hash/Salt oder Setupsecret.
- Loginaccount wird nicht mehr vom Browser erstellt; Firebase-Sitzung stammt vom Server.
- Setup-Key ist nicht im Clientbundle und kann keinen bestehenden Raum überschreiben.
- Allgemeine Firestore-Overrides können keine Schreibrolle erzeugen.
- Rollenänderungen und Mitgliedsdokumente werden nur per Admin SDK geschrieben.
- Sheetrollenänderung/geschützter Override folgen der getesteten Merge-Semantik.
- Legacykennwort/-rollen sind erst nach verifiziertem Ersatz entfernt; Migration ist idempotent.
- Rules-Emulator verhindert Selbstbeförderung und raumübergreifenden Zugriff.
- Die verbleibende Team-Login-Grenze (bewusste Handle-Imitation bei bekanntem gemeinsamem Kennwort) ist ausdrücklich dokumentiert.
