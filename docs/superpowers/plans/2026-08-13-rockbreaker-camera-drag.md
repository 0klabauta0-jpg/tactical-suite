# Rockbreaker Camera-Relative Token Drag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Rockbreaker troop tokens freely on a bounded camera-facing 3D plane, persist shared `freeSpace` coordinates, and provide a reliable Nyx recovery action.

**Architecture:** Put all drag geometry and bounds in a pure shared module. Keep legacy coordinates readable, validate new group-token moves again in the transactional server store, and integrate the new math only into the existing group-token drag branch while leaving enemy placement unchanged.

**Tech Stack:** Next.js 16, React 19, TypeScript, Three.js, Firebase/Firestore, Vitest, Playwright.

## Global Constraints

- Existing asteroid and belt-plane positions remain readable; no bulk data migration.
- Group-token bounds are `x: -36..37`, `y: -31..25`, `z: -23..29` kilometres.
- Pointer movement stays at least `24 CSS pixels` inside the active canvas.
- Existing token lock, revision, permissions, and realtime subscription behavior remains authoritative.
- Enemy-marker placement behavior remains unchanged.
- No Big-Bang refactor of `app/page.tsx`.

---

### Task 1: Pure camera-plane geometry and free-space coordinates

**Files:**
- Create: `lib/rockbreaker/drag.ts`
- Create: `tests/rockbreaker-drag.test.ts`
- Modify: `lib/rockbreaker/coordinates.ts`
- Modify: `lib/rockbreaker/scene-objects.ts`
- Modify: `tests/rockbreaker-coordinates.test.ts`
- Modify: `tests/rockbreaker-scene-objects.test.ts`

**Interfaces:**
- Produces: `ROCKBREAKER_MOVEMENT_BOUNDS`, `clampCanvasPoint`, `intersectCameraDragPlane`, `clampRockbreakerPosition`, `isRockbreakerPositionWithinBounds`, and `freeSpaceWorldPoint`.
- Extends: `WorldAnchor` with `{ kind: "freeSpace" }`.

- [ ] **Step 1: Write failing geometry tests**

```ts
expect(intersectCameraDragPlane(
  { origin: [0, 5, 10], direction: [0, 0, -1] },
  [0, 2, 0],
  [0, 0, -1],
)).toEqual([0, 5, 0]);
expect(clampCanvasPoint({ x: -100, y: 900 }, { left: 10, top: 20, width: 800, height: 600 }))
  .toEqual({ x: 34, y: 596 });
expect(clampRockbreakerPosition([-100, 80, 90])).toEqual([-36, 25, 29]);
```

- [ ] **Step 2: Run the focused tests and verify missing exports fail**

Run: `npm test -- --run tests/rockbreaker-drag.test.ts tests/rockbreaker-coordinates.test.ts tests/rockbreaker-scene-objects.test.ts`

- [ ] **Step 3: Implement finite vector math and versioned constants**

```ts
export const ROCKBREAKER_MOVEMENT_BOUNDS = {
  x: { min: -36, max: 37 }, y: { min: -31, max: 25 }, z: { min: -23, max: 29 },
} as const;

export function intersectCameraDragPlane(ray: Ray3, planePoint: Vec3, planeNormal: Vec3): Vec3 | null {
  const denominator = dot(ray.direction, planeNormal);
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-8) return null;
  const distance = dot(subtract(planePoint, ray.origin), planeNormal) / denominator;
  if (!Number.isFinite(distance) || distance < 0) return null;
  return add(ray.origin, scale(ray.direction, distance));
}
```

Implement the canvas and world clamps with finite-number guards and return `{ x, y, z, sceneVersion: 1, anchor: { kind: "freeSpace" } }` from `freeSpaceWorldPoint`.

- [ ] **Step 4: Extend parser tests and implementation for `freeSpace`**

```ts
expect(parseWorldPoint({ x: 1, y: 2, z: 3, sceneVersion: 1, anchor: { kind: "freeSpace" } }))
  .toMatchObject({ y: 2, anchor: { kind: "freeSpace" } });
expect(parseWorldPoint({ x: 1, y: 2, z: 3, sceneVersion: 1, anchor: { kind: "unknown" } }))
  .toBeNull();
```

- [ ] **Step 5: Run focused tests and commit**

Run: `npm test -- --run tests/rockbreaker-drag.test.ts tests/rockbreaker-coordinates.test.ts tests/rockbreaker-scene-objects.test.ts`

