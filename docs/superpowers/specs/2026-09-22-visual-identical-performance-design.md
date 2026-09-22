# Visual-Identical Performance Optimization Design

**Repository:** `fanelix/slope-viewer`  
**Branch:** `perf/visual-identical-optimization`  
**Date:** 2026-09-22  
**Status:** Proposed for implementation after user review

## 1. Purpose

Make the Slope Monitor 3D application substantially lighter and more responsive while preserving the rendered DXF model and existing operating behavior.

The current terrain is not geometrically excessive: the canonical DXF contains 41,832 `3DFACE` entities and produces 21,002 unique vertices and 41,832 triangles. Performance work will therefore optimize transport, parsing, memory lifecycle, render scheduling, overlay draw calls, and scene updates instead of reducing terrain fidelity.

## 2. Binding constraints

The implementation must preserve all of the following unless a later request explicitly changes them:

- `data/topografi.dxf` remains the canonical terrain source.
- The extracted X/Y/Z coordinates and I/J/K triangle indices remain identical.
- Default terrain has 21,002 unique vertices and 41,832 triangles.
- Three.js stays pinned to `0.160.0` during this work.
- Elevation palette and color interpolation remain identical.
- Default opacity remains 0.9.
- Default Z exaggeration remains 6×.
- Faceted rendering remains enabled by default.
- `DoubleSide`, antialiasing, pixel ratio policy, lights, shadows, camera FOV, camera presets, grid, and control mappings remain unchanged.
- Monitoring point positions, classifications, colors, arrow directions, minimum arrow lengths, sphere radii, and scale controls remain unchanged.
- The existing zero-horizontal-motion north-pointing placeholder arrows remain unchanged in this performance-only branch.
- GitHub Pages remains the runtime host; the application remains a static site with no backend.
- Manual `.dxf` and `.csv` upload remains available.
- Failure of an optimization layer must fall back to a functional path, not prevent the viewer from opening.

## 3. Non-goals

This project will not:

- decimate or simplify the terrain mesh;
- convert the canonical terrain to glTF, Draco, or another model format;
- change slope/edge filtering defaults;
- change monitoring thresholds or geotechnical interpretations;
- remove antialiasing, shadows, or double-sided rendering;
- lower device pixel ratio to gain performance;
- upgrade Three.js or change the renderer/material family;
- redesign the UI;
- make the public repository private;
- clean the duplicate `HLO-W-27` monitoring record;
- change the placeholder arrow behavior for zero horizontal displacement.

Those correctness and governance items are documented separately and require their own approval because they can change visible or operational output.

## 4. Selected approach

Use a phased static architecture:

1. Keep GitHub Pages and browser-native ES modules.
2. Extract the existing inline JavaScript into focused source modules without adding a production bundler.
3. Add a deterministic compressed transport copy of the canonical DXF.
4. Move parse/extraction/reprocessing work to a Web Worker.
5. Replace perpetual rendering with invalidation-driven rendering.
6. Replace per-point scene objects with visually equivalent batched/instanced objects.
7. Cache parsed typed arrays by content hash for repeat loads.
8. Guard every change with geometry hashes and fixed-view screenshot comparisons.

Development tooling may use Node.js and Playwright, but deployed runtime files remain plain static assets.

## 5. Proposed file structure

```text
index.html
package.json
src/
  app.js
  config.js
  data-loader.js
  dxf-core.js
  monitoring-core.js
  render-scheduler.js
  scene-controller.js
  cache.js
  workers/
    dxf-worker.js
scripts/
  build-assets.mjs
  serve-tests.mjs
tests/
  geometry.test.mjs
  monitoring.test.mjs
  assets.test.mjs
  ui.spec.mjs
  baselines/
data/
  topografi.dxf
  topografi.dxf.gz
  assets-manifest.json
  monitoring.csv
lib/
  dxf-parser.js
  delaunator.min.js
  papaparse.min.js
.github/workflows/
  verify.yml
```

Responsibilities:

- `app.js`: DOM wiring and high-level orchestration only.
- `config.js`: immutable defaults, column aliases, thresholds, asset paths, and algorithm/cache version.
- `data-loader.js`: manifest lookup, cache lookup, gzip/raw fallback, worker request lifecycle, and manual file loading.
- `dxf-core.js`: pure extraction, filtering, voxel, and triangulation functions shared with tests and the worker.
- `monitoring-core.js`: pure CSV normalization, classification, and visual transform calculations.
- `render-scheduler.js`: one-frame invalidation, damping continuation, resize handling, and tab visibility behavior.
- `scene-controller.js`: Three.js scene ownership, targeted updates, resource disposal, batching, and camera presets.
- `cache.js`: IndexedDB storage keyed by source hash and algorithm version; every error is non-fatal.
- `dxf-worker.js`: decode, parse, extract, reprocess, and transferable typed-array responses.
- `build-assets.mjs`: deterministic gzip generation plus SHA-256 manifest generation.

