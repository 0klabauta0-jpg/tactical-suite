# Persönliche QR-/Handy-Statusseite – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jeder angemeldete KlabsCom-Spieler kann mit einem persönlichen QR-Code ohne erneuten Login eine reduzierte Handyseite öffnen, dort Raum und eigenen Namen prüfen und ausschließlich den eigenen Lebensstatus sowie einen erlaubten Spawnpunkt ändern.

**Architecture:** Dieser Plan baut auf der serverseitigen Raum- und Rollen-Sicherheit auf. Ein kryptografischer QR-Schlüssel wird nur gehasht gespeichert und einmalig gegen eine signierte HttpOnly-Sitzung getauscht. Desktop und Handy verwenden dieselbe transaktionale Statusoperation. Kanonische Statusdokumente sind pro Spieler granular; die alten Boardfelder bleiben in der Übergangsphase kompatibel.

**Tech Stack:** Next.js App Router, React 19.2.3, Firebase Admin/Client SDK, Node `crypto`, `qrcode`, Vitest, Playwright, Firestore Rules Emulator.

## Verbindliche Voraussetzung

Vor Task 1 muss `2026-08-12-room-auth-and-role-security.md` vollständig umgesetzt und lokal verifiziert sein. Insbesondere müssen vorhanden sein:

- serverausgestellte Firebase-Sitzung mit `roomId`/`playerId`;
- `requireRoomMember(request, roomId, options?)` auf Basis geschützter Mitgliedschaft;
- server-only Firebase Admin;
- geschützte Rollenquelle und Emulator-Baseline;
- kein `NEXT_PUBLIC_SETUP_KEY`, kein öffentlich geladenes Raumkennwort, keine Clientrollewrites.

## Sicherheits- und Produktgrenzen

- Keine QR-URL enthält Raumkennwort, Firebase-Credential oder Spielerrolle.
- Ein Handy-Cookie ist auf genau `roomId`, `playerId` und `sessionRevision` begrenzt.
- Das Handy liest weder Board, Karten, Rollen, andere Spieler noch Notizen.
- Name/Handle und Raumname werden erst nach erfolgreicher Sitzungsprüfung geliefert.
- Viewer darf Desktopstatus nur für sich ändern; Commander/Admin dürfen vorhandene Desktoprechte für andere nutzen.
- Alle Statusmutationen validieren den Spawn gegen den neuesten Boardstand.
- Fehlendes/false `features.mobileStatus` deaktiviert Linkausstellung und Handyseite.
- Alte Statusfelder werden in diesem Abschnitt nicht gelöscht.
- QR-Klartext, Cookies und Statusdaten erscheinen nicht in Logs oder committeden Fixtures.

## Geplante Dateistruktur

- `lib/player-status/model.ts`: Runtime-Parser und Statusaktionen.
- `lib/player-status/transition.ts`: reine fachliche Status-/Boardtransformation.
- `lib/server/player-status-store.ts`: Firestore-Transaktion mit testbarem Adapter.
- `app/api/rooms/[roomId]/player-status/[playerId]/route.ts`: Desktop-Statusoperation.
- `lib/mobile-link/token.ts`: Tokenhash und Timing-safe-Vergleich.
- `lib/mobile-link/session.ts`: signierte, widerrufbare Cookie-Payload.
- `lib/server/mobile-link-store.ts`: Ausgabe, Prüfung und Widerruf.
- `app/api/rooms/[roomId]/mobile-link/route.ts`: persönlichen Link ausstellen/erneuern.
- `app/connect/page.tsx`: unmittelbarer Fragmenttausch ohne sichtbares Login.
- `app/api/mobile/connect/route.ts`: Token gegen HttpOnly-Cookie tauschen.
- `app/mobile/status/page.tsx`: reduzierte Handyoberfläche.
- `app/api/mobile/status/route.ts`: eigenen Status lesen/ändern.
- `app/components/mobile/mobile-link-dialog.tsx`: QR-Dialog im Desktop.
- `lib/player-status/migration.ts`: idempotente Legacy-Migration.
- `tests/*`: Status-, Token-, Route-, Rules- und UI-Tests.

