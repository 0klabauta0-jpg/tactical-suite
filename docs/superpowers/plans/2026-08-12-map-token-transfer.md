# Map Token Transfer and Compact Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build loss-safe troop transfers across 2D maps and Rockbreaker 3D, add a clear one-level return path, and move the persistent map controls into a compact right-side dock.

**Architecture:** Keep the current board document and Rockbreaker scene-object collection, but route every troop-location mutation through one authenticated server transaction. Pure transfer, hierarchy, slot-selection, and audit modules sit outside `app/page.tsx`; the page coordinates realtime state and optimistic UI while focused map components own drag/drop presentation.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Firebase client SDK, Firebase Admin/Firestore transactions, Three.js, `@dnd-kit/core`, Vitest, Firebase Rules Unit Testing, Playwright.

## Global Constraints

- Web repository only: `C:\dev\KlabsCom\klabscom`; do not change `klabscom-tauri-local`.
- No big-bang rewrite of `app/page.tsx`; extract only transfer-specific UI and pure logic.
- Preserve the existing room login process and the roles `admin`, `commander`, and `viewer`.
- Admin and commander may transfer troops; viewer remains read-only.
- A normal troop group has zero or one authoritative location per system; ancestor dots are derived indicators, not tokens.
- A transfer is atomic and idempotent across the board document, Rockbreaker object, and operation receipt.
- Existing valid board tokens and scene objects remain readable without a global migration.
- Rockbreaker entry coordinates are scene-level world coordinates, never camera-relative coordinates.
- Grid defaults to visible only when no preference exists; an explicit saved preference still wins.
- Enemy markers remain visible until an authorized user deletes them.
- Do not delete or repair ambiguous production data automatically.
- Back up and audit `Pyro_Template` before applying scene metadata or deploying.
- Use test-driven development and commit after every task.

## File and Responsibility Map

**Create:**

- `lib/map/token-transfer.ts` — validated command, source, intent, result, and error-safe shared types.
- `lib/map/token-placement.ts` — hierarchy resolution and deterministic 2D entry/return slot selection.
- `lib/map/token-occupancy.ts` — zero/one/ambiguous location detection and ancestor badge derivation.
- `lib/map/token-transfer-client.ts` — authenticated transfer API call and structured conflict error.
- `lib/rockbreaker/scene-config.ts` — typed Rockbreaker entry slots and metadata parser.
- `lib/server/token-transfer-store.ts` — authorization-independent transaction orchestration and invariants.
- `lib/server/token-transfer-store-production.ts` — Firebase Admin transaction adapter.
- `app/api/rooms/[roomId]/token-transfers/route.ts` — fresh-role authenticated transfer endpoint.
- `app/components/map/token-transfer-controls.tsx` — draggable troop chips and visible parent-level drop target.
- `lib/release/token-location-audit.ts` — pure audit of board tokens, scene objects, and entry metadata.
- `lib/release/rockbreaker-entry-rollout.ts` — safe dry-run/apply payload construction.
- `scripts/audit-token-locations.ts` — read-only room audit CLI.
- `scripts/set-rockbreaker-entry.ts` — confirmed room-scoped metadata initializer.
- `app/ui-test/token-transfer/page.tsx` — deterministic transfer interaction harness.
- `tests/token-transfer.test.ts`, `tests/token-placement.test.ts`, `tests/token-occupancy.test.ts`.
- `tests/token-transfer-store.test.ts`, `tests/token-transfer-route.test.ts`, `tests/token-transfer-client.test.ts`.
- `tests/rockbreaker-scene-config.test.ts`, `tests/token-location-audit.test.ts`, `tests/rockbreaker-entry-rollout.test.ts`.
- `tests/ui/token-transfer.spec.ts`.

**Modify:**

- `app/page.tsx` — replace direct troop writes, lift Rockbreaker occupancy, and wire transfer UI.
- `app/components/map/rockbreaker-map.tsx` — controlled objects, 3D-to-parent drop, and no duplicate troop panel.
- `app/components/map/map-control-dock.tsx` — compact right-edge layout and renderer-specific sections.
- `lib/map/ui-preferences.ts`, `lib/map/control-dock.ts` — compact defaults and persistence.
- `lib/map-scene/client.ts` — keep non-troop scene APIs and provide one shared scene subscription.
- `lib/server/map-scene-store.ts` and scene object routes — block group-token creation/deletion outside transfers.
- `firestore.rules` — block direct client changes to `tokens` and `tokensBySystem`.
- `package.json` — add audit and Rockbreaker entry commands.
- Existing unit, rule, UI-test pages, and Playwright specs named in the tasks below.

---

### Task 1: Shared transfer contracts, hierarchy, and stable slots

**Files:**

- Create: `lib/map/token-transfer.ts`
- Create: `lib/map/token-placement.ts`
- Create: `lib/rockbreaker/scene-config.ts`
- Test: `tests/token-transfer.test.ts`
- Test: `tests/token-placement.test.ts`
- Test: `tests/rockbreaker-scene-config.test.ts`

**Interfaces:**

- Produces: `TokenLocation`, `TokenTransferCommand`, `TokenTransferIntent`, `TokenTransferResult`, `parseTokenTransferCommand(value)`.
- Produces: `resolveChildLocation(...)`, `resolveParentLocation(...)`, `selectEntry2dPosition(...)`, `selectReturn2dPosition(...)`.
- Produces: `ROCKBREAKER_SCENE_ID`, `DEFAULT_ROCKBREAKER_ENTRY`, `parseRockbreakerSceneConfig(value)`, `selectRockbreakerEntryPoint(config, occupied)`.

- [ ] **Step 1: Write failing command-parser tests**

