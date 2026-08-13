# Collaborative Rockbreaker 3D Drawing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add shared freehand 3D paths and points to Rockbreaker, make complete drawings movable and deletable, and let enemy markers move freely on X/Y/Z.

**Architecture:** Drawings remain independent documents in the existing Rockbreaker scene-object collection. Pure geometry helpers own sampling, simplification, translation, bounds, and undo selection; the transactional server remains authoritative for create, move, and delete; `RockbreakerMap` owns pointer interaction and delegates object construction/disposal to a focused Three.js renderer module. The existing left map dock exposes drawing controls, while the existing realtime listener distributes authoritative objects.

**Tech Stack:** Next.js 16, React 19, TypeScript, Three.js, Firebase Admin/Firestore, Vitest, Playwright, ESLint.

## Global Constraints

- A stroke is one independent Firestore document with 2 to 512 world points.
- Stored stroke width is finite and restricted to `1`, `3`, or `6`.
- Only `admin` and `commander` can create, move, or delete scene objects; viewers only render them.
- All scene writes continue through authenticated server routes; Firestore client rules remain read-only for scene mutations.
- Creation is local preview only until pointer release, followed by one atomic create.
- Stroke movement sends a translation vector; the server applies it to authoritative points inside one transaction.
- Every created or moved position must remain inside `ROCKBREAKER_MOVEMENT_BOUNDS`.
- Undo deletes only the current user's newest still-existing `point` or `stroke` object.
- Existing `groupToken` deletion protection remains unchanged.
- Existing rooms require no data migration.
- Text, editable individual vertices, filled shapes, variable-depth strokes, import/export, and 2D drawing storage changes are out of scope.
- Do not merge, push, or deploy this new feature without explicit user approval after verification.

---

### Task 1: Stroke domain model and pure geometry

**Files:**
- Create: `lib/rockbreaker/drawing.ts`
- Modify: `lib/rockbreaker/scene-objects.ts`
- Test: `tests/rockbreaker-drawing.test.ts`
- Test: `tests/rockbreaker-scene-objects.test.ts`

**Interfaces:**
- Consumes: `WorldPoint`, `Vec3`, `ROCKBREAKER_MOVEMENT_BOUNDS`, and `isRockbreakerPositionWithinBounds`.
- Produces: `RockbreakerDrawingTool`, `StrokeSample`, `appendStrokeSample`, `simplifyStrokePoints`, `translateStrokePoints`, `clampStrokeTranslation`, `latestOwnDrawingObject`, and the `stroke` member of `SceneObject`.

- [ ] **Step 1: Write failing parser and geometry tests**

Add these cases before production code:

```ts
const free = (x: number, y = 0, z = 0) => ({
  x, y, z, sceneVersion: 1 as const, anchor: { kind: "freeSpace" as const },
});
const drawingBase = (id: string, uid: string, createdAtMs: number) => ({
  id, systemId: "nyx" as const, mapId: "rockbreaker" as const, sceneVersion: 1 as const,
  color: "#22d3ee", revision: 0, createdBy: uid, createdAtMs,
  updatedBy: uid, updatedAtMs: createdAtMs,
});
const scenePoint = (id: string, uid: string, createdAtMs: number): SceneObject => ({
  ...drawingBase(id, uid, createdAtMs), type: "point", position: free(0),
});
const sceneStroke = (id: string, uid: string, createdAtMs: number): SceneObject => ({
  ...drawingBase(id, uid, createdAtMs), type: "stroke", width: 3, points: [free(0), free(1)],
});
const sceneEnemy = (id: string, uid: string, createdAtMs: number): SceneObject => ({
  ...drawingBase(id, uid, createdAtMs), type: "enemyMarker", kind: "ground", position: free(0),
});

it("parses one bounded stroke object", () => {
  expect(parseSceneObject({
    ...common, id: "stroke--1", type: "stroke", width: 3,
    points: [free(1), free(2, 1)],
  })).toMatchObject({ type: "stroke", width: 3, points: [{ x: 1 }, { x: 2, y: 1 }] });
});

it.each([
  { width: 0, points: [free(1), free(2)] },
  { width: 2, points: [free(1), free(2)] },
  { width: 3, points: [free(1)] },
  { width: 3, points: Array.from({ length: 513 }, (_, index) => free(index / 20)) },
])("rejects malformed strokes", (stroke) => {
  expect(parseSceneObject({ ...common, id: "bad", type: "stroke", ...stroke })).toBeNull();
});

it("samples by screen distance and simplifies a 3d path", () => {
  const samples = [
    { screen: { x: 10, y: 10 }, world: free(0) },
    { screen: { x: 11, y: 11 }, world: free(0.01) },
  ];
  expect(appendStrokeSample(samples, { screen: { x: 12, y: 12 }, world: free(0.02) }, 4)).toHaveLength(2);
  const appended = appendStrokeSample(samples, { screen: { x: 20, y: 10 }, world: free(1) }, 4);
  expect(appended).toHaveLength(3);
  expect(simplifyStrokePoints([free(0), free(1, 0.01), free(2)], 0.05)).toEqual([free(0), free(2)]);
});

it("clamps one translation for the complete path and preserves shape", () => {
  const points = [free(35, 4, -2), free(36, 7, 1)];
  const delta = clampStrokeTranslation(points, [10, -2, 4]);
  expect(delta).toEqual([1, -2, 4]);
  expect(translateStrokePoints(points, delta).map(({ x, y, z }) => [x, y, z]))
    .toEqual([[36, 2, 2], [37, 5, 5]]);
});

it("selects only the current user's latest drawing for undo", () => {
  expect(latestOwnDrawingObject([
    scenePoint("other", "u2", 20),
    sceneStroke("mine-old", "u1", 10),
    sceneStroke("mine-new", "u1", 30),
    sceneEnemy("enemy", "u1", 40),
  ], "u1")?.id).toBe("mine-new");
});
```

- [ ] **Step 2: Run the focused tests and confirm the red state**

Run:

```powershell
npx vitest run tests/rockbreaker-drawing.test.ts tests/rockbreaker-scene-objects.test.ts
```

Expected: failure because `drawing.ts`, the helper exports, and `stroke` parsing do not exist.

- [ ] **Step 3: Add the stroke type and pure helpers**

