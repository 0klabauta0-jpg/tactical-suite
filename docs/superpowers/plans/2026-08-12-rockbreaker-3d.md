# Native Rockbreaker-3D-Unterkarte – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rockbreaker wird als letzte, verschiebbare Nyx-Unterkarte nativ in KlabsCom gerendert; alle taktischen Objekte besitzen gemeinsame Weltkoordinaten und werden granular sowie konfliktfest synchronisiert.

**Architecture:** Unveränderliche Asteroidendaten, reine Koordinatenlogik, validierte Szenenobjekte, serverseitige Mutationen und der Three.js-Renderer bleiben getrennt. Die Kamera ist ausschließlich lokaler Zustand. Realtime-Lesen erfolgt pro Objekt aus Firestore; Sperren und bestätigte Änderungen laufen über serverseitig autorisierte Transaktionen. Bestehende 2D-Karten bleiben unverändert und werden über eine kleine Rendererauswahl ergänzt.

**Tech Stack:** Next.js 16.1.6, React 19.2.3, TypeScript 5, Firebase/Firestore 12.9.0, Three.js, Vitest, Playwright.

## Voraussetzungen und Grenzen

- Dieser Plan setzt `2026-08-12-room-auth-and-role-security.md` vollständig voraus: Firebase Admin, serverausgestellte Raum-Sitzung, geschützte Mitgliedschaft und `requireRoomMember` müssen vor den 3D-Schreibendpunkten stehen. Die neuen Objektpfade werden anschließend durch Task 10 aus `2026-08-12-mobile-player-status.md` in die gesicherte Rules-Baseline aufgenommen.
- Die Datenquelle ist `C:\Users\bjoer\Downloads\rockbreaker-3d-standalone-Taktik\rockbreaker-3d-standalone.html`.
- Die Standalone-Datei und ihre eingebettete Three.js-r137-Bibliothek werden nicht kopiert.
- Öffentliche Aktivierung bleibt gesperrt, bis die Weiterverwendungs- und Verteilungsfreigabe für Karte und Felddaten dokumentiert ist.
- Eine Three.js-Einheit entspricht exakt einem Kilometer; Zentrum ist `(0, 0, 0)`; `sceneVersion` startet bei `1`.
- Nur bestätigte Serverpositionen sind gemeinsamer Zustand. Kamera, Hover, Drag-Vorschau, Dock und Gridwahl bleiben lokal.
- Bestehende Karteneinträge ohne Rendererfeld bleiben `image2d`.
- Jede Verhaltensänderung beginnt mit einem fehlschlagenden Test.

## Geplante Dateistruktur

- `lib/board/collections.ts`: rückwärtskompatibler Kartentyp und Parser.
- `lib/rooms/config.ts`: Feature-Schalter mit sicheren Defaults.
- `scripts/extract-rockbreaker-field.mjs`: reproduzierbare Extraktion der eingebetteten Felddaten.
- `lib/rockbreaker/field.v1.json`: ausschließlich die normalisierten 944 Asteroiden.
- `lib/rockbreaker/NOTICE.md`: Herkunft, Hash und Freigabestatus.
- `lib/rockbreaker/field.ts`: Integritätsprüfung und stabile IDs.
- `lib/rockbreaker/coordinates.ts`: gemeinsame Weltpunkte, Anker und Strahl-Schnittpunkte.
- `lib/rockbreaker/scene-objects.ts`: Runtime-Parser und deterministische Objekt-IDs.
- `lib/server/map-scene-store.ts`: transaktionale Anlage-, Sperr-/Änderungslogik mit testbarem Adapter.
- `app/api/rooms/[roomId]/map-scenes/[sceneId]/route.ts`: Szenenmetadaten serverseitig initialisieren.
- `app/api/rooms/[roomId]/map-scenes/[sceneId]/objects/route.ts`: Objekte validiert anlegen.
- `app/api/rooms/[roomId]/map-scenes/[sceneId]/objects/[objectId]/lock/route.ts`: Sperre erwerben/erneuern.
- `app/api/rooms/[roomId]/map-scenes/[sceneId]/objects/[objectId]/route.ts`: Position ändern/löschen.
- `lib/map-scene/client.ts`: Realtime-Listener und API-Client.
- `app/components/map/rockbreaker-map.tsx`: Three.js-Lifecycle und Eingabesteuerung.
- `app/components/map/map-renderer.tsx`: Auswahl `image2d`/`rockbreaker3d`.
- `tests/rockbreaker-*.test.ts`: Datensatz-, Parser-, Koordinaten- und Konflikttests.
- `tests/ui/rockbreaker-map.spec.ts`: Browserabnahme mit zwei unabhängigen Kameras.

