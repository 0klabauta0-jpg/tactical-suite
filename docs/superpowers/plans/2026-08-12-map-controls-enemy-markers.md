# Kartensteuerung, Grid und dauerhafte Feindmarker – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die drei Kartensteuerungen werden zu einer links angedockten, einklappbaren Leiste; das Grid startet sichtbar und Feindmarker bleiben dauerhaft voll sichtbar.

**Architecture:** Reine Einstellungs- und Markerlogik wandert in kleine Module unter `lib/map`. Eine neue React-Komponente verwaltet ausschließlich Docklayout und Abschnittszustände; die bestehenden fachlichen Karten-, Token- und Zeichenkomponenten werden als Inhalte eingesetzt. Firestore-Daten werden nur dort verändert, wo veraltete Markerwerte beim Lesen normalisiert werden.

**Tech Stack:** Next.js 16.1.6, React 19.2.3, TypeScript 5, Vitest 4.1.10, Playwright 1.62.1, Browser `localStorage`.

## Global Constraints

- Kein Big-Bang-Refactor von `app/page.tsx`; nur die für Kartensteuerung und Zeichenelemente benötigten Grenzen extrahieren.
- Grid ist beim ersten Start `true`, bleibt aber persönlich ausschaltbar.
- Feindmarker verblassen und löschen sich niemals automatisch.
- Bestehende Marker mit beliebigem `opacity`-Wert werden voll sichtbar gerendert.
- Karten-, Token- und Zeichenbereiche teilen ein linkes Dock; Notizen und Logs bleiben unverändert frei beweglich.
- Jede Verhaltensänderung beginnt mit einem fehlschlagenden Test.

---

## Geplante Dateistruktur

- `lib/map/ui-preferences.ts`: validiert, lädt und speichert persönliche Karten-UI-Einstellungen.
- `lib/map/enemy-markers.ts`: normalisiert Feindmarker und formatiert Altersangaben.
- `app/components/map/map-control-dock.tsx`: Dockrahmen, vertikales Ziehen und drei klappbare Bereiche.
- `app/page.tsx`: bindet bestehende Controls in das Dock ein und verwendet die extrahierte Markerlogik.
- `tests/map-ui-preferences.test.ts`: reine Präferenztests.
- `tests/enemy-markers.test.ts`: Persistenz- und Altersformatierung.
- `tests/ui/map-control-dock.spec.ts`: Browserabnahme über eine kleine Testseite.
- `app/ui-test/map-controls/page.tsx`: nur bei explizitem UI-Test-Build erreichbare Testoberfläche für das Dock.

### Task 1: Persönliche Karten-UI-Einstellungen

**Files:**
- Create: `lib/map/ui-preferences.ts`
- Create: `tests/map-ui-preferences.test.ts`

**Interfaces:**
- Produces: `MapUiPreferences`, `DEFAULT_MAP_UI_PREFERENCES`, `parseMapUiPreferences(value)`, `loadMapUiPreferences(storage, key)`, `saveMapUiPreferences(storage, key, value)`.
- Consumes: keine Produktmodule.

- [ ] **Step 1: Failing Tests für sichere Defaults und gespeicherte Werte schreiben**

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAP_UI_PREFERENCES,
  loadMapUiPreferences,
  parseMapUiPreferences,
} from "@/lib/map/ui-preferences";

describe("map UI preferences", () => {
  it("starts with a visible grid and expanded dock", () => {
    expect(parseMapUiPreferences(undefined)).toEqual(DEFAULT_MAP_UI_PREFERENCES);
    expect(DEFAULT_MAP_UI_PREFERENCES.showGrid).toBe(true);
    expect(DEFAULT_MAP_UI_PREFERENCES.dockCollapsed).toBe(false);
  });

  it("keeps only bounded and boolean persisted values", () => {
    expect(parseMapUiPreferences({
      showGrid: false,
      dockCollapsed: true,
      dockY: -200,
      sections: { maps: false, tokens: true, drawing: false },
    })).toEqual({
      showGrid: false,
      dockCollapsed: true,
      dockY: 70,
      sections: { maps: false, tokens: true, drawing: false },
    });
  });

  it("falls back when local storage contains malformed JSON", () => {
    const storage = { getItem: () => "{broken", setItem: () => undefined };
    expect(loadMapUiPreferences(storage, "map-ui:test")).toEqual(DEFAULT_MAP_UI_PREFERENCES);
  });
});
```

- [ ] **Step 2: Test ausführen und erwartetes Fehlschlagen bestätigen**

Run: `npm test -- --run tests/map-ui-preferences.test.ts`
Expected: FAIL mit `Cannot find module '@/lib/map/ui-preferences'`.

- [ ] **Step 3: Minimale Präferenzimplementierung schreiben**

```ts
export type MapControlSections = { maps: boolean; tokens: boolean; drawing: boolean };
export type MapUiPreferences = {
  showGrid: boolean;
  dockCollapsed: boolean;
  dockY: number;
  sections: MapControlSections;
};

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

