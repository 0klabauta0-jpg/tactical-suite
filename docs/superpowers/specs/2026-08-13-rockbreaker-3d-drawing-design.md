# Rockbreaker 3D Drawing Design

**Date:** 2026-08-13  
**Status:** Approved in conversation; awaiting review of this written specification

## Goal

Rockbreaker receives a collaborative drawing tool whose marks are real 3D scene objects. A drawing keeps fixed shared world coordinates, moves visually with the asteroid field when the camera rotates, and appears live for every participant. Enemy markers also become freely movable on all three axes.

The first release supports points and freehand paths. A complete path can be moved or deleted, but individual control points cannot be edited.

## User Experience

The left Rockbreaker control dock contains these drawing controls for writers:

- pointer mode;
- point placement;
- freehand drawing;
- move mode;
- delete mode;
- color selection;
- stroke-width selection;
- undo of the current user's most recently created drawing object.

In freehand mode, pressing the pointer starts a local preview. The initial hit determines the depth. A camera-facing plane through that initial point remains fixed for the duration of the stroke. Pointer movement is projected onto that plane and produces a path of shared X/Y/Z coordinates. Releasing the pointer saves the complete path as one scene object.

The drawing remains fixed in world space when the camera rotates. Move mode translates the entire path camera-relatively on X, Y and Z without changing its shape. Delete mode removes only the selected point or path. It cannot remove troop tokens. Undo removes only the current user's latest drawing object and never another participant's latest work.

Enemy markers use the same camera-relative, bounded X/Y/Z movement as troop tokens. Their existing creation behavior remains available.

## Architecture

Rockbreaker drawings use the existing per-object scene collection:

`rooms/{roomId}/mapScenes/{sceneId}/objects/{objectId}`

Each point, path, token, and enemy marker remains an independent document. Realtime listeners continue to deliver authoritative scene snapshots. This avoids whole-board rewrites and prevents one participant's drawing from overwriting unrelated scene objects.

The implementation extends the existing Rockbreaker boundaries rather than reusing `drawingsBySystem` from the 2D board:

- the scene-object domain model parses and validates 3D paths;
- the server scene store creates, locks, translates, and deletes them transactionally;
- the map-scene API exposes the required mutations under the existing room authentication and role checks;
- the Three.js renderer owns path geometry, hit targets, preview geometry, and disposal;
- a focused Rockbreaker drawing control component owns tool selection and reports user intent to the renderer.

No existing Firestore document requires migration. Existing scene objects remain valid.

## Data Model

A new `stroke` scene object contains:

- the existing scene-object metadata and revision fields;
- `type: "stroke"`;
- a validated color;
- a bounded stroke width;
- `points`, containing between 2 and 512 valid Rockbreaker world points.

The existing `point` type remains the single-point drawing object. A stroke is stored atomically as one document, not as separate documents per segment.

Client sampling skips points that are too close in screen space and simplifies the completed path before upload. The server does not trust this optimization: it independently validates the final point count, finite coordinates, scene version, anchors, stroke width, and world bounds.

## Mutations and Concurrency

Creation remains local-only until pointer release. The final object is then created once through the authenticated scene-object API. Failed creation removes the preview and shows an actionable status message.

Moving a point, stroke, or enemy marker requires the existing short-lived object lock and expected revision. A stroke move sends a translation vector; the server applies it to the authoritative stored points inside the transaction and validates every resulting point before committing. It does not accept a client replacement of the complete stored path during movement.

If the lock expires or the revision changes, the operation is rejected. The client restores the latest authoritative object instead of retaining the optimistic position.

Deletion uses the authenticated transactional path. It permits drawing points, strokes, enemy markers, and other deletable tactical objects while preserving the existing protection for troop tokens. Undo calls this same deletion path for the latest still-existing drawing object created by the current user.

## Bounds and Interaction Safety

All created and moved points use the shared Rockbreaker movement bounds. Pointer coordinates are clamped to a safe canvas inset before ray projection. A translation that would move any part of a stroke outside the shared field is clamped client-side and rejected server-side if invalid data still arrives.

Drawing mode suppresses camera orbit for the active stroke. Pointer mode retains normal orbit and token interaction. Tool actions stop propagation so operating the left dock cannot draw into the scene.

Path selection uses a dedicated, enlarged invisible hit target so thin visible strokes remain usable. Selecting and moving a path translates the complete object; editing individual vertices is intentionally out of scope.

## Permissions

Only authenticated `admin` and `commander` members can create, move, or delete Rockbreaker drawing objects and enemy markers. Viewers receive them through the existing realtime subscription but cannot mutate them. Firestore client rules remain read-only for map-scene writes; all mutations continue through authenticated server routes.

## Rendering

Points render as small emissive 3D markers. Strokes render as connected 3D paths with stable color and visible thickness. Geometry is rebuilt when the authoritative object revision changes. Temporary preview geometry is visually distinct and is never inserted into the shared object list before persistence succeeds.

All created geometry, materials, hit targets, and previews must be disposed when objects change or the component unmounts.

## Error Handling

User-visible status covers:

- invalid or empty strokes;
- paths exceeding the point limit;
- objects outside shared bounds;
- lock and revision conflicts;
- permission rejection;
- persistence or connection failure.

Creation failure removes the preview. Move failure restores the confirmed coordinates. Delete failure keeps the object visible. Realtime validation ignores malformed remote objects without allowing them into renderer state or follow-up writes.

## Verification

Unit tests cover:

- parsing valid and invalid strokes;
- point-count, width, coordinate, anchor, and bounds validation;
- path sampling and simplification;
- bounded translation of complete paths;
- lock, revision, permission, and protected-token behavior;
- delete and user-owned undo selection.

Store and API tests cover atomic create, transactional translation, deletion, conflict rejection, and malformed input.

Browser tests cover:

- drawing a freehand path and observing the same saved world coordinates from two camera perspectives;
- rotating the camera while the path remains fixed in the scene;
- moving the entire path on X, Y, and Z while preserving its shape;
- shared-bound clamping and rejection;
- deleting a point and a path;
- undoing only the current user's latest drawing;
- moving an enemy marker freely on X, Y, and Z;
- rollback after a simulated conflict;
- viewer visibility without write controls.

Final acceptance requires the complete unit/integration suite, ESLint, production build, and Playwright suite to pass before merge or deployment.

## Out of Scope

- text labels;
- individually editable path vertices;
- filled polygons or volumes;
- freehand strokes that change depth within one pointer gesture;
- export/import of drawings;
- bulk deletion of every participant's drawings;
- changes to 2D board drawing storage.