Extend `SceneObject` without removing the legacy `line` parser:

```ts
export const ROCKBREAKER_STROKE_WIDTHS = [1, 3, 6] as const;
export const ROCKBREAKER_STROKE_MAX_POINTS = 512;
export type RockbreakerStrokeWidth = typeof ROCKBREAKER_STROKE_WIDTHS[number];

export type SceneObject = SceneObjectBase & (
  // existing variants
  | { type: "stroke"; width: RockbreakerStrokeWidth; points: WorldPoint[] }
);
export type StrokeSceneObject = Extract<SceneObject, { type: "stroke" }>;
```

In `parseSceneObject`, parse a stroke before the single-position branch. Require an allowed width, an array length of `2..512`, and every entry to pass `parseWorldPoint`.

Create `drawing.ts` with these exact public signatures:

```ts
export type RockbreakerDrawingTool = "pointer" | "point" | "stroke" | "move" | "delete";
export type StrokeSample = { screen: { x: number; y: number }; world: WorldPoint };

export function appendStrokeSample(
  samples: readonly StrokeSample[], next: StrokeSample, minimumScreenDistance = 4,
): StrokeSample[];

export function simplifyStrokePoints(
  points: readonly WorldPoint[], tolerance = 0.08,
): WorldPoint[];

export function translateStrokePoints(points: readonly WorldPoint[], delta: Vec3): WorldPoint[];
export function clampStrokeTranslation(points: readonly WorldPoint[], desired: Vec3): Vec3;
export function latestOwnDrawingObject(objects: readonly SceneObject[], uid: string): SceneObject | null;
```

Implementation requirements:

- `appendStrokeSample` compares the last and next screen coordinates with Euclidean distance and returns the unchanged samples when below the threshold.
- `simplifyStrokePoints` uses 3D Ramer-Douglas-Peucker distance to the line segment, always preserves first/last, and caps the returned result at 512 by uniform index selection if simplification still exceeds the limit.
- `translateStrokePoints` returns new `freeSpace` world points.
- `clampStrokeTranslation` derives one permitted delta interval per axis from the minimum and maximum coordinates of the whole path.
- `latestOwnDrawingObject` considers only `point` and `stroke`, matches `createdBy`, and selects the highest `createdAtMs`.

- [ ] **Step 4: Run the focused tests until green**

Run the same Vitest command. Expected: both files pass with malformed widths, counts, and coordinates rejected.

- [ ] **Step 5: Commit the domain slice**

```powershell
git add lib/rockbreaker/drawing.ts lib/rockbreaker/scene-objects.ts tests/rockbreaker-drawing.test.ts tests/rockbreaker-scene-objects.test.ts
git commit -m "feat: model shared rockbreaker strokes"
```

---

### Task 2: Transactional create, movement, and deletion rules

**Files:**
- Modify: `lib/server/map-scene-store.ts`
- Test: `tests/map-scene-store.test.ts`

**Interfaces:**
- Consumes: `StrokeSceneObject`, `Vec3`, `translateStrokePoints`, and the shared movement bounds.
- Produces: stroke-aware `SceneObjectDraft` and `commitSceneObjectTranslation(store, input)`.

- [ ] **Step 1: Write failing transaction tests**

Add tests that prove:

```ts
async function createStroke(
  store: MapSceneTransactionStore,
  actor: { uid: string; role: "admin" | "commander" },
  points: WorldPoint[],
) {
  return createSceneObject(store, {
    roomId: "room", sceneId: "nyx--rockbreaker", actor, nowMs: 1,
    draft: { type: "stroke", color: "#22d3ee", width: 3, points },
  });
}

it("creates one atomic stroke and rejects an out-of-bounds point", async () => {
  const { store } = createStore();
  const actor = { uid: "u1", role: "commander" as const };
  const stroke = await createSceneObject(store, {
    roomId: "room", sceneId: "nyx--rockbreaker", actor, nowMs: 1,
    draft: { type: "stroke", color: "#22d3ee", width: 3, points: [free(1), free(2, 1)] },
  });
  expect(stroke).toMatchObject({ type: "stroke", revision: 0, createdBy: "u1" });
  await expect(createSceneObject(store, {
    roomId: "room", sceneId: "nyx--rockbreaker", actor, nowMs: 2,
    draft: { type: "point", color: "#ffffff", position: free(99) },
  })).rejects.toMatchObject({ code: "OUT_OF_BOUNDS" });
});

it("translates the authoritative locked stroke and preserves its shape", async () => {
  const { store } = createStore();
  const actor = { uid: "u1", role: "commander" as const };
  const created = await createStroke(store, actor, [free(1), free(3, 2)]);
  const locked = await acquireSceneObjectLock(store, {
    roomId: "room", sceneId: "nyx--rockbreaker", objectId: created.id, actor, nowMs: 2,
  });
  const moved = await commitSceneObjectTranslation(store, {
    roomId: "room", sceneId: "nyx--rockbreaker", objectId: created.id, actor,
    expectedRevision: created.revision, expectedLockRevision: locked.lockRevision!,
    translation: [2, 4, -1], nowMs: 3,
  });
  expect(moved).toMatchObject({ revision: 1, points: [free(3, 4, -1), free(5, 6, -1)] });
});

it("rejects stale and out-of-bounds stroke translations", async () => {
  const { store } = createStore();
  const actor = { uid: "u1", role: "commander" as const };
  const created = await createStroke(store, actor, [free(35), free(36)]);
  const locked = await acquireSceneObjectLock(store, {
    roomId: "room", sceneId: "nyx--rockbreaker", objectId: created.id, actor, nowMs: 2,
  });
  const base = {
    roomId: "room", sceneId: "nyx--rockbreaker", objectId: created.id, actor,
    expectedLockRevision: locked.lockRevision!, nowMs: 3,
  };
  await expect(commitSceneObjectTranslation(store, {
    ...base, expectedRevision: 99, translation: [1, 0, 0],
  })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  await expect(commitSceneObjectTranslation(store, {
    ...base, expectedRevision: created.revision, translation: [2, 0, 0],
  })).rejects.toMatchObject({ code: "OUT_OF_BOUNDS" });
});

it("bounds enemy marker movement on x y z", async () => {
  const { store } = createStore();
  const actor = { uid: "u1", role: "commander" as const };
  const enemy = await createSceneObject(store, {
    roomId: "room", sceneId: "nyx--rockbreaker", actor, nowMs: 1,
    draft: { type: "enemyMarker", kind: "ground", color: "#ef4444", position: free(1) },
  });
  const locked = await acquireSceneObjectLock(store, {
    roomId: "room", sceneId: "nyx--rockbreaker", objectId: enemy.id, actor, nowMs: 2,
  });
  await expect(commitSceneObjectMove(store, {
    roomId: "room", sceneId: "nyx--rockbreaker", objectId: enemy.id, actor,
    expectedRevision: enemy.revision, expectedLockRevision: locked.lockRevision!,
    position: free(100, 40, -50), nowMs: 3,
  })).rejects.toMatchObject({ code: "OUT_OF_BOUNDS" });
});

it("deletes strokes but keeps troop tokens protected", async () => {
  const { objects, store } = createStore();
  const actor = { uid: "u1", role: "admin" as const };
  const stroke = await createStroke(store, actor, [free(1), free(2)]);
  await deleteSceneObject(store, {
    roomId: "room", sceneId: "nyx--rockbreaker", objectId: stroke.id, actor,
  });
  expect(objects.has(stroke.id)).toBe(false);
  objects.set("groupToken--g1", groupObject("g1", free(1)));
  await expect(deleteSceneObject(store, {
    roomId: "room", sceneId: "nyx--rockbreaker", objectId: "groupToken--g1", actor,
  })).rejects.toMatchObject({ code: "PROTECTED_OBJECT" });
});
```

