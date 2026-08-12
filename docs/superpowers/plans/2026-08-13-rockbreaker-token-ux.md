# Rockbreaker Token UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make troop transfers into and out of Rockbreaker discoverable and reliable, place the map dock on the left, and start notes/log panels collapsed on the right.

**Architecture:** Keep the existing transactional token-transfer API authoritative. Fix client-side drop-target selection, expose Rockbreaker as a child drop surface, reuse the existing draggable troop chips in 3D, and isolate session panel placement in a small pure helper.

**Tech Stack:** Next.js 16, React 19, TypeScript, DndKit, Three.js, Vitest, Playwright.

## Global Constraints

- No Firestore schema or token-transfer API change.
- Viewer permissions remain read-only.
- Realtime location conflicts continue to be resolved by the server.
- No Big-Bang refactor of `app/page.tsx`.
- Work only in the web app at `C:\dev\KlabsCom\klabscom`.

---

### Task 1: Specific drop targets beat the surrounding map

**Files:**
- Modify: `app/components/map/token-transfer-controls.tsx`
- Create: `tests/token-drop-target.test.ts`
- Modify: `app/ui-test/token-transfer/page.tsx`
- Modify: `tests/ui/token-transfer.spec.ts`

**Interfaces:**
- Produces: `tokenDropIntentForTargets(targets: readonly string[]): TokenTransferIntent | null`
- Keeps: `tokenDropIntentAtPoint(clientX: number, clientY: number): TokenTransferIntent | null`

- [ ] **Step 1: Write the failing precedence test**

```ts
expect(tokenDropIntentForTargets(["map2d:main", "child:rockbreaker"]))
  .toEqual({ kind: "enterChild", childId: "rockbreaker" });
expect(tokenDropIntentForTargets(["map2d:rockbreaker", "parent"]))
  .toEqual({ kind: "moveUp" });
```

- [ ] **Step 2: Run the test and verify it fails because the helper is missing**

Run: `npm test -- --run tests/token-drop-target.test.ts`

- [ ] **Step 3: Implement target collection and specific-target priority**

```ts
export function tokenDropIntentForTargets(targets: readonly string[]) {
  const specific = targets.find((target) => target === "parent" || target.startsWith("child:"));
  if (specific === "parent") return { kind: "moveUp" };
  return specific?.startsWith("child:")
    ? { kind: "enterChild", childId: specific.slice("child:".length) }
    : null;
}
```

`tokenDropIntentAtPoint` must collect every unique `data-token-drop-target` returned by `elementsFromPoint`, then call this helper instead of stopping at the first surrounding map target.

- [ ] **Step 4: Add a manual pointer-drag UI case whose token overlaps a child pill**

The `/ui-test/token-transfer` harness records the resulting intent after a plain pointer-captured map token is dragged onto `location-pill-rockbreaker`. Assert `{"kind":"enterChild","childId":"rockbreaker"}`.

- [ ] **Step 5: Run unit and UI tests**

Run: `npm test -- --run tests/token-drop-target.test.ts tests/token-transfer.test.ts`

Run: `npx playwright test tests/ui/token-transfer.spec.ts`

- [ ] **Step 6: Commit**

```powershell
git add app/components/map/token-transfer-controls.tsx app/ui-test/token-transfer/page.tsx tests/token-drop-target.test.ts tests/ui/token-transfer.spec.ts
git commit -m "fix: prefer rockbreaker token drop targets"
```

### Task 2: Direct Rockbreaker entry and dual-purpose return target

**Files:**
- Modify: `app/components/map/token-transfer-controls.tsx`
- Modify: `app/components/map/rockbreaker-map.tsx`
- Modify: `app/page.tsx`
- Modify: `app/ui-test/rockbreaker/page.tsx`
- Modify: `tests/ui/rockbreaker-map.spec.ts`

**Interfaces:**
- `ParentLevelDropTarget` gains `onNavigate?: () => void`.
- `RockbreakerMap` exposes its root as `{ type: "child", childId: "rockbreaker" }`.
- `TokenPlacerPanel` gains `showOrders?: boolean`, defaulting to `true`.

- [ ] **Step 1: Write failing UI assertions**

```ts
await dragTroop(page, "troop-chip-g2", "rockbreaker-scene-drop");
await expect(page.getByTestId("rockbreaker-group-g2")).toBeVisible();
await page.getByRole("button", { name: "Eine Ebene hoch nach Nyx" }).click();
await expect(page.getByTestId("rockbreaker-navigation-count")).toHaveText("1");
```

Also assert that clicking the return target does not remove the existing 3D group.

- [ ] **Step 2: Run the Rockbreaker UI test and verify the new assertions fail**

Run: `npx playwright test tests/ui/rockbreaker-map.spec.ts`

- [ ] **Step 3: Make the 3D scene a child drop target**

Attach `useTokenDropTarget("rockbreaker-scene-drop", { type: "child", childId: "rockbreaker" })` to the Rockbreaker root and expose `data-testid="rockbreaker-scene-drop"`.

- [ ] **Step 4: Add click/keyboard navigation to the parent target without changing drop behavior**

```tsx
<TokenDropTarget
  role={onNavigate ? "button" : undefined}
  tabIndex={onNavigate ? 0 : undefined}
  onClick={onNavigate}
  onKeyDown={(event) => {
    if (onNavigate && (event.key === "Enter" || event.key === " ")) onNavigate();
  }}
>
```