## 6. Asset transport design

### 6.1 Canonical and derived files

`data/topografi.dxf` remains canonical. `data/topografi.dxf.gz` is a generated transport artifact. The gzip file must decompress byte-for-byte to the canonical DXF.

`data/assets-manifest.json` contains:

```json
{
  "schemaVersion": 1,
  "algorithmVersion": "dxf-v1",
  "dxf": {
    "path": "data/topografi.dxf",
    "gzipPath": "data/topografi.dxf.gz",
    "sha256": "ce8f3293b3358105cfc337dc50a4a1de096db72e8ffd892610c7231d13b2acca",
    "bytes": 16758246,
    "gzipBytes": 2313888
  }
}
```

The exact gzip size may vary slightly across zlib implementations; the decompressed SHA-256 and bytes are authoritative.

### 6.2 Load order

1. Fetch the manifest with revalidation enabled.
2. Look for a parsed cache entry keyed by `sha256 + algorithmVersion`.
3. If found and structurally valid, hydrate the mesh from cache.
4. Otherwise fetch `gzipPath`.
5. If `DecompressionStream('gzip')` is available, decompress to an `ArrayBuffer`.
6. Verify byte length and SHA-256 when Web Crypto is available.
7. If compressed fetch/decompression/hash verification fails, fetch the canonical `.dxf`.
8. Transfer the buffer to the DXF worker.

No asset optimization failure may block the canonical raw-DXF fallback.

### 6.3 Manual upload

Manual uploads are read as `ArrayBuffer`, then transferred to the same worker pipeline. A manually uploaded file is not persisted unless it matches a known manifest hash; this avoids retaining user-selected files unexpectedly.

## 7. Worker and geometry design

### 7.1 Worker protocol

Requests contain a unique ID and one of these operations:

- `parse`: DXF buffer plus mesh parameters.
- `reprocess`: raw typed geometry plus mesh parameters.
- `dispose`: release worker-held state before termination.

Responses contain:

- `progress`: stage and optional counts;
- `success`: geometry kind, raw geometry, mesh, statistics, and validation metadata;
- `error`: request ID, safe message, and stage.

### 7.2 Numeric representation

- Source X/Y/Z values use `Float64Array` so extraction preserves JavaScript number precision.
- Triangle indices use `Uint32Array`.
- Render buffers remain `Float32Array`, matching current Three.js `BufferGeometry` behavior.
- Filtering and triangulation formulas and comparison constants remain unchanged.
- 3DFACE vertex deduplication remains rounded to 0.001 units using the existing key formula.

### 7.3 Memory lifecycle

- Network data is transferred to the worker, not cloned.
- The worker discards the parser object tree and original text immediately after extraction.
- Typed buffers are transferred back to the main thread.
- Reprocessing transfers raw buffers to a short-lived worker and receives those raw buffers back with the new mesh, avoiding a persistent duplicate.
- A failed worker operation restores a coherent state and offers the canonical synchronous fallback.

### 7.4 Optional fast path

A streaming 3DFACE fast path is allowed only after the initial worker implementation passes geometry-hash tests. It must:

- support the current 3DFACE group-code layout;
- emit the same coordinate and triangle arrays;
- fall back to `DxfParser` when unsupported entities or layouts are encountered;
- never become the only parser path.

This fast path is the final optimization phase, not a prerequisite for the first functional release.

## 8. Parsed cache design

Use IndexedDB database `slope-viewer-cache`, schema version 1, object store `meshes`.

Each record contains:

- cache key: `<sha256>:<algorithmVersion>`;
- raw geometry kind and typed arrays;
- rendered mesh typed arrays and statistics;
- created timestamp;
- source byte length;
- parser/algorithm version.

Validation before use:

- exact cache key match;
- expected typed-array constructors;
- finite coordinates;
- equal I/J/K lengths;
- indices within vertex bounds;
- known geometry kind.

Any IndexedDB error, quota error, malformed record, or unsupported browser silently disables cache and continues through the source DXF path.

Only one current entry needs to be retained; stale algorithm/source entries are removed opportunistically after a successful load.

## 9. Rendering design

### 9.1 Invalidation scheduler

Replace the unconditional `requestAnimationFrame(animate)` loop with an invalidation scheduler.

A frame is requested when:

- initial scene build completes;
- OrbitControls emits `change`;
- damping still changes camera state;
- a UI control changes visible scene state;
- a mesh or monitoring update completes;
- labels/grid change;
- the window resizes;
- the document becomes visible again.