---

### Task 1: Kanonisches Spielerstatusmodell und reine Übergänge definieren

**Files:**
- Create: `lib/player-status/model.ts`
- Create: `lib/player-status/transition.ts`
- Create: `tests/player-status-model.test.ts`
- Create: `tests/player-status-transition.test.ts`

**Interfaces:**
- Produces: `PlayerStatus`, `PlayerStatusAction`, `parsePlayerStatus`, `derivePlayerSystem`, `applyPlayerStatusAction`.
- Consumes: `BoardState`, Spieler-ID, aktuelle Status-/Spawndaten.

- [ ] **Step 1: Failing Modelltests schreiben**

```ts
expect(parsePlayerStatus({
  playerId: "p1", aliveStatus: "dead", systemId: "nyx", spawnGroupId: "spawn-nyx",
  revision: 3, updatedBy: "p1", updatedVia: "mobile", updatedAtMs: 100,
})).not.toBeNull();
expect(parsePlayerStatus({ playerId: "p1", aliveStatus: "unknown", revision: -1 })).toBeNull();
```

Übergangstests:

- `LIVE` ändert den Lebensstatus auf `alive`, ohne fremde Spieler zu berühren;
- `TOT` setzt `dead` und verschiebt anhand des neuesten Boards zum gewählten erlaubten Spawn;
- `RESPAWN` setzt `alive`, speichert den gewählten Spawn und ordnet den Spieler genau einmal dort zu;
- `SET_SPAWN` ändert nur die persönliche Spawnwahl;
- Spawn muss `isSpawn`, gleiches `systemId` und im neuesten Board vorhanden sein;
- unbekanntes System liefert `SYSTEM_UNASSIGNED`, keinen geratenen Default;
- alle Boardspalten verlieren Dubletten des betroffenen Spielers, andere Spieler/Reihenfolgen bleiben erhalten;
- Revision erhöht sich genau einmal.

- [ ] **Step 2: Erwartetes Fehlschlagen bestätigen**

Run: `npm test -- --run tests/player-status-model.test.ts tests/player-status-transition.test.ts`
Expected: FAIL, Module fehlen.

- [ ] **Step 3: Modell und reine Transformation implementieren**

```ts
export type PlayerStatusAction =
  | { type: "LIVE" }
  | { type: "TOT" }
  | { type: "RESPAWN"; spawnGroupId: string }
  | { type: "SET_SPAWN"; spawnGroupId: string };
```

`applyPlayerStatusAction` erhält aktuelle Daten und gibt `{ status, board, legacyAliveState, legacySpawnState, logEntry }` zurück. Es führt kein I/O aus. Das aktuelle System wird aus dem Status oder der letzten gültigen Gruppen-/Spawnzuordnung abgeleitet; ohne eindeutige Zuordnung bleibt es leer.

- [ ] **Step 4: Tests und Commit**

Run: `npm test -- --run tests/player-status-model.test.ts tests/player-status-transition.test.ts`
Expected: PASS.

```powershell
git add lib/player-status/model.ts lib/player-status/transition.ts tests/player-status-model.test.ts tests/player-status-transition.test.ts
git commit -m "feat: define canonical player status transitions"
```

### Task 2: Statusänderungen transaktional und konfliktfest speichern

**Files:**
- Create: `lib/server/player-status-store.ts`
- Create: `tests/player-status-store.test.ts`

**Interfaces:**
- Produces: `PlayerStatusTransactionStore`, `changePlayerStatus`.
- Consumes: reine Transition aus Task 1.

- [ ] **Step 1: Failing Transaktionstests mit In-Memory-Adapter schreiben**