---

### Task 1: Kartenschema rückwärtskompatibel um den Renderer erweitern

**Files:**
- Modify: `lib/board/collections.ts`
- Modify: `tests/board-collections.test.ts`

**Interfaces:**
- Produces: `MapRendererKind`, `BoardMapEntry.renderer`, `BoardMapEntry.sceneId`.
- Consumes: bestehende `parseMapEntries` sowie `RoomFeatures` aus dem vorgeschalteten Auth-/Rollenplan.

- [ ] **Step 1: Failing Tests schreiben**

```ts
it("defaults old maps to image2d and accepts a valid Rockbreaker scene", () => {
  expect(parseMapEntries([{ id: "main", label: "Nyx", image: "/nyx.png" }])[0]).toMatchObject({
    renderer: "image2d",
  });
  expect(parseMapEntries([{
    id: "rockbreaker", label: "Rockbreaker", image: "", renderer: "rockbreaker3d",
    sceneId: "nyx--rockbreaker", x: 0.4, y: 0.6,
  }])[0]).toMatchObject({ renderer: "rockbreaker3d", sceneId: "nyx--rockbreaker" });
});

```

- [ ] **Step 2: Erwartetes Fehlschlagen bestätigen**

Run: `npm test -- --run tests/board-collections.test.ts`
Expected: FAIL, weil `renderer` und `sceneId` fehlen.

- [ ] **Step 3: Minimale Typen und Parser implementieren**

```ts
export type MapRendererKind = "image2d" | "rockbreaker3d";
export type BoardMapEntry = {
  id: string;
  label: string;
  image: string;
  renderer: MapRendererKind;
  sceneId?: string;
  x?: number;
  y?: number;
};

```

Parserregeln:

- fehlendes/ungültiges `renderer` wird `image2d`;
- `rockbreaker3d` ist nur gültig, wenn `sceneId` eine nichtleere Zeichenkette ist;
- ein 3D-Eintrag darf `image: ""` besitzen, ein 2D-Eintrag benötigt weiter ein nichtleeres Bild;
- zusätzliche Firestore-Felder werden ignoriert.

- [ ] **Step 4: Tests und Commit**

Run: `npm test -- --run tests/board-collections.test.ts`
Expected: PASS.

```powershell
git add lib/board/collections.ts tests/board-collections.test.ts
git commit -m "feat: validate map renderers"
```

### Task 2: Rockbreaker-Felddaten reproduzierbar extrahieren und prüfen

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `scripts/extract-rockbreaker-field.mjs`
- Create: `lib/rockbreaker/field.v1.json`
- Create: `lib/rockbreaker/field.ts`
- Create: `lib/rockbreaker/NOTICE.md`
- Create: `tests/rockbreaker-field.test.ts`

**Interfaces:**
- Produces: `ROCKBREAKER_SCENE_VERSION`, `AsteroidRecord`, `loadRockbreakerField()`.
- Consumes: eingebettetes `const FIELD = {...};` aus der bestätigten lokalen Quelldatei.

- [ ] **Step 1: Abhängigkeiten deklarieren**

Run: `npm install three@^0.180.0`
Run: `npm install --save-dev @types/three@^0.180.0`
Expected: `package.json` und Lockfile enthalten genau eine npm-basierte Three.js-Version; kein CDN und kein eingebettetes Minifikat.

- [ ] **Step 2: Failing Integritätstest schreiben**

```ts
import { describe, expect, it } from "vitest";
import { loadRockbreakerField, ROCKBREAKER_SCENE_VERSION } from "@/lib/rockbreaker/field";

describe("Rockbreaker field v1", () => {
  it("contains exactly 944 stable and finite asteroids", () => {
    const field = loadRockbreakerField();
    expect(ROCKBREAKER_SCENE_VERSION).toBe(1);
    expect(field).toHaveLength(944);
    expect(new Set(field.map((asteroid) => asteroid.id)).size).toBe(944);
    expect(field.every((asteroid) => asteroid.position.every(Number.isFinite))).toBe(true);
    expect(field.every((asteroid) => asteroid.scale.every((n) => Number.isFinite(n) && n > 0))).toBe(true);
  });
});
```

- [ ] **Step 3: Erwartetes Fehlschlagen bestätigen**