Only one pending animation frame is allowed. No frames run while the scene is stable or the document is hidden.

`renderer.render()` and `labelRenderer.render()` are still called together for every visible update, preserving layering.

### 9.2 Shadow updates

Keep `PCFSoftShadowMap`, 2048×2048 shadow size, lights, cast/receive flags, and shadow camera parameters. Set shadow auto-update off after the first valid render. Mark the shadow map dirty only when geometry, monitoring instances, Z exaggeration, or lighting changes.

Camera-only orbit/pan/zoom does not require rebuilding a world-space shadow map.

### 9.3 Targeted updates

UI changes map to the smallest valid scene operation:

| Change | Operation |
|---|---|
| opacity | mutate terrain material opacity |
| show topography | mutate terrain visibility |
| solid color | mutate terrain material color |
| horizontal/vertical scale | rebuild monitoring transforms only |
| show H/V/labels | toggle/rebuild monitoring layer only |
| show grid/grid spacing | rebuild helpers only |
| Z exaggeration | rebuild terrain render positions, monitoring transforms, helpers, frustum |
| faceted/smooth | rebuild terrain geometry/normals |
| wireframe | replace or mutate terrain material only |
| elevation coloring | rebuild color attribute/material state |
| voxel/slope/edge parameters | worker reprocess after explicit button action |

Range input events are coalesced to at most one visual update per animation frame.

### 9.4 Debug information

Bounding-box data comes from the existing mesh cache. Debug text updates only after mesh or camera changes. No random per-frame full-vertex scan remains.

## 10. Monitoring batching design

The renderer must preserve current visual calculations exactly.

### 10.1 Spheres

- Keep the current 16×16 `SphereGeometry` dimensions.
- Create one `InstancedMesh` for each monitoring category color.
- Instance transforms preserve the current origin and sphere radius.
- Keep `castShadow=true`.

### 10.2 Arrow shafts

- Combine shafts into `LineSegments` buffers.
- Use per-vertex colors matching current horizontal category and vertical settling/heaving colors.
- Endpoints use the existing direction, scale, and `MIN_ARROW_LEN` calculations.

### 10.3 Arrow heads

- Use instanced cone geometry matching Three.js r160 `ArrowHelper` cone geometry and orientation.
- Group instances by material color.
- Preserve current head length and width formulas.

### 10.4 Labels

CSS2D labels remain individual DOM elements because they are disabled by default and require text. They are created only when labels are enabled and are removed explicitly when rebuilt.

The target is a low-tens draw-call count while preserving all visible transforms and colors.

## 11. Resource ownership

`scene-controller.js` owns and disposes all Three.js resources.

- Shared geometry/material is disposed once by its owner, never once per instance.
- Replaced BufferGeometry and materials are disposed immediately after scene removal.
- The invisible production `Box3Helper` is removed; bounding boxes come from numeric mesh data.
- Grid and elevation line buffers are batched where their appearance remains identical.
- CSS2D DOM nodes are removed when their layer is rebuilt.
- Worker instances are terminated after completion or cancellation.
- Cache/database handles are closed when no longer needed.

## 12. Failure handling

Failures degrade in this order:

1. Parsed cache invalid → delete it and use source asset.
2. Gzip fetch/decompression invalid → use canonical raw DXF.
3. Worker unavailable/fails → use synchronous compatibility path with a warning.
4. Auto-load unavailable → retain manual upload mode.

Errors shown to the user use `textContent`, not interpolated `innerHTML`. Developer diagnostics retain stage, request ID, and original error in the console.

Partial state is never presented as successfully loaded. A failed replacement keeps the previous valid scene when possible.

## 13. Testing strategy

### 13.1 Geometry contract tests

For the canonical DXF, verify:

- 41,833 parsed entities;
- 41,832 3DFACE entities;
- 21,002 unique vertices;
- 41,832 triangles;
- exact SHA-256 of serialized Float64 coordinate arrays and Uint32 index arrays;
- exact bounding box values;
- no non-finite coordinate;
- every index is in range.

Run the same contract for synchronous extraction and worker extraction.

### 13.2 Asset tests

- Gzip generation is deterministic for identical canonical bytes.
- Decompressed gzip equals the canonical DXF byte-for-byte.
- Manifest hash and sizes match files.
- Missing/corrupt gzip selects raw fallback.

### 13.3 Monitoring tests

- CSV aliases and current 188-row input parse as before.
- Category counts remain 56 safe, 107 warning, and 25 danger rows.
- Horizontal/vertical vector components and azimuth remain identical.
- Batched sphere/shaft/head transforms equal legacy transforms within a strict floating-point tolerance.
- Four zero-horizontal rows retain the current north placeholder direction.

### 13.4 Scene/update tests