1. liest in derselben Transaktion neuesten Boardstand und `playerStatus/{playerId}`;
2. legt fehlenden Status aus Legacyfeldern mit Revision `0` an;
3. schreibt nur persönliches Status- plus aktuelles Boarddokument;
4. aktualisiert Legacy-`aliveState[playerId]`/`spawnState[playerId]`, ohne andere Schlüssel zu verlieren;
5. parallele Aktionen für verschiedene Spieler werden gegen den jeweils neuesten Boardstand erneut angewandt;
6. ungültiger/verschwundener Spawn schreibt nichts;
7. Handyakteur darf nur `actor.playerId === targetPlayerId`;
8. Desktop-Viewer darf nur sich selbst; Commander/Admin dürfen andere;
9. `expectedRevision`-Konflikt enthält den aktuellen Status.

- [ ] **Step 2: Erwartetes Fehlschlagen bestätigen**

Run: `npm test -- --run tests/player-status-store.test.ts`
Expected: FAIL.

- [ ] **Step 3: Dienst implementieren**

Transaktion liest/schreibt:

- `rooms/{roomId}/playerStatus/{playerId}`
- `rooms/{roomId}/state/board`

Sie erhält keine gecachte Boardkopie vom Client. Firestore wiederholt bei konkurrierendem Boardupdate. `updatedBy`, `updatedVia` und Zeit werden serverseitig gesetzt. Das Operationslog wird im neuesten Boardzustand auf 1000 Einträge begrenzt.

- [ ] **Step 4: Tests und Commit**

Run: `npm test -- --run tests/player-status-store.test.ts`
Expected: PASS.

```powershell
git add lib/server/player-status-store.ts tests/player-status-store.test.ts
git commit -m "feat: transact player status updates"
```

### Task 3: Desktopstatus auf dieselbe kanonische API umstellen

**Files:**
- Create: `app/api/rooms/[roomId]/player-status/[playerId]/route.ts`
- Create: `lib/player-status/client.ts`
- Create: `tests/player-status-route.test.ts`
- Create: `tests/player-status-client.test.ts`
- Modify: `app/page.tsx`

- [ ] **Step 1: Failing Route-/Clienttests schreiben**

Pflichtfälle: 401 ohne Token, 403 fremder Viewer, 400 unbekannte Aktion, 409 Revisionskonflikt, 422 ungültiger Spawn, 200 mit bestätigtem Status. Der Client sendet genau `{ action, expectedRevision }`, nie Rolle oder vollständigen Boardstand.

- [ ] **Step 2: Erwartetes Fehlschlagen bestätigen**

Run: `npm test -- --run tests/player-status-route.test.ts tests/player-status-client.test.ts`
Expected: FAIL.

- [ ] **Step 3: Route und Client implementieren**

Die Route verwendet `requireRoomMember`; Fremdänderungen verlangen frisch serverseitig verifizierte Commander-/Adminrolle. `Cache-Control:no-store`; alle Bodies werden zur Runtime validiert.

In `app/page.tsx`:

- Collection-Listener auf `rooms/{roomId}/playerStatus` ergänzen;
- kanonischer Status gewinnt, Legacyfelder nur Fallback;
- `toggleAlive` und `setSpawn` rufen API-Client auf;
- UI zeigt Pendingzustand und rollt bei Fehler auf Listenerzustand zurück;
- `pushAll` schreibt Status für neue Aktionen nicht mehr aus veralteter Clientkopie;
- bestehende UI-Rechte bleiben, die Route ist die endgültige Grenze.

- [ ] **Step 4: Tests, Lint, Build und Commit**

Run: `npm test`
Run: `npm run lint`
Run: `npm run build`
Expected: alles PASS ohne neue Meldungen.

```powershell
git add app/api/rooms/[roomId]/player-status/[playerId]/route.ts lib/player-status/client.ts tests/player-status-route.test.ts tests/player-status-client.test.ts app/page.tsx
git commit -m "feat: use canonical status operations on desktop"
```