export const DEFAULT_MAP_UI_PREFERENCES: MapUiPreferences = {
  showGrid: true,
  dockCollapsed: false,
  dockY: 70,
  sections: { maps: true, tokens: true, drawing: true },
};

export function parseMapUiPreferences(value: unknown): MapUiPreferences {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return structuredClone(DEFAULT_MAP_UI_PREFERENCES);
  }
  const record = value as Record<string, unknown>;
  const sections = typeof record.sections === "object" && record.sections !== null
    ? record.sections as Record<string, unknown>
    : {};
  return {
    showGrid: typeof record.showGrid === "boolean" ? record.showGrid : true,
    dockCollapsed: typeof record.dockCollapsed === "boolean" ? record.dockCollapsed : false,
    dockY: typeof record.dockY === "number" && Number.isFinite(record.dockY)
      ? Math.max(70, record.dockY)
      : 70,
    sections: {
      maps: typeof sections.maps === "boolean" ? sections.maps : true,
      tokens: typeof sections.tokens === "boolean" ? sections.tokens : true,
      drawing: typeof sections.drawing === "boolean" ? sections.drawing : true,
    },
  };
}

export function loadMapUiPreferences(storage: StorageLike, key: string): MapUiPreferences {
  try { return parseMapUiPreferences(JSON.parse(storage.getItem(key) ?? "null")); }
  catch { return structuredClone(DEFAULT_MAP_UI_PREFERENCES); }
}

export function saveMapUiPreferences(storage: StorageLike, key: string, value: MapUiPreferences): void {
  storage.setItem(key, JSON.stringify(parseMapUiPreferences(value)));
}
```

- [ ] **Step 4: Fokussierte und vollständige Tests ausführen**

Run: `npm test -- --run tests/map-ui-preferences.test.ts`
Expected: 3 Tests PASS.
Run: `npm test`
Expected: alle bestehenden Tests PASS.

- [ ] **Step 5: Commit erstellen**

```powershell
git add lib/map/ui-preferences.ts tests/map-ui-preferences.test.ts
git commit -m "feat: persist map control preferences"
```

### Task 2: Dauerhafte Feindmarker als validierte Domänenwerte

**Files:**
- Create: `lib/map/enemy-markers.ts`
- Create: `tests/enemy-markers.test.ts`
- Modify: `app/page.tsx` bei `DrawMarker`, `DrawingLayer.redraw`, Markeranlage und Marker-Altersticker.

**Interfaces:**
- Produces: `EnemyMarker`, `normalizeEnemyMarker(value)`, `enemyMarkerAgeLabel(createdAt, now)`.
- Consumes: Markerarten `infantry | ground | air`.

- [ ] **Step 1: Failing Tests für volle Sichtbarkeit und Alter schreiben**

```ts
import { describe, expect, it } from "vitest";
import { enemyMarkerAgeLabel, normalizeEnemyMarker } from "@/lib/map/enemy-markers";