Run: `npm test -- --run tests/rockbreaker-field.test.ts`
Expected: FAIL, Modul und Datendatei fehlen.

- [ ] **Step 4: Extraktionsskript erstellen und einmalig ausführen**

Skriptvertrag:

```text
node scripts/extract-rockbreaker-field.mjs <source-html> <target-json>
```

Das Skript:

1. liest die HTML-Datei als UTF-8;
2. isoliert den JSON-Wert hinter `const FIELD =` bis zum zugehörigen Semikolon, ohne JavaScript auszuführen;
3. validiert `FIELD.roids` und verlangt exakt 944 Einträge;
4. erzeugt in Quellreihenfolge IDs `rb-v1-0001` bis `rb-v1-0944`;
5. schreibt nur `{ id, meshIndex, position:[x,y,z], scale:[x,y,z] }`;
6. sortiert Objektschlüssel deterministisch und beendet sich bei nicht endlichen Zahlen mit Exitcode 1;
7. gibt SHA-256 von Quelle und Ergebnis aus.

Run:

```powershell
node scripts/extract-rockbreaker-field.mjs "C:\Users\bjoer\Downloads\rockbreaker-3d-standalone-Taktik\rockbreaker-3d-standalone.html" "lib\rockbreaker\field.v1.json"
```

Expected: `944 asteroids`, Quellhash und Ausgabehash; Exitcode 0.

- [ ] **Step 5: Runtime-Loader und Herkunftsnotiz implementieren**

`loadRockbreakerField()` validiert das importierte JSON erneut und wirft `InvalidRockbreakerFieldError`, statt eine teilweise Szene zu liefern. `NOTICE.md` dokumentiert:

- lokalen Quelldateinamen, Datum und beide Hashes;
- dass nur Felddaten und fachliche Maße übernommen wurden;
- `Public redistribution permission: PENDING` bis zum dokumentierten Nachweis;
- dass `PENDING` die öffentliche Feature-Aktivierung blockiert.

- [ ] **Step 6: Reproduzierbarkeit testen und committen**

Run: Extraktionsbefehl erneut; danach `git diff --exit-code -- lib/rockbreaker/field.v1.json`.
Expected: keine Änderung.
Run: `npm test -- --run tests/rockbreaker-field.test.ts`
Expected: PASS.

```powershell
git add package.json package-lock.json scripts/extract-rockbreaker-field.mjs lib/rockbreaker/field.v1.json lib/rockbreaker/field.ts lib/rockbreaker/NOTICE.md tests/rockbreaker-field.test.ts
git commit -m "feat: import validated Rockbreaker asteroid field"
```

### Task 3: Gemeinsame 3D-Weltpunkte und Anker als reine Logik

**Files:**
- Create: `lib/rockbreaker/coordinates.ts`
- Create: `tests/rockbreaker-coordinates.test.ts`

**Interfaces:**
- Produces: `Vec3`, `WorldPoint`, `Ray3`, `AsteroidHit`, `worldPointFromHit`, `intersectBeltPlane`, `resolveWorldPoint`.
- Consumes: gemeinsame Einheit Kilometer, Gürtelebene `y = 0`.

- [ ] **Step 1: Failing Tests für kameraunabhängige Weltpunkte schreiben**

```ts
it("stores the same global point independent of camera origin", () => {
  const first = intersectBeltPlane({ origin: [0, 10, 10], direction: [0, -1, -1] });
  const second = intersectBeltPlane({ origin: [10, 20, 20], direction: [-10, -20, -20] });
  expect(first).toEqual([0, 0, 0]);
  expect(second).toEqual([0, 0, 0]);
});

it("stores a true asteroid-local anchor plus the common world position", () => {
  expect(worldPointFromHit({
    asteroidId: "rb-v1-0007", asteroidWorldMatrix: translationMatrix(10, 2, -4),
    hitPoint: [10.5, 2.25, -4.75],
  })).toEqual({
    x: 10.5, y: 2.25, z: -4.75, sceneVersion: 1,
    anchor: { kind: "asteroid", asteroidId: "rb-v1-0007", local: [0.5, 0.25, -0.75] },
  });
});
```

Zusatztests: paralleler Strahl zur Gürtelebene liefert `null`; nicht endliche Werte werden verworfen; `resolveWorldPoint` bevorzugt Asteroidentreffer und verwendet nur ersatzweise die Ebene. Ein gedrehter und skalierter Asteroid beweist, dass der lokale Anker über die inverse Instance-Weltmatrix berechnet und nicht nur der Mittelpunkt subtrahiert wird. `worldPointFromAnchor` transformiert denselben lokalen Anker wieder auf den ursprünglichen Weltpunkt.

