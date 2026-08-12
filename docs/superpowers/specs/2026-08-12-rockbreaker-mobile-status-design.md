# KlabsCom: Rockbreaker-3D, Kartenbedienung und persönliche Handy-Statusseite

Datum: 12. August 2026  
Status: Vom Nutzer im Dialog freigegeben  
Zielbranch: `codex/lint-quality-baseline`

## 1. Ziel und Umfang

KlabsCom erhält vier zusammenhängende Erweiterungen:

1. Rockbreaker wird als native, kollaborative 3D-Unterkarte im Nyx-System integriert.
2. Die Kartenbedienung wird in einer gemeinsamen, links angedockten Steuerleiste zusammengeführt.
3. Das Grid ist auf 2D- und 3D-Karten standardmäßig sichtbar; Feindmarker bleiben dauerhaft erhalten.
4. Jeder eingeloggte Spieler kann eine persönliche Handy-Statusseite per QR-Code verbinden und dort ausschließlich den eigenen Lebens- und Respawnstatus pflegen.

Der zentrale Qualitätsmaßstab ist weiterhin ein konsistentes gemeinsames Lagebild. Kamerapositionen und lokale Panelzustände sind persönlich; taktische Objekte, Spielerstatus und Spawnzuordnungen sind gemeinsam und realtime-synchronisiert.

## 2. Nicht-Ziele

- Die vorhandenen 2D-Karten werden nicht auf Three.js migriert.
- Rockbreaker ersetzt nicht die Nyx-Hauptkarte, sondern wird deren verschiebbare Unterkarte.
- Die Standalone-HTML-Datei wird nicht als dauerhaftes `iframe` eingebettet.
- Die Handy-Seite erhält kein vollständiges Board und keine Kartenbedienung.
- Bestehende Firestore-Statusfelder werden beim ersten Release nicht gelöscht.
- Es erfolgt kein Big-Bang-Refactor der gesamten `app/page.tsx`.

## 3. Fachliche Entscheidungen

### 3.1 Rockbreaker in Nyx

Rockbreaker erscheint auf der Nyx-Hauptkarte als verschiebbarer Kartenort. Der Ort lässt sich wie bestehende Unterkartenmarker positionieren und öffnen. Rockbreaker ist die letzte Kartenebene und besitzt zunächst keine weiteren Unterkarten.

Beim Öffnen entscheidet der Karteneintrag über den Renderer:

- `image2d`: bestehender 2D-Kartenrenderer
- `rockbreaker3d`: neuer nativer Three.js-Renderer

Bestehende Karteneinträge ohne expliziten Renderertyp werden rückwärtskompatibel als `image2d` interpretiert.

### 3.2 Gemeinsames 3D-Weltkoordinatensystem

Alle Nutzer sehen dieselbe, deterministische Rockbreaker-Welt:

- Stationszentrum: `0 / 0 / 0`
- eine Three.js-Welteinheit: ein Kilometer
- dieselben 944 Asteroiden mit stabilen IDs und identischen Transformationen
- dieselbe Szenenversion für Asteroidengeometrie und Ankerberechnung

Die Kamera ist ausschließlich lokale Darstellung. Drehen, Neigen und Zoomen verändern keine gemeinsamen Daten.

Ein Mausklick oder Drag wird durch Raycasting in das gemeinsame Weltkoordinatensystem umgerechnet. Der Kamerastrahl bestimmt nur, welchen gemeinsamen Weltpunkt der Nutzer auswählt. Gespeichert wird die globale Position, nicht die persönliche Kameraperspektive.

Bei einem Treffer auf einem Asteroiden werden gespeichert:

- die globale Weltposition `x / y / z`
- die stabile Asteroiden-ID
- ein lokaler Anker relativ zum Asteroiden
- die verwendete Szenenversion

Trifft der Strahl keinen Asteroiden, wird der Punkt auf der gemeinsamen Gürtelebene `y = 0` bestimmt. Andere Nutzer rendern exakt dieselbe gespeicherte Position, unabhängig von ihrer Kamera.

### 3.3 Bewegliche 3D-Objekte

Rockbreaker unterstützt:

- Truppentoken
- Auftragsmarker
- Feindmarker
- taktische Punkte
- taktische Linien