describe("enemy markers", () => {
  it("ignores persisted fade values and keeps the marker fully visible", () => {
    expect(normalizeEnemyMarker({
      id: "enemy-1", type: "marker", kind: "ground",
      x: 0.25, y: 0.75, color: "#ef4444", opacity: 0.05, createdAt: 1_000,
    })).toEqual({
      id: "enemy-1", type: "marker", kind: "ground",
      x: 0.25, y: 0.75, color: "#ef4444", opacity: 1, createdAt: 1_000,
    });
  });

  it("formats a stable marker age without changing marker data", () => {
    expect(enemyMarkerAgeLabel(1_000, 31_000)).toBe("<1m");
    expect(enemyMarkerAgeLabel(1_000, 181_000)).toBe("3m");
    expect(enemyMarkerAgeLabel(1_000, 3_721_000)).toBe("1h2m");
  });

  it("rejects malformed coordinates and marker kinds", () => {
    expect(normalizeEnemyMarker({ id: "x", type: "marker", kind: "ship", x: 0, y: 0 })).toBeNull();
  });
});
```

- [ ] **Step 2: Test ausführen und erwartetes Fehlschlagen bestätigen**

Run: `npm test -- --run tests/enemy-markers.test.ts`
Expected: FAIL, Modul fehlt.

- [ ] **Step 3: Markerparser und Altersformatierung implementieren**

```ts
export type EnemyMarker = {
  id: string;
  type: "marker";
  kind: "infantry" | "ground" | "air";
  x: number;
  y: number;
  color: string;
  opacity: 1;
  createdAt: number;
};

export function normalizeEnemyMarker(value: unknown): EnemyMarker | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || item.type !== "marker") return null;
  if (item.kind !== "infantry" && item.kind !== "ground" && item.kind !== "air") return null;
  if (typeof item.x !== "number" || !Number.isFinite(item.x)
    || typeof item.y !== "number" || !Number.isFinite(item.y)) return null;
  return {
    id: item.id, type: "marker", kind: item.kind,
    x: item.x, y: item.y,
    color: typeof item.color === "string" ? item.color : "#ef4444",
    opacity: 1,
    createdAt: typeof item.createdAt === "number" && Number.isFinite(item.createdAt)
      ? item.createdAt
      : Date.now(),
  };
}

export function enemyMarkerAgeLabel(createdAt: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - createdAt) / 60_000));
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)}h${rest ? `${rest}m` : ""}`;
}
```

- [ ] **Step 4: `app/page.tsx` auf die zentrale Markerlogik umstellen**

Konkrete Änderungen:

- `DrawMarker` durch importierten Typ `EnemyMarker` ersetzen.
- Beim Rendern `ctx.globalAlpha = 1` setzen.
- Alterslabel über `enemyMarkerAgeLabel(el.createdAt, markerNow)` erzeugen.
- Den globalen `markerTick` in `BoardApp` entfernen.
- In `DrawingLayer` einen lokalen `markerNow`-State nur dann minütlich aktualisieren, wenn `elements.some(el => el.type === "marker")` wahr ist.
- Hilfe `Feind ⚠ (fade)` in `Feind ⚠ (dauerhaft)` ändern.
- Tooltiptext `alle 30s blasser, löscht sich automatisch` durch `bleibt sichtbar, bis er manuell gelöscht wird` ersetzen.
- `onResetTool` nach dem Setzen weiterhin beibehalten; das Zeichenfenster selbst bleibt künftig sichtbar.

Lokaler Timer:

```ts
const hasEnemyMarkers = elements.some((element) => element.type === "marker");
const [markerNow, setMarkerNow] = useState(() => Date.now());
useEffect(() => {
  if (!hasEnemyMarkers) return;
  const timer = window.setInterval(() => setMarkerNow(Date.now()), 60_000);
  return () => window.clearInterval(timer);
}, [hasEnemyMarkers]);
```

- [ ] **Step 5: Tests, Lint und Build prüfen**

Run: `npm test -- --run tests/enemy-markers.test.ts`
Expected: 3 Tests PASS.
Run: `npm test`
Expected: gesamte Suite PASS.
Run: `npm run lint`
Expected: keine neuen Fehler oder Warnungen.
Run: `npm run build` mit den bereits verwendeten lokalen `NEXT_PUBLIC_*`-Variablen
Expected: Production Build PASS.

- [ ] **Step 6: Commit erstellen**

```powershell
git add lib/map/enemy-markers.ts tests/enemy-markers.test.ts app/page.tsx
git commit -m "fix: keep enemy markers permanently visible"
```

### Task 3: Reine Dockzustandslogik

**Files:**
- Create: `lib/map/control-dock.ts`
- Create: `tests/map-control-dock.test.ts`