- [ ] **Step 2: Erwartetes Fehlschlagen bestätigen**

Run: `npm test -- --run tests/rockbreaker-coordinates.test.ts`
Expected: FAIL, Modul fehlt.

- [ ] **Step 3: Reine Koordinatenfunktionen implementieren**

```ts
export type Vec3 = readonly [number, number, number];
export type Mat4 = readonly [number, number, number, number, number, number, number, number,
  number, number, number, number, number, number, number, number];
export type WorldAnchor =
  | { kind: "asteroid"; asteroidId: string; local: Vec3 }
  | { kind: "beltPlane" };
export type WorldPoint = {
  x: number; y: number; z: number; sceneVersion: 1; anchor: WorldAnchor;
};
```

`intersectBeltPlane` normalisiert den Strahl nicht zwingend, sondern berechnet `t = -origin.y / direction.y`, verlangt `t >= 0` und rundet nicht. Für Asteroiden wird der Treffpunkt mit der invertierten vollständigen Instance-Weltmatrix (Translation, Rotation und Skalierung) in lokale Koordinaten transformiert. Rundung findet nur in der visuellen Anzeige statt; Firestore behält die vollen endlichen Zahlen.

- [ ] **Step 4: Tests und Commit**

Run: `npm test -- --run tests/rockbreaker-coordinates.test.ts`
Expected: PASS.

```powershell
git add lib/rockbreaker/coordinates.ts tests/rockbreaker-coordinates.test.ts
git commit -m "feat: define shared Rockbreaker world coordinates"
```

### Task 4: Szenenobjekte strikt validieren und IDs stabilisieren

**Files:**
- Create: `lib/rockbreaker/scene-objects.ts`
- Create: `tests/rockbreaker-scene-objects.test.ts`

**Interfaces:**
- Produces: `SceneObject`, `parseSceneObject`, `groupTokenObjectId`, `orderMarkerObjectId`.
- Consumes: `WorldPoint` aus Task 3.

- [ ] **Step 1: Failing Parser- und ID-Tests schreiben**

```ts
expect(groupTokenObjectId("g/a")).toBe("groupToken--g%2Fa");
expect(orderMarkerObjectId("g/a")).toBe("orderMarker--g%2Fa");

expect(parseSceneObject({
  type: "groupToken", groupId: "g1", systemId: "nyx", mapId: "rockbreaker",
  sceneVersion: 1, color: "#0ea5e9", position: validPoint,
  revision: 2, createdBy: "u1", createdAtMs: 1, updatedBy: "u1", updatedAtMs: 2,
})).not.toBeNull();
expect(parseSceneObject({ type: "groupToken", position: { x: NaN } })).toBeNull();
```

Testfälle decken alle Typen ab: `groupToken`, `orderMarker`, `enemyMarker`, `point`, `line`. Linien brauchen `start` und `end`; Gruppen-/Auftragsobjekte brauchen `groupId`; Feindmarker brauchen `kind`; unbekannte Felder oder Typen erzeugen keinen teilweise gültigen Wert.

- [ ] **Step 2: Erwartetes Fehlschlagen bestätigen**

Run: `npm test -- --run tests/rockbreaker-scene-objects.test.ts`
Expected: FAIL, Modul fehlt.

- [ ] **Step 3: Diskriminierte Union implementieren**

Gemeinsame Regeln:

- `sceneVersion === 1`, `revision` ist ganze Zahl `>= 0`;
- `systemId === "nyx"`, `mapId === "rockbreaker"` für diese Szene;
- Farbe entspricht `^#[0-9a-fA-F]{6}$`;
- Zeitstempel werden an der Firestore-Grenze in `createdAtMs`/`updatedAtMs` normalisiert;
- Lockfelder sind optional: `lockedByUid`, `lockRevision`, `lockExpiresAtMs`;
- `opacity` an Feindmarkern wird toleriert, aber nie in den Domänenwert übernommen.

- [ ] **Step 4: Tests und Commit**

Run: `npm test -- --run tests/rockbreaker-scene-objects.test.ts`
Expected: PASS.

```powershell
git add lib/rockbreaker/scene-objects.ts tests/rockbreaker-scene-objects.test.ts
git commit -m "feat: validate Rockbreaker scene objects"
```

### Task 5: Sperren und revisionsgeprüfte Mutationen als testbaren Dienst bauen