### Task 4: QR-Abhängigkeit, Token und signierte Sitzung implementieren

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `lib/mobile-link/token.ts`
- Create: `lib/mobile-link/session.ts`
- Create: `tests/mobile-link-token.test.ts`
- Create: `tests/mobile-link-session.test.ts`

- [ ] **Step 1: QR-Abhängigkeit installieren**

Run: `npm install qrcode@^1.5.4`
Run: `npm install --save-dev @types/qrcode@^1.5.5`
Expected: nur npm-Abhängigkeit/Lockfile; kein externer QR-Dienst.

- [ ] **Step 2: Failing Kryptografie- und Sitzungsfälle schreiben**

```ts
const token = createConnectionToken();
expect(Buffer.from(token, "base64url")).toHaveLength(32);
expect(verifyConnectionToken(token, hashConnectionToken(token))).toBe(true);
expect(verifyConnectionToken(`${token}x`, hashConnectionToken(token))).toBe(false);
```

Sitzungstests: gültige Signatur; manipulierte Raum-/Spieler-ID und Ablauf abgelehnt; `sessionRevision` wird später gegen Store geprüft; Secret unter 32 Bytes schlägt fehl; Cookie ist `httpOnly`, `secure` in Produktion, `sameSite:"strict"`, `path:"/"`.

- [ ] **Step 3: Erwartetes Fehlschlagen bestätigen**

Run: `npm test -- --run tests/mobile-link-token.test.ts tests/mobile-link-session.test.ts`
Expected: FAIL.

- [ ] **Step 4: Node-Crypto-Implementierung schreiben**

- Token: `randomBytes(32).toString("base64url")`.
- Hash: SHA-256 über decodierte Tokenbytes, hexkodiert.
- Vergleich: gleiche Bufferlänge plus `timingSafeEqual`.
- Cookie: versionierte Payload `v`, `roomId`, `playerId`, `sessionRevision`, `issuedAtMs`, `expiresAtMs` plus HMAC-SHA-256.
- Token, Cookie und Secret werden nie geloggt.

- [ ] **Step 5: Tests und Commit**

Run: `npm test -- --run tests/mobile-link-token.test.ts tests/mobile-link-session.test.ts`
Expected: PASS.

```powershell
git add package.json package-lock.json lib/mobile-link/token.ts lib/mobile-link/session.ts tests/mobile-link-token.test.ts tests/mobile-link-session.test.ts
git commit -m "feat: secure personal mobile sessions"
```

### Task 5: Persönlichen Link ausstellen, erneuern und widerrufen

**Files:**
- Create: `lib/server/mobile-link-store.ts`
- Create: `app/api/rooms/[roomId]/mobile-link/route.ts`
- Create: `tests/mobile-link-store.test.ts`
- Create: `tests/mobile-link-route.test.ts`

- [ ] **Step 1: Failing Store-/Routenfälle schreiben**

- Viewer darf eigenen Link ausstellen;
- Body kann keine fremde Spieler-ID erzwingen;
- Feature aus: `FEATURE_DISABLED` ohne Linkdaten;
- Store speichert nur Hash, nie Klartext;
- Erneuern erhöht `sessionRevision` atomar und invalidiert alt;
- DELETE widerruft/erhöht Revision;
- Antwort enthält URL nur einmalig, `Cache-Control:no-store`;
- DB-/Fehlerlogs enthalten keinen Token.

- [ ] **Step 2: Erwartetes Fehlschlagen bestätigen**

Run: `npm test -- --run tests/mobile-link-store.test.ts tests/mobile-link-route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Store und Route implementieren**

Pfad: `rooms/{roomId}/mobileLinks/{playerId}`. URL:

```text
https://<app-origin>/connect#r=<roomId>&p=<playerId>&t=<base64url-token>
```

Das Fragment erreicht keine Webserver-/Proxylogs. Die Origin wird serverseitig als exakte HTTPS-Origin validiert; lokal ist `http://localhost` erlaubt. Die Route verwendet ausschließlich `playerId` aus `requireRoomMember`.