```ts
import { describe, expect, it } from "vitest";
import { parseTokenTransferCommand } from "@/lib/map/token-transfer";

describe("token transfer command", () => {
  it("accepts a map source and enter-child intent", () => {
    expect(parseTokenTransferCommand({
      operationId: "3f7f4d48-93ce-4b34-8102-58ccdf530111",
      systemId: "nyx",
      groupId: "fight-team",
      expectedSource: { kind: "map2d", mapId: "main", x: 0.4, y: 0.6 },
      intent: { kind: "enterChild", childId: "rockbreaker" },
    })).toMatchObject({ groupId: "fight-team", intent: { kind: "enterChild" } });
  });

  it("rejects non-finite positions, empty IDs, and invalid scene revisions", () => {
    expect(parseTokenTransferCommand({ operationId: "short" })).toBeNull();
    expect(parseTokenTransferCommand({
      operationId: "3f7f4d48-93ce-4b34-8102-58ccdf530111",
      systemId: "nyx", groupId: "g1",
      expectedSource: { kind: "map2d", mapId: "main", x: Number.NaN, y: 0 },
      intent: { kind: "remove" },
    })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the parser test and verify the missing module failure**

Run: `npm test -- tests/token-transfer.test.ts`  
Expected: FAIL because `@/lib/map/token-transfer` does not exist.

- [ ] **Step 3: Implement the exact shared command union and parser**

```ts
export const ROCKBREAKER_SCENE_ID = "nyx--rockbreaker" as const;

export type TokenLocation =
  | { kind: "unplaced" }
  | { kind: "map2d"; mapId: string; x: number; y: number }
  | { kind: "rockbreaker3d"; sceneId: typeof ROCKBREAKER_SCENE_ID; revision: number };

export type TokenTransferIntent =
  | { kind: "place2d"; mapId: string; x: number; y: number }
  | { kind: "enterChild"; childId: string }
  | { kind: "moveUp" }
  | { kind: "remove" };

export type TokenTransferCommand = {
  operationId: string;
  systemId: string;
  groupId: string;
  expectedSource: TokenLocation;
  intent: TokenTransferIntent;
};

export type TokenTransferResult = {
  operationId: string;
  groupId: string;
  systemId: string;
  location: TokenLocation;
};
```

Validate IDs with `/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/`, operation IDs with the canonical UUID pattern, 2D coordinates within `[0, 1]`, and non-negative integer scene revisions. Return `null` for every invalid branch instead of casting request data.

- [ ] **Step 4: Write failing hierarchy and slot tests**

```ts
it("resolves Rockbreaker below Nyx main and a POI below its parent", () => {
  expect(resolveChildLocation("nyx", "rockbreaker", [], [], true)).toEqual({
    kind: "rockbreaker3d", sceneId: "nyx--rockbreaker", parentMapId: "main",
  });
  expect(resolveParentLocation("poi-a", [], [{ id: "poi-a", label: "A", image: "", parentMapId: "cap-map", x: 0.4, y: 0.5 }]))
    .toEqual({ parentMapId: "cap-map", marker: { x: 0.4, y: 0.5 } });
});