**Files:**
- Create: `lib/server/map-scene-store.ts`
- Create: `tests/map-scene-store.test.ts`

**Interfaces:**
- Produces: `MapSceneTransactionStore`, `createSceneObject`, `acquireSceneObjectLock`, `commitSceneObjectMove`, `deleteSceneObject`.
- Consumes: validierte `SceneObject`, serverseitige `nowMs`, autorisierte Akteur-ID/Rolle.

- [ ] **Step 1: Failing Konflikttests mit In-Memory-Adapter schreiben**

Pflichtfälle:

1. Gruppe/Auftrag erhalten serverseitig deterministische ID; Feind/Punkt/Linie eine kollisionssichere ID.
2. Anlage prüft Gruppe, System, Karte und Szenenversion gegen neuesten Board-/Szenenstand.
3. Zweite Anlage derselben Gruppe/Art liefert bestehendes Objekt statt Dublette.
4. Admin/Commander erwirbt freie Sperre für 15 Sekunden.
5. Derselbe Akteur darf die Sperre erneuern.
6. Andere Person wird vor Ablauf mit `OBJECT_LOCKED` abgelehnt.
7. Abgelaufene Sperre kann übernommen werden.
8. Commit mit erwarteter Revision `4` schreibt ausschließlich dieses Dokument als Revision `5`.
9. Commit nach konkurrierender Revision `5` wird `REVISION_CONFLICT` und enthält aktuelle Serverposition.
10. Zwei Transaktionen auf verschiedenen Objekt-IDs beeinflussen sich nicht.
11. Viewer wird vor jedem Storezugriff `FORBIDDEN`.

Beispielvertrag:

```ts
await commitSceneObjectMove(store, {
  roomId: "room", sceneId: "nyx--rockbreaker", objectId: "groupToken--g1",
  actor: { uid: "commander", role: "commander" },
  expectedRevision: 4, expectedLockRevision: 2, position: nextPoint, nowMs: 10_000,
});
```

- [ ] **Step 2: Erwartetes Fehlschlagen bestätigen**

Run: `npm test -- --run tests/map-scene-store.test.ts`
Expected: FAIL, Dienst fehlt.

- [ ] **Step 3: Dienst ohne Firebase-Kopplung implementieren**

Der Adapter stellt `runObjectTransaction(path, callback)` sowie read-only Zugriff auf Szenenmetadaten und die betroffene Gruppe bereit. Der Callback erhält genau ein Objekt und darf nur dieses Objekt zurückschreiben. `createSceneObject` setzt ID, Autor, Zeit und Revision serverseitig. `commitSceneObjectMove` prüft Rolle, Lockeigentümer, Sperrablauf, Revision, Szenenversion und vollständigen `WorldPoint` erneut. Serverzeit kommt als Parameter aus der Route und wird im Firestore-Adapter durch `Timestamp.now()` ersetzt.

- [ ] **Step 4: Tests und Commit**

Run: `npm test -- --run tests/map-scene-store.test.ts`
Expected: PASS.

```powershell
git add lib/server/map-scene-store.ts tests/map-scene-store.test.ts
git commit -m "feat: guard 3d object moves with locks and revisions"
```

### Task 6: Autorisierte Firestore-Routen und granularer Realtime-Client

**Files:**
- Create: `lib/server/firestore-map-scene-store.ts`
- Create: `app/api/rooms/[roomId]/map-scenes/[sceneId]/route.ts`
- Create: `app/api/rooms/[roomId]/map-scenes/[sceneId]/objects/route.ts`
- Create: `app/api/rooms/[roomId]/map-scenes/[sceneId]/objects/[objectId]/lock/route.ts`
- Create: `app/api/rooms/[roomId]/map-scenes/[sceneId]/objects/[objectId]/route.ts`
- Create: `lib/map-scene/client.ts`
- Create: `tests/map-scene-routes.test.ts`
- Create: `tests/map-scene-client.test.ts`

**Interfaces:**
- Consumes: `requireRoomMember(request, roomId)` aus dem Mobile-/Security-Plan, Firebase Admin, Firebase Client SDK.
- Produces: `subscribeSceneObjects`, `ensureMapScene`, `createSceneObject`, `lockSceneObject`, `moveSceneObject`, `removeSceneObject`.

- [ ] **Step 1: Failing Route-Tests schreiben**

Routen werden über injizierbare `createMapSceneHandlers({ requireMember, store, now })` getestet. Pflichtfälle:

- fehlendes/ungültiges Bearer-Token: 401;
- Viewer: 403 ohne Storeaufruf;
- nur Admin darf Szenenmetadaten initialisieren; falsche feste Metadaten: 400;
- Objektanlage validiert Typ/Gruppe/Position und ignoriert Clientautor/Zeit/Revision;
- doppelte Gruppen-/Auftragsanlage erzeugt kein zweites Dokument;
- falsche `sceneId`, ungültiger JSON-Body oder `NaN`: 400;
- aktive Fremdsperre: 409 `OBJECT_LOCKED`;
- Revisionskonflikt: 409 `REVISION_CONFLICT` plus aktuelles Objekt;
- erfolgreicher Lock: 200 mit `lockRevision`/`lockExpiresAtMs`;
- erfolgreicher Move: 200 mit bestätigter Position/Revision;
- unbekanntes Objekt: 404.

- [ ] **Step 2: Erwartetes Fehlschlagen bestätigen**

Run: `npm test -- --run tests/map-scene-routes.test.ts tests/map-scene-client.test.ts`
Expected: FAIL, Routen und Client fehlen.

- [ ] **Step 3: Firestore-Adapter und Routen implementieren**

Der Adapter verwendet `admin.firestore().runTransaction` ausschließlich auf:

`rooms/{roomId}/mapScenes/{sceneId}/objects/{objectId}`

Die Metadatenroute legt ausschließlich `nyx--rockbreaker` mit `systemId:"nyx"`, `mapId:"rockbreaker"`, `renderer:"rockbreaker3d"`, `sceneVersion:1` an und ist idempotent. Objektanlage und Mutationsrouten akzeptieren keine `createdBy`, `updatedBy`, Rolle, Revisionserhöhung oder System-ID vom Client als vertrauenswürdig. Diese Werte werden serverseitig gesetzt/validiert. Antworten tragen `Cache-Control: no-store`; Fehler enthalten keine Tokens oder Firestore-Inhalte außerhalb des betroffenen Objekts.

- [ ] **Step 4: Realtime-Client implementieren**

`subscribeSceneObjects(db, roomId, sceneId, onValue, onError)`:

- hört auf die Objektkollektion;
- parst jedes Dokument einzeln;
- meldet ungültige Dokument-IDs einmalig über `onError`, rendert sie aber nicht;
- ersetzt den lokalen bestätigten Snapshot atomar durch die aktuelle Map `objectId -> SceneObject`;
- schreibt niemals direkt in Firestore.

Mutationen holen ein frisches Firebase-ID-Token und senden es als Bearer-Token an die API. Ein abgebrochener Request lässt die letzte bestätigte Position bestehen.

- [ ] **Step 5: Tests und Commit**

Run: `npm test -- --run tests/map-scene-routes.test.ts tests/map-scene-client.test.ts`
Expected: PASS.

```powershell
git add lib/server/firestore-map-scene-store.ts app/api/rooms/[roomId]/map-scenes lib/map-scene/client.ts tests/map-scene-routes.test.ts tests/map-scene-client.test.ts
git commit -m "feat: synchronize 3d scene objects granularly"
```

### Task 7: Nativen Three.js-Renderer mit sauberem Lifecycle bauen

**Files:**
- Create: `app/components/map/rockbreaker-map.tsx`
- Create: `lib/rockbreaker/scene-factory.ts`
- Create: `tests/rockbreaker-scene-factory.test.ts`

**Interfaces:**
- Consumes: Asteroidenfeld, `SceneObject[]`, `showGrid`, Gruppenlabels/-farben, Mutationscallbacks.
- Produces: `RockbreakerMap` und testbare `buildRockbreakerSceneResources`/`disposeSceneResources`.

- [ ] **Step 1: Failing Ressourcentests schreiben**

Tests prüfen mit kleinen Fakes:

- 944 Asteroiden werden nach `meshIndex` zu InstancedMeshes gruppiert;
- jedes Asteroiden-Instance erhält in `userData` eine stabile ID-Zuordnung;
- Grid liegt auf `y = 0` und verwendet Kilometerabstände;
- `dispose` gibt Renderer, Geometrien, Materialien, Texturen und ResizeObserver genau einmal frei;
- Szenenobjektposition wird direkt aus `x/y/z` gesetzt, nicht aus Kamera-/Bildschirmkoordinaten.

- [ ] **Step 2: Erwartetes Fehlschlagen bestätigen**

Run: `npm test -- --run tests/rockbreaker-scene-factory.test.ts`
Expected: FAIL, Factory fehlt.