- [ ] **Step 4: Tests und Commit**

Run: `npm test -- --run tests/mobile-link-store.test.ts tests/mobile-link-route.test.ts`
Expected: PASS.

```powershell
git add lib/server/mobile-link-store.ts app/api/rooms/[roomId]/mobile-link/route.ts tests/mobile-link-store.test.ts tests/mobile-link-route.test.ts
git commit -m "feat: issue revocable player QR links"
```

### Task 6: Scan sofort gegen HttpOnly-Sitzung tauschen

**Files:**
- Create: `app/connect/page.tsx`
- Create: `app/components/mobile/mobile-connect.tsx`
- Create: `app/api/mobile/connect/route.ts`
- Create: `tests/mobile-connect-route.test.ts`
- Create: `tests/ui/mobile-connect.spec.ts`

- [ ] **Step 1: Failing Routen-/Browsertests schreiben**

Route: gültiger Hash setzt Cookie; falscher/widerrufener Token 401 ohne Name/Raum; Feature aus 404; Antwort `no-store`.

Browser: `/connect#r=room&p=p1&t=fixture-secret` führt unmittelbar nach `/mobile/status`; finale URL/History enthält das Secret nicht.

- [ ] **Step 2: Erwartetes Fehlschlagen bestätigen**

Run: `npm test -- --run tests/mobile-connect-route.test.ts`
Run: `npm run test:ui -- tests/ui/mobile-connect.spec.ts`
Expected: Modul-/404-Fehler.

- [ ] **Step 3: Connectfluss implementieren**

Client liest Fragment einmalig, validiert nur Form/Längen, führt sofort `history.replaceState(null,"","/connect")` aus und POSTet an `/api/mobile/connect`. Route prüft Hash, Dokument, Revision, Widerruf und Feature; setzt signiertes HttpOnly-Cookie und antwortet `{ redirectTo:"/mobile/status" }`. Client nutzt `location.replace`. Fehlerseite zeigt nur `Verbindung ungültig oder widerrufen`.

Der Browsertest interceptet mit `page.route()` ausschließlich Connect-API und nachfolgendes Statusdokument. Damit prüft er realen Fragmentclient ohne Auth-Bypass in der Produktionsroute.

- [ ] **Step 4: Tests und Commit**

Run: `npm test -- --run tests/mobile-connect-route.test.ts`
Run: `npm run build:ui-test`
Run: `npm run test:ui -- tests/ui/mobile-connect.spec.ts`
Expected: PASS.

```powershell
git add app/connect/page.tsx app/components/mobile/mobile-connect.tsx app/api/mobile/connect/route.ts tests/mobile-connect-route.test.ts tests/ui/mobile-connect.spec.ts
git commit -m "feat: connect phones without a second login"
```

### Task 7: Reduzierte persönliche Handy-Statusseite bauen

**Files:**
- Create: `lib/server/mobile-session-context.ts`
- Create: `app/api/mobile/status/route.ts`
- Create: `app/mobile/status/page.tsx`
- Create: `app/components/mobile/mobile-status-controls.tsx`
- Create: `app/ui-test/mobile-status/page.tsx`
- Create: `tests/mobile-status-route.test.ts`
- Create: `tests/ui/mobile-status.spec.ts`

- [ ] **Step 1: Failing Self-Service-Tests schreiben**

- gültige Sitzung liest nur eigenen Namen, Raum, Status und erlaubte Spawns;
- fremde `playerId` im Body abgelehnt;
- unbekannte Aktion, fremdes System, Nicht-Spawn: kein Write;
- gültige vier Aktionen: eigener neuer Status;
- falsche Revision, Widerruf, Ablauf: 401 ohne Daten;
- fehlendes System: leere Spawnliste plus `systemUnassigned:true`;
- POST-Origin muss exakt App-Origin sein;
- GET/POST `no-store`.

- [ ] **Step 2: Erwartetes Fehlschlagen bestätigen**