```powershell
git add lib/rockbreaker/drag.ts lib/rockbreaker/coordinates.ts lib/rockbreaker/scene-objects.ts tests/rockbreaker-drag.test.ts tests/rockbreaker-coordinates.test.ts tests/rockbreaker-scene-objects.test.ts
git commit -m "feat: add bounded rockbreaker drag geometry"
```

### Task 2: Enforce group-token bounds in the transactional write path

**Files:**
- Modify: `lib/server/map-scene-store.ts`
- Modify: `app/api/rooms/[roomId]/map-scenes/[sceneId]/objects/[objectId]/route.ts`
- Modify: `tests/map-scene-store.test.ts`

**Interfaces:**
- Consumes: `isRockbreakerPositionWithinBounds(position)` from Task 1.
- Extends: `MapSceneStoreError` with `OUT_OF_BOUNDS`.

- [ ] **Step 1: Write failing store tests for bounded group moves and unchanged non-group moves**

```ts
await expect(commitSceneObjectMove(store, {
  ...lockedGroupMove,
  position: freeSpaceWorldPoint([38, 0, 0]),
})).rejects.toMatchObject({ code: "OUT_OF_BOUNDS" });

await expect(commitSceneObjectMove(store, {
  ...lockedEnemyMove,
  position: point(100),
})).resolves.toMatchObject({ position: point(100) });
```

- [ ] **Step 2: Run the store test and verify the out-of-bounds group move is accepted before the fix**

Run: `npm test -- --run tests/map-scene-store.test.ts`

- [ ] **Step 3: Validate after loading the authoritative object inside the transaction**

```ts
if (object.type === "groupToken" && !isRockbreakerPositionWithinBounds(input.position)) {
  throw new MapSceneStoreError("OUT_OF_BOUNDS", object);
}
```

Map `OUT_OF_BOUNDS` to HTTP `400`; retain `409` for lock and revision conflicts.

- [ ] **Step 4: Run focused tests and commit**

Run: `npm test -- --run tests/map-scene-store.test.ts`

```powershell
git add lib/server/map-scene-store.ts 'app/api/rooms/[roomId]/map-scenes/[sceneId]/objects/[objectId]/route.ts' tests/map-scene-store.test.ts
git commit -m "fix: reject out-of-bounds troop positions"
```

### Task 3: Use the frozen camera plane for troop-token drags

**Files:**
- Modify: `app/components/map/rockbreaker-map.tsx`
- Modify: `app/ui-test/rockbreaker/page.tsx`
- Modify: `tests/ui/rockbreaker-map.spec.ts`

**Interfaces:**
- Consumes: Task 1 geometry functions.
- Adds optional test seam: `onMoveGroupPosition?: (object: PositionedSceneObject, position: WorldPoint) => Promise<void>`.

- [ ] **Step 1: Write a failing UI test for vertical world movement and edge safety**

```ts
const before = await page.getByTestId("camera-a-coordinate").textContent();
await dragBy(page, page.getByTestId("rockbreaker-group-g1").first(), { x: 0, y: -90 });
await expect(page.getByTestId("camera-a-coordinate")).not.toHaveText(before!);
await expect(page.getByTestId("camera-a-coordinate")).toHaveText(await page.getByTestId("camera-b-coordinate").textContent() ?? "");
await expect(page.getByTestId("camera-a-anchor")).toHaveText("freeSpace");
```

Add a second drag beyond the canvas edge and assert the resulting `x/y/z` values stay inside the shared bounds.

- [ ] **Step 2: Run the Rockbreaker UI test and verify height/anchor assertions fail**

Run: `npx playwright test tests/ui/rockbreaker-map.spec.ts`

- [ ] **Step 3: Freeze drag geometry at pointer-down**

For `groupToken`, store its start point and `camera.getWorldDirection()` as the drag plane. On pointer-move, clamp the client point to the canvas inset, rebuild the camera ray, intersect the frozen plane, clamp the world point, convert it with `freeSpaceWorldPoint`, and update only the local mesh preview.

- [ ] **Step 4: Preserve existing persistence and conflict behavior**

Use `onMoveGroupPosition` when supplied by the UI test route. Otherwise keep the production lock → revision-checked PATCH path. On rejection, restore `confirmedObjectPosition` exactly as before. Non-group objects continue through `pointAt`, including asteroid hits.

- [ ] **Step 5: Update the UI-test route to commit the preview into shared object state**