- [ ] **Step 3: Scene Factory implementieren**

Übernehmen werden Maßstab, Station in `(0,0,0)`, prozedurale Felsgrundform, Feldpositionen und grundsätzliche Lichtstimmung. Sterne dürfen deterministisch per Seed erzeugt werden; `Math.random()` darf keinen taktisch relevanten Wert bestimmen. Die Factory wirft bei ungültigem Feld vor dem Anlegen des Renderers.

- [ ] **Step 4: React-Komponente implementieren**

`RockbreakerMap`:

- ist `"use client"` und importiert Three.js dynamisch, damit SSR kein `window` benötigt;
- erzeugt eine Szene pro Mount und räumt sie vollständig auf;
- hält Orbitkamera/Zoom lokal und schreibt sie nicht;
- rendert Truppen/Aufträge als 3D-Sprites mit kameraseitig lesbaren Labels;
- rendert Feindmarker dauerhaft voll sichtbar;
- rendert Punkte und Linien in Weltkoordinaten;
- verwendet Raycasting zuerst gegen Asteroiden/Station, sonst gegen `y = 0`;
- sperrt Orbitsteuerung für den aktiven Drag-Pointer;
- zeigt Drag-Vorschau lokal und ruft beim Loslassen `onCommitMove(objectId, expectedRevision, point)` auf;
- springt bei Konflikt auf die Serverposition zurück und zeigt eine sichtbare Meldung;
- zeigt bei fehlendem WebGL eine klare Rückkehraktion zur Nyx-Hauptkarte.

Die Props enthalten keine Firestore-Instanz:

```tsx
type RockbreakerMapProps = {
  objects: ReadonlyMap<string, SceneObject>;
  showGrid: boolean;
  canWrite: boolean;
  onLock: (objectId: string, revision: number) => Promise<SceneObjectLock>;
  onCommitMove: (objectId: string, revision: number, point: WorldPoint) => Promise<SceneObject>;
  onBack: () => void;
};
```

- [ ] **Step 5: Tests, Lint und Commit**

Run: `npm test -- --run tests/rockbreaker-scene-factory.test.ts`
Expected: PASS.
Run: `npm run lint`
Expected: keine neuen Warnungen, insbesondere keine Hook-/Resource-Leaks.

```powershell
git add app/components/map/rockbreaker-map.tsx lib/rockbreaker/scene-factory.ts tests/rockbreaker-scene-factory.test.ts
git commit -m "feat: render the Rockbreaker field natively"
```

### Task 8: Nyx-Unterkarte und Rendererauswahl in das bestehende Board integrieren

**Files:**
- Create: `app/components/map/map-renderer.tsx`
- Modify: `app/page.tsx`
- Modify: `tests/board-collections.test.ts`

**Interfaces:**
- Consumes: bestehende `ZoomableMap`, neue `RockbreakerMap`, `RoomConfig.features`.
- Produces: eine einzige Auswahlgrenze anhand `activeMapEntry.renderer`.

- [ ] **Step 1: Failing Auswahltest schreiben**

Die Rendererauswahl wird als reine Funktion exportiert:

```ts
expect(resolveMapRenderer({ renderer: "rockbreaker3d" }, { rockbreaker3d: false })).toBe("disabled");
expect(resolveMapRenderer({ renderer: "rockbreaker3d" }, { rockbreaker3d: true })).toBe("rockbreaker3d");
expect(resolveMapRenderer({ renderer: "image2d" }, { rockbreaker3d: true })).toBe("image2d");
```

- [ ] **Step 2: Erwartetes Fehlschlagen bestätigen**

Run: `npm test -- --run tests/map-renderer.test.ts`
Expected: FAIL, Auswahlmodul fehlt.

- [ ] **Step 3: Renderergrenze und Boardintegration implementieren**

Konkrete Änderungen in `app/page.tsx`:

- `activeMapEntry` bestimmt den Renderer;
- bestehende 2D-Props bleiben im `image2d`-Zweig unverändert;
- `rockbreaker3d` abonniert `nyx--rockbreaker` nur solange die Karte aktiv ist;
- der Eintrag wird in Nyx nur angeboten, wenn `features.rockbreaker3d` aktiv ist oder ein Admin die noch deaktivierte Konfiguration bearbeitet;
- beim erstmaligen Einrichten ruft der Admin die idempotente Szenenmetadatenroute auf und legt danach einen Karteneintrag `{ id:"rockbreaker", label:"Rockbreaker", image:"", renderer:"rockbreaker3d", sceneId:"nyx--rockbreaker", x, y }` an;
- der Eintrag bleibt über die bestehende Unterkartenpositionierung auf der Nyx-Hauptkarte verschiebbar;
- Rockbreaker ist letzte Ebene; `childNavItems` liefert darin keine weiteren Unterkarten/POIs;
- Truppen-, Auftrags-, Feind-, Punkt- und Linienplatzierung in 3D erfolgt über die Anlage-API; Gruppe/Auftrag erhalten dort deterministische IDs, nicht über `tokensBySystem`/`orderMarkersBySystem`;
- ein Rückweg setzt `activeMapId` auf `main`, ohne Szenendaten zu ändern.

- [ ] **Step 4: Tests, Lint, Build und Commit**

Run: `npm test`
Expected: komplette Suite PASS.
Run: `npm run lint`
Expected: keine neuen Meldungen.
Run: `npm run build` mit den vorhandenen Firebase-Public-Variablen
Expected: PASS.

```powershell
git add app/components/map/map-renderer.tsx app/page.tsx tests/map-renderer.test.ts
git commit -m "feat: add Rockbreaker as a Nyx submap"
```

### Task 9: Browserregression für gemeinsame Koordinaten und Kameratrennung

**Files:**
- Create: `app/ui-test/rockbreaker/page.tsx`
- Create: `tests/ui/rockbreaker-map.spec.ts`
- Modify: `package.json` nur falls `build:ui-test` aus dem Karten-UX-Plan noch nicht vorhanden ist.

- [ ] **Step 1: Failing Browsertest schreiben**

Die freigeschaltete Testseite rendert zwei `RockbreakerMap`-Instanzen mit demselben In-Memory-Objektstore, aber unterschiedlichen Anfangskameras. Sie bietet zusätzlich eine deterministische Testaktion `Objekt auf 4 / 2 / -3 setzen`, damit die Abnahme nicht von Pixel-/GPU-Toleranzen abhängt.

```ts
test("two cameras render one shared world coordinate", async ({ page }) => {
  await page.goto("/ui-test/rockbreaker");
  await page.getByRole("button", { name: "Objekt auf 4 / 2 / -3 setzen" }).click();
  await expect(page.getByTestId("camera-a-coordinate")).toHaveText("4.00 / 2.00 / -3.00");
  await expect(page.getByTestId("camera-b-coordinate")).toHaveText("4.00 / 2.00 / -3.00");
  await page.getByRole("button", { name: "Kamera A drehen" }).click();
  await expect(page.getByTestId("camera-b-coordinate")).toHaveText("4.00 / 2.00 / -3.00");
});
```

Zusätzlich: Grid standardmäßig sichtbar; Objektlabel bleibt nach Kameradrehung vorhanden; simuliertes `REVISION_CONFLICT` zeigt Meldung und Serverposition.

- [ ] **Step 2: Testseite implementieren und Route absichern**

Wie beim Karten-Dock liefert die Route ohne `NEXT_PUBLIC_ENABLE_UI_TEST_ROUTES=1` eine 404 und setzt `noindex`. Sie enthält keine Firebase-Daten und keine Geheimnisse.

- [ ] **Step 3: Gesamtabnahme durchführen**

Run: `npm run build:ui-test`
Run: `npm run test:ui -- tests/ui/rockbreaker-map.spec.ts`
Expected: PASS.
Run: `npm test`
Run: `npm run lint`
Expected: beide Befehle PASS ohne neue Meldungen.

- [ ] **Step 4: Commit erstellen**

```powershell
git add app/ui-test/rockbreaker/page.tsx tests/ui/rockbreaker-map.spec.ts package.json package-lock.json
git commit -m "test: cover shared Rockbreaker world coordinates"
```

## Fertigkriterien dieses Teilplans

- Datensatzintegrität: exakt 944 stabile Asteroiden, reproduzierbarer Hash.
- Kamera A und Kamera B lesen/schreiben dieselben Weltkoordinaten.
- Gruppe, Auftrag und Feindmarker bewegen sich als echte 3D-Objekte mit der Szene.
- Verschiedene Objekte sind parallel editierbar; dasselbe Objekt erzeugt einen sichtbaren Konflikt statt stillen Verlust.
- 2D-Karten bleiben über den Default `image2d` unverändert.
- Feature ist bei fehlendem Schalter aus und öffentlich erst nach dokumentierter Datenfreigabe aktivierbar.