Truppen- und Auftragsmarker werden als echte 3D-Objekte gerendert. Sie lassen sich im Raum greifen und verschieben. Während des Ziehens ist die Kameradrehung für diesen Pointer gesperrt. Nach dem Loslassen wird die neue gemeinsame Position gespeichert; anschließend ist die Kamera wieder frei bedienbar.

Marker und Beschriftungen wandern beim Drehen, Neigen und Zoomen perspektivisch korrekt mit. Gruppenfarben, Gruppenbezeichnungen und Objektarten bleiben aus der vorhandenen KlabsCom-Darstellung erkennbar.

## 4. Rockbreaker-Renderer

### 4.1 Übernahme der Standalone-Karte

Quelle ist:

`C:\Users\bjoer\Downloads\rockbreaker-3d-standalone-Taktik\rockbreaker-3d-standalone.html`

Die Datei enthält eine eingebettete Three.js-Szene, 944 persistente Asteroidenpositionen, eine Orbitkamera sowie lokale Punkt- und Linienwerkzeuge. Für KlabsCom werden übernommen:

- die 944 Asteroidendatensätze
- Maßstab und Stationszentrum
- die optische Grundszene
- Kamera- und Raycastverhalten
- die fachliche Bedeutung der Punkt- und Linienwerkzeuge

Die eingebettete Three.js-Bibliothek und das globale Standalone-Skript werden nicht direkt übernommen. KlabsCom verwendet eine versionierte npm-Abhängigkeit und gekapselte React-/Three.js-Komponenten. Die extrahierten Felddaten erhalten eine Herkunftsnotiz und einen automatisierten Integritätscheck auf Anzahl, IDs und gültige Koordinaten.

Vor einer öffentlichen Bereitstellung wird die Erlaubnis zur Weiterverwendung und Verteilung der von einem Dritten erstellten Karte einschließlich der Asteroidendaten dokumentiert. Diese Freigabe ist ein Deployment-Gate; lokale technische Integration und Tests dürfen vorher erfolgen, die öffentliche Aktivierung jedoch nicht.

### 4.2 Komponenten- und Modulgrenzen

Die Umsetzung erhält gezielte, eigenständig testbare Grenzen:

- `map-renderers`: Auswahl zwischen 2D- und 3D-Renderer
- `rockbreaker-scene`: Aufbau der deterministischen Szene und Kamera
- `rockbreaker-coordinates`: Raycasting, Anker und Weltkoordinaten
- `scene-objects`: Parsing und Rendering gemeinsamer 3D-Objekte
- `scene-object-repository`: Realtime-Lesen sowie granulare Mutationen
- `map-control-dock`: gemeinsame Karten-, Token- und Zeichenbedienung

Die Grenzen dienen der neuen Funktion. Sie sind keine vollständige Zerlegung des bestehenden Seitenmonolithen.

## 5. Realtime-Datenmodell für 3D-Objekte

### 5.1 Szenenidentität

Jede Szene erhält eine stabile `sceneId`, die System und Karte eindeutig verbindet. Für Rockbreaker wird eine feste ID wie `nyx--rockbreaker` verwendet. Dadurch können gleichnamige Karten in anderen Systemen nicht kollidieren.

Metadaten liegen unter:

`rooms/{roomId}/mapScenes/{sceneId}`

Beispielschema:

```ts
type MapScene = {
  systemId: "nyx";
  mapId: "rockbreaker";
  renderer: "rockbreaker3d";
  sceneVersion: 1;
  updatedAt: Timestamp;
};
```

### 5.2 Objektkollektion

Gemeinsame Objekte liegen einzeln unter:

`rooms/{roomId}/mapScenes/{sceneId}/objects/{objectId}`

Gemeinsame Felder:

```ts
type SceneObjectBase = {
  type: "groupToken" | "orderMarker" | "enemyMarker" | "point" | "line";
  systemId: string;
  mapId: string;
  sceneVersion: number;
  color: string;
  createdBy: string;
  createdAt: Timestamp;
  updatedBy: string;
  updatedAt: Timestamp;
  revision: number;
};

type WorldPoint = {
  x: number;
  y: number;
  z: number;
  anchor?: {
    kind: "asteroid" | "beltPlane";
    asteroidId?: string;
    localX?: number;
    localY?: number;
    localZ?: number;
  };
};
```