**Interfaces:**
- Produces: `clampDockY(y, viewportHeight, dockHeight)`, `toggleDockSection(preferences, section)`.
- Consumes: `MapUiPreferences`, `MapControlSections` aus Task 1.

- [ ] **Step 1: Failing Tests für vertikales Klemmen und Abschnittswechsel schreiben**

```ts
import { describe, expect, it } from "vitest";
import { clampDockY, toggleDockSection } from "@/lib/map/control-dock";
import { DEFAULT_MAP_UI_PREFERENCES } from "@/lib/map/ui-preferences";

describe("map control dock", () => {
  it("keeps the dock between the header and viewport bottom", () => {
    expect(clampDockY(-20, 800, 500)).toBe(70);
    expect(clampDockY(700, 800, 500)).toBe(292);
  });

  it("toggles only the selected section", () => {
    const next = toggleDockSection(DEFAULT_MAP_UI_PREFERENCES, "tokens");
    expect(next.sections).toEqual({ maps: true, tokens: false, drawing: true });
    expect(next.showGrid).toBe(true);
  });
});
```

- [ ] **Step 2: Test ausführen und erwartetes Fehlschlagen bestätigen**

Run: `npm test -- --run tests/map-control-dock.test.ts`
Expected: FAIL, Modul fehlt.

- [ ] **Step 3: Minimale reine Docklogik implementieren**

```ts
import type { MapControlSections, MapUiPreferences } from "@/lib/map/ui-preferences";

const HEADER_BOTTOM = 70;
const VIEWPORT_PADDING = 8;

export function clampDockY(y: number, viewportHeight: number, dockHeight: number): number {
  const maximum = Math.max(HEADER_BOTTOM, viewportHeight - dockHeight - VIEWPORT_PADDING);
  return Math.min(Math.max(HEADER_BOTTOM, y), maximum);
}

export function toggleDockSection(
  preferences: MapUiPreferences,
  section: keyof MapControlSections,
): MapUiPreferences {
  return {
    ...preferences,
    sections: { ...preferences.sections, [section]: !preferences.sections[section] },
  };
}
```

- [ ] **Step 4: Tests ausführen und committen**

Run: `npm test -- --run tests/map-control-dock.test.ts`
Expected: 2 Tests PASS.

```powershell
git add lib/map/control-dock.ts tests/map-control-dock.test.ts
git commit -m "feat: define map control dock behavior"
```

### Task 4: Angedockte React-Steuerleiste

**Files:**
- Create: `app/components/map/map-control-dock.tsx`
- Modify: `app/page.tsx` bei `DrawingToolbar`, `showToolbar/showNav/showPlacer`, Panelbuttons und Kartenansicht.
- Create: `app/ui-test/map-controls/page.tsx`
- Create: `tests/ui/map-control-dock.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `MapUiPreferences`, `saveMapUiPreferences`, `clampDockY`, drei React-Nodes für Karten, Tokens und Zeichnen.
- Produces: `MapControlDock` mit Props `preferences`, `onPreferencesChange`, `maps`, `tokens`, `drawing`.

- [ ] **Step 1: Browsertest für Dock, Abschnitte und Grid-Default schreiben**

```ts
import { expect, test } from "@playwright/test";

test("keeps map controls in one collapsible left dock", async ({ page }) => {
  await page.goto("/ui-test/map-controls");
  const dock = page.getByRole("complementary", { name: "Kartensteuerung" });
  await expect(dock).toBeVisible();
  await expect(page.getByRole("button", { name: "Grid ausschalten" })).toBeVisible();
  await expect(page.getByText("Karten-Testinhalt")).toBeVisible();
  await expect(page.getByText("Token-Testinhalt")).toBeVisible();
  await expect(page.getByText("Zeichen-Testinhalt")).toBeVisible();

  await page.getByRole("button", { name: "Tokenbereich einklappen" }).click();
  await expect(page.getByText("Token-Testinhalt")).toBeHidden();

  await page.getByRole("button", { name: "Steuerleiste einklappen" }).click();
  await expect(dock).toHaveAttribute("data-collapsed", "true");
});
```

- [ ] **Step 2: Browsertest ausführen und erwartetes Fehlschlagen bestätigen**

Run: zunächst `npm run build`, danach `npm run test:ui -- tests/ui/map-control-dock.spec.ts`
Expected: FAIL mit 404 oder fehlendem `Kartensteuerung`-Element.

- [ ] **Step 3: `MapControlDock` implementieren**

Die Komponente:

- rendert `<aside aria-label="Kartensteuerung">` am linken Rand,
- nutzt Pointer Capture ausschließlich auf dem Draghandle,
- verändert nur `dockY`, niemals `x`,
- klemmt `dockY` über `clampDockY`,
- bietet einen Gesamt-Einklappbutton,
- bietet je Abschnitt einen Button mit eindeutiger `aria-label`,
- rendert Inhalte nur bei geöffnetem Gesamt- und Abschnittszustand,
- bietet den Gridbutton als `Grid einschalten` beziehungsweise `Grid ausschalten`,
- ruft jede Zustandsänderung über `onPreferencesChange(next)` zurück.

Signatur:

```tsx
export type MapControlDockProps = {
  preferences: MapUiPreferences;
  onPreferencesChange: (next: MapUiPreferences) => void;
  maps: React.ReactNode;
  tokens: React.ReactNode;
  drawing: React.ReactNode;
};