- Opacity changes do not rebuild geometry.
- Visibility changes do not rebuild geometry.
- Monitoring scale does not rebuild topography.
- Grid changes do not rebuild topography or monitoring.
- Z exaggeration updates all required layers and preserves camera remapping.
- Replaced resources are disposed exactly once.
- Stable scenes do not schedule frames.
- Damping and control changes schedule frames until stable.
- Hidden documents do not render.

### 13.5 Visual regression

Use a pinned Playwright Chromium version and software rendering in CI. Capture fixed-size screenshots for:

- isometric default;
- plan;
- front;
- side;
- solid-color mode;
- wireframe mode;
- labels enabled.

Create legacy baselines from the pre-refactor viewer. The initial acceptance target is pixel-identical where deterministic; a small threshold is allowed only for platform rasterization differences and must not mask geometry, camera, color, or object-placement changes.

### 13.6 Performance assertions

Automated tests record rather than overfit wall-clock timings. Structural budgets are binding:

- canonical first-load transfer path uses gzip when supported;
- stable scene schedules zero additional frames;
- default draw calls are below 25;
- no full topography rebuild for material-only or overlay-only controls;
- worker messages transfer, rather than clone, DXF and mesh buffers;
- cache hit skips source DXF download and parse.

Manual performance profiling is performed on desktop and a representative iPad/mobile browser before merge.

## 14. Continuous integration and deployment

Add a verification workflow that runs:

1. dependency installation with a lockfile;
2. deterministic asset verification;
3. Node unit/contract tests;
4. Playwright visual tests;
5. static-file/path validation.

GitHub Pages continues to deploy the repository as static content. No production Node server, generated JavaScript bundle, or runtime environment variable is introduced.

Generated assets are committed so Pages can serve them directly. CI fails if the canonical DXF changes without regenerated gzip/manifest artifacts and updated approved geometry baselines.

## 15. Implementation phases

### Phase 0 — Guardrails

- Add Node/Playwright test harness.
- Capture legacy geometry hashes and screenshots.
- Add deterministic asset builder and verification.

### Phase 1 — Transport and worker

- Add gzip/manifest loader with raw fallback.
- Add worker parsing with typed arrays and synchronous fallback.
- Add parsed cache with graceful failure.

### Phase 2 — Render scheduling and targeted updates

- Add invalidation scheduler.
- Make shadow updates event-driven.
- Split scene operations by responsibility.
- Remove random mesh scans and hidden box helper.

### Phase 3 — Monitoring batching

- Add pure transform calculations.
- Replace legacy per-point meshes/arrows with batched equivalents.
- Preserve labels and visual state.

### Phase 4 — Optional memory fast path

- Add streaming 3DFACE parser behind geometry-hash equivalence tests.
- Keep the general parser fallback.

Phase 4 ships only if it is demonstrably identical and materially lowers peak memory; otherwise it remains deferred without blocking Phases 0–3.

## 16. Acceptance criteria

The change is complete when:

1. All binding constraints remain true.
2. Canonical geometry hashes, counts, and bounding box match the legacy viewer.
3. Approved visual-regression views pass.
4. Gzip round-trip is byte-identical and is used on supported browsers.
5. Raw DXF fallback and manual upload both work.
6. UI remains responsive while parsing in a worker.
7. Stable scene rendering stops when no update is required.
8. Default draw calls are below 25.
9. Material-only and overlay-only controls do not rebuild topography.
10. Parsed cache hits skip DXF download and parsing.
11. No resource-lifecycle errors or detached-buffer state leaks occur during repeated load/reprocess cycles.
12. CI passes from a clean checkout.
13. GitHub Pages deployment succeeds on the feature branch/PR validation path.

## 17. Rollback strategy

Each phase is committed independently. If a regression occurs:

- gzip loading can be disabled while raw DXF remains available;
- worker loading can fall back to the synchronous pipeline;
- cache can be bypassed by increasing `algorithmVersion` or disabling cache initialization;
- demand rendering can temporarily return to the legacy loop without reverting geometry work;
- batched monitoring can be switched back to the legacy builder behind one implementation flag during validation.

No rollback requires modifying the canonical DXF.

## 18. Review focus

Reviewers must explicitly verify:

- byte and hash equivalence across raw/gzip/worker/cache paths;
- transfer-list correctness and detached-buffer recovery;
- cache invalidation when either DXF or algorithm changes;
- fallback behavior on Safari/iOS-compatible modern browsers;
- no missed invalidation event that leaves a stale frame;
- identical ArrowHelper-compatible cone transforms;
- correct resource disposal after repeated controls, loads, and reprocesses;
- visual comparisons at all four camera presets;
- no accidental Three.js version or default-render-state changes.
