# KlabsCom

KlabsCom ist ein kollaboratives Echtzeit-Lageboard auf Basis von Next.js, Firebase Auth und Firestore. Spieler- und Gruppendaten kommen aus einem Google Sheet und werden mit validierten Firestore-Overrides zusammengeführt.

## Lokale Entwicklung

1. `.env.example` nach `.env.local` kopieren und die projektspezifischen Werte setzen.
2. Abhängigkeiten mit `npm ci` installieren.
3. `npm run dev` starten und `http://localhost:3000` öffnen.

Wichtige Prüfungen:

```text
npm test
npm run lint
npm run build
npm run build:ui-test
npm run test:ui
npx firebase-tools emulators:exec --only firestore "npm test -- --run tests/firestore-rules/mobile-and-scenes.test.ts"
```

Der normale Build benötigt die öffentlichen Firebase-Werte. Serverseitiger Login, QR-Verbindungen und Statusupdates benötigen zusätzlich Firebase-Admin-Zugang sowie die drei mindestens 32 Zeichen langen Geheimnisse aus `.env.example`.

## Sicherheits- und Rollout-Hinweise

- Rollen und privilegierte Statusänderungen werden serverseitig autorisiert.
- Mobile Statuslinks und Rockbreaker-3D sind getrennte, standardmäßig deaktivierte Raum-Features.
- `rockbreaker3d` darf erst öffentlich aktiviert werden, wenn die Weiterverwendungs- und Verteilungserlaubnis der Quelldaten in `lib/rockbreaker/NOTICE.md` als freigegeben dokumentiert ist.
- Datenmigrationen laufen standardmäßig als Dry-run und verlangen für Writes `--apply --confirm-room <Raum-ID>`.

Die ausführlichen Architektur-, Migrations- und Abnahmepläne liegen unter `docs/superpowers/`.