Add this fixture beside `createStore`:

```ts
function groupObject(groupId: string, position: WorldPoint): SceneObject {
  return {
    id: `groupToken--${groupId}`, type: "groupToken", groupId,
    systemId: "nyx", mapId: "rockbreaker", sceneVersion: 1,
    color: "#0ea5e9", position, revision: 0,
    createdBy: "u1", createdAtMs: 1, updatedBy: "u1", updatedAtMs: 1,
  };
}
```

- [ ] **Step 2: Run the store test and verify failure**

```powershell
npx vitest run tests/map-scene-store.test.ts
```

Expected: failures for the missing stroke draft and translation function; the old enemy-out-of-bounds expectation must fail after the rule changes.

- [ ] **Step 3: Implement authoritative validation and translation**

Extend the draft union:

```ts
export type SceneObjectDraft =
  // existing variants
  | { type: "stroke"; color: string; width: RockbreakerStrokeWidth; points: WorldPoint[] };
```

Add:

```ts
export async function commitSceneObjectTranslation(store: MapSceneTransactionStore, input: {
  roomId: string;
  sceneId: string;
  objectId: string;
  actor: MapSceneActor;
  expectedRevision: number;
  expectedLockRevision: number;
  translation: Vec3;
  nowMs: number;
}): Promise<StrokeSceneObject>;
```

The function must execute `assertWriter`, `assertBoundary`, revision check, actor-owned unexpired lock check, and `object.type === "stroke"` inside the transaction. Apply `translateStrokePoints` to `object.points`, reject with `OUT_OF_BOUNDS` if any result violates the shared bounds, increment `revision`, and update audit fields.

Update `createSceneObject` so point, enemy, order, and stroke coordinates are all checked against shared bounds. Update `commitSceneObjectMove` so every positioned scene object—not only group tokens—is bounded. Do not weaken group-token create/delete protection.

- [ ] **Step 4: Run the store tests until green**

```powershell
npx vitest run tests/map-scene-store.test.ts tests/rockbreaker-drawing.test.ts
```

Expected: atomic stroke create/translate/delete, conflict rejection, viewer rejection, and enemy bounds all pass.

- [ ] **Step 5: Commit the server-domain slice**

```powershell
git add lib/server/map-scene-store.ts tests/map-scene-store.test.ts
git commit -m "feat: transact rockbreaker drawing changes"
```

---

### Task 3: Authenticated API and client transport

**Files:**
- Modify: `app/api/rooms/[roomId]/map-scenes/[sceneId]/objects/route.ts`
- Modify: `app/api/rooms/[roomId]/map-scenes/[sceneId]/objects/[objectId]/route.ts`
- Modify: `lib/map-scene/client.ts`
- Test: `tests/map-scene-route.test.ts`

**Interfaces:**
- Consumes: stroke-aware `SceneObjectDraft` and `commitSceneObjectTranslation`.
- Produces: `translateMapSceneObject(...)` and HTTP support for `{ translation, expectedRevision, expectedLockRevision }`.

- [ ] **Step 1: Write failing route tests**

Mock `room-auth-production` and `createFirestoreMapSceneStore` with an in-memory `MapSceneTransactionStore`, then call the exported route functions directly:

```ts
import { beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/rooms/[roomId]/map-scenes/[sceneId]/objects/route";
import { PATCH } from "@/app/api/rooms/[roomId]/map-scenes/[sceneId]/objects/[objectId]/route";
import {
  acquireSceneObjectLock, createSceneObject, type MapSceneTransactionStore,
} from "@/lib/server/map-scene-store";
import type { SceneObject } from "@/lib/rockbreaker/scene-objects";

const harness = vi.hoisted(() => ({ store: undefined as unknown as MapSceneTransactionStore }));
vi.mock("@/lib/server/room-auth-production", () => ({
  requireRoomMember: vi.fn(async () => ({ uid: "u1", role: "commander" })),
}));
vi.mock("@/lib/server/firestore-map-scene-store", () => ({
  createFirestoreMapSceneStore: () => harness.store,
}));

const free = (x: number, y = 0, z = 0) => ({
  x, y, z, sceneVersion: 1 as const, anchor: { kind: "freeSpace" as const },
});
const postContext = { params: Promise.resolve({ roomId: "r", sceneId: "nyx--rockbreaker" }) };
let memoryStore: MapSceneTransactionStore;

beforeEach(() => {
  const objects = new Map<string, SceneObject>();
  memoryStore = {
    runObjectTransaction: async (_roomId, _sceneId, objectId, operation) => {
      const result = await operation({
        object: objects.get(objectId) ?? null,
        groupIds: new Set(["g1"]),
        rockbreakerEnabled: true,
      });
      if (result === null) objects.delete(objectId); else objects.set(objectId, result);
      return result;
    },
  };
  harness.store = memoryStore;
});

const requestWith = (body: unknown) => new Request("https://app.test/api", {
  method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

it("accepts a validated stroke POST for a commander", async () => {
  const response = await POST(new Request("https://app.test/api/rooms/r/map-scenes/nyx--rockbreaker/objects", {
    method: "POST",
    body: JSON.stringify({ type: "stroke", color: "#22d3ee", width: 3, points: [free(1), free(2)] }),
  }), postContext);
  expect(response.status).toBe(201);
  await expect(response.json()).resolves.toMatchObject({ type: "stroke", width: 3 });
});

it("rejects malformed stroke POSTs", async () => {
  const response = await POST(requestWith({ type: "stroke", color: "#22d3ee", width: 2, points: [free(1)] }), postContext);
  expect(response.status).toBe(400);
});

it("translates one locked stroke through PATCH", async () => {
  const actor = { uid: "u1", role: "commander" as const };
  const created = await createSceneObject(memoryStore, {
    roomId: "r", sceneId: "nyx--rockbreaker", actor, nowMs: 1,
    draft: { type: "stroke", color: "#22d3ee", width: 3, points: [free(1), free(2)] },
  });
  const locked = await acquireSceneObjectLock(memoryStore, {
    roomId: "r", sceneId: "nyx--rockbreaker", objectId: created.id, actor, nowMs: 2,
  });
  const response = await PATCH(requestWith({
    translation: [1, 2, 3], expectedRevision: created.revision, expectedLockRevision: locked.lockRevision,
  }), { params: Promise.resolve({ roomId: "r", sceneId: "nyx--rockbreaker", objectId: created.id }) });
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({ type: "stroke", revision: 1 });
});

it("maps an out-of-bounds translation to 400 and a stale revision to 409", async () => {
  const actor = { uid: "u1", role: "commander" as const };
  const created = await createSceneObject(memoryStore, {
    roomId: "r", sceneId: "nyx--rockbreaker", actor, nowMs: 1,
    draft: { type: "stroke", color: "#22d3ee", width: 3, points: [free(35), free(36)] },
  });
  const locked = await acquireSceneObjectLock(memoryStore, {
    roomId: "r", sceneId: "nyx--rockbreaker", objectId: created.id, actor, nowMs: 2,
  });
  const context = { params: Promise.resolve({ roomId: "r", sceneId: "nyx--rockbreaker", objectId: created.id }) };
  const stale = await PATCH(requestWith({
    translation: [1, 0, 0], expectedRevision: 99, expectedLockRevision: locked.lockRevision,
  }), context);
  expect(stale.status).toBe(409);
  const outside = await PATCH(requestWith({
    translation: [2, 0, 0], expectedRevision: created.revision, expectedLockRevision: locked.lockRevision,
  }), context);
  expect(outside.status).toBe(400);
});
```

This setup verifies route parsing and HTTP mapping with the real store functions instead of replacing them with status stubs.

- [ ] **Step 2: Run route tests and verify failure**

```powershell
npx vitest run tests/map-scene-route.test.ts
```

Expected: stroke POST returns 400 and translation PATCH is not recognized.

- [ ] **Step 3: Extend request parsing and client calls**

The collection POST parser must accept only:

```ts
if (record.type === "stroke"
  && typeof record.color === "string"
  && ROCKBREAKER_STROKE_WIDTHS.includes(record.width as RockbreakerStrokeWidth)
  && Array.isArray(record.points)) {
  const points = record.points.map(parseWorldPoint);
  if (points.every((point): point is WorldPoint => point !== null)) {
    return { type: "stroke", color: record.color, width: record.width as RockbreakerStrokeWidth, points };
  }
}
```

In object PATCH, keep the existing `position` request compatible and add an exclusive translation branch. Translation must be exactly three finite numbers. Route it to `commitSceneObjectTranslation`; preserve 400 for invalid/out-of-bounds, 409 for revision/lock conflicts, 403 for roles/features, and 404 for missing objects.

Add the client function:

```ts
export const translateMapSceneObject = (
  roomId: string,
  sceneId: string,
  object: StrokeSceneObject,
  translation: Vec3,
  lockRevision: number,
  getIdToken: () => Promise<string>,
) => api<StrokeSceneObject>(
  `${base(roomId, sceneId)}/objects/${encodeURIComponent(object.id)}`,
  "PATCH",
  getIdToken,
  { translation, expectedRevision: object.revision, expectedLockRevision: lockRevision },
);
```

- [ ] **Step 4: Run route, store, and client-adjacent tests**

```powershell
npx vitest run tests/map-scene-route.test.ts tests/map-scene-store.test.ts tests/rockbreaker-scene-objects.test.ts
```

Expected: all pass and invalid payloads never reach the store.

- [ ] **Step 5: Commit the transport slice**

```powershell
git add app/api/rooms/[roomId]/map-scenes/[sceneId]/objects/route.ts app/api/rooms/[roomId]/map-scenes/[sceneId]/objects/[objectId]/route.ts lib/map-scene/client.ts tests/map-scene-route.test.ts
git commit -m "feat: expose rockbreaker stroke mutations"
```

---

### Task 4: Left-dock drawing controls and page state

**Files:**
- Create: `app/components/map/rockbreaker-drawing-controls.tsx`
- Modify: `app/page.tsx`
- Modify: `app/ui-test/rockbreaker/page.tsx`
- Test: `tests/ui/rockbreaker-map.spec.ts`

**Interfaces:**
- Consumes: `RockbreakerDrawingTool`, `RockbreakerStrokeWidth`, `latestOwnDrawingObject`, and `removeMapSceneObject`.
- Produces: `RockbreakerDrawingControls` and controlled drawing props passed to `RockbreakerMap`.

- [ ] **Step 1: Add a failing dock-controls browser assertion**

Append a test that opens the drawing section and checks writer controls:

```ts
test("shows persistent Rockbreaker drawing controls to writers", async ({ page }) => {
  await page.goto("/ui-test/rockbreaker");
  await expect(page.getByRole("button", { name: "Freihand zeichnen" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Freihand zeichnen" }).first().click();
  await expect(page.getByRole("button", { name: "Freihand zeichnen" }).first()).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Strichstärke 3" }).first()).toBeVisible();
});
```