export declare function MapControlDock(props: MapControlDockProps): React.ReactElement;
```

- [ ] **Step 4: Explizit freigeschaltete Testseite implementieren**

`app/ui-test/map-controls/page.tsx` rendert das echte Dock mit drei statischen Testinhalten. Wenn `process.env.NEXT_PUBLIC_ENABLE_UI_TEST_ROUTES !== "1"`, wird `notFound()` aufgerufen. Die Seite verwendet `DEFAULT_MAP_UI_PREFERENCES` als Anfangszustand und setzt `robots: { index: false, follow: false }`.

Da Next.js öffentliche Buildvariablen beim Build einbettet, erhält `package.json` einen Windows-kompatiblen Test-Build über `cross-env`:

```json
{
  "scripts": {
    "build:ui-test": "cross-env NEXT_PUBLIC_ENABLE_UI_TEST_ROUTES=1 next build"
  },
  "devDependencies": {
    "cross-env": "^10.0.0"
  }
}
```

Der normale Befehl `npm run build` setzt die Variable nicht; die Route liefert dort 404.

- [ ] **Step 5: Browsertest grün machen**

Run: `npm run build:ui-test` mit Firebase-Public-Variablen.
Run: `npm run test:ui -- tests/ui/map-control-dock.spec.ts`
Expected: Test PASS.

- [ ] **Step 6: Bestehende Kartenansicht auf das Dock umstellen**

In `BoardApp`:

- Präferenzen nach erfolgreichem Mount aus `localStorage` mit Schlüssel `klabscom:map-ui:${roomId}:${currentPlayer.id}` laden.
- jede Änderung zurückschreiben.
- `showGrid` aus Präferenzen ableiten statt separatem `useState(false)`.
- die drei runden Headerbuttons für `toolbar`, `nav` und `placer` entfernen.
- die drei separaten absoluten Wrapper im Kartenbereich entfernen.
- bestehende `MapNavPanel`, `TokenPlacerPanel` und den Inhalt von `DrawingToolbar` als Dockabschnitte einsetzen.
- `DrawingToolbar` in einen eingebetteten Inhalt ohne eigenes Draghandle/absolute Position umwandeln; Farb-, Breiten-, Undo- und Clearlogik bleibt unverändert.
- Tokenbereich für Viewer weiterhin nicht rendern; Kartenbereich bleibt lesbar.
- Dockbreite und `z-index` so setzen, dass Karte und Controls bedienbar bleiben.

- [ ] **Step 7: Gesamtabnahme durchführen**

Run: `npm test`
Expected: alle Unit-Tests PASS.
Run: `npm run test:ui`
Expected: alle Browsertests PASS.
Run: `npm run lint`
Expected: keine neuen Meldungen; die bisherigen Canvaswarnungen werden durch die berührten Hookgrenzen nicht vermehrt.
Run: `npm run build`
Expected: PASS.

- [ ] **Step 8: Commit erstellen**

```powershell
git add app/components/map/map-control-dock.tsx app/ui-test/map-controls/page.tsx tests/ui/map-control-dock.spec.ts app/page.tsx playwright.config.ts package.json package-lock.json
git commit -m "feat: dock map controls on the left"
```