```tsx
onMoveGroupPosition={async (object, position) => {
  setObjects((current) => current.map((candidate) => candidate.id === object.id
    ? { ...candidate, position, revision: candidate.revision + 1 }
    : candidate));
}}
```

- [ ] **Step 6: Build the UI-test app, run the Rockbreaker tests, and commit**

Run: `npm run build:ui-test`

Run: `npx playwright test tests/ui/rockbreaker-map.spec.ts`

```powershell
git add app/components/map/rockbreaker-map.tsx app/ui-test/rockbreaker/page.tsx tests/ui/rockbreaker-map.spec.ts
git commit -m "feat: move rockbreaker troops in camera space"
```

### Task 4: Recover an unseen Rockbreaker troop through the token list

**Files:**
- Modify: `app/components/map/token-transfer-controls.tsx`
- Modify: `app/page.tsx`
- Modify: `app/ui-test/token-transfer/page.tsx`
- Modify: `tests/ui/token-transfer.spec.ts`

**Interfaces:**
- Produces: `RockbreakerRecoveryButton({ label, disabled, onRecover })`.
- `TokenPlacerPanel` gains `onRecoverFromRockbreaker?: (groupId: string) => void`.

- [ ] **Step 1: Write a failing UI test for mesh-independent recovery**

```ts
await page.goto("/ui-test/token-transfer?rockbreaker=1");
await page.getByRole("button", { name: "Fight Team nach Nyx zurückholen" }).click();
await expect(page.getByTestId("last-transfer-intent")).toHaveText('{"kind":"moveUp"}');
await expect(page.getByTestId("token-main-g1")).toBeVisible();
```

- [ ] **Step 2: Run the token-transfer UI test and verify the recovery button is absent**

Run: `npx playwright test tests/ui/token-transfer.spec.ts`

- [ ] **Step 3: Implement and wire the recovery action**

Render the recovery button for `location.kind === "rockbreaker3d"` while the token section is shown in Rockbreaker. Wire it to:

```tsx
onRecoverFromRockbreaker={(groupId) => {
  void requestTokenTransfer(groupId, { kind: "moveUp" });
}}
```

The button uses the existing pending-transfer set for its disabled state and the transfer service for permissions, source revision, return placement, and conflict messages. The UI-test route initializes `g1` as `{ kind: "rockbreaker3d", sceneId: ROCKBREAKER_SCENE_ID, revision: 1 }` when `rockbreaker=1` is present and renders the same recovery component.

- [ ] **Step 4: Run focused UI tests and commit**

Run: `npm run build:ui-test`

Run: `npx playwright test tests/ui/token-transfer.spec.ts tests/ui/rockbreaker-map.spec.ts`

```powershell
git add app/components/map/token-transfer-controls.tsx app/page.tsx app/ui-test/token-transfer/page.tsx tests/ui/token-transfer.spec.ts
git commit -m "feat: recover rockbreaker troops through the dock"
```

### Task 5: Full verification, merge, and production cutover

**Files:**
- Verify the complete branch and merged `main`.

- [ ] **Step 1: Run all automated checks on the feature branch**

Run: `npm test`

Run: `npm run lint`

Run: `npm run build:ui-test`

Run: `npm run test:ui`

Run: `npm run build`

- [ ] **Step 2: Verify scope and merge with an explicit merge commit**

Run: `git diff main...HEAD --check`

Run: `git status -sb`

Merge: `git switch main`, `git pull --ff-only origin main`, then `git merge --no-ff fix/rockbreaker-camera-drag -m "merge: add bounded camera-relative troop movement"`.

- [ ] **Step 3: Re-run merged-main verification**

Run: `npm test`

Run: `npm run lint`

Run: `npm run build`

- [ ] **Step 4: Push and verify production**

Push: `git push origin main`.

Resolve the deployment URL from the pushed commit and inspect that exact deployment:

```powershell
$commit = git rev-parse HEAD
$status = gh api "repos/0klabauta0-jpg/tactical-suite/commits/$commit/status" | ConvertFrom-Json
$deploymentUrl = ($status.statuses | Where-Object context -eq 'Vercel' | Select-Object -First 1).target_url
npx vercel inspect $deploymentUrl
```

Require GitHub/Vercel state `success`, Vercel target `production`, Vercel status `Ready`, and HTTP `200` from `https://klabscom.vercel.app`.

- [ ] **Step 5: Clean the merged local branch**

Run: `git branch -d fix/rockbreaker-camera-drag` only after the merged commit is on `origin/main` and production is ready.