The UI-test route may render the control directly beside each test camera instead of recreating the full `MapControlDock`; production must render it inside the existing left dock's `drawing` section.

- [ ] **Step 2: Build and run the focused Playwright test to confirm red**

```powershell
npm run build:ui-test
npx playwright test tests/ui/rockbreaker-map.spec.ts --grep "persistent Rockbreaker drawing controls"
```

Expected: the Freihand button is absent.

- [ ] **Step 3: Implement the controlled toolbar and production integration**

Use this component contract:

```ts
export function RockbreakerDrawingControls(props: {
  tool: RockbreakerDrawingTool;
  color: string;
  width: RockbreakerStrokeWidth;
  canUndo: boolean;
  busy?: boolean;
  onToolChange: (tool: RockbreakerDrawingTool) => void;
  onColorChange: (color: string) => void;
  onWidthChange: (width: RockbreakerStrokeWidth) => void;
  onUndo: () => void;
}): React.ReactNode;
```

Render buttons with exact accessible names: `Zeiger`, `Punkt setzen`, `Freihand zeichnen`, `Zeichnung verschieben`, `Zeichnung löschen`, `Strichstärke 1`, `Strichstärke 3`, `Strichstärke 6`, and `Eigene letzte Zeichnung rückgängig`. Use `aria-pressed` for active tool/color/width. Do not auto-reset a selected drawing tool after one operation.

In `app/page.tsx`, own:

```ts
const [rockbreakerDrawingTool, setRockbreakerDrawingTool] = useState<RockbreakerDrawingTool>("pointer");
const [rockbreakerDrawingColor, setRockbreakerDrawingColor] = useState("#22d3ee");
const [rockbreakerDrawingWidth, setRockbreakerDrawingWidth] = useState<RockbreakerStrokeWidth>(3);
const [rockbreakerDrawingBusy, setRockbreakerDrawingBusy] = useState(false);
```

Pass these values plus `currentUid={user.uid}` to `RockbreakerMap`. Supply `MapControlDock.drawing` with `RockbreakerDrawingControls` only when `activeRenderer === "rockbreaker3d" && canWrite`. The existing 2D toolbar remains selected for `image2d`.

Implement undo in the page by selecting `latestOwnDrawingObject(rockbreakerObjects, user.uid)`, calling `removeMapSceneObject`, setting busy while awaiting, and showing failure via the existing map status message path. Disable undo when no owned drawing exists.

- [ ] **Step 4: Rebuild and run the controls test**

Run the Step 2 commands. Expected: controls are visible, remain selected, and width/color choices are accessible.

- [ ] **Step 5: Commit the dock slice**

```powershell
git add app/components/map/rockbreaker-drawing-controls.tsx app/page.tsx app/ui-test/rockbreaker/page.tsx tests/ui/rockbreaker-map.spec.ts
git commit -m "feat: add rockbreaker drawing controls"
```

---

### Task 5: Three.js drawing rendering and freehand creation

**Files:**
- Create: `lib/rockbreaker/three-scene-objects.ts`
- Modify: `app/components/map/rockbreaker-map.tsx`
- Modify: `app/ui-test/rockbreaker/page.tsx`
- Test: `tests/rockbreaker-three-scene-objects.test.ts`
- Test: `tests/ui/rockbreaker-map.spec.ts`

**Interfaces:**
- Consumes: drawing props from Task 4, stroke helpers from Task 1, and `createMapSceneObject`.
- Produces: `createRockbreakerObject3d`, `disposeRockbreakerObject3d`, and freehand/point creation behavior.

- [ ] **Step 1: Write failing renderer and browser tests**

Unit-test Three.js objects without WebGL:

```ts
const free = (x: number, y = 0, z = 0) => ({
  x, y, z, sceneVersion: 1 as const, anchor: { kind: "freeSpace" as const },
});

it("builds a world-space stroke with an enlarged hit target", () => {
  const stroke: SceneObject = {
    id: "s1", type: "stroke", width: 3, points: [free(0), free(1, 1)],
    systemId: "nyx", mapId: "rockbreaker", sceneVersion: 1, color: "#22d3ee",
    revision: 0, createdBy: "u1", createdAtMs: 1, updatedBy: "u1", updatedAtMs: 1,
  };
  const rendered = createRockbreakerObject3d(THREE, stroke);
  expect(rendered.root.userData.objectId).toBe("s1");
  expect(rendered.hitTarget.userData.objectId).toBe("s1");
  expect(rendered.root.children.length).toBeGreaterThan(0);
  const geometry = (rendered.root.children[0] as THREE.Mesh).geometry;
  const dispose = vi.spyOn(geometry, "dispose");
  disposeRockbreakerObject3d(rendered.root);
  expect(dispose).toHaveBeenCalledOnce();
});
```

Add browser coverage using a single camera test locator:

```ts
test("draws one shared freehand 3d path", async ({ page }) => {
  await page.goto("/ui-test/rockbreaker");
  await page.getByRole("button", { name: "Freihand zeichnen" }).first().click();
  const canvas = page.getByLabel("Rockbreaker 3D Karte").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Rockbreaker canvas fehlt.");
  await page.mouse.move(box.x + 300, box.y + 240);
  await page.mouse.down();
  await page.mouse.move(box.x + 350, box.y + 190, { steps: 12 });
  await page.mouse.move(box.x + 410, box.y + 250, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByTestId("rockbreaker-stroke-count")).toHaveText("1");
  await expect(page.getByTestId("camera-a-stroke-points")).toHaveText(await page.getByTestId("camera-b-stroke-points").textContent() ?? "");
  const stored = await page.getByTestId("camera-a-stroke-points").textContent();
  await page.getByRole("button", { name: "Kamera A drehen" }).click();
  await expect(page.getByTestId("camera-a-stroke-points")).toHaveText(stored ?? "");
  await expect(page.getByTestId("camera-b-stroke-points")).toHaveText(stored ?? "");
});

test("removes a failed local preview without creating shared state", async ({ page }) => {
  await page.goto("/ui-test/rockbreaker?drawingCreateFailure=1");
  await page.getByRole("button", { name: "Freihand zeichnen" }).first().click();
  const box = await page.getByLabel("Rockbreaker 3D Karte").first().boundingBox();
  if (!box) throw new Error("Rockbreaker canvas fehlt.");
  await page.mouse.move(box.x + 300, box.y + 220);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 180, { steps: 20 });
  await page.mouse.up();
  await expect(page.getByTestId("rockbreaker-stroke-count")).toHaveText("0");
  await expect(page.getByTestId("rockbreaker-preview-count")).toHaveText("0");
  await expect(page.getByTestId("drawing-status")).toContainText("konnte nicht gespeichert werden");
});
```