Truppentoken und Auftragsmarker verwenden pro Szene und Gruppe deterministische Objekt-IDs, damit es nicht versehentlich mehrere aktive Instanzen derselben Gruppe gibt. Feindmarker, Punkte und Linien verwenden zufällige, kollisionssichere IDs. Linien besitzen zwei `WorldPoint`-Endpunkte.

### 5.3 Konfliktverhalten

Jedes Objekt besitzt ein eigenes Firestore-Dokument. Änderungen an einem Marker überschreiben keine anderen Marker.

Beim Drag:

1. Eine kurze, serverzeitbasierte Bearbeitungssperre wird transaktional angefordert.
2. Der Marker bewegt sich sofort lokal.
3. Andere Clients sehen weiterhin die letzte bestätigte Position.
4. Beim Loslassen wird Position plus erhöhte Revision transaktional gespeichert.
5. Der Realtime-Listener verteilt die bestätigte Position.
6. Eine verlorene Verbindung lässt die Sperre automatisch auslaufen.

Wenn die Revision seit Dragbeginn geändert wurde, wird der Commit abgelehnt und die aktuelle Serverposition angezeigt. Der Nutzer erhält eine verständliche Konfliktmeldung. Verschiedene Objekte bleiben gleichzeitig bearbeitbar.

## 6. Kartenbedienung

### 6.1 Gemeinsame linke Steuerleiste

Die bisherigen Fenster für Kartenwahl, Tokenplatzierung und Zeichenwerkzeuge werden in einer links angedockten Leiste zusammengeführt.

Eigenschaften:

- am linken Kartenrand angeheftet
- vertikal verschiebbar und an den sichtbaren Bereich geklemmt
- vollständig zu einer schmalen Symbolleiste einklappbar
- drei einzeln auf- und zuklappbare Bereiche: Karten, Truppen/Aufträge, Zeichnen/Feindmarker
- eigener Scrollbereich bei geringer Bildschirmhöhe
- Position und Klappzustände lokal pro Browser gespeichert
- dieselbe Bedienlogik für 2D und Rockbreaker-3D

Notizen, Log-Notizen und Operationslog bleiben unabhängige, frei verschiebbare Fenster.

### 6.2 Grid

Das Grid ist bei erstmaliger Nutzung standardmäßig eingeschaltet. Der Nutzer kann es weiterhin ausschalten; die persönliche Wahl wird lokal gespeichert.

- 2D: bestehendes beschriftetes Raster über der Karte
- 3D: dezentes Kilometerraster auf der gemeinsamen Gürtelebene mit Achsenbezug

Das 3D-Grid ist Teil der Welt und bewegt sich beim Drehen perspektivisch korrekt mit. Es verändert keine taktischen Daten.

### 6.3 Dauerhafte Feindmarker

Feindmarker besitzen keine automatische Ablaufzeit, kein Verblassen und keine automatische Löschung. Sie verschwinden ausschließlich durch bewusstes manuelles Löschen oder „Alles löschen“ auf der betreffenden Ebene.

Bestehende Marker mit einem alten `opacity`-Wert werden mit voller Sichtbarkeit gerendert. Das Feld bleibt beim Lesen aus Kompatibilitätsgründen zulässig, beeinflusst aber die Anzeige nicht mehr.

Das Alter eines Markers bleibt sichtbar. Der bisherige globale Minutentick wird entfernt; eine lokal begrenzte Aktualisierung im Marker-Layer erneuert ausschließlich die Altersbeschriftung und löst kein Realtime-Schreiben aus. Sämtliche Hilfetexte und Beschriftungen verlieren den Hinweis auf „Fade“.

## 7. Persönliche Handy-Statusseite

### 7.1 Nutzererlebnis

Jeder im Desktop-KlabsCom eingeloggte Spieler sieht „Handy verbinden“. Der Dialog zeigt einen persönlichen QR-Code und bietet „Verbindung erneuern“.

Nach dem Scan:

1. Der Verbindungslink wird serverseitig geprüft.
2. Das Handy wird genau einem Raum und Spieler zugeordnet.
3. Der geheime Schlüssel wird aus der sichtbaren URL entfernt.
4. Die Statusseite öffnet sich ohne Handle-, Passwort- oder Team-Login.

