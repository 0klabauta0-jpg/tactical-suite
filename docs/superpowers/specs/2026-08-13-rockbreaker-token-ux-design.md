# Rockbreaker Token UX Design

## Ziel

Der Truppentransfer zwischen der Nyx-Hauptkarte und Rockbreaker 3D soll ohne versteckte Bedienregeln funktionieren. Gleichzeitig startet die Karten- und Notizoberfläche in einer kompakten, nicht störenden Anordnung.

## Bestätigtes Verhalten

- Ein vorhandener Truppentoken auf Nyx kann auf die Rockbreaker-Pille gezogen werden. Die spezifische Pille gewinnt bei der Zielerkennung immer vor der umgebenden Kartenfläche.
- Die linke Kartensteuerung zeigt auch in Rockbreaker den Bereich `Token`. Dort sind die taktischen Nyx-Gruppen mit ihrem aktuellen Aufenthaltsort sichtbar.
- Eine Gruppe, die auf Nyx liegt oder noch nicht platziert ist, kann aus dieser Liste direkt in die Rockbreaker-3D-Fläche gezogen werden. Der Server bleibt für den erwarteten Ausgangsort und den atomaren Transfer zuständig.
- Bereits in Rockbreaker befindliche Truppen werden dort als 3D-Marker bewegt. Werden sie auf `Eine Ebene hoch nach Nyx` gezogen, landen sie über den bestehenden Transferdienst wieder an der festen Nyx-Einstiegsposition.
- Ein einfacher Klick auf `Eine Ebene hoch nach Nyx` navigiert nur zur Nyx-Hauptkarte und verschiebt keinen Trupp. Ein Drop auf dieselbe Fläche verschiebt den gezogenen Trupp.
- Der vorhandene Button `← Nyx` bleibt als zweiter, eindeutiger Navigationsweg erhalten.
- Die Kartensteuerung ist links angeheftet, vertikal verschiebbar und klappt zum linken Rand ein.
- Grid, Bereichszustände und vertikale Dockposition bleiben weiterhin pro Raum und Spieler lokal gespeichert.
- Notizen und Log-Notizen starten bei jeder neuen App-Sitzung rechts, sichtbar und eingeklappt. Der Inhalt bleibt unverändert erhalten; nur Position, Sichtbarkeit und Klappzustand werden lokal initialisiert.

## Technischer Ansatz

Die vorhandene Transaktions-API und das bestehende Ortsmodell bleiben unverändert. Der Fehler wird an der Eingangsgrenze der Drop-Erkennung behoben: Aus allen DOM-Treffern wird zuerst ein spezifisches Ziel (`child` oder `parent`) gewählt; die große `map2d`-Fläche darf es nicht verdecken.

Rockbreaker erhält eine DndKit-Drop-Fläche für neue Truppen. Der Drop wird in eine bestehende `enterChild`-Absicht für `rockbreaker` übersetzt; die eigentliche Erzeugung des 3D-Objekts und Konfliktprüfung bleiben im Server-Transferdienst. Die Tokenliste wird renderer-unabhängig bereitgestellt, blendet aber den Auftragsmarker-Button in 3D aus, weil dieser nur 2D-Koordinaten besitzt.

Die Panel-Startanordnung wird als lokale, viewportabhängige Initialisierung umgesetzt. Sie wird nicht in Firestore geschrieben und verändert daher nicht die Oberfläche anderer Teilnehmer.

## Fehler- und Konfliktverhalten

- Veraltete Ausgangsrevisionen oder ein inzwischen verschobener Trupp werden weiterhin vom Transferdienst abgelehnt; die UI zeigt die vorhandene Konfliktmeldung und übernimmt den Serverstand.
- Gruppen mit mehrdeutigem Altbestand bleiben deaktiviert und zeigen `Position prüfen`.
- Ein Drop außerhalb eines spezifischen Ziels bleibt eine normale Positionsänderung auf der aktuellen 2D- beziehungsweise 3D-Karte.
- Viewer sehen die Kartensteuerung und Navigation, können jedoch keine Truppen übertragen oder platzieren.

## Abnahme

1. Reales Karten-Token auf Nyx → Rockbreaker-Pille: Token verschwindet aus Nyx und erscheint in Rockbreaker.
2. Leere Rockbreaker-Karte → linke Tokenliste → Gruppe auf 3D-Fläche: Gruppe erscheint als 3D-Marker.
3. 3D-Marker → mittlere Rückgabezone: Gruppe erscheint wieder auf Nyx an der festen Einstiegsposition.
4. Einfacher Klick auf die mittlere Rückgabezone: Navigation nach Nyx ohne Ortsänderung der Gruppe.
5. Kartensteuerung sitzt links und klappt nach links ein.
6. Neue Sitzung: Notizen und Log-Notizen sind rechts sichtbar und eingeklappt.
7. Bestehende Unit-, UI-, Lint- und Build-Prüfungen bleiben grün.