- [ ] **Step 2: Run the focused tests and confirm failure**

```powershell
npx vitest run tests/rockbreaker-three-scene-objects.test.ts
npm run build:ui-test
npx playwright test tests/ui/rockbreaker-map.spec.ts --grep "draws one shared freehand|failed local preview"
```

Expected: renderer module is missing and no stroke is created.

- [ ] **Step 3: Extract object construction and implement point/stroke preview**

Use this renderer contract:

```ts
export type RockbreakerRenderedObject = {
  root: Three.Object3D;
  hitTarget: Three.Object3D;
};

export function createRockbreakerObject3d(
  THREE: typeof import("three"), object: SceneObject,
): RockbreakerRenderedObject;

export function disposeRockbreakerObject3d(root: Three.Object3D): void;
```

Rendering rules:

- point: emissive sphere;
- stroke: `CatmullRomCurve3` plus visible `TubeGeometry`; map widths `1/3/6` to radii `0.04/0.08/0.14` world units;
- stroke hit target: transparent `TubeGeometry` with radius at least `0.22`, `opacity: 0`, `depthWrite: false`, and the same `objectId`;
- existing positioned objects preserve their current shapes;
- legacy two-point `line` remains renderable as a thin connected path;
- every material and geometry is disposed during object replacement and unmount.

In `RockbreakerMap`, add props:

```ts
currentUid: string;
drawingTool: RockbreakerDrawingTool;
drawingColor: string;
drawingWidth: RockbreakerStrokeWidth;
sceneMutations?: {
  create?: (draft: SceneObjectDraft) => Promise<void>;
  remove?: (object: SceneObject) => Promise<void>;
  movePosition?: (object: PositionedSceneObject, position: WorldPoint) => Promise<void>;
  translateStroke?: (object: StrokeSceneObject, translation: Vec3) => Promise<void>;
};
onPreviewActiveChange?: (active: boolean) => void;
```

The optional mutation seams are for the UI route; production falls back to authenticated API calls.

Freehand behavior:

1. On pointer down in `stroke` mode, call the existing scene hit/fallback resolver once.
2. Freeze a plane through that point using `camera.getWorldDirection()` as its normal.
3. Start a `THREE.Line` preview and pointer capture; suppress orbit and report `onPreviewActiveChange?.(true)`.
4. On pointer move, clamp the client coordinate, intersect the frozen plane, create `freeSpaceWorldPoint`, and call `appendStrokeSample`.
5. Update only preview geometry while dragging; make no network request.
6. On pointer up or cancel, dispose preview and report `onPreviewActiveChange?.(false)`. On a valid pointer-up path, simplify the world points, require at least two distinct points, and create one `{ type: "stroke", color, width, points }` draft.
7. In `point` mode, one click creates `{ type: "point", color, position }`.
8. Keep the selected tool active after success or failure.

- [ ] **Step 4: Run renderer, domain, and creation tests**

Run the Step 2 commands plus:

```powershell
npx vitest run tests/rockbreaker-drawing.test.ts tests/rockbreaker-scene-objects.test.ts
```

Expected: one object is created only on release, both cameras expose the same stored coordinates, and renderer disposal tests pass.

- [ ] **Step 5: Commit the rendering/creation slice**

```powershell
git add lib/rockbreaker/three-scene-objects.ts app/components/map/rockbreaker-map.tsx app/ui-test/rockbreaker/page.tsx tests/rockbreaker-three-scene-objects.test.ts tests/ui/rockbreaker-map.spec.ts
git commit -m "feat: draw shared paths in rockbreaker space"
```

---

### Task 6: Whole-path manipulation, deletion, undo, and free enemy movement

**Files:**
- Modify: `app/components/map/rockbreaker-map.tsx`
- Modify: `app/ui-test/rockbreaker/page.tsx`
- Modify: `tests/ui/rockbreaker-map.spec.ts`

**Interfaces:**
- Consumes: scene mutation seams, `clampStrokeTranslation`, `translateMapSceneObject`, lock/move/delete clients, and the toolbar modes.
- Produces: bounded whole-path movement, drawing deletion, rollback, and enemy X/Y/Z movement.

- [ ] **Step 1: Add failing end-to-end interaction tests**

Add independent tests for:

```ts
async function drawBentStroke(page: Page) {
  await page.getByRole("button", { name: "Freihand zeichnen" }).first().click();
  const box = await page.getByLabel("Rockbreaker 3D Karte").first().boundingBox();
  if (!box) throw new Error("Rockbreaker canvas fehlt.");
  const path = [
    { x: box.x + 290, y: box.y + 220 },
    { x: box.x + 350, y: box.y + 170 },
    { x: box.x + 415, y: box.y + 235 },
  ];
  await page.mouse.move(path[0].x, path[0].y);
  await page.mouse.down();
  await page.mouse.move(path[1].x, path[1].y, { steps: 16 });
  await page.mouse.move(path[2].x, path[2].y, { steps: 16 });
  await page.mouse.up();
  await expect(page.getByTestId("rockbreaker-stroke-count")).toHaveText("1");
  return { box, path };
}

const readPoints = async (page: Page) => JSON.parse(
  await page.getByTestId("camera-a-stroke-points").textContent() ?? "[]",
) as Array<[number, number, number]>;

test("moves the complete stroke in xyz without changing its shape", async ({ page }) => {
  await page.goto("/ui-test/rockbreaker");
  const { path } = await drawBentStroke(page);
  const before = await readPoints(page);
  await page.getByRole("button", { name: "Zeichnung verschieben" }).first().click();
  await page.mouse.move(path[1].x, path[1].y);
  await page.mouse.down();
  await page.mouse.move(path[1].x + 80, path[1].y - 70, { steps: 20 });
  await page.mouse.up();
  const after = await readPoints(page);
  const deltas = after.map((point, index) => point.map((value, axis) => value - before[index][axis]));
  expect(deltas.every((delta) => delta.every((value, axis) => Math.abs(value - deltas[0][axis]) < 0.001))).toBe(true);
  expect(deltas[0].every((value) => Math.abs(value) > 0.01)).toBe(true);
  const segment = (points: Array<[number, number, number]>, index: number) =>
    points[index + 1].map((value, axis) => value - points[index][axis]);
  const sameVector = (left: number[], right: number[]) => left.every((value, axis) => Math.abs(value - right[axis]) < 0.001);
  expect(sameVector(segment(after, 0), segment(before, 0))).toBe(true);
  expect(sameVector(segment(after, before.length - 2), segment(before, before.length - 2))).toBe(true);
  const movedScreen = { x: path[1].x + 80, y: path[1].y - 70 };
  await page.mouse.move(movedScreen.x, movedScreen.y);
  await page.mouse.down();
  await page.mouse.move(movedScreen.x + 2_000, movedScreen.y + 2_000, { steps: 24 });
  await page.mouse.up();
  const bounded = await readPoints(page);
  expect(bounded.every(([x, y, z]) => x >= -36 && x <= 37 && y >= -31 && y <= 25 && z >= -23 && z <= 29)).toBe(true);
});

test("moves one drawing point in xyz", async ({ page }) => {
  await page.goto("/ui-test/rockbreaker");
  const box = await page.getByLabel("Rockbreaker 3D Karte").first().boundingBox();
  if (!box) throw new Error("Rockbreaker canvas fehlt.");
  const start = { x: box.x + 470, y: box.y + 250 };
  await page.getByRole("button", { name: "Punkt setzen" }).first().click();
  await page.mouse.click(start.x, start.y);
  const before = coordinates(await page.getByTestId("drawing-point-coordinate").textContent());
  await page.getByRole("button", { name: "Zeichnung verschieben" }).first().click();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 60, start.y - 60, { steps: 20 });
  await page.mouse.up();
  const after = coordinates(await page.getByTestId("drawing-point-coordinate").textContent());
  expect(after.x).not.toBe(before.x);
  expect(after.y).not.toBe(before.y);
  expect(after.z).not.toBe(before.z);
});

test("deletes a selected point and stroke but never a troop", async ({ page }) => {
  await page.goto("/ui-test/rockbreaker");
  const { box, path } = await drawBentStroke(page);
  await page.getByRole("button", { name: "Punkt setzen" }).first().click();
  await page.mouse.click(box.x + 480, box.y + 260);
  await expect(page.getByTestId("rockbreaker-point-count")).toHaveText("1");
  await page.getByRole("button", { name: "Zeichnung löschen" }).first().click();
  await page.mouse.click(path[1].x, path[1].y);
  await expect(page.getByTestId("rockbreaker-stroke-count")).toHaveText("0");
  await page.mouse.click(box.x + 480, box.y + 260);
  await expect(page.getByTestId("rockbreaker-point-count")).toHaveText("0");
  const troop = await page.getByTestId("rockbreaker-group-g1").first().boundingBox();
  if (!troop) throw new Error("Trupp fehlt.");
  await page.mouse.click(troop.x + troop.width / 2, troop.y + troop.height / 2);
  await expect(page.getByTestId("rockbreaker-group-g1")).toHaveCount(2);
});

test("undo removes only the current user's latest drawing", async ({ page }) => {
  await page.goto("/ui-test/rockbreaker?foreignStroke=1");
  const { box } = await drawBentStroke(page);
  await page.getByRole("button", { name: "Punkt setzen" }).first().click();
  await page.mouse.click(box.x + 470, box.y + 250);
  await page.getByRole("button", { name: "Eigene letzte Zeichnung rückgängig" }).first().click();
  await expect(page.getByTestId("rockbreaker-point-count")).toHaveText("0");
  await page.getByRole("button", { name: "Eigene letzte Zeichnung rückgängig" }).first().click();
  await expect(page.getByTestId("foreign-stroke-count")).toHaveText("1");
  await expect(page.getByTestId("rockbreaker-stroke-count")).toHaveText("1");
});

test("moves an enemy marker freely in xyz and remains bounded", async ({ page }) => {
  await page.goto("/ui-test/rockbreaker?emptyEnemy=1");
  const box = await page.getByLabel("Rockbreaker 3D Karte").first().boundingBox();
  if (!box) throw new Error("Rockbreaker canvas fehlt.");
  const start = { x: box.x + 430, y: box.y + 230 };
  await page.getByRole("button", { name: "Boden-Feindmarker setzen" }).click();
  await page.mouse.click(start.x, start.y);
  const before = coordinates(await page.getByTestId("enemy-coordinate").textContent());
  await page.getByRole("button", { name: "Zeiger" }).first().click();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y - 90, { steps: 20 });
  await page.mouse.up();
  const after = coordinates(await page.getByTestId("enemy-coordinate").textContent());
  expect(after.y).not.toBe(before.y);
  expect(after.x).toBeGreaterThanOrEqual(-36); expect(after.x).toBeLessThanOrEqual(37);
  expect(after.y).toBeGreaterThanOrEqual(-31); expect(after.y).toBeLessThanOrEqual(25);
  expect(after.z).toBeGreaterThanOrEqual(-23); expect(after.z).toBeLessThanOrEqual(29);
});

test("rolls a drawing back after a revision conflict", async ({ page }) => {
  await page.goto("/ui-test/rockbreaker?drawingConflict=1");
  const { path } = await drawBentStroke(page);
  const confirmed = await page.getByTestId("camera-a-stroke-points").textContent();
  await page.getByRole("button", { name: "Zeichnung verschieben" }).first().click();
  await page.mouse.move(path[1].x, path[1].y);
  await page.mouse.down();
  await page.mouse.move(path[1].x + 60, path[1].y - 60, { steps: 20 });
  await page.mouse.up();
  await expect(page.getByTestId("camera-a-stroke-points")).toHaveText(confirmed ?? "");
  await expect(page.getByTestId("drawing-status")).toContainText("Positionskonflikt");
});

test("keeps a drawing visible when deletion fails", async ({ page }) => {
  await page.goto("/ui-test/rockbreaker?drawingDeleteFailure=1");
  const { path } = await drawBentStroke(page);
  await page.getByRole("button", { name: "Zeichnung löschen" }).first().click();
  await page.mouse.click(path[1].x, path[1].y);
  await expect(page.getByTestId("rockbreaker-stroke-count")).toHaveText("1");
  await expect(page.getByTestId("drawing-status")).toContainText("konnte nicht gelöscht werden");
});

test("viewer sees shared paths without drawing controls", async ({ page }) => {
  await page.goto("/ui-test/rockbreaker?viewer=1");
  await expect(page.getByTestId("rockbreaker-stroke-count")).toHaveText("1");
  await expect(page.getByRole("button", { name: "Freihand zeichnen" })).toHaveCount(0);
});
```