Die Seite zeigt deutlich:

- KlabsCom und Raumname
- Handle/Spielername zur Sichtprüfung
- aktuellen Lebensstatus
- ausgewählten Spawnpunkt
- Kennzeichnung „Persönlich verbunden“

Große, touchfreundliche Bedienelemente:

- `LEBT`
- `TOT`
- `RESPAWN`
- Auswahl der im aktuellen System erlaubten Spawnpunkte

Unterhalb bleibt ein klar abgegrenzter Platz für spätere Schnellaktionen. Im ersten Release werden dort keine weiteren Rechte oder Boardfunktionen eingebaut.

### 7.2 Statussemantik

- `LEBT`: setzt ausschließlich den eigenen Status auf lebend.
- `TOT`: setzt den eigenen Status auf tot und verwendet die aktuell gewählte Spawnzuordnung für den bestehenden Boardablauf.
- `RESPAWN`: setzt den Status auf lebend und ordnet den Spieler dem auf dem Handy gewählten, erlaubten Spawnpunkt zu.
- Spawn-Auswahl: ändert ausschließlich die eigene zukünftige Spawnzuordnung.

Ein Spawnpunkt ist nur auswählbar, wenn er im Raum existiert, als Spawn markiert ist und zum aktuellen System des Spielers gehört. Der Server validiert diese Bedingungen bei jeder Änderung erneut.

## 8. Status-Datenmodell und Migration

### 8.1 Kanonischer persönlicher Status

Persönliche Statuswerte werden granular gespeichert:

`rooms/{roomId}/playerStatus/{playerId}`

```ts
type PlayerStatus = {
  playerId: string;
  aliveStatus: "alive" | "dead";
  systemId?: string;
  spawnGroupId?: string;
  revision: number;
  updatedBy: string;
  updatedVia: "desktop" | "mobile" | "migration";
  updatedAt: Timestamp;
};
```

Desktop und Handy verwenden dieselbe fachliche Statusoperation. Für Aktionen, die zusätzlich eine Boardspalte verändern, aktualisiert der Server Status und aktuelle Boardzuordnung in einer Firestore-Transaktion. Die Transaktion liest die neueste Boardversion und verändert nur die Zuordnung des betroffenen Spielers, sodass parallele Änderungen erneut versucht statt still überschrieben werden.

Das aktuelle System wird aus der letzten gültigen taktischen Gruppen- oder Spawnzuordnung des Spielers abgeleitet und im persönlichen Status mitgeführt. Fehlt bei einem unzugeteilten Spieler diese Information, bietet die Handy-Seite keinen geratenen Spawnpunkt an, sondern zeigt „System noch nicht zugewiesen“. Ein Commander oder Admin muss den Spieler dann zunächst einem System zuordnen.

### 8.2 Übergang vom bestehenden Format

Bestehende Räume besitzen `aliveState` und `spawnState` im Board-Dokument. Die Einführung erfolgt rückwärtskompatibel:

1. Beim ersten Laden werden fehlende persönliche Statusdokumente aus dem vorhandenen Boardzustand erzeugt.
2. Vorhandene persönliche Dokumente gewinnen anhand Revision und Serverzeit.
3. Während der Übergangsphase kann die Desktop-Anwendung alte Felder lesen, schreibt neue Statusänderungen aber über die kanonische Statusoperation.
4. Eine kontrollierte Kompatibilitätsschicht hält alte Clients während des Live-Tests lesbar.
5. Die alten Felder werden in diesem Projektabschnitt nicht gelöscht.

Die Migration ist idempotent und protokolliert Anzahl, übersprungene Datensätze und Validierungsfehler, ohne gültige neue Dokumente zu überschreiben.

## 9. QR-Verbindung und Sicherheit

### 9.1 Verbindungsschlüssel

Der QR-Code enthält einen kryptografisch zufälligen persönlichen Verbindungsschlüssel sowie Raum- und Spieleridentität. Raum- und Team-Passwort werden niemals eingebettet.

Der Server speichert nur einen Hash des Schlüssels und eine Sitzungsrevision. Der Scan-Endpunkt validiert den Schlüssel, setzt eine sichere `HttpOnly`-/`Secure`-/`SameSite`-Sitzung und leitet auf die Statusseite weiter. Dabei wird der Schlüssel aus der Browseradresse entfernt.