it("uses deterministic non-overlapping 2D entry and return slots", () => {
  const occupied = [{ groupId: "g1", mapId: "cap-map", x: 0.08, y: 0.16 }];
  expect(selectEntry2dPosition("cap-map", occupied)).toEqual({ x: 0.08, y: 0.24 });
  expect(selectReturn2dPosition({ x: 0.5, y: 0.5 }, [])).toEqual({ x: 0.54, y: 0.5 });
});
```

- [ ] **Step 5: Implement hierarchy and deterministic 2D slots**

Use fixed candidate arrays rather than random offsets:

```ts
const ENTRY_SLOTS = [
  { x: 0.08, y: 0.16 }, { x: 0.08, y: 0.24 }, { x: 0.08, y: 0.32 },
  { x: 0.14, y: 0.16 }, { x: 0.14, y: 0.24 }, { x: 0.14, y: 0.32 },
] as const;
const RETURN_OFFSETS = [
  { x: 0.04, y: 0 }, { x: -0.04, y: 0 }, { x: 0, y: 0.05 }, { x: 0, y: -0.05 },
] as const;
```

Choose the first candidate at least `0.025` normalized units from every token already on the destination map. Extend candidates in the same pattern if all listed slots are occupied; never return coordinates outside `[0.02, 0.98]`.

- [ ] **Step 6: Write failing Rockbreaker configuration tests**

```ts
it("parses fixed belt-plane entry slots and chooses the first free slot", () => {
  const config = parseRockbreakerSceneConfig({
    systemId: "nyx", mapId: "rockbreaker", renderer: "rockbreaker3d", sceneVersion: 1,
    troopEntry: { slots: [
      { x: -34, y: 0, z: -3, sceneVersion: 1, anchor: { kind: "beltPlane" } },
      { x: -34, y: 0, z: -1, sceneVersion: 1, anchor: { kind: "beltPlane" } },
    ] },
  });
  expect(config).not.toBeNull();
  expect(selectRockbreakerEntryPoint(config!, [{ x: -34, y: 0, z: -3 }])).toMatchObject({ x: -34, z: -1 });
});
```

- [ ] **Step 7: Implement scene metadata and shared edge slots**

Define `DEFAULT_ROCKBREAKER_ENTRY` with 24 belt-plane world points along the outer edge (`x = -34`, `y = 0`, `z = -11 ... 11` at 2-unit spacing, then a second row at `x = -31.5`). `parseRockbreakerSceneConfig` must require at least one and at most 64 valid `WorldPoint` slots. `selectRockbreakerEntryPoint` returns the first slot farther than `0.75` world units from every occupied group-token position and returns `null` only when all configured slots are occupied.

- [ ] **Step 8: Run the focused unit tests**

Run: `npm test -- tests/token-transfer.test.ts tests/token-placement.test.ts tests/rockbreaker-scene-config.test.ts`  
Expected: PASS.

- [ ] **Step 9: Commit the shared contracts**

```powershell
git add lib/map/token-transfer.ts lib/map/token-placement.ts lib/rockbreaker/scene-config.ts tests/token-transfer.test.ts tests/token-placement.test.ts tests/rockbreaker-scene-config.test.ts
git commit -m "feat: define authoritative troop transfers"
```

### Task 2: Occupancy invariant and ancestor badges

**Files:**

- Create: `lib/map/token-occupancy.ts`
- Test: `tests/token-occupancy.test.ts`
- Modify: `lib/map-scene/client.ts`

**Interfaces:**

- Consumes: `TokenLocation`, `BoardToken`, `BoardPoi`, `SceneObject`.
- Produces: `locateGroup(groupId, systemTokens, sceneObjects)`, `buildGroupLocations(...)`, `groupsForLocationMarker(...)`.
- Produces: existing `subscribeSceneObjects(...)` as the only client listener for both Rockbreaker rendering and parent badges.

- [ ] **Step 1: Write failing zero/one/ambiguous location tests**

```ts
it("distinguishes unplaced, one 2D location, one 3D location, and ambiguity", () => {
  expect(locateGroup("g1", [], [])).toEqual({ kind: "unplaced" });
  expect(locateGroup("g1", [{ groupId: "g1", mapId: "main", x: 0.2, y: 0.3 }], []))
    .toEqual({ kind: "map2d", mapId: "main", x: 0.2, y: 0.3 });
  expect(locateGroup("g1", [], [groupSceneObject("g1", 4)]))
    .toEqual({ kind: "rockbreaker3d", sceneId: "nyx--rockbreaker", revision: 4 });
  expect(locateGroup("g1", [{ groupId: "g1", mapId: "main", x: 0.2, y: 0.3 }], [groupSceneObject("g1", 4)]))
    .toEqual({ kind: "ambiguous" });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm test -- tests/token-occupancy.test.ts`  
Expected: FAIL because the occupancy module is missing.

- [ ] **Step 3: Implement occupancy without duplicating stored state**

`locateGroup` must count parsed 2D tokens for the group and `groupToken` scene objects for the group. Return `{ kind: "ambiguous" }` for more than one total authoritative record. `groupsForLocationMarker` must include direct 2D descendants, recursive POI descendants, and Rockbreaker scene groups when `markerId === "rockbreaker"`, deduplicated by group ID.

- [ ] **Step 4: Keep one shared scene subscription**

Do not add a second Firestore listener. Keep `subscribeSceneObjects(roomId, sceneId, onChange)` in `lib/map-scene/client.ts` and later lift its use to `app/page.tsx`; `RockbreakerMap` will receive the resulting array as a prop.

- [ ] **Step 5: Run and commit**

Run: `npm test -- tests/token-occupancy.test.ts tests/rockbreaker-scene-objects.test.ts`  
Expected: PASS.

```powershell
git add lib/map/token-occupancy.ts lib/map-scene/client.ts tests/token-occupancy.test.ts
git commit -m "feat: derive troop occupancy across map renderers"
```

### Task 3: Atomic Firestore transfer service

**Files:**

- Create: `lib/server/token-transfer-store.ts`
- Create: `lib/server/token-transfer-store-production.ts`
- Test: `tests/token-transfer-store.test.ts`

**Interfaces:**

- Consumes: `TokenTransferCommand`, hierarchy helpers, occupancy helpers, scene configuration.
- Produces: `executeTokenTransfer(store, input): Promise<TokenTransferResult>`.
- Produces: `ExecuteTokenTransferInput = { roomId: string; actor: { uid: string; role: Role }; command: TokenTransferCommand; nowMs: number }`.
- Produces: `TokenTransferTransactionStore` and `TokenTransferStoreError` codes `FORBIDDEN`, `BOARD_NOT_FOUND`, `FEATURE_DISABLED`, `INVALID_GROUP`, `INVALID_TARGET`, `SOURCE_CONFLICT`, `AMBIGUOUS_SOURCE`, `ENTRY_FULL`, `OPERATION_CONFLICT`.

- [ ] **Step 1: Write an in-memory transaction fixture and failing transfer tests**

Cover these exact cases in `tests/token-transfer-store.test.ts`:

```ts
it("atomically moves a Nyx board token into the first free Rockbreaker entry slot", async () => {
  const fixture = transferFixture({ token: { groupId: "g1", mapId: "main", x: 0.4, y: 0.6 } });
  const result = await executeTokenTransfer(fixture.store, transferInput({
    command: command({
      expectedSource: { kind: "map2d", mapId: "main", x: 0.4, y: 0.6 },
      intent: { kind: "enterChild", childId: "rockbreaker" },
    }),
  }));
  expect(result.location).toEqual({ kind: "rockbreaker3d", sceneId: "nyx--rockbreaker", revision: 0 });
  expect(fixture.tokens("nyx")).toEqual([]);
  expect(fixture.groupObject("g1")?.position).toEqual(DEFAULT_ROCKBREAKER_ENTRY.slots[0]);
});

it("moves a Rockbreaker group one level up beside its Nyx pill", async () => {
  const fixture = transferFixture({ sceneGroup: groupSceneObject("g1", 3), rockbreakerMarker: { x: 0.5, y: 0.5 } });
  await executeTokenTransfer(fixture.store, transferInput({
    command: command({
      expectedSource: { kind: "rockbreaker3d", sceneId: "nyx--rockbreaker", revision: 3 },
      intent: { kind: "moveUp" },
    }),
  }));
  expect(fixture.groupObject("g1")).toBeNull();
  expect(fixture.tokens("nyx")[0]).toMatchObject({ groupId: "g1", mapId: "main", x: 0.54, y: 0.5 });
});
```

Also test 2D entry, 2D move, 2D move-up, remove-to-unplaced, viewer denial, disabled Rockbreaker, wrong-system group, stale source, simultaneous source ambiguity, full entry area, and two different commands reusing one operation ID.

- [ ] **Step 2: Run the store test and verify failure**

Run: `npm test -- tests/token-transfer-store.test.ts`  
Expected: FAIL because the server store module is missing.

- [ ] **Step 3: Define the transaction boundary**

```ts
export type TokenTransferSnapshot = {
  boardDocument: Record<string, unknown> | null;
  roomConfig: unknown;
  sceneMetadata: unknown;
  sceneObjects: SceneObject[];
  receipt: TokenTransferReceipt | null;
};

export type TokenTransferTransaction = {
  readSnapshot(roomId: string, operationId: string): Promise<TokenTransferSnapshot>;
  setTokensBySystem(roomId: string, value: Record<string, unknown>): Promise<void>;
  setSceneGroup(roomId: string, object: SceneObject): Promise<void>;
  deleteSceneGroup(roomId: string, objectId: string): Promise<void>;
  setReceipt(roomId: string, receipt: TokenTransferReceipt): Promise<void>;
};

export type TokenTransferTransactionStore = {
  runTransaction<T>(operation: (transaction: TokenTransferTransaction) => Promise<T>): Promise<T>;
};
```

The receipt stores the complete normalized command, result, actor UID, `completedAtMs`, and `expiresAtMs = completedAtMs + 7 * 24 * 60 * 60 * 1000`. A matching retry returns the stored result; a different command with the same ID throws `OPERATION_CONFLICT`.

- [ ] **Step 4: Implement invariant checks before writes**

Inside one `runTransaction` callback:

1. Read the board, room config, scene metadata, all scene objects, and receipt.
2. Parse the group and require `group.systemId === command.systemId`, non-spawn, and writer role.
3. Compute the actual location with `locateGroup`; reject ambiguity.
4. Compare the actual location to `expectedSource`, including exact stored 2D coordinates or scene revision.
5. Resolve the intent:
   - `place2d` only from unplaced or the same 2D map;
   - `enterChild` only from unplaced or the child's direct 2D parent;
   - `moveUp` only from a non-root 2D child or Rockbreaker;
   - `remove` from any non-ambiguous state.
6. Compute deterministic entry/return coordinates.
7. Build the next system token array and optional scene group object.
8. Write board tokens, scene object mutation, and receipt before returning.

Never trust client-provided colors: use the current board group's normalized color, falling back to `#3b82f6`.

- [ ] **Step 5: Implement the Firebase Admin adapter**

`createProductionTokenTransferStore()` must call `getAdminFirestore().runTransaction`. Its `readSnapshot` reads:

- `rooms/{roomId}/state/board`;
- `rooms/{roomId}/config/main`;
- `rooms/{roomId}/mapScenes/nyx--rockbreaker`;
- the complete `rooms/{roomId}/mapScenes/nyx--rockbreaker/objects` query; and
- `rooms/{roomId}/tokenTransferOperations/{operationId}`.

Use `FieldValue.serverTimestamp()` only for the board's `updatedAt`; scene objects retain numeric `updatedAtMs` because the existing parser requires it. Write the receipt under `tokenTransferOperations` in the same transaction.

- [ ] **Step 6: Prove retry and concurrency behavior**

Add tests that invoke the same operation twice and assert one destination record, then invoke two commands sharing the same expected source and assert the second receives `SOURCE_CONFLICT` with no extra writes.

- [ ] **Step 7: Run and commit**

Run: `npm test -- tests/token-transfer-store.test.ts`  
Expected: PASS with all mutations observed as one fixture transaction.

```powershell
git add lib/server/token-transfer-store.ts lib/server/token-transfer-store-production.ts tests/token-transfer-store.test.ts
git commit -m "feat: transfer troops in one Firestore transaction"
```

### Task 4: Authenticated API and conflict-aware client

**Files:**

- Create: `app/api/rooms/[roomId]/token-transfers/route.ts`
- Create: `lib/map/token-transfer-client.ts`
- Test: `tests/token-transfer-route.test.ts`
- Test: `tests/token-transfer-client.test.ts`
- Modify: `app/api/rooms/[roomId]/map-scenes/[sceneId]/objects/route.ts`
- Modify: `app/api/rooms/[roomId]/map-scenes/[sceneId]/objects/[objectId]/route.ts`
- Modify: `lib/server/map-scene-store.ts`
- Modify: `tests/map-scene-store.test.ts`

**Interfaces:**

- Produces: `createTokenTransferHandler(dependencies)` and route `POST /api/rooms/{roomId}/token-transfers`.
- Produces: `transferTokenClient(roomId, command, getIdToken)` and `TokenTransferClientError` with optional `currentLocation`.

- [ ] **Step 1: Write failing route tests with injected dependencies**

```ts
it("uses a fresh authenticated writer and ignores body role fields", async () => {
  const calls: unknown[] = [];
  const handler = createTokenTransferHandler({
    requireWriter: async () => ({ uid: "u1", playerId: "p1", name: "Ada", role: "commander", authVersion: 1, verifiedAtMs: 1 }),
    transfer: async (input) => { calls.push(input); return { ...input.command, location: { kind: "unplaced" } } as never; },
    now: () => 123,
  });
  const response = await handler(request({ ...validCommand, role: "admin" }), context("alpha"));
  expect(response.status).toBe(200);
  expect(calls).toMatchObject([{ roomId: "alpha", actor: { uid: "u1", role: "commander" }, nowMs: 123 }]);
});
```

Test malformed JSON as 400, viewer/auth failures as 401/403, source and operation conflicts as 409 with the current location, invalid target as 422, missing board as 404, and entry full as 409.

- [ ] **Step 2: Run route tests and verify failure**

Run: `npm test -- tests/token-transfer-route.test.ts`  
Expected: FAIL because the route module is missing.

- [ ] **Step 3: Implement the route handler and production composition**

The production `POST` must call:

```ts
requireRoomMember(request, roomId, { roles: ["admin", "commander"], freshRole: true })
```

Parse through `parseTokenTransferCommand` before authentication-dependent mutation. Return `{ result }` with `Cache-Control: no-store`. Do not accept coordinates, group color, source identity, or role outside the normalized command fields.

- [ ] **Step 4: Write and implement the authenticated client**

```ts
export async function transferTokenClient(
  roomId: string,
  command: TokenTransferCommand,
  getIdToken: () => Promise<string>,
): Promise<TokenTransferResult>;
```

Send `Authorization: Bearer <token>`, JSON content type, and `cache: "no-store"`. Map HTTP 409 to `TokenTransferClientError` carrying `currentLocation`; other errors carry the server's German message.

- [ ] **Step 5: Close direct scene API bypasses for group tokens**

- Reject `type: "groupToken"` in the generic scene-object POST route with 409 and `Gruppen werden über den Transferdienst gesetzt.`
- In `deleteSceneObject`, throw `PROTECTED_OBJECT` when the stored object is a `groupToken`; the transfer store remains the only code that directly deletes it.
- Keep lock and PATCH movement for an already existing 3D group token, because this changes coordinates without changing its authoritative location.
- Add route/store tests proving enemy markers and order markers still create/delete normally.

- [ ] **Step 6: Run focused API tests**

Run: `npm test -- tests/token-transfer-route.test.ts tests/token-transfer-client.test.ts tests/map-scene-store.test.ts`  
Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add app/api/rooms/[roomId]/token-transfers/route.ts lib/map/token-transfer-client.ts tests/token-transfer-route.test.ts tests/token-transfer-client.test.ts app/api/rooms/[roomId]/map-scenes/[sceneId]/objects/route.ts app/api/rooms/[roomId]/map-scenes/[sceneId]/objects/[objectId]/route.ts lib/server/map-scene-store.ts tests/map-scene-store.test.ts
git commit -m "feat: expose protected troop transfer API"
```

### Task 5: Compact right-side map controls

**Files:**

- Modify: `lib/map/ui-preferences.ts`
- Modify: `lib/map/control-dock.ts`
- Modify: `app/components/map/map-control-dock.tsx`
- Modify: `tests/map-ui-preferences.test.ts`
- Modify: `tests/map-control-dock.test.ts`
- Modify: `app/ui-test/map-controls/page.tsx`
- Modify: `tests/ui/map-control-dock.spec.ts`

**Interfaces:**

- Preserves: `MapUiPreferences`, `loadMapUiPreferences`, `saveMapUiPreferences`, `clampDockY`, `toggleDockSection`.
- Adds: section `enemy` and optional `enemy: ReactNode` dock content.

- [ ] **Step 1: Change tests first to the compact defaults**

Expected defaults:

```ts
expect(DEFAULT_MAP_UI_PREFERENCES).toEqual({
  showGrid: true,
  dockCollapsed: false,
  dockY: 70,
  sections: { maps: false, tokens: false, enemy: false, drawing: false },
});
```

Also verify old stored preferences without `enemy` parse safely with `enemy: false`, explicit `showGrid: false` remains false, and `dockY` is clamped.

- [ ] **Step 2: Run focused tests and verify expectation failures**

Run: `npm test -- tests/map-ui-preferences.test.ts tests/map-control-dock.test.ts`  
Expected: FAIL because current sections default open and have no enemy section.

- [ ] **Step 3: Implement right-edge compact styling and persistence**

- Change fixed classes from `left-0`, `rounded-r-*`, `border-l-0` to `right-0`, `rounded-l-*`, `border-r-0`.
- Use expanded width `w-[min(280px,calc(100vw-16px))]` and collapsed rail width `w-9`.
- The collapse button title is `Nach rechts einklappen`; the rail reopens toward the left.
- Preserve vertical pointer dragging and `dockY` persistence.
- Render only non-null renderer-specific sections.
- Add `enemy` between tokens and drawing.

- [ ] **Step 4: Update the Playwright harness and test**

The test must assert right anchoring through `await expect(dock).toHaveCSS("right", "0px")`, default collapsed section bodies, opening only the troop section, collapsing the full dock, and reopening it.

- [ ] **Step 5: Build the UI-test bundle and run Playwright**

Run: `npm run build:ui-test`  
Expected: successful Next.js build.

Run: `npm run test:ui -- tests/ui/map-control-dock.spec.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add lib/map/ui-preferences.ts lib/map/control-dock.ts app/components/map/map-control-dock.tsx tests/map-ui-preferences.test.ts tests/map-control-dock.test.ts app/ui-test/map-controls/page.tsx tests/ui/map-control-dock.spec.ts
git commit -m "feat: compact map controls on the right edge"
```

### Task 6: 2D troop drag/drop and optimistic recovery

**Files:**

- Create: `app/components/map/token-transfer-controls.tsx`
- Create: `app/ui-test/token-transfer/page.tsx`
- Create: `tests/ui/token-transfer.spec.ts`
- Modify: `app/page.tsx:1793-1865`
- Modify: `app/page.tsx:2577-3064`
- Modify: `app/page.tsx:4010-4218`
- Modify: `app/page.tsx:4751-4971`
- Modify: `app/page.tsx:5200-5712`

**Interfaces:**

- Consumes: `TokenLocation`, `TokenTransferIntent`, `transferTokenClient`, occupancy helpers.
- Produces UI: `TroopTransferProvider`, `DraggableTroopChip`, `ParentLevelDropTarget`, `useTokenDropTarget`.
- Page callback: `requestTokenTransfer(groupId, intent): Promise<void>`.

- [ ] **Step 1: Add a failing Playwright scenario before implementation**

`tests/ui/token-transfer.spec.ts` must use the gated deterministic page and assert:

```ts
test("drags a troop into a child and returns it exactly one level", async ({ page }) => {
  await page.goto("/ui-test/token-transfer");
  await page.getByTestId("troop-chip-g1").dragTo(page.getByTestId("location-pill-cap-map"));
  await expect(page.getByTestId("location-pill-cap-map")).toContainText("Fight Team");
  await expect(page.getByTestId("token-main-g1")).toHaveCount(0);
  await page.getByRole("button", { name: "Cap Map öffnen" }).click();
  await expect(page.getByTestId("token-cap-map-g1")).toBeVisible();
  await page.getByTestId("token-cap-map-g1").dragTo(page.getByTestId("move-up-target"));
  await expect(page.getByTestId("token-main-g1")).toBeVisible();
});
```

Add a second scenario where a simulated 409 resets the optimistic token and shows `Trupp wurde inzwischen von einem anderen Teilnehmer verschoben.`

- [ ] **Step 2: Build and run the UI test to verify failure**

Run: `npm run build:ui-test`  
Run: `npm run test:ui -- tests/ui/token-transfer.spec.ts`  
Expected: FAIL because the test route and drag components do not exist.

- [ ] **Step 3: Implement reusable drag sources and drop targets**

Use the existing `@dnd-kit/core` dependency with pointer and keyboard sensors. Put normalized data on every draggable/droppable:

```ts
type TroopDragData = { type: "troop"; groupId: string; expectedSource: TokenLocation };
type TokenDropData =
  | { type: "map2d"; mapId: string; imageElement: HTMLElement }
  | { type: "child"; childId: string }
  | { type: "parent" };
```

The provider maps the final drag overlay center through the transformed image's `getBoundingClientRect()` for `place2d`; marker and parent targets emit `enterChild` and `moveUp`. Use a `DragOverlay` so the dock chip stays stable.

- [ ] **Step 4: Integrate existing pointer-dragged 2D tokens with the same targets**

Keep the current direct DOM movement for smooth zoomed-map dragging. On pointer-up, inspect the element under `clientX/clientY` for the shared target data attribute:

- child target → `enterChild`;
- parent target → `moveUp`;
- otherwise → `place2d` with the final normalized coordinate.

Change `onBgUp()` to receive the pointer event. Do not call `pushTokensOnly`. On success, wait for the realtime snapshot; on failure, restore the last confirmed token array and display the structured conflict message.

- [ ] **Step 5: Replace the generic troop click placer while preserving order markers**

- Replace each troop button in `TokenPlacerPanel` with `DraggableTroopChip`.
- Keep the existing order-marker arm-and-click path only for the 2D renderer, renamed locally to make its purpose explicit.
- Pass `tokens={null}` to `MapControlDock` when the user cannot write.
- Do not render a 2D click placer in Rockbreaker.

- [ ] **Step 6: Route every 2D troop mutation through `requestTokenTransfer`**

Implement one page function:

```ts
async function requestTokenTransfer(groupId: string, intent: TokenTransferIntent) {
  const expectedSource = locateGroup(groupId, confirmedTokensRef.current, rockbreakerObjectsRef.current);
  if (expectedSource.kind === "ambiguous") throw new Error("Trupp besitzt mehrere gespeicherte Positionen.");
  const command = { operationId: crypto.randomUUID(), systemId: activeSystemIdRef.current, groupId, expectedSource, intent };
  return transferTokenClient(roomId, command, () => user!.getIdToken());
}
```

Migrate `commitToken`, `upsertToken`, `removeToken`, and `moveTokenUp` to this callback. Keep `confirmedTokensRef` updated only from Firestore snapshots, separate from temporary optimistic state. Prevent a second local request for a group while its first transfer is pending.

Change group deletion to refuse a located group with `Token zuerst entfernen oder eine Ebene verschieben.`; it must no longer mutate token arrays directly.

- [ ] **Step 7: Lift Rockbreaker objects and merge badges**

Subscribe once in `app/page.tsx` when the room member is authenticated and Rockbreaker is enabled. Pass the objects to `RockbreakerMap`, and update `getActiveGroupsForMarker` to call `groupsForLocationMarker` so the Rockbreaker pill shows its 3D groups without copying them into the board document.

- [ ] **Step 8: Run focused unit and UI tests**

Run: `npm test -- tests/token-transfer.test.ts tests/token-occupancy.test.ts`  
Expected: PASS.

Run: `npm run build:ui-test`  
Run: `npm run test:ui -- tests/ui/token-transfer.spec.ts`  
Expected: PASS for list drag, existing-token drag, badge, parent return, and rollback.

- [ ] **Step 9: Commit**

```powershell
git add app/components/map/token-transfer-controls.tsx app/ui-test/token-transfer/page.tsx tests/ui/token-transfer.spec.ts app/page.tsx
git commit -m "feat: drag troops through the 2d map hierarchy"
```

### Task 7: Rockbreaker fixed entry and 3D return drop

**Files:**

- Modify: `app/components/map/rockbreaker-map.tsx`
- Modify: `app/ui-test/rockbreaker/page.tsx`
- Modify: `tests/ui/rockbreaker-map.spec.ts`
- Modify: `app/page.tsx`
- Modify: `lib/map-scene/client.ts`

**Interfaces:**

- `RockbreakerMap` consumes controlled `objects: SceneObject[]`.
- `RockbreakerMap` produces `onMoveGroupUp(groupId, revision): Promise<void>`.
- Existing `moveMapSceneObject` remains the same-map coordinate mutation API.

- [ ] **Step 1: Extend the Rockbreaker UI test first**

Add assertions that:

- there is no `Truppenmarker` select inside either Rockbreaker canvas;
- `↑ Eine Ebene hoch nach Nyx` is visible for writers;
- dragging the rendered Fight Team object to that target calls the harness transfer and removes the 3D object;
- two camera views still report the same world coordinate before removal; and
- camera rotation changes neither stored coordinate nor anchor.

- [ ] **Step 2: Build and run the test to verify failure**

Run: `npm run build:ui-test`  
Run: `npm run test:ui -- tests/ui/rockbreaker-map.spec.ts`  
Expected: FAIL because Rockbreaker still owns duplicate controls and has no parent drop target.

- [ ] **Step 3: Convert Rockbreaker to controlled scene objects**

Remove its internal `subscribeSceneObjects` effect and `objectsOverride`. Require `objects` from the parent. Preserve `objectsRef` for pointer handlers and preserve the existing lock/revision move path.

- [ ] **Step 4: Add the explicit parent-level target**

Render a clearly labelled DOM target above the canvas:

```tsx
<ParentLevelDropTarget parentLabel="Nyx" data-testid="rockbreaker-move-up" />
```

On pointer-up during a group-token drag, call `document.elementFromPoint(event.clientX, event.clientY)`. If the parent target is under the pointer, call `onMoveGroupUp(groupId, object.revision)` instead of `moveMapSceneObject`. On success the shared scene snapshot removes the mesh. On rejection reset the mesh through `confirmedObjectPosition` and show the conflict message.

- [ ] **Step 5: Move renderer controls into the right dock**

- Remove the Rockbreaker troop select and internal enemy button box.
- Keep the compact title/back affordance.
- Put Rockbreaker enemy marker placement buttons into the dock's `enemy` section.
- Keep enemy creation through the generic scene-object endpoint; enemy markers are not troop transfers.
- Keep `showGrid` driven by persisted map preferences.

- [ ] **Step 6: Verify shared positions and return behavior**

Run: `npm test -- tests/rockbreaker-coordinates.test.ts tests/rockbreaker-scene-objects.test.ts tests/token-transfer-store.test.ts`  
Expected: PASS.

Run: `npm run build:ui-test`  
Run: `npm run test:ui -- tests/ui/rockbreaker-map.spec.ts tests/ui/token-transfer.spec.ts`  
Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add app/components/map/rockbreaker-map.tsx app/ui-test/rockbreaker/page.tsx tests/ui/rockbreaker-map.spec.ts app/page.tsx lib/map-scene/client.ts
git commit -m "feat: return Rockbreaker troops to Nyx"
```

### Task 8: Enforce server-only troop-location changes

**Files:**

- Modify: `firestore.rules`
- Modify: `tests/firestore-rules/mobile-and-scenes.test.ts`
- Modify: `app/page.tsx`

**Interfaces:**

- Consumes: transfer route for all token location mutations.
- Produces: Firestore rule guarantee that direct clients cannot alter `tokens` or `tokensBySystem`.

- [ ] **Step 1: Add failing Firestore rule assertions**

Extend the emulator fixture board with `tokensBySystem.nyx`. Assert:

```ts
await assertFails(updateDoc(boardRef(commander), {
  tokensBySystem: { nyx: [{ groupId: "g1", mapId: "main", x: 0.9, y: 0.9 }] },
}));
await assertSucceeds(updateDoc(boardRef(commander), { notesText: "authorized non-token update" }));
```

Also assert that delete/recreate cannot be used to replace protected token fields and direct writes under `tokenTransferOperations` are denied.

- [ ] **Step 2: Run the rule test under the emulator and verify failure**

Run: `npx firebase-tools emulators:exec --only firestore "npm test -- tests/firestore-rules/mobile-and-scenes.test.ts"`  
Expected: FAIL because commanders can currently replace `tokensBySystem`.

- [ ] **Step 3: Protect token fields without blocking unrelated board work**

Add helpers:

```text
function createsNoTokenFields() {
  return !request.resource.data.keys().hasAny(['tokens', 'tokensBySystem']);
}

function keepsTokenFieldsUnchanged() {
  return !request.resource.data.diff(resource.data).affectedKeys().hasAny(['tokens', 'tokensBySystem']);
}
```

Use `allow create: if canWriteBoard(roomId) && createsNoTokenFields()` and `allow update: if canWriteBoard(roomId) && keepsTokenFieldsUnchanged()`. Server Admin transactions bypass client rules as intended.

- [ ] **Step 4: Prove no legacy direct token writer remains**

Run: `rg -n "pushTokensOnly|tokensBySystem.*updateDoc|tokensBySystem.*setDoc" app lib`  
Expected: no callable direct token-location writer remains. Remove the obsolete `pushTokensOnly` function after confirming every call site uses `requestTokenTransfer`.

- [ ] **Step 5: Run rules and relevant tests**

Run: `npx firebase-tools emulators:exec --only firestore "npm test -- tests/firestore-rules/mobile-and-scenes.test.ts"`  
Expected: PASS.

Run: `npm test -- tests/token-transfer-store.test.ts tests/token-transfer-route.test.ts tests/map-scene-store.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add firestore.rules tests/firestore-rules/mobile-and-scenes.test.ts app/page.tsx
git commit -m "fix: prevent direct troop location overwrites"
```

### Task 9: Confirm grid and persistent enemy-marker behavior

**Files:**

- Modify: `tests/enemy-markers.test.ts`
- Modify: `tests/map-ui-preferences.test.ts`
- Modify: `tests/ui/map-control-dock.spec.ts`
- Modify: `tests/ui/rockbreaker-map.spec.ts`
- Modify only if a test exposes a regression: `lib/map/enemy-markers.ts`, `app/page.tsx`, or `app/components/map/rockbreaker-map.tsx`

**Interfaces:**

- Preserves: `normalizeEnemyMarker` always yields `opacity: 1`.
- Preserves: default `showGrid: true`, explicit stored false remains false.

- [ ] **Step 1: Add regression tests for absence of expiration**

Test a marker one year old and assert normalization still returns it with opacity 1. In both 2D and Rockbreaker UI harnesses, rerender with a later clock/object array and assert the marker remains until the explicit delete action is invoked.

- [ ] **Step 2: Add preference regression tests**

Assert a new storage key shows the grid, saved `{ showGrid: false }` hides it after reload, and returning to a new player/room key restores the default visible grid.

- [ ] **Step 3: Run tests and make only evidence-driven fixes**

Run: `npm test -- tests/enemy-markers.test.ts tests/map-ui-preferences.test.ts`  
Run: `npm run build:ui-test`  
Run: `npm run test:ui -- tests/ui/map-control-dock.spec.ts tests/ui/rockbreaker-map.spec.ts`  
Expected: PASS. If current code already satisfies persistence, commit only strengthened tests; do not rewrite working marker code.

- [ ] **Step 4: Commit**

```powershell
git add tests/enemy-markers.test.ts tests/map-ui-preferences.test.ts tests/ui/map-control-dock.spec.ts tests/ui/rockbreaker-map.spec.ts lib/map/enemy-markers.ts app/page.tsx app/components/map/rockbreaker-map.tsx
git commit -m "test: lock grid and enemy marker persistence"
```

Before committing, use `git diff --name-only` and omit unchanged implementation paths from `git add`.

### Task 10: Read-only data audit and safe Rockbreaker entry rollout

**Files:**

- Create: `lib/release/token-location-audit.ts`
- Create: `lib/release/rockbreaker-entry-rollout.ts`
- Create: `scripts/audit-token-locations.ts`
- Create: `scripts/set-rockbreaker-entry.ts`
- Create: `tests/token-location-audit.test.ts`
- Create: `tests/rockbreaker-entry-rollout.test.ts`
- Modify: `package.json`
- Modify: `app/api/rooms/[roomId]/map-scenes/[sceneId]/route.ts`

**Interfaces:**

- Produces: `auditTokenLocations(input): TokenLocationAuditIssue[]`.
- Produces: `buildRockbreakerEntryUpdate(currentMetadata)` and confirmed CLI apply.
- Commands: `npm run room:audit-tokens -- --room <id> --out <absolute-new-file>` and `npm run room:rockbreaker-entry -- --room <id> [--apply --confirm-room <id>]`.

- [ ] **Step 1: Write failing audit tests**

Cover issue codes:

```ts
"INVALID_TOKEN" | "UNKNOWN_GROUP" | "DUPLICATE_2D_LOCATION" |
"CROSS_RENDERER_DUPLICATE" | "INVALID_SCENE_OBJECT" |
"ENTRY_CONFIG_MISSING" | "ENTRY_CONFIG_INVALID"
```

Assert valid unplaced groups and one valid 2D or 3D location produce no issue. Assert the audit result includes exact document paths and group IDs but never mutates the input.

- [ ] **Step 2: Implement the pure audit and read-only CLI**

The CLI reads only:

- `rooms/{roomId}/state/board`;
- `rooms/{roomId}/mapScenes/nyx--rockbreaker`; and
- its `objects` collection.

Require an explicit absolute output file, open with `flag: "wx"`, write JSON with room, project, timestamp, counts, and issues, and set exit code 2 when blocking issues exist. Do not include secrets or member data.

- [ ] **Step 3: Write and implement safe entry metadata rollout**

`buildRockbreakerEntryUpdate` returns only:

```ts
{
  systemId: "nyx",
  mapId: "rockbreaker",
  renderer: "rockbreaker3d",
  sceneVersion: 1,
  troopEntry: DEFAULT_ROCKBREAKER_ENTRY,
}
```

The CLI follows the existing `room:features` safety pattern: dry-run by default; writes only with `--apply --confirm-room <exact-room>`; uses merge semantics; rereads and parses the metadata to verify it. Update the scene PUT route to use the same builder so newly initialized scenes receive identical configuration.

- [ ] **Step 4: Add package commands and run tests**

```json
"room:audit-tokens": "tsx scripts/audit-token-locations.ts",
"room:rockbreaker-entry": "tsx scripts/set-rockbreaker-entry.ts"
```

Run: `npm test -- tests/token-location-audit.test.ts tests/rockbreaker-entry-rollout.test.ts tests/rockbreaker-scene-config.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add lib/release/token-location-audit.ts lib/release/rockbreaker-entry-rollout.ts scripts/audit-token-locations.ts scripts/set-rockbreaker-entry.ts tests/token-location-audit.test.ts tests/rockbreaker-entry-rollout.test.ts package.json app/api/rooms/[roomId]/map-scenes/[sceneId]/route.ts
git commit -m "feat: audit and configure troop transfer data"
```

### Task 11: Full verification, production backup, cutover, and live acceptance

**Files:**

- Modify only for discovered defects: files owned by Tasks 1–10.
- Evidence output outside Git: `C:\dev\KlabsCom\private-backups\...` and a new audit JSON beside it.

**Interfaces:**

- Consumes all prior tasks.
- Produces a green feature branch, verified production backup/audit, merged `main`, Vercel deployment, and two-session acceptance record.

- [ ] **Step 1: Run the complete automated suite**

Run each command separately:

```powershell
npm test
npx tsc --noEmit
npm run lint
npm run build
npm run build:ui-test
npm run test:ui
npx firebase-tools emulators:exec --only firestore "npm test -- tests/firestore-rules/mobile-and-scenes.test.ts"
```

Expected: all tests pass; TypeScript, lint, both builds, all Playwright specs, and Firestore rules are green. Record exact pass/skip counts before claiming completion.

- [ ] **Step 2: Inspect the branch before production access**

```powershell
git status --short --branch
git log --oneline --decorate main..HEAD
git diff --check main...HEAD
git diff --stat main...HEAD
```

Expected: clean branch, only scoped commits, no whitespace errors, no `.env*`, backup, audit, or credential files staged.

- [ ] **Step 3: Back up `Pyro_Template` into a new private directory**

```powershell
$klabsBackupStamp = Get-Date -Format 'yyyy-MM-dd-HHmmss'
$klabsBackupDir = "C:\dev\KlabsCom\private-backups\pre-token-transfer-pyro-$klabsBackupStamp"
npm run room:backup -- --room Pyro_Template --out $klabsBackupDir
npm run room:backup:verify -- --dir $klabsBackupDir
```

Expected: backup reports a non-zero document count and verification reports no hash/count errors. Do not reuse or overwrite an existing backup directory.

- [ ] **Step 4: Run the read-only production audit**

```powershell
$klabsAuditPath = Join-Path $klabsBackupDir 'token-location-audit.json'
npm run room:audit-tokens -- --room Pyro_Template --out $klabsAuditPath
Get-Content -LiteralPath $klabsAuditPath -Raw
```

Expected: no `DUPLICATE_2D_LOCATION`, `CROSS_RENDERER_DUPLICATE`, `INVALID_TOKEN`, or `INVALID_SCENE_OBJECT`. `ENTRY_CONFIG_MISSING` is allowed only before Step 5 and must disappear afterward. Stop before writes if any other blocking issue appears.

- [ ] **Step 5: Initialize and verify the fixed Rockbreaker entry metadata**

```powershell
npm run room:rockbreaker-entry -- --room Pyro_Template
npm run room:rockbreaker-entry -- --room Pyro_Template --apply --confirm-room Pyro_Template
```

Expected: dry-run shows only the scene metadata fields from Task 10; apply rereads and reports `verified: true`.

Run a second audit to a new path:

```powershell
$klabsVerifiedAuditPath = Join-Path $klabsBackupDir 'token-location-audit-after-entry.json'
npm run room:audit-tokens -- --room Pyro_Template --out $klabsVerifiedAuditPath
```

Expected: zero blocking issues including entry configuration.

- [ ] **Step 6: Push the feature branch and verify the Vercel preview**

```powershell
git push -u origin agent/map-token-transfer
```

Wait for the existing Vercel Git integration to produce a Ready preview. On that preview verify login, Nyx navigation, compact right dock, Grid, Rockbreaker loading, and no public `/ui-test/*` route.

- [ ] **Step 7: Merge with an explicit merge commit and publish `main`**

```powershell
git switch main
git pull --ff-only origin main
git merge --no-ff agent/map-token-transfer -m "merge: publish transactional map token transfers"
git push origin main
```

Expected: push succeeds and Vercel starts the production deployment automatically from `main`.

- [ ] **Step 8: Perform two-browser live acceptance**

Using two authenticated sessions against `https://klabscom.vercel.app`:

1. Open `Pyro_Template`, switch to Nyx, and drag Fight Team onto Rockbreaker.
2. Confirm both sessions show one Rockbreaker badge and the same fixed edge world coordinate.
3. Rotate one camera and confirm neither session's stored coordinate changes.
4. Drag the 3D troop onto `↑ Eine Ebene hoch nach Nyx`.
5. Confirm both sessions show one 2D token beside the Rockbreaker pill and no 3D duplicate.
6. Repeat with a normal 2D child and confirm exactly-one-level return.
7. Attempt a simultaneous transfer and confirm one succeeds while the other visibly rolls back.
8. Confirm viewer cannot drag or call the transfer endpoint successfully.
9. Reload and confirm Grid preference, persistent enemy markers, dock side, height, and section states.
10. Confirm `https://klabscom.vercel.app/ui-test/token-transfer` and other UI-test routes return 404.

- [ ] **Step 9: Roll back only if acceptance fails**

Use Vercel's previous production deployment for application rollback; do not restore the room backup automatically. Completed transfers remain valid records in the existing schemas. Use the backup only for a separately reviewed data repair if the audit demonstrates corrupted data.

- [ ] **Step 10: Record final evidence**

Report:

- merge commit SHA and production deployment URL;
- backup path, document count, and SHA-256;
- before/after audit paths and issue counts;
- unit/integration, rule, TypeScript, lint, build, and UI-test results; and
- every live acceptance item as passed or still open.

Do not describe the feature as complete until all automated checks and the live two-browser acceptance pass.
