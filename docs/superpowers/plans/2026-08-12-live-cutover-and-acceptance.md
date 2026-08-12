# Migration, Live-Cutover und Abnahme – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Karten-UX, mobile Statusseite und Rockbreaker-3D werden mit gesicherten Daten, nachweisbaren Berechtigungen, getrennten Feature-Schaltern und einem nicht-destruktiven Rückweg zuerst in genau einem dedizierten Raum live geprüft.

**Architecture:** Die neuen Collections und Konfigurationsfelder sind additiv. Eine vorab geprüfte Security-Basis trennt den Cutover von der Feature-Aktivierung. Alle datenverändernden Skripte sind zuerst Dry-run, verlangen eine exakte Raum-ID-Bestätigung und erzeugen Evidenz. Der Rückweg deaktiviert Features und lässt Legacydaten unangetastet; gehärtete Rollenregeln werden nicht auf einen unsicheren Stand zurückgedreht.

**Tech Stack:** Next.js/Vercel, Firebase Auth/Firestore, Firebase CLI/Emulator, Vitest, Playwright, PowerShell, zwei Desktopbrowser und zwei Handys für die Live-Abnahme.

## Verbindliche Ausführungsreihenfolge

1. `2026-08-12-room-auth-and-role-security.md`: serverseitiger Login, geschützte Rollen, Setup und Rules-Baseline
2. `2026-08-12-map-controls-enemy-markers.md`
3. `2026-08-12-mobile-player-status.md`: Statusoperation, QR, Handyseite und additive Rules
4. `2026-08-12-rockbreaker-3d.md`: Daten, gemeinsame Koordinaten, granulare Mutationen und Renderer
5. dieser Cutover-Plan

Der Rockbreaker-Plan darf seine schreibenden Routen erst ausführen, wenn `requireRoomMember(..., { freshRole:true })` und die Rules-Matrix nachgewiesen sind.

## Harte Stop-Gates

| Gate | Erforderlicher Nachweis | Bei Fehlen |
|---|---|---|
| G1 Quellfreigabe | dokumentierte Erlaubnis zur öffentlichen Weiterverwendung/Verteilung der Rockbreaker-Karte und Felddaten | `rockbreaker3d` bleibt in allen öffentlich erreichbaren Räumen `false` |
| G2 Projektidentität | Firebase-Projekt-ID und Hostingprojekt eindeutig dem Zielsystem zugeordnet | kein Deploy |
| G3 Regeln | vollständiger exportierter Rules-Baselinehash plus grüne Emulator-Matrix | keine Rules-Änderung, keine 3D-/Mobile-Schreibrechte |
| G4 Servergeheimnisse | Firebase Admin vollständig, `ROOM_SETUP_SECRET`/`AUTH_RATE_LIMIT_SECRET`/`MOBILE_SESSION_SECRET` >= 32 Bytes, App-Origin exakt | kein Auth-/QR-/Status-Cutover |
| G5 Datensicherung | lesbar geprüfte Sicherung des Zielraums mit Hash/Manifest | keine Migration, keine Feature-Aktivierung |
| G6 Automatisierung | Unit, Rules, Playwright, Lint und Production Build grün | kein Live-Cutover |
| G7 Testmittel | dedizierte Raum-ID, zwei Desktop-Sessions, zwei Handys, benannte Testspieler | Aktivierung verschieben |

## Geplante Betriebsdateien

- `scripts/preflight-release.ts`: read-only Prüfung von Versionen, Env-Namen, Auth-Migrationsstatus, Featuredefaults und Herkunftsgate.
- `scripts/backup-room.ts`: read-only Raumexport mit Manifest und SHA-256.
- `scripts/verify-room-backup.ts`: Struktur- und Hashprüfung.
- `scripts/set-room-features.ts`: punktuelle, bestätigungspflichtige Featureänderung.
- `docs/superpowers/evidence/2026-08-12-release-readiness.md`: lokaler Nachweis vor Deploy.
- `docs/superpowers/evidence/<date>-live-acceptance.md`: manuelle Live-Abnahme ohne Geheimnisse.
- `docs/superpowers/runbooks/rockbreaker-mobile-cutover.md`: wiederholbarer Operatorablauf.