Pro Spieler liegt genau ein aktives Verbindungsdokument unter:

`rooms/{roomId}/mobileLinks/{playerId}`

```ts
type MobileLink = {
  playerId: string;
  tokenHash: string;
  sessionRevision: number;
  issuedByUid: string;
  issuedAt: Timestamp;
  revokedAt?: Timestamp;
};
```

Der QR-Link enthält Raum-ID, Spieler-ID und das zufällige Geheimnis. Die IDs dienen nur zum Auffinden des Dokuments; ausschließlich der Hashvergleich authentifiziert die Verbindung.

### 9.2 Autorisierung

Die Handy-Sitzung ist eine eng begrenzte Berechtigung:

- genau ein Raum
- genau ein Spieler
- Lesen des eigenen Status, eigenen Namens, Raumnamens und erlaubter Spawnpunkte
- Schreiben des eigenen Lebensstatus und eigenen Spawnpunkts

Nicht erlaubt sind Boardlesen, Kartenlesen, Rollenänderungen, andere Spieler, Notizen oder taktische Objekte.

Alle Handy-Mutationen laufen über serverseitige Endpunkte. Bei jedem Aufruf werden Sitzung, Sitzungsrevision, Raum, Spieler, Aktion und Spawnpunkt erneut validiert. Schreibende Requests prüfen Herkunft und verwenden ausschließlich erlaubte Aktionswerte.

### 9.3 Widerruf

„Verbindung erneuern“ erhöht die Sitzungsrevision und erzeugt einen neuen Schlüssel. Dadurch werden alte QR-Codes und bestehende Handy-Sitzungen ungültig. Ein Admin kann dieselbe Sperre für einen Spieler auslösen.

Ein ungültiger oder widerrufener Link zeigt keine Raumdaten und fordert einen neuen QR-Code an. Geheimnisse werden weder geloggt noch in Firestore-Klartext gespeichert.

### 9.4 Rollen- und Regelgrenze

Neue Server-Endpunkte prüfen Firebase-ID-Tokens des Desktopnutzers und serverseitig geschützte Raumrollen. Neue Firestore-Pfade erhalten versionierte Regeln:

- authentifizierte Raumteilnehmer dürfen freigegebene Realtime-Daten lesen
- Commander und Admin dürfen 3D-Szenenobjekte verändern
- Rollen- und Verbindungsdokumente sind nicht durch normale Clients beschreibbar
- persönliche Handy-Statusänderungen erfolgen ausschließlich serverseitig

Vor der Liveschaltung wird geprüft, dass die bestehenden Mitgliedsdokumente nicht zur ungeschützten Selbstbeförderung verwendet werden können. Falls die aktuell deployten Regeln dies nicht garantieren, wird die Rollenvergabe für die betroffenen Pfade auf eine serverseitig geschützte Mitgliedschaft umgestellt, bevor 3D-Schreibrechte aktiviert werden.

## 10. Fehlerverhalten

- Kein WebGL: klare Meldung und Rückweg zur Nyx-Hauptkarte; keine Endlosschleife.
- Ungültige Szenendaten: Rockbreaker wird nicht teilweise gestartet; Fehler wird protokolliert und verständlich angezeigt.
- Realtime-Verbindung unterbrochen: bestätigte Position bleibt sichtbar, nicht bestätigte Änderung wird gekennzeichnet und kann erneut versucht werden.
- Marker-Konflikt: aktuelle Serverposition gewinnt; Nutzer erhält eine Konfliktmeldung.
- Abgelaufene Bearbeitungssperre: Objekt wird wieder bearbeitbar.
- QR ungültig oder widerrufen: keine persönlichen Daten; Aufforderung, neu zu verbinden.
- Spawnpunkt zwischen Anzeige und Klick gelöscht: Server lehnt die Aktion ab und liefert die aktualisierte Liste.
- Migration mit ungültigen Altwerten: sichere Standardwerte, protokollierter Fehler und kein Überschreiben gültiger neuer Daten.

## 11. Tests und Nachweise

### 11.1 Automatisiert vor dem Deployment

