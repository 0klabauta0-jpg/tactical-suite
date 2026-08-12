# Web-Qualitätsbasis

Erfasst am 12.08.2026 auf Branch `codex/lint-quality-baseline` vor fachlichen
Änderungen an KlabsCom.

| Prüfung | Ergebnis |
| --- | --- |
| `npm test` | 1 Test, 0 Fehler |
| `npm run lint` | 77 Errors, 33 Warnings |
| `npm run build` | erfolgreich mit vorhandenen `NEXT_PUBLIC_*` Firebase-Werten |

Der Build benötigt die nicht versionierte Firebase-Konfiguration. Für lokale
Worktrees werden diese Werte nur prozesslokal bereitgestellt; `.env.local`
wird nicht in den Branch kopiert oder eingecheckt.

Der Lint-Stand ist die Ausgangsbasis für die folgenden Arbeitspakete. Die
häufigste Regel ist `@typescript-eslint/no-explicit-any` mit 67 Fehlern.