Sicherungsdaten selbst werden nicht committed und liegen unter einem expliziten lokalen Zielverzeichnis außerhalb von `public/` und außerhalb des Repositorys.

---

### Task 1: Release-Preflight automatisieren

**Files:**
- Create: `scripts/preflight-release.ts`
- Create: `tests/release-preflight.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: Exitcode 0/1 und JSON-Zusammenfassung ohne Secretwerte.
- Consumes: Packageversionen, notwendige Env-Namen, `NOTICE.md`, Room-Featureparser.

- [ ] **Step 1: Failing Preflighttests schreiben**

Testfälle:

- fehlende Firebase-Projekt-ID: Fehlercode `FIREBASE_PROJECT_MISSING`;
- unvollständiges Admin-Credentialset: `FIREBASE_ADMIN_INCOMPLETE`;
- zu kurzes Setup-, Rate-Limit- oder Mobile-Secret: eigener `*_SECRET_WEAK`-Fehler;
- App-Origin mit Pfad oder unerwartetem Host: `APP_ORIGIN_INVALID`;
- `NOTICE.md` mit `PENDING` plus gewünschtem Rockbreaker-Public-Cutover: `SOURCE_PERMISSION_PENDING`;
- Featuredefaults sind beide `false`;
- Ausgabe enthält nur boolesche Vorhandenheitswerte, nie Schlüsselinhalt.

- [ ] **Step 2: Erwartetes Fehlschlagen bestätigen**

Run: `npm test -- --run tests/release-preflight.test.ts`
Expected: FAIL, Preflight fehlt.

- [ ] **Step 3: Preflight implementieren**

CLI:

```text
npm run release:preflight -- --target test-room --features mobileStatus,rockbreaker3d
```

Der Befehl verändert nichts. `--features rockbreaker3d` verlangt einen expliziten `APPROVED`-Status samt Referenz in der Herkunftsnotiz. Die JSON-Ausgabe wird über `--out <path>` gespeichert; Standard ist nur stdout.

`package.json` verwendet das bereits im Auth-Plan installierte `tsx`:

```json
{
  "scripts": {
    "release:preflight": "tsx scripts/preflight-release.ts"
  }
}
```

- [ ] **Step 4: Tests und Commit**

Run: `npm test -- --run tests/release-preflight.test.ts`
Expected: PASS.

```powershell
git add scripts/preflight-release.ts tests/release-preflight.test.ts package.json
git commit -m "chore: add release safety preflight"
```

### Task 2: Vollständige Raum-Sicherung und Verifikation bauen

**Files:**
- Create: `scripts/backup-room.ts`
- Create: `scripts/verify-room-backup.ts`
- Create: `tests/room-backup.test.ts`
- Modify: `.gitignore`
- Modify: `package.json`

**Scope der Sicherung:**

- `rooms/{roomId}/config/*`
- `rooms/{roomId}/state/*`
- `rooms/{roomId}/members/*`
- `rooms/{roomId}/playerStatus/*`
- `rooms/{roomId}/mobileLinks/*` nur als geschützte Rohsicherung; Werte nie in Konsolenausgabe
- `rooms/{roomId}/mapScenes/*` plus jeweilige `objects/*`
- alle weiteren direkten Untercollections, die der Admin-SDK-ListCollections-Aufruf findet.

- [ ] **Step 1: Failing Serialisierungs- und Vollständigkeitstests schreiben**

Mit In-Memory-Dokumentbaum prüfen:

- rekursive Untercollections werden nicht ausgelassen;
- Timestamp, GeoPoint, DocumentReference, Bytefelder und `undefined` werden eindeutig serialisiert/abgelehnt;
- Dokumentpfade sind sortiert;
- Manifest enthält Projekt-ID, Raum-ID, UTC-Zeit, Dokumentanzahl und SHA-256;
- Konsolenzusammenfassung enthält keine Felddaten;
- Verifier erkennt fehlendes Dokument und manipulierten Hash.

- [ ] **Step 2: Erwartetes Fehlschlagen bestätigen**

Run: `npm test -- --run tests/room-backup.test.ts`
Expected: FAIL.

- [ ] **Step 3: Backup und Verifier implementieren**

CLI:

```text
npm run room:backup -- --room <roomId> --out <absolute-directory>
npm run room:backup:verify -- --manifest <absolute-manifest-path>
```

`package.json`:

```json
{
  "scripts": {
    "room:backup": "tsx scripts/backup-room.ts",
    "room:backup:verify": "tsx scripts/verify-room-backup.ts"
  }
}
```

Sicherheitsregeln:

- Ziel muss ein expliziter absoluter Pfad sein, darf nicht Repositoryroot, Benutzerprofilroot oder Laufwerksroot sein;
- bestehende Datei/Unterordner werden nicht überschrieben;
- keine Mutation am Firebase-Projekt;
- Ausgabeordner erhält restriktive lokale Hinweise und wird über `.gitignore` ausgeschlossen;
- Verifier liest Export neu ein und vergleicht Anzahl/Hash.

- [ ] **Step 4: Tests und Commit**

Run: `npm test -- --run tests/room-backup.test.ts`
Expected: PASS.

```powershell
git add scripts/backup-room.ts scripts/verify-room-backup.ts tests/room-backup.test.ts .gitignore package.json
git commit -m "chore: back up room data before migration"
```

### Task 3: Feature-Schalter punktuell und bestätigungspflichtig ändern

**Files:**
- Create: `scripts/set-room-features.ts`
- Create: `tests/set-room-features.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Failing Mutationstests schreiben**

Testfälle:

- Standard ist Dry-run;
- `--apply` ohne `--confirm-room <gleiche-id>` schreibt nicht;
- unbekanntes Feature schreibt nicht;
- Update verwendet nur dot paths `features.mobileStatus`/`features.rockbreaker3d` und lässt `sheetUrl`, `password`, Raumname unverändert;
- Aktivierung von Rockbreaker prüft `APPROVED`-Gate;
- Deaktivierung ist auch bei fehlendem Permission-Gate möglich;
- Ergebnis liest Dokument nach Write erneut und prüft den tatsächlichen Wert.

- [ ] **Step 2: Erwartetes Fehlschlagen bestätigen**

Run: `npm test -- --run tests/set-room-features.test.ts`
Expected: FAIL.

- [ ] **Step 3: Skript implementieren**

Beispiele:

```powershell
npm run room:features -- --room klabs-live-test --set mobileStatus=true --dry-run
npm run room:features -- --room klabs-live-test --set mobileStatus=true --apply --confirm-room klabs-live-test
npm run room:features -- --room klabs-live-test --set mobileStatus=false,rockbreaker3d=false --apply --confirm-room klabs-live-test
```

`package.json` setzt `"room:features": "tsx scripts/set-room-features.ts"`.

Vorher-/Nachher-Ausgabe zeigt nur Featurewerte und Raum-ID, nie übrige Configfelder.

- [ ] **Step 4: Tests und Commit**

Run: `npm test -- --run tests/set-room-features.test.ts`
Expected: PASS.

```powershell
git add scripts/set-room-features.ts tests/set-room-features.test.ts package.json
git commit -m "chore: control room feature rollout safely"
```

### Task 4: Vollständige lokale Abnahme und Release-Evidenz

**Files:**
- Create: `docs/superpowers/evidence/2026-08-12-release-readiness.md`
- Create: `docs/superpowers/runbooks/rockbreaker-mobile-cutover.md`

- [ ] **Step 1: Saubere Buildumgebung herstellen**

Read-only prüfen: `git status --short`, Branch, HEAD, Node/npm-Version. Danach `npm ci`; keine Envwerte ausgeben.

- [ ] **Step 2: Automatisierte Matrix ausführen**

```powershell
npm test
npm run lint
npm run build
npm run build:ui-test
npm run test:ui
npx firebase-tools emulators:exec --only firestore "npm test -- --run tests/firestore-rules/mobile-and-scenes.test.ts"
```

Erwartung:

- alle Unit-/Route-/Migrationstests PASS;
- alle UI-Regressionstests PASS;
- ESLint 0 Errors und keine neuen Warnungen gegenüber Branchbaseline;
- normaler Production Build PASS;
- UI-Test-Routen im normalen Build 404;
- Rules-Matrix vollständig PASS.

Falls ein Befehl fehlschlägt: Cutover stoppt, Ursache wird behoben und die vollständige Matrix erneut ausgeführt. Einzelne grüne Teiltests ersetzen die Gesamtmatrix nicht.

- [ ] **Step 3: Security-spezifische Negativtests wiederholen**

Evidenz festhalten für:

- Viewer kann Rolle nicht selbst erhöhen;
- Viewer kann kein 3D-Objekt direkt schreiben;
- Handy-Cookie kann keinen fremden Spieler adressieren;
- widerrufene Revision wird abgelehnt;
- manipulierte Spawn-ID wird abgelehnt;
- QR-Token taucht weder URL nach Connect noch Applog auf.

- [ ] **Step 4: Release-Evidenz schreiben**

Dokument enthält Datum, Branch/Commit, exakte Befehle, Exitcodes, Testanzahlen, bekannte verbleibende Warnungen, Featuredefault `false/false` und offene Gates. Keine Credentials, QR-Links, Spielerklardaten oder Sicherungsinhalte.

- [ ] **Step 5: Cutover-Runbook finalisieren und committen**

```powershell
git add docs/superpowers/evidence/2026-08-12-release-readiness.md docs/superpowers/runbooks/rockbreaker-mobile-cutover.md
git commit -m "docs: record release readiness and cutover runbook"
```

### Task 5: Deployment mit Features aus und Security-Basis aktivieren

**Files:**
- Update during execution: Live evidence document only; no product code expected.

- [ ] **Step 1: Ziel und Deployments eindeutig prüfen**

- lokaler Commit entspricht freigegebenem Releasecommit;
- GitHub-Remote/Branch korrekt;
- Vercel-Projekt und Firebase-Projekt-ID schriftlich im Evidenzdokument;
- erforderliche Serverenvvariablen vorhanden, ohne Werte anzuzeigen;
- Test-Raum-ID existiert und ist nicht der produktive Einsatzraum;
- beide Feature-Schalter sind im Testraum explizit `false`.

- [ ] **Step 2: App deployen, Features aus lassen**

Deployment enthält Serveridentität, QR-/Status- und 3D-Code, aber fehlende/false Schalter machen neue Produktoberflächen und Routen unbenutzbar. Deployment-URL und unveränderlicher Commit werden notiert.

- [ ] **Step 3: Sichere Membership-Synchronisation live prüfen**

Mit einem Viewer und einem Commander/Admin anmelden:

- beide erhalten serverausgestellte Firebase Custom Tokens mit richtiger Raum-/Spielerbindung;
- Rollen entsprechen Sheet/Override-Merge;
- gespeichertes Raumkennwort und Hash erscheinen in keinem Firestore-Read; das eingegebene Kennwort läuft ausschließlich im TLS-geschützten Loginrequest und wird nicht gespeichert;
- direkte Clientrolle wird nicht geschrieben;
- absichtlich abweichende Identität wird abgelehnt.

- [ ] **Step 4: Firestore-Regeln deployen und erneut prüfen**

Erst nach erfolgreichem Step 3 vollständige, emulierte Rules deployen. Danach Live-Negativprobe mit Testkonten: Viewer-Selbstbeförderung und direkte Writes auf `members`, `mobileLinks`, `playerStatus`, `mapScenes/*/objects` werden abgelehnt; normale bestehende Realtime-Lesewege und freigegebene alte Boardoperationen funktionieren.

- [ ] **Step 5: Security-Kompatibilitätsrelease markieren**

Den jetzt laufenden Commit/Deployment als `secure-feature-off baseline` dokumentieren. Nach diesem Punkt darf ein Rollback nicht auf eine Version zurückgehen, die für Mitgliedschaft auf Clientwrites angewiesen ist. Bei Fehlern bleiben Features aus; korrigiert wird vorwärts oder auf diesen dokumentierten Security-Baseline-Commit.

### Task 6: Zielraum sichern, Authdaten und Status migrieren

- [ ] **Step 1: Sicherung erstellen und prüfen**

Mit absolutem, neuem lokalen Zielverzeichnis `room:backup` ausführen; unmittelbar `room:backup:verify` ausführen. Manifestpfad, Dokumentanzahl und Hash notieren, nicht den Inhalt.

- [ ] **Step 2: Migration als Dry-run ausführen**

Zuerst die sicherheitskritische Raummigration:

```powershell
npm run migrate:room-security -- --room <test-room> --dry-run
```

Sie muss genau ein Kennwort zum Hashen, die erwarteten geschützten Rollen und mindestens einen Admin melden. Unklare Rollen oder fehlendes Kennwort stoppen den Cutover.

Danach Status-Dry-run:

```powershell
npm run migrate:player-status -- --room <test-room> --dry-run
```

Zähler und jede Warnung prüfen. Ungültige Spieler-/Spawnzuordnungen werden vor Apply fachlich geklärt; keine automatische Ratenlösung.

- [ ] **Step 3: Migration bestätigt anwenden**

Zuerst Auth/Rollen:

```powershell
npm run migrate:room-security -- --room <test-room> --apply --confirm-room <test-room>
```

Direkt verifizieren: `private/auth` ist gültig, geschützte Rollen vollständig, `config/main.password` entfernt, Serverlogin funktioniert und liefert nicht `legacyAuth:true`.

Danach Status:

```powershell
npm run migrate:player-status -- --room <test-room> --apply --confirm-room <test-room>
```

Beide Dry-runs erneut ausführen. Erwartung: null Änderungen, keine neuen Fehler. Legacy-`aliveState`, `spawnState` und Boardspalten sind weiterhin vorhanden; nur Klartext-Raumkennwort und unsichere Rollenfelder sind nach verifiziertem Ersatz entfernt.

- [ ] **Step 4: Datenvergleich**

Für jeden Testspieler vergleichen: Name/ID, alive/dead, Spawn, System und Boardspalte. Statusdokumentanzahl darf bekannte Sheetspieler nicht übersteigen; unbekannte Legacy-IDs werden als Warnung dokumentiert.

### Task 7: Mobile Statusseite im Testraum aktivieren und live abnehmen

- [ ] **Step 1: Nur `mobileStatus` aktivieren**

Feature-Skript zuerst Dry-run, danach mit exakter Raum-ID bestätigen. `rockbreaker3d` bleibt `false`.

- [ ] **Step 2: Zwei persönliche QR-Verbindungen herstellen**

- Desktop A als Spieler A, Desktop B als Spieler B;
- jeweils `Handy verbinden`, QR mit eigenem Handy scannen;
- URL wechselt sofort zu `/mobile/status` und enthält kein Secret;
- jedes Handy zeigt richtigen Raum und richtigen Handle/Namen.

- [ ] **Step 3: Parallel- und Berechtigungsmatrix**

Zeitgleich:

1. Handy A `TOT`, Handy B `SET_SPAWN`/`RESPAWN`.
2. Beide Desktops müssen die korrekten eigenen Änderungen realtime sehen.
3. Keine Status-/Boardänderung des jeweils anderen Spielers darf verloren gehen.
4. Desktop Commander ändert Spieler A; Handy A zeigt es spätestens nach fünf Sekunden.
5. Manipulierte fremde Spieler-/Spawn-ID wird abgelehnt.
6. `Verbindung erneuern`: alter QR und altes Cookie werden ungültig, neuer Scan funktioniert.
7. Raum-/Board-/Karteninhalte sind auf dem Handy nicht erreichbar.

- [ ] **Step 4: Mobile Rückweg probeweise ausführen**

`mobileStatus=false` setzen: neuer Link und Statusseite werden deaktiviert, bestehendes Desktopboard bleibt nutzbar. Danach für weitere Abnahme wieder aktivieren. Diese Probe beweist den operativen Kill Switch.

### Task 8: Rockbreaker im Testraum aktivieren und live abnehmen

**Prerequisite:** Gate G1 ist `APPROVED`. Falls nicht: Task überspringen, Feature bleibt aus, Mobile kann unabhängig abgenommen werden.

- [ ] **Step 1: Szenenmetadaten und Nyx-Unterkarte einrichten**

Mit Admin im Testraum genau einen Eintrag `rockbreaker` unter Nyx sowie Metadokument `nyx--rockbreaker`, `sceneVersion:1` erstellen. Vorhandene Nyx-Maps/POIs bleiben unverändert. Danach Konfiguration erneut lesen und Parserergebnis notieren.

- [ ] **Step 2: `rockbreaker3d` aktivieren**

Feature-Skript Dry-run und bestätigt Apply. App neu laden; nur Testraum darf Rockbreaker anbieten.

- [ ] **Step 3: Zwei-Desktop-Koordinatenabnahme**

Desktop A und B öffnen Rockbreaker mit deutlich unterschiedlichen Kamerawinkeln:

1. A setzt Truppentoken auf Asteroid; beide zeigen gleiche numerische Weltposition und Asteroiden-ID.
2. B dreht/zoomt Kamera; Marker wandert perspektivisch mit, gespeicherte Koordinate bleibt gleich.
3. B verschiebt Marker auf Gürtelebene; A erhält bestätigte Position realtime.
4. A und B verschieben zwei verschiedene Objekte gleichzeitig; beide Änderungen bleiben.
5. A und B greifen dasselbe Objekt; zweite Sperre/Revision wird sichtbar abgelehnt, kein stiller Verlust.
6. Auftrags- und Feindmarker sind im Raum beweglich; Feindmarker bleibt dauerhaft voll sichtbar.
7. Grid ist beim frischen Browserprofil sichtbar, kann lokal ausgeschaltet werden.
8. Linkes Dock ist angeheftet, vertikal beweglich, ganz und abschnittsweise einklappbar.
9. Rockbreaker-Ort lässt sich auf Nyx verschieben und bleibt letzte Ebene.

- [ ] **Step 4: Fehlerpfade live prüfen**

- Offline während Drag: unbestätigte Vorschau wird markiert, bestätigte Position bleibt;
- WebGL absichtlich deaktiviert/ungeeigneter Browser: verständlicher Fehler und Rückweg;
- Viewer kann beobachten, aber keine 3D-Objekte schreiben;
- abgelaufene Sperre wird wieder verfügbar;
- absichtlich veraltete Revision zeigt Konflikt und Serverposition.

- [ ] **Step 5: Rockbreaker-Kill-Switch probeweise ausführen**

`rockbreaker3d=false`: Unterkarte/Renderer nicht mehr nutzbar, 2D-Nyx und additive Szenendaten bleiben intakt. Danach für die Schlussabnahme wieder aktivieren.

### Task 9: Bestehende 2D-Funktionen und Gesamtprodukt regressiv prüfen

- [ ] **Step 1: Bestehende Kernpfade**

- Raumlogin Viewer/Commander/Admin;
- Sheet plus Override Merge, einschließlich Sheet-Rollenänderung;
- Stanton/Pyro/Nyx-Hauptkarten und bestehende Unterkarten/POIs;
- Gruppen, Boardspalten, 2D-Tokens, Auftragsmarker, Zeichnungen;
- Notizen, Systemnotizen, Operationslog;
- Spawn und Lebensstatus auf Desktop;
- öffentlicher Missing-Room-Pfad.

- [ ] **Step 2: Realtime-Konsistenz gezielt prüfen**

Mit zwei Desktops mindestens je eine parallele Änderung an verschiedenen Spielern, verschiedenen 3D-Objekten und einer Status-/Kartenaktion durchführen. Firestore nach jeder Probe direkt lesen und mit beiden UIs vergleichen; UI allein ist kein Datennachweis.

- [ ] **Step 3: Lint-/Build-/Logkontrolle nach Live-Test**

Deploymentlogs auf 4xx/5xx, unhandled exceptions, Token-/Cookie-Leaks und Firestore permission errors prüfen. Keine Secrets in Evidenz kopieren. Lokalen Releasecommit nochmals `npm test`, `npm run lint`, `npm run build` ausführen, falls seit dem ersten Build irgendeine Korrektur committed wurde.

### Task 10: Abnahme dokumentieren und gezielt freischalten

**Files:**
- Create: `docs/superpowers/evidence/<yyyy-mm-dd>-live-acceptance.md`

- [ ] **Step 1: Ergebnis pro Kriterium dokumentieren**

Tabelle mit `bestanden`, `fehlgeschlagen`, `nicht geprüft`, Gerät/Browser, Raum, Zeit und knapper Evidenz. Screenshots dürfen nur Testhandles und keine QR-Secrets zeigen. Firestore-Nachweise nennen Pfad/Revision, nicht sensible Inhalte.

- [ ] **Step 2: Go/No-Go getrennt entscheiden**

- `mobileStatus` kann unabhängig von Rockbreaker freigegeben werden.
- `rockbreaker3d` bleibt bei fehlender Quellenfreigabe oder 3D-Konfliktfehler aus.
- Keine globale Aktivierung; nur die explizit freigegebene Einsatzraum-ID wird geändert.
- Andere Räume behalten fehlende/false Schalter.

- [ ] **Step 3: Freigabe anwenden und nachlesen**

Feature-Skript erst Dry-run, dann bestätigt Apply; Konfigurationsdokument erneut lesen. Anschließend kurzer Smoke-Test mit einem Desktop und einem bereits verbundenen Handy.

- [ ] **Step 4: Evidenz committen**

Nur bereinigtes Evidenzdokument committen, keine Backupdaten, QR-URLs oder Envwerte.

```powershell
git add docs/superpowers/evidence/<yyyy-mm-dd>-live-acceptance.md
git commit -m "docs: record Rockbreaker and mobile live acceptance"
```

## Rückweg und Störungsreaktion

### Primärer Rückweg: Feature-Schalter

Bei Funktionsfehlern zuerst im betroffenen Raum:

```powershell
npm run room:features -- --room <roomId> --set mobileStatus=false,rockbreaker3d=false --apply --confirm-room <roomId>
```

Danach tatsächliche Werte erneut lesen. Dieser Schritt ist additiv/reversibel und verändert weder Legacyboard noch neue Collections.

### Security-Regeln nicht unsicher zurückdrehen

- Gehärtete Verbote für direkte Clientwrites auf `members`, `mobileLinks`, `playerStatus` und 3D-Objekte bleiben bestehen.
- Kein Rollback auf eine App vor der dokumentierten `secure-feature-off baseline`, weil diese möglicherweise clientseitige Mitgliedschaftsschreibweisen erwartet.
- Falls eine Serverroute defekt ist: Features aus, dann vorwärts korrigieren oder die sichere Baseline deployen.

### Datenrollback

- Die Statusmigration löscht/überschreibt keine gültigen neuen Dokumente und entfernt keine Legacy-Statusfelder. Die separate Security-Migration entfernt ausschließlich Klartextkennwort und unsichere Rollenfelder, nachdem deren geschützter Ersatz verifiziert und der Raum gesichert wurde.
- Bei Statusproblem liest Desktop nach Featuredeaktivierung weiter die Legacyfelder; neue `playerStatus`-Dokumente können bis zur Analyse ungenutzt bestehen bleiben.
- Szenenobjekte sind additive Daten; Feature aus blendet sie aus. Keine Massenlöschung im Incident.
- Wiederherstellung aus Backup ist eine separate, explizit freizugebende destruktive Aktion und gehört nicht zum automatischen Rückweg.

### QR-Störung

- einzelnen Spielerlink widerrufen/erneuern;
- bei vermutetem Secret-Leak alle Testlinks revisionsbasiert widerrufen;
- bei vermutetem `MOBILE_SESSION_SECRET`-Leak Secret rotieren, wodurch alle Cookies ungültig werden; anschließend neue Links ausstellen.

## Gesamt-Abnahmekriterien

- Beide Features sind standardmäßig aus und nur raumbezogen aktivierbar.
- Security-Basis ist vor Features live und per Negativprobe nachgewiesen.
- Zielraum ist vor Migration hashverifiziert gesichert.
- Statusmigration ist idempotent; Legacydaten bleiben erhalten.
- Zwei Kameras teilen identische 3D-Weltkoordinaten, nicht persönliche Bildschirmkoordinaten.
- Parallele Änderungen an verschiedenen Objekten/Spielern bleiben erhalten; Gleichobjektkonflikte sind sichtbar.
- QR-Scan öffnet sofort die richtige Self-Service-Seite, zeigt Handle/Name und entfernt das Geheimnis.
- Handy kann ausschließlich eigenen Status und erlaubten Spawn ändern.
- 2D-Karten, Rollen, Gruppen, Notizen und Logs funktionieren weiter.
- Kill Switches für Mobile und Rockbreaker wurden praktisch getestet.
- Öffentliche Rockbreaker-Aktivierung erfolgt nur bei dokumentierter Quellenfreigabe.