- Parser- und Schema-Tests für Kartentyp, Szenenobjekte und Spielerstatus
- Integritätsprüfung der exakt 944 Asteroiden und stabilen IDs
- Tests für Weltkoordinaten, Asteroidenanker und Szenenversion
- Tests für granulare Objektmutationen, Revisionen und Sperrablauf
- Tests für dauerhafte Feindmarker und volle Sichtbarkeit alter Marker
- Komponententests für linke Steuerleiste, Grid-Standard und Klappzustände
- API-Tests für QR-Ausstellung, Hashprüfung, Widerruf und Sitzungsrevision
- Berechtigungstests: Handy kann nur den eigenen Status und erlaubten Spawn ändern
- Migrationstests für alte `aliveState`-/`spawnState`-Werte
- bestehende Vitest- und Playwright-Suite
- Produktions-Build und ESLint ohne neue Fehler

### 11.2 Geplanter Live-Test

Die Firebase-Integration wird im vereinbarten Liveschaltungsfenster in einem dedizierten Testraum geprüft, da das Produkt aktuell nicht aktiv genutzt wird. Vorher werden relevante Raumdokumente gesichert.

Abnahme mit mindestens zwei Desktop-Browsern und zwei Handys:

1. Beide Desktops sehen denselben 3D-Marker an derselben Weltposition.
2. Unterschiedliche Kameraperspektiven verändern die gemeinsame Position nicht.
3. Zwei Nutzer verschieben verschiedene Objekte parallel ohne Datenverlust.
4. Ein Konflikt am selben Objekt wird sichtbar und nicht still überschrieben.
5. Grid, linke Steuerleiste und dauerhafte Feindmarker funktionieren in 2D und 3D.
6. Beide Handys zeigen den korrekten Handle und Raum.
7. Beide Handys ändern gleichzeitig ausschließlich ihren eigenen Status.
8. Spawn-Auswahl und Respawn landen am ausgewählten erlaubten Spawnpunkt.
9. Fremder, manipulierter und widerrufener QR-Code wird abgelehnt.
10. Bestehende Räume und 2D-Karten bleiben funktionsfähig.

## 12. Deployment, Feature-Schalter und Rückweg

Rockbreaker-3D und die mobile Statusseite werden pro Raum über getrennte Feature-Schalter im bestehenden Dokument `rooms/{roomId}/config/main` aktiviert:

```ts
features: {
  rockbreaker3d: boolean;
  mobileStatus: boolean;
}
```

Fehlende Schalter bedeuten `false`. Der erste Live-Test erfolgt nur im dedizierten Testraum.

Reihenfolge:

1. Produktions-Build und automatisierte Tests abschließen.
2. Weiterverwendungsfreigabe für Karte und Felddaten bestätigen.
3. Firestore-Regeln und Serverkonfiguration validieren.
4. relevante Board- und Konfigurationsdokumente sichern.
5. Anwendung deployen, Features zunächst nur im Testraum aktivieren.
6. Live-Abnahme durchführen.
7. bei Erfolg gezielt für den gewünschten Einsatzraum aktivieren.

Bei einem Problem werden die Feature-Schalter deaktiviert. Neue additive Collections können bestehen bleiben und verursachen für alte Clients keine Wirkung. Bestehende Boardfelder werden bis zu einer späteren, separat freigegebenen Bereinigung nicht gelöscht. Dadurch ist kein destruktives Rollback notwendig.

## 13. Abnahmekriterien

Das Vorhaben gilt als umgesetzt, wenn:

- Rockbreaker als verschiebbare letzte Nyx-Unterkarte erreichbar ist.
- alle Clients dieselbe deterministische 3D-Welt verwenden.
- Truppen-, Auftrags- und Feindmarker im 3D-Raum beweglich und realtime-konsistent sind.
- die persönliche Kamera keine gemeinsamen Daten verändert.
- die linke Steuerleiste, das standardmäßig aktive Grid und dauerhafte Feindmarker wie beschrieben funktionieren.
- QR-Scan die persönliche Statusseite ohne Login öffnet und den korrekten Handle anzeigt.
- ein Handy ausschließlich den eigenen Status und erlaubten Spawn ändern kann.
- parallele Änderungen keinen stillen Datenverlust erzeugen.
- bestehende 2D-Karten und Räume nach Migration weiter funktionieren.
- automatisierte Nachweise und der vereinbarte Live-Test erfolgreich sind.
