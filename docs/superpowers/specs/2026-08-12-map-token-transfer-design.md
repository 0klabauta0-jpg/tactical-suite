# Map Token Transfer and Compact Controls Design

**Status:** Approved conversational design, pending written-spec review
**Date:** 2026-08-12
**Target:** KlabsCom web app only

## Objective

Make troop placement and movement consistent across the map hierarchy, including the Rockbreaker 3D submap. A group must be movable by drag and drop from the group list or from an existing token, must be dockable into a child location, and must be movable back exactly one level. Every participant must see the same authoritative result in real time.

The same change also makes the map controls less intrusive, keeps the grid enabled by default, and makes enemy markers persistent instead of time-limited.

## Non-goals

- No big-bang rewrite of `app/page.tsx` or the map system.
- No replacement of the existing room, board, or Rockbreaker storage models.
- No change to the user login flow.
- No redesign of roles beyond enforcing the existing write permissions.
- No automatic destructive cleanup of ambiguous live data.

## Current behavior and problem

- The generic token placer expects the image element used by the 2D renderer. Rockbreaker renders a canvas, so selecting a troop and clicking Rockbreaker does not place it.
- Rockbreaker also has renderer-specific controls, producing duplicate and confusing token controls.
- Existing 2D tokens can be moved within their current map, but a token or group cannot be dragged directly onto a child-map or POI pill.
- Parent location pills already display small colored group indicators for 2D descendants.
- A small arrow in the location-pill menu can move a 2D group upward. This action is hard to discover and is not connected to Rockbreaker's 3D object model.
- Rockbreaker group objects and 2D board tokens are stored separately. Client-side two-step writes could duplicate or lose a group during a transfer.
- The map control dock occupies too much permanent space for routine use.

## Chosen approach

Add a focused, server-authoritative transfer service while preserving the existing 2D token and Rockbreaker object models. The transfer service performs all source and destination mutations in one Firestore transaction.

This is preferred over client-orchestrated writes because a network interruption cannot leave a group duplicated or missing. A full migration to a new universal token collection is intentionally rejected as an unnecessary large refactor.

## Location invariant

Within one system, each ordinary troop group has at most one authoritative tactical location:

- a token on one 2D map or POI; or
- a group object in one 3D scene.

An unplaced group has no tactical location until it is placed again. Colored dots on ancestor pills are derived occupancy indicators, not additional locations or duplicate tokens. Spawn groups retain their existing special behavior and are outside this transfer invariant unless the current application already treats them as ordinary movable troop groups.

## User interaction

### Compact control dock

- The control dock is attached to the right edge.
- It can collapse to a narrow rail and can be moved vertically within the viewport.
- Its collapsed state, vertical position, and section states are persisted with the existing map UI preferences.
- Sections such as troops, enemy markers, and drawing controls start compact instead of permanently occupying the map.
- Renderer-specific controls appear only when they work for the active renderer. The broken generic 2D click placer is not shown in Rockbreaker.

### Moving groups downward or within a level

A writable group can be dragged from either source:

1. its entry in the compact troop list; or
2. an existing token on the active map.

Valid drop targets are:

- open map space, which places or moves the token at the dropped position; and
- a child-map or POI pill, which transfers the group into that child location.

After a successful child transfer, the large token disappears from the parent. The parent pill keeps a small colored group indicator. Opening the child shows the actual token or 3D group object.

Normal 2D children use stable, neighboring slots in a fixed entry area near the left edge. This gives a pill drop an immediate deterministic destination without pretending that the parent-map drop coordinate is a coordinate inside the child.

### Rockbreaker entry

Dropping a group onto the Rockbreaker pill transfers it immediately into a fixed shared entry area at the outside edge of the 3D scene. The entry area's base coordinate and slot layout are scene configuration, not camera-relative or client-local values.

Groups use stable neighboring slots around the entry point so multiple arrivals do not occupy the exact same position. Slot choice is determined against authoritative scene occupancy inside the transaction. Every client therefore receives identical world coordinates. Camera rotation changes only the view; the troop object remains at its shared world position and visually moves with the scene.

### Moving one level upward

Every child location exposes a clear drop target labelled with its parent, for example `↑ Eine Ebene hoch nach Nyx`.

- Dragging an existing token or Rockbreaker group object onto this target transfers it exactly one hierarchy level upward.
- On the parent 2D map, the token is placed beside the pill representing the child it left.
- Stable neighboring offsets keep the token and pill separately clickable and prevent multiple returning groups from stacking exactly.
- The existing arrow action remains as a click and touch fallback and invokes the same transfer service.
- Repeating the action traverses further hierarchy levels; there is no implicit jump to the root map.