Run: `npm test -- --run tests/mobile-status-route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Serverkontext und Route implementieren**

Jeder Request prüft Cookie-HMAC, Ablauf, Linkdokument, Revision, Widerruf, Feature und Spielerexistenz. Route nimmt keine Raum-/Spieler-ID aus URL/Body und ruft `changePlayerStatus` mit Cookie-Spieler-ID auf.

- [ ] **Step 4: Touchfreundliche UI implementieren**

Anzeige: KlabsCom, Raumname, gut sichtbarer Handle/Name, `Persönlich verbunden`, großer aktueller Status, `LEBT`, `TOT`, `RESPAWN`, erlaubte Spawnwahl, `System noch nicht zugewiesen`, reservierter leerer Bereich `Weitere Schnellaktionen`. Mindestens 48px Touchhöhe, Inlinefehler, keine Board-/Kartenlinks.

Writeantwort sofort anzeigen; zusätzlich alle fünf Sekunden `no-store` nachladen, im Hintergrundtab pausieren. Keine Poll-Writes.

- [ ] **Step 5: Reproduzierbare UI-Testseite und Browserabnahme**

Die gegatete/noindex Testseite rendert die echte Controls-Komponente mit In-Memory-Adapter und fiktiven Namen. Prüfen: Name/Raum, TOT, Spawn+RESPAWN, Mobile-Viewport, keine fremden Daten, verständlicher Fehler.

Run: `npm run build:ui-test`
Run: `npm run test:ui -- tests/ui/mobile-status.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add lib/server/mobile-session-context.ts app/api/mobile/status/route.ts app/mobile/status/page.tsx app/components/mobile/mobile-status-controls.tsx app/ui-test/mobile-status/page.tsx tests/mobile-status-route.test.ts tests/ui/mobile-status.spec.ts
git commit -m "feat: add personal mobile status controls"
```

### Task 8: Persönlichen QR-Dialog in den Desktop integrieren

**Files:**
- Create: `app/components/mobile/mobile-link-dialog.tsx`
- Create: `app/ui-test/mobile-link/page.tsx`
- Create: `tests/ui/mobile-link-dialog.spec.ts`
- Modify: `app/page.tsx`

- [ ] **Step 1: Failing Browsertest schreiben**

Mit aktivem Feature sieht Viewer `Handy verbinden`; Dialog zeigt QR, eigenen Handle und Ablauf; `Verbindung erneuern` ersetzt QR; kein fremder Name. Feature aus: kein Button.

- [ ] **Step 2: Dialog implementieren**

Komponente erhält `getIdToken()` und Fetchadapter als Props, ruft persönliche Linkroute und erzeugt QR lokal mit `QRCode.toDataURL(url,{ errorCorrectionLevel:"M",margin:2,width:320 })`. Klartextlink nur im offenen React-State, nie LocalStorage/Logs; beim Schließen verwerfen. Optionaler Kopierbutton.

Gegatete Testseite nutzt feste Token-/Fetch-Fakes, keine Produktions-Authumgehung. Integration erfolgt in persönlicher Profil-/Kopfzeilenaktion.

- [ ] **Step 3: Tests und Commit**

Run: `npm run build:ui-test`
Run: `npm run test:ui -- tests/ui/mobile-link-dialog.spec.ts`
Run: `npm test`
Run: `npm run lint`
Run: `npm run build`
Expected: alles PASS.

```powershell
git add app/components/mobile/mobile-link-dialog.tsx app/ui-test/mobile-link/page.tsx tests/ui/mobile-link-dialog.spec.ts app/page.tsx
git commit -m "feat: let players connect their phone by QR"
```

### Task 9: Bestehende Statusdaten idempotent migrieren

**Files:**
- Create: `lib/player-status/migration.ts`
- Create: `scripts/migrate-player-status.ts`
- Create: `tests/player-status-migration.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Failing Migrationstests schreiben**