- [ ] **Step 2: Rebuild and run only these tests to prove they fail**

```powershell
npm run build:ui-test
npx playwright test tests/ui/rockbreaker-map.spec.ts --grep "complete stroke|one drawing point|selected point|current user's|enemy marker freely|revision conflict|deletion fails|viewer sees"
```

Expected: manipulation/delete/viewer expectations fail against the creation-only implementation.

- [ ] **Step 3: Implement mode-specific hit handling and rollback**

Use one pointer state union instead of parallel booleans:

```ts
type CameraDragPlane = { point: Vec3; normal: Vec3 };
type PointerOperation =
  | { kind: "orbit"; pointerId: number; x: number; y: number; azimuth: number; elevation: number }
  | { kind: "position-drag"; object: PositionedSceneObject; root: Three.Object3D; plane: CameraDragPlane; point: WorldPoint }
  | { kind: "stroke-drag"; object: StrokeSceneObject; root: Three.Object3D; plane: CameraDragPlane; startHit: Vec3; translation: Vec3 }
  | { kind: "stroke-create"; samples: StrokeSample[]; plane: CameraDragPlane; preview: Three.Line }
  | { kind: "idle" };
```

Interaction rules:

- `pointer`: retain camera orbit and group movement; enemy markers also use the same frozen camera plane, canvas clamp, `freeSpaceWorldPoint`, and `clampRockbreakerPosition` as group tokens.
- `move`: clicking a point uses bounded positioned-object movement; clicking a stroke freezes a plane through the hit, translates its root locally, and on release calls `clampStrokeTranslation` followed by lock plus `translateMapSceneObject`.
- `delete`: raycast only drawing hit targets (`point` or `stroke`) and call `removeMapSceneObject`; ignore group tokens and enemy markers in this mode.
- translation failure sets the stroke root back to `[0,0,0]`; position failure restores `confirmedObjectPosition`.
- deletion failure leaves the authoritative object rendered.
- realtime object changes rebuild the root from stored coordinates and clear stale optimistic transforms.
- tool-panel pointer events must never reach the canvas.

In the UI-test route, implement mutation seams by immutably updating shared `objects`. Use these exact query switches:

- `drawingCreateFailure=1`: reject stroke creation;
- `drawingConflict=1`: reject one stroke translation;
- `drawingDeleteFailure=1`: reject one drawing deletion;
- `foreignStroke=1`: seed a stroke whose `createdBy` is `other-user`;
- `emptyEnemy=1`: omit the default enemy so the test can place one at a known pointer coordinate;
- `viewer=1`: pass `canWrite={false}` while retaining a seeded shared stroke.

Expose deterministic outputs with test IDs `rockbreaker-stroke-count`, `rockbreaker-point-count`, `foreign-stroke-count`, `camera-a-stroke-points`, `camera-b-stroke-points`, `drawing-point-coordinate`, `enemy-coordinate`, `rockbreaker-preview-count`, and `drawing-status`. Add the UI-test-only button `Boden-Feindmarker setzen` to select the existing enemy placement mode.

- [ ] **Step 4: Run all Rockbreaker browser tests**

```powershell
npm run build:ui-test
npx playwright test tests/ui/rockbreaker-map.spec.ts
```

Expected: old token/camera tests and all new drawing/enemy/viewer tests pass.

- [ ] **Step 5: Commit the complete interaction slice**

```powershell
git add app/components/map/rockbreaker-map.tsx app/ui-test/rockbreaker/page.tsx tests/ui/rockbreaker-map.spec.ts
git commit -m "feat: manipulate shared rockbreaker drawings"
```

---

### Task 7: Full regression and release handoff

**Files:**
- Modify only if a verifier exposes a real defect in the implemented scope.
- Review: `docs/superpowers/specs/2026-08-13-rockbreaker-3d-drawing-design.md`
- Review: `docs/superpowers/plans/2026-08-13-rockbreaker-3d-drawing.md`

**Interfaces:**
- Consumes: the complete feature branch.
- Produces: fresh evidence for review and an explicit merge/deployment decision from the user.

- [ ] **Step 1: Run formatting/diff checks**

```powershell
git diff --check
git status --short
git diff --stat main...HEAD
```

Expected: no whitespace errors and only in-scope files.

- [ ] **Step 2: Run unit/integration and lint gates**

```powershell
npm test
npm run lint
```

Expected: zero test failures, zero lint errors, zero lint warnings.

- [ ] **Step 3: Run complete browser regression**

```powershell
npm run build:ui-test
npm run test:ui
```

Expected: every existing and new Playwright test passes, including token transfer, mobile status, map dock, and all Rockbreaker cases.

- [ ] **Step 4: Run the actual production build**

```powershell
npm run build
```

Expected: successful Next.js compilation, TypeScript checking, static generation, and route build.

- [ ] **Step 5: Review requirements against evidence**

Confirm explicitly in the handoff:

- shared freehand paths and points persist as independent scene documents;
- both cameras render identical stored X/Y/Z coordinates;
- full-path translation preserves shape and stays bounded;
- drawings delete individually and undo is user-owned;
- enemy markers move freely on X/Y/Z and remain bounded;
- viewer write controls are absent;
- conflict rollback and protected troop tokens pass;
- no migration was needed.

- [ ] **Step 6: Ask for integration authorization**

Keep the verified branch intact and report its commit list. Do not merge, push, or deploy until the user explicitly chooses that integration path. If authorized, use `superpowers:finishing-a-development-branch`, `github:yeet`, and `superpowers:verification-before-completion`, re-run the required checks on the merged commit, then verify Vercel `Ready` and HTTP 200.