Pass `onNavigate={onBack}` from `RockbreakerMap`.

- [ ] **Step 5: Show draggable Nyx groups in the 3D dock**

Render `TokenPlacerPanel` for both `image2d` and `rockbreaker3d`. Pass `showOrders={activeRenderer === "image2d"}` so the 2D-only order action is absent in 3D. Add a compact location label for `unplaced`, `map2d`, `rockbreaker3d`, and `ambiguous` states.

- [ ] **Step 6: Run the Rockbreaker and token-transfer UI tests**

Run: `npx playwright test tests/ui/rockbreaker-map.spec.ts tests/ui/token-transfer.spec.ts`

- [ ] **Step 7: Commit**

```powershell
git add app/components/map/token-transfer-controls.tsx app/components/map/rockbreaker-map.tsx app/page.tsx app/ui-test/rockbreaker/page.tsx tests/ui/rockbreaker-map.spec.ts
git commit -m "feat: make rockbreaker troop transfers discoverable"
```

### Task 3: Move the map control dock to the left

**Files:**
- Modify: `app/components/map/map-control-dock.tsx`
- Modify: `tests/ui/map-control-dock.spec.ts`

**Interfaces:**
- No state-model change; `MapUiPreferences` remains compatible with existing local storage.

- [ ] **Step 1: Change the UI test to require `left: 0px` and left-edge collapse copy**

```ts
await expect(dock).toHaveCSS("left", "0px");
await expect(page.getByRole("button", { name: "Steuerleiste einklappen" }))
  .toHaveAttribute("title", "Nach links einklappen");
```

- [ ] **Step 2: Run the test and verify it fails on the current right dock**

Run: `npx playwright test tests/ui/map-control-dock.spec.ts`

- [ ] **Step 3: Replace right-edge positioning, borders, radii, arrows, and title with left-edge equivalents**

Expanded and collapsed variants use `left-0`, `rounded-r-*`, `border-l-0`; collapse uses `‹`, expansion uses `›`.

- [ ] **Step 4: Run the UI test**

Run: `npx playwright test tests/ui/map-control-dock.spec.ts`

- [ ] **Step 5: Commit**

```powershell
git add app/components/map/map-control-dock.tsx tests/ui/map-control-dock.spec.ts
git commit -m "fix: dock map controls on the left"
```

### Task 4: Start notes and log collapsed on the right

**Files:**
- Create: `lib/ui/session-panel-layout.ts`
- Create: `tests/session-panel-layout.test.ts`
- Modify: `app/page.tsx`

**Interfaces:**
- Produces: `rightPanelStack(viewportWidth: number, notesWidth: number, logWidth: number)` returning `{ notes: { x, y }, logNotes: { x, y } }`.

- [ ] **Step 1: Write the failing pure layout test**

```ts
expect(rightPanelStack(1440, 320, 320)).toEqual({
  notes: { x: 1112, y: 70 },
  logNotes: { x: 1112, y: 108 },
});
```

Also test a narrow viewport clamps both `x` values to `8`.

- [ ] **Step 2: Run the test and verify it fails because the helper is missing**

Run: `npm test -- --run tests/session-panel-layout.test.ts`

- [ ] **Step 3: Implement the pure right-stack calculation**

```ts
const PAD = 8;
export function rightPanelStack(viewportWidth: number, notesWidth: number, logWidth: number) {
  return {
    notes: { x: Math.max(PAD, viewportWidth - notesWidth - PAD), y: 70 },
    logNotes: { x: Math.max(PAD, viewportWidth - logWidth - PAD), y: 108 },
  };
}
```

- [ ] **Step 4: Initialize the session UI after mount**

Set `minimizedPanels` initially to `{ notes: true, log: true }`, `panelLogNotes.visible` initially to `true`, and on mount apply `rightPanelStack(window.innerWidth, notes.w, logNotes.w)` to the two local panel positions. Do not write these values to Firestore or local storage.

- [ ] **Step 5: Run the unit test and related lint**

Run: `npm test -- --run tests/session-panel-layout.test.ts`

Run: `npx eslint app/page.tsx lib/ui/session-panel-layout.ts tests/session-panel-layout.test.ts`

- [ ] **Step 6: Commit**

```powershell
git add app/page.tsx lib/ui/session-panel-layout.ts tests/session-panel-layout.test.ts
git commit -m "fix: start note panels collapsed on the right"
```

### Task 5: Full verification

**Files:**
- Verify only unless a failing check exposes a defect in the files above.

- [ ] **Step 1: Run all unit tests**

Run: `npm test`

- [ ] **Step 2: Run all UI tests against the UI-test build**

Run: `npm run build:ui-test`

Run: `npm run test:ui`

- [ ] **Step 3: Run lint and production build**

Run: `npm run lint`

Run: `npm run build`

- [ ] **Step 4: Inspect the final diff and worktree**

Run: `git diff main...HEAD --check`

Run: `git status --short --branch`

- [ ] **Step 5: Commit verification corrections only if a check required them**

Stage only the corrected files from Tasks 1–4 by their exact paths already listed above, rerun the failed check, and commit with `git commit -m "fix: close rockbreaker ux verification gaps"`. If no correction was required, leave the branch unchanged.