- Legacywerte erzeugen fehlende Dokumente mit `updatedVia:"migration"`;
- bestehendes valides Dokument bleibt;
- ungültiger Lebenswert wird `alive` plus Warnung;
- nicht existierender Spawn ausgelassen plus Warnung;
- zweiter Lauf null Writes;
- Dry-run Zähler ohne Writes;
- Batchgröße bleibt unter Firestorelimit.

- [ ] **Step 2: Erwartetes Fehlschlagen bestätigen**

Run: `npm test -- --run tests/player-status-migration.test.ts`
Expected: FAIL.

- [ ] **Step 3: Migration und Script implementieren**

```json
{
  "scripts": {
    "migrate:player-status": "tsx scripts/migrate-player-status.ts"
  }
}
```

CLI: `--room <id> --dry-run`; Apply verlangt zusätzlich `--apply --confirm-room <gleiche-id>`. Es löscht keine Legacyfelder, loggt keine Namen/Secrets und setzt keine existierenden validen Dokumente zurück.

- [ ] **Step 4: Tests und Commit**

Run: `npm test -- --run tests/player-status-migration.test.ts`
Expected: PASS.

```powershell
git add lib/player-status/migration.ts scripts/migrate-player-status.ts tests/player-status-migration.test.ts package.json
git commit -m "feat: migrate player status documents safely"
```

### Task 10: Firestore-Regeln um Mobile/Status/3D-Serverpfade ergänzen

**Files:**
- Modify: `firestore.rules`
- Create: `tests/firestore-rules/mobile-and-scenes.test.ts`

- [ ] **Step 1: Failing Emulator-Matrix ergänzen**

| Pfad/Aktion | unauth | Viewer | Commander | Admin | Admin SDK |
|---|---:|---:|---:|---:|---:|
| `mobileLinks/*` lesen/schreiben | nein | nein | nein | nein | ja |
| `playerStatus/*` direkt schreiben | nein | nein | nein | nein | ja |
| `playerStatus/*` Desktop lesen | nein | Raumteilnehmer | Raumteilnehmer | Raumteilnehmer | ja |
| `mapScenes/*/objects/*` lesen | nein | Raumteilnehmer | Raumteilnehmer | Raumteilnehmer | ja |
| `mapScenes/*/objects/*` direkt schreiben | nein | nein | nein | nein | ja |

- [ ] **Step 2: Erwartetes Fehlschlagen gegen gesicherte Auth-Baseline bestätigen**

Run: `npx firebase-tools emulators:exec --only firestore "npm test -- --run tests/firestore-rules/mobile-and-scenes.test.ts"`
Expected: neue Pfade/Assertions zunächst FAIL.

- [ ] **Step 3: Vollständige Regeln minimal ergänzen**

Keine Baselineregel ersetzen. Admin SDK bleibt einzige Schreibgrenze für Links/Status/3D. Keine breite authentifizierte Write-Regel darf Verbote überschatten.

- [ ] **Step 4: Emulator, Gesamtsuite und Commit**

Run: Emulatorbefehl erneut
Run: `npm test`
Run: `npm run lint`
Run: `npm run build`
Expected: alles PASS.

```powershell
git add firestore.rules tests/firestore-rules/mobile-and-scenes.test.ts
git commit -m "security: enforce server-only status and mobile writes"
```

## Fertigkriterien dieses Teilplans

- QR-Scan öffnet ohne Login richtige persönliche Seite und entfernt Secret sofort.
- Seite zeigt eindeutig richtigen Handle/Name und Raum.
- Handy kann nur eigenen Status und erlaubten Spawn verändern.
- Neuer QR/Widerruf macht alten QR und bestehende Sitzung ungültig.
- Desktop und Handy verwenden dieselbe transaktionale Statusoperation.
- Migration ist Dry-run-fähig, idempotent und lässt Legacydaten stehen.
- Emulator schließt direkte Writes auf Links, Status und 3D-Objekte aus.