This establishes one consistent rule: drop onto a location pill to enter it; drop onto the labelled parent target to leave it.

## Transfer service

The client submits a transfer command containing at least:

- room and system identity;
- group identity;
- expected source location and source kind;
- destination location and destination kind;
- requested 2D position when dropping on open map space;
- expected source revision or equivalent precondition; and
- a unique operation ID.

The server validates the complete command before mutation:

- authenticated room membership;
- freshly resolved role and write permission;
- room feature gates, including Rockbreaker;
- known group, source, destination, renderer, and hierarchy relationship;
- finite and bounded 2D or 3D coordinates; and
- the group's continued presence at the expected source.

One Firestore transaction then applies the required pair of changes:

- 2D to 2D: update the board token structure;
- 2D to Rockbreaker: remove the board token and create the scene group object;
- Rockbreaker to 2D: delete the scene group object and create the parent board token.

An operation ID makes retries idempotent. If the source precondition is stale because another participant moved the group first, the transaction is rejected without partial writes.

## Realtime display

Existing board listeners continue to provide 2D token updates. Rockbreaker group occupancy shown on an ancestor pill is derived from the scene's authoritative group objects through a narrow realtime subscription or selector. It is not copied into the board document.

Dragging is shown optimistically on the initiating client, while the last confirmed server state remains available. On rejection, the token returns to that state and the user receives a short message such as: `Trupp wurde inzwischen von einem anderen Teilnehmer verschoben.`

## Grid and enemy markers

- Grid visibility defaults to enabled for users without a saved preference.
- An explicit saved preference still wins on later visits.
- Enemy markers have no automatic disappearance timer.
- Creating, moving, or deleting an enemy marker remains subject to existing write permissions and realtime persistence.

## Data audit and compatibility

Before rollout, a read-only audit checks affected rooms for:

- a group present on more than one 2D level;
- a group present in both 2D board tokens and a Rockbreaker scene;
- malformed group IDs, map IDs, scene objects, positions, or revisions; and
- missing or invalid Rockbreaker entry configuration.

The audit reports ambiguous records and does not delete them automatically. Before any approved repair, the affected board and map-scene documents are backed up. Existing valid tokens and Rockbreaker objects remain compatible; the rollout does not require a new global data model or login migration.

## Verification

### Automated checks

- Unit tests for hierarchy resolution, stable entry/return slots, validation, and the one-location invariant.
- Transfer-service tests for every 2D/3D direction, authorization, feature gates, stale sources, duplicate operation IDs, and concurrent transfers.
- Firestore tests confirming clients cannot bypass protected server mutations.
- UI tests for both drag sources, child pills, the parent drop target, occupancy badges, compact right dock, grid default, and persistent enemy markers.
- Existing unit, integration, Firestore-rule, TypeScript, lint, and production-build checks remain green.

### Live acceptance with two browser sessions

1. Drag Fight Team onto the Rockbreaker pill.
2. Verify that both sessions show it in the same fixed edge entry area.
3. Rotate the 3D view and verify that the troop remains attached to its world position.
4. Drag it onto `↑ Nyx`.
5. Verify that both sessions show it beside the Rockbreaker pill on Nyx.
6. Verify that a viewer can observe but cannot perform transfers.
7. Reload and verify the grid default, persistent enemy markers, and saved dock layout.
8. Attempt simultaneous transfers and verify that exactly one authoritative destination wins while the rejected client recovers visibly.

## Rollout and rollback

Implementation occurs on a feature branch. After all automated checks pass, deploy a preview and perform the focused UI checks. Back up and audit production data before merging to `main`. The existing Vercel integration then publishes the main branch, followed by the two-browser live acceptance.

The endpoint and UI changes are additive and use the existing storage models. If application behavior regresses, the previous Vercel deployment can be restored without migrating data back to another schema. Any transfers already completed remain valid existing 2D tokens or Rockbreaker objects.

## Acceptance criteria

The design is fulfilled when:

- both the troop list and existing tokens can initiate a drag;
- entering and leaving ordinary child locations follows the same visible interaction rule;
- Rockbreaker entry uses fixed shared edge coordinates with non-overlapping stable slots;
- a Rockbreaker troop can return exactly one level to Nyx beside its pill;
- ancestor pills show accurate derived occupancy;
- concurrent or retried transfers cannot duplicate or lose a group;
- role enforcement and the login experience remain unchanged;
- the right control dock is compact, collapsible, vertically movable, and persistent;
- the grid defaults on and enemy markers remain until explicitly deleted; and
- automated checks plus the two-session live acceptance pass.
