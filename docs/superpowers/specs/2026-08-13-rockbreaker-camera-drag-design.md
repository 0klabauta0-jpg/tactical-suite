# Rockbreaker Camera-Relative Token Drag Design

## Ziel

Vorhandene Truppentokens in Rockbreaker werden frei im dreidimensionalen Raum verschoben. Die aktuelle Kameraperspektive bestimmt die Bewegungsebene, während gemeinsame Weltkoordinaten, feste Raumgrenzen und der bestehende Realtime-Konfliktschutz erhalten bleiben.

## Bedienung

- Beim Pointer-Down auf einen Truppentoken wird eine unsichtbare Ebene durch dessen aktuelle Weltposition gelegt. Die Ebenennormale entspricht der Blickrichtung der Kamera zu Beginn des Drags.
- Kamera und Bewegungsebene bleiben während dieses Drags unverändert. Pointer-Bewegungen werden als Kamerastrahlen mit dieser Ebene geschnitten.
- Eine vertikale Bewegung auf dem Bildschirm verändert damit abhängig von Blickwinkel und Kamerahöhe auch die Weltachse `y` sowie gegebenenfalls `x` und `z`.
- Asteroiden und Station werden beim Verschieben vorhandener Truppentokens nicht geraycastet und lösen kein Einrasten aus.
- Feindmarker und deren bisherige Platzierung durch einen Klick auf Asteroid oder Gürtelebene bleiben unverändert.
- Die Pointerposition wird während des Token-Drags auf das Canvas mit 24 CSS-Pixeln Innenabstand begrenzt. Der Token kann dadurch beim Loslassen nicht hinter den sichtbaren Kartenrand gezogen werden.

## Gemeinsame Raumgrenzen

Die versionierten Rockbreaker-Grenzen umfassen das vollständige Asteroidenfeld, die bestehende Eintrittsleiste und einen Sicherheitsrand:

| Achse | Minimum | Maximum |
|---|---:|---:|
| `x` | `-36 km` | `37 km` |
| `y` | `-31 km` | `25 km` |
| `z` | `-23 km` | `29 km` |

Jeder während eines Drags berechnete Punkt wird clientseitig auf diesen Quader begrenzt. Der Server prüft dieselben Konstanten vor einem Write eines Truppentokens und lehnt manipulierte oder veraltete Requests außerhalb des Quaders ab. Andere 3D-Objekttypen werden durch diese Änderung nicht neu begrenzt.

## Datenmodell und Realtime-Verhalten

- `WorldAnchor` erhält die rückwärtskompatible Variante `{ kind: "freeSpace" }`.
- Ein frei verschobener Truppentoken wird als `WorldPoint` mit `sceneVersion: 1`, den begrenzten `x/y/z`-Werten und `anchor: { kind: "freeSpace" }` gespeichert.
- Bestehende `beltPlane`- und `asteroid`-Positionen bleiben lesbar. Es gibt keine automatische Massendatenmigration.
- Beim ersten freien Verschieben wird nur der betreffende Token auf `freeSpace` umgestellt.
- Der vorhandene Lock-/Revision-Pfad bleibt maßgeblich. Ein zwischenzeitlich von einem anderen Teilnehmer geänderter Token übernimmt weiterhin den bestätigten Serverstand.
- Die gespeicherten Weltkoordinaten sind unabhängig von späteren Kamerabewegungen und werden von allen Teilnehmern identisch gerendert.

## Schutz und Wiederherstellung

- Der Screen-Clamp verhindert, dass ein aktuell gezogener Token in der aktiven Perspektive außerhalb des Canvas abgelegt wird.
- Die Weltgrenzen verhindern extreme Koordinaten durch flache oder manipulierte Strahlen.
- Bereits außerhalb der Ansicht befindliche Truppentokens bleiben lesbar. In der Rockbreaker-Tokenliste erhält jede dort befindliche Gruppe die Aktion `Nach Nyx zurückholen`.
- Diese Aktion verwendet den bestehenden atomaren `moveUp`-Transfer. Der Trupp landet an der vorhandenen sicheren Rückkehrposition neben der Rockbreaker-Pille auf Nyx und kann anschließend wieder über die Pille oder die 3D-Tokenliste eintreten.
- Die Rückholaktion erfordert dieselben Schreibrechte wie ein normaler Truppentransfer und benötigt keine neue Firestore-Struktur.

## Komponenten

- `lib/rockbreaker/drag.ts` enthält reine, testbare Mathematik für Strahl-/Kameraebenen-Schnitt, Canvas-Clamp und Weltgrenzen.
- `lib/rockbreaker/coordinates.ts` und `lib/rockbreaker/scene-objects.ts` akzeptieren und validieren den neuen `freeSpace`-Anker.
- `app/components/map/rockbreaker-map.tsx` friert beim Drag die Kameraebene ein, rendert die lokale Vorschau und übergibt beim Loslassen den begrenzten `freeSpace`-Punkt an den vorhandenen Client.
- Der Map-Scene-Write-Pfad validiert neue Positionen von `groupToken`-Objekten serverseitig gegen dieselben Grenzen.
- `TokenPlacerPanel` erhält für Rockbreaker-Gruppen die vorhandene `moveUp`-Aktion als sichtbaren Rückholbutton.

## Fehlerverhalten

- Ist ein Strahl parallel zur eingefrorenen Kameraebene oder liefert er keinen endlichen Schnittpunkt, bleibt der Token an der letzten gültigen Position.
- Bei einem Serverkonflikt springt die Vorschau wie bisher auf die bestätigte Position zurück und zeigt die Konfliktmeldung.
- Ein serverseitig abgelehnter Punkt außerhalb der Grenzen wird nicht gespeichert; die UI übernimmt wieder den letzten bestätigten Stand.
- Die Rückholaktion wird während eines laufenden Transfers deaktiviert und verwendet die bestehende Fehlermeldung des Transferdienstes.

## Tests und Abnahme

1. Reine Mathematiktests belegen, dass Bildschirmbewegungen auf einer Kamerafläche je nach Blickrichtung unterschiedliche Weltachsen einschließlich `y` verändern.
2. Grenztests belegen Canvas-Innenabstand, alle sechs Weltgrenzen sowie ausschließlich endliche Ergebnisse.
3. Parser-Tests akzeptieren `freeSpace`, behalten Altpositionen bei und verwerfen unbekannte Anker.
4. API-/Store-Tests akzeptieren begrenzte neue Truppenpositionen und lehnen Werte außerhalb des Quaders ab.
5. Der Rockbreaker-UI-Test zieht einen Token bei schräger Kamera vertikal, beobachtet eine veränderte Höhe und dieselben gespeicherten Koordinaten in einer zweiten Kameraansicht.
6. Ein Drag bis zum Canvasrand bleibt innerhalb der Raumgrenzen und der Token bleibt in der aktiven Ansicht sichtbar.
7. Ein nicht auffindbarer Rockbreaker-Trupp kann über `Nach Nyx zurückholen` ohne direkten Zugriff auf sein Mesh nach Nyx transferiert werden.
8. Unit-Tests, vollständige UI-Regressionstests, Lint und Produktions-Build bleiben grün.
