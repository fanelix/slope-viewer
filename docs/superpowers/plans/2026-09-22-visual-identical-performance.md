# Visual-Identical Performance Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce first-load transfer, main-thread blocking, idle GPU/CPU work, draw calls, and unnecessary scene rebuilds while keeping the rendered DXF and monitoring overlay visually identical and allowing browser-only weekly topography replacement.

**Architecture:** Keep the application as a static GitHub Pages site using browser-native ES modules. Introduce deterministic build-time gzip/manifest generation, a transferable-buffer DXF worker, hash-keyed IndexedDB cache, invalidation-driven rendering, targeted scene updates, and instanced/batched monitoring objects; compare every optimized path with the legacy reference implementation and immutable visual fixtures.

**Tech Stack:** HTML/CSS, JavaScript ES modules, Three.js `0.160.0`, Papa Parse `5.5.3`, existing `dxf-parser.js`, existing Delaunator, Node.js 22 built-in test runner, Playwright `1.63.0`, GitHub Actions, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-09-22-visual-identical-performance-design.md`

## Global Constraints

- `data/topografi.dxf` remains the canonical terrain source and may be replaced weekly without editing source code.
- During initial refactor acceptance, the current canonical extraction remains 21,002 vertices, 41,832 triangles, and geometry digest `8fd2580cef69c33fb15a5035a9e2b7308c0617ea5e1b35357636514c11e21a3b`; persistent CI then compares the replaceable canonical file dynamically against the frozen legacy implementation.
- Three.js remains pinned to `0.160.0`; Papa Parse remains `5.5.3`.
- Preserve terrain coordinates/indices, elevation colors, opacity `0.9`, Z exaggeration `6×`, faceted default, `DoubleSide`, antialiasing, pixel-ratio policy, lights, shadows, camera FOV/presets, grid, and mouse/touch mappings.
- Preserve monitoring positions, categories, colors, directions, sphere radii, scaling formulas, minimum arrow length, and zero-horizontal north placeholder behavior.
- Keep raw-DXF, synchronous-parser, no-cache, and manual-upload fallbacks functional.
- Do not decimate the mesh, change geotechnical thresholds, change the UI design, upgrade rendering libraries, or require a production backend/bundler.
- Production remains a static Pages artifact; Node and Playwright are development/CI dependencies only.
- Every task follows RED→GREEN TDD and ends in an independently testable commit.

## Review Focus

1. Corrupt or unavailable gzip/manifest/cache must fall back to the canonical DXF without leaving a blank or partial scene; Task 4 and Task 5 include explicit fallback tests.
2. Weekly DXFs with different valid counts/bounds must deploy without hard-coded baseline failures while reference and optimized geometry still match; Tasks 2, 3, and 12 include dynamic parity and replacement-fixture tests.
3. Safari/iOS paths without `DecompressionStream`, reliable IndexedDB, or module-worker support must remain functional; Task 4 and Task 5 test injected capability failures and synchronous fallback.
4. Rapid control changes, tab hide/show, resize, and OrbitControls damping must never leave a stale frame or resume perpetual rendering; Task 6 includes deterministic scheduler tests.
5. Repeated load/reprocess/toggle cycles must not leak GPU resources, DOM labels, workers, or detached typed arrays; Tasks 7, 8, and 9 include lifecycle tests.

---

## File Map

### Runtime source

- `index.html`: preserve markup/CSS; replace inline application module with `src/app.js` and retain the pinned import map.
- `src/config.js`: immutable defaults, paths, thresholds, aliases, algorithm/cache versions.
- `src/dxf-core.js`: pure DXF extraction/filtering/voxel/triangulation/validation functions.
- `src/monitoring-core.js`: pure CSV parsing and monitoring visual-transform calculations.
- `src/workers/dxf-worker.js`: thin browser worker adapter.
- `src/dxf-client.js`: worker request lifecycle and synchronous compatibility fallback.
- `src/cache.js`: hash-keyed IndexedDB adapter and validation.
- `src/data-loader.js`: manifest/cache/gzip/raw/manual loading orchestration.
- `src/render-scheduler.js`: invalidation-driven RAF scheduling.
- `src/scene-controller.js`: Three.js ownership, terrain/helpers/camera/resource lifecycle, targeted updates.
- `src/monitoring-batch.js`: instanced spheres, batched shafts, and instanced arrow heads.
- `src/app.js`: DOM bindings and integration only.

### Build and tests

- `package.json`, `package-lock.json`: pinned development dependencies and commands.
- `scripts/build-site.mjs`: deterministic Pages staging, gzip, manifest, and static-file copy.
- `scripts/serve-tests.mjs`: local static server for Playwright.
- `tests/helpers/legacy-reference.mjs`: frozen legacy extraction and monitoring math.
- `tests/helpers/geometry-digest.mjs`: explicit little-endian geometry digest helper.
- `tests/fixtures/terrain-sample.dxf`: immutable small 3DFACE fixture.
- `tests/fixtures/monitoring-sample.csv`: immutable monitoring fixture.
- `tests/*.test.mjs`: Node contract/unit tests.
- `tests/ui.spec.mjs`: browser, visual, fallback, and integration tests.
- `tests/baselines/`: approved screenshots generated from the legacy app and immutable fixtures.
- `playwright.config.mjs`: pinned visual-test settings.
- `.github/workflows/verify-and-deploy.yml`: validation and Pages deployment.

---

### Task 1: Establish Legacy Contracts and Test Harness

**Files:**
- Create: `package.json`
- Create: `playwright.config.mjs`
- Create: `scripts/serve-tests.mjs`
- Create: `tests/helpers/legacy-reference.mjs`
- Create: `tests/helpers/geometry-digest.mjs`
- Create: `tests/fixtures/terrain-sample.dxf`
- Create: `tests/fixtures/monitoring-sample.csv`
- Create: `tests/legacy-geometry.test.mjs`
- Create: `tests/legacy-monitoring.test.mjs`
- Create: `tests/ui.spec.mjs`
- Create: `tests/baselines/*`

**Interfaces:**
- Consumes: existing `index.html`, `data/topografi.dxf`, `data/monitoring.csv`, and UMD libraries.
- Produces: `legacyExtractDxf(text, deps)`, `legacyParseMonitoring(text, Papa)`, `geometryDigest(mesh)`, fixed fixture files, and reusable test commands.

- [ ] **Step 1: Add a failing geometry-contract test**

```js
// tests/legacy-geometry.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { legacyExtractDxf, loadLegacyDependencies } from './helpers/legacy-reference.mjs';
import { geometryDigest } from './helpers/geometry-digest.mjs';

test('canonical DXF establishes the immutable refactor baseline', async () => {
  const text = await readFile(new URL('../data/topografi.dxf', import.meta.url), 'utf8');
  const deps = await loadLegacyDependencies();
  const geometry = legacyExtractDxf(text, deps);
  assert.equal(geometry.mesh.x.length, 21002);
  assert.equal(geometry.mesh.i.length, 41832);
  assert.equal(await geometryDigest(geometry.mesh), '8fd2580cef69c33fb15a5035a9e2b7308c0617ea5e1b35357636514c11e21a3b');
  assert.deepEqual(geometry.bbox, {
    minX: 174463.74700927734,
    maxX: 177063.76000976562,
    minY: 9046593.924377441,
    maxY: 9048189.697998047,
    minZ: 8.487126350402832,
    maxZ: 374.9599914550781,
  });
});
```

- [ ] **Step 2: Run the geometry test and observe the missing-helper failure**

Run: `node --test tests/legacy-geometry.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `tests/helpers/legacy-reference.mjs`.

- [ ] **Step 3: Add the pinned development manifest and install dependencies**

```json
{
  "name": "slope-viewer",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build:site": "node scripts/build-site.mjs",
    "serve:test": "node scripts/serve-tests.mjs",
    "test:unit": "node --test tests/*.test.mjs",
    "test:visual": "playwright test",
    "test": "npm run test:unit && npm run test:visual"
  },
  "devDependencies": {
    "@playwright/test": "1.63.0",
    "three": "0.160.0"
  }
}
```

Run: `npm install`
Expected: `package-lock.json` created with no install error.

- [ ] **Step 4: Implement the legacy reference and digest helpers**

`tests/helpers/legacy-reference.mjs` must copy the current 3DFACE extraction and monitoring formulas exactly, including 0.001-unit vertex keys, degenerate checks, quad splitting, thresholds, azimuth, and minimum arrow rules. Load UMD dependencies using an isolated `vm` context so tests do not depend on production modules.

```js
export async function loadLegacyDependencies() {
  const [{ readFile }, vm] = await Promise.all([
    import('node:fs/promises'),
    import('node:vm'),
  ]);
  const context = vm.createContext({ console, globalThis: null });
  context.globalThis = context;
  context.self = context;
  for (const path of ['../../lib/dxf-parser.js', '../../lib/delaunator.min.js', '../../lib/papaparse.min.js']) {
    const code = await readFile(new URL(path, import.meta.url), 'utf8');
    new vm.Script(code, { filename: path }).runInContext(context);
  }
  return { DxfParser: context.DxfParser, Delaunator: context.Delaunator, Papa: context.Papa };
}
```

`tests/helpers/geometry-digest.mjs` serializes X/Y/Z as Float64 little-endian and I/J/K as Uint32 little-endian before SHA-256:

```js
import { createHash } from 'node:crypto';

export function geometryDigest(mesh) {
  const hash = createHash('sha256');
  for (const [array, bytes] of [[mesh.x, 8], [mesh.y, 8], [mesh.z, 8], [mesh.i, 4], [mesh.j, 4], [mesh.k, 4]]) {
    const buffer = Buffer.allocUnsafe(array.length * bytes);
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    for (let index = 0; index < array.length; index += 1) {
      if (bytes === 8) view.setFloat64(index * bytes, Number(array[index]), true);
      else view.setUint32(index * bytes, Number(array[index]), true);
    }
    hash.update(buffer);
  }
  return hash.digest('hex');
}
```

- [ ] **Step 5: Add monitoring baseline tests**

```js
test('canonical monitoring baseline is frozen for the refactor', async () => {
  const text = await readFile(new URL('../data/monitoring.csv', import.meta.url), 'utf8');
  const { Papa } = await loadLegacyDependencies();
  const points = legacyParseMonitoring(text, Papa);
  assert.equal(points.length, 188);
  assert.deepEqual(countCategories(points), { Aman: 56, Waspada: 107, Bahaya: 25 });
  assert.equal(points.filter(point => point.dE === 0 && point.dN === 0).length, 4);
  assert.equal(points.filter(point => point.dZ !== 0).length, 169);
});
```

Run: `node --test tests/legacy-geometry.test.mjs tests/legacy-monitoring.test.mjs`
Expected: PASS, 2 tests, 0 failures.

- [ ] **Step 6: Add deterministic fixture and legacy screenshots**

Create `terrain-sample.dxf` with six non-degenerate 3DFACE triangles at three elevations and `monitoring-sample.csv` with safe, warning, danger, zero-horizontal, settling, and heaving cases. Configure Playwright at viewport `1440×900`, device scale factor `1`, Chromium software rendering, `snapshotPathTemplate: '{testDir}/baselines/{arg}{ext}'`, exact screenshot comparison (`threshold: 0`, `maxDiffPixels: 0`), and `webServer.command = 'npm run serve:test'`. The local server must serve only paths contained by the repository root, set stable MIME types plus `Cache-Control: no-store`, and exit cleanly on `SIGTERM`. Route interception serves the immutable data fixtures and fulfills every `https://unpkg.com/three@0.160.0/**` request from the pinned `node_modules/three` files so visual tests do not depend on the network.

```js
test('legacy isometric fixture baseline', async ({ page }) => {
  await installFixtureRoutes(page);
  await page.goto('/');
  await expect(page.locator('#stat-triangles')).not.toHaveText('—');
  await expect(page.locator('#canvas-container')).toHaveScreenshot('legacy-isometric.png', { animations: 'disabled' });
});
```

Run: `npx playwright install chromium`
Expected: Chromium installation succeeds.

Run: `npm run test:visual -- --update-snapshots`
Expected: isometric, plan, front, side, solid, wireframe, and labels baselines are written.

Run: `npm test`
Expected: all unit and visual tests pass.

- [ ] **Step 7: Commit the harness and legacy contracts**

```bash
git add package.json package-lock.json playwright.config.mjs scripts tests
git commit -m "test: lock legacy geometry and visual contracts"
```

### Task 2: Extract Pure Geometry and Monitoring Cores

**Files:**
- Create: `src/config.js`
- Create: `src/dxf-core.js`
- Create: `src/monitoring-core.js`
- Create: `tests/dxf-core.test.mjs`
- Create: `tests/monitoring-core.test.mjs`
- Modify: `tests/legacy-geometry.test.mjs`
- Modify: `tests/legacy-monitoring.test.mjs`

**Interfaces:**
- Consumes: Task 1 reference functions and existing parser dependencies.
- Produces: `parseDxfGeometry(text, deps)`, `buildMeshFromGeometry(raw, settings, deps)`, `validateMesh(mesh)`, `parseMonitoringCsv(text, Papa)`, and `buildMonitoringTransforms(points, settings)`.

- [ ] **Step 1: Write failing equivalence tests for the new DXF core**

```js
test('optimized extraction is byte-equivalent to the legacy reference', async () => {
  const text = await readCanonicalDxf();
  const deps = await loadLegacyDependencies();
  const legacy = legacyExtractDxf(text, deps);
  const optimized = parseDxfGeometry(text, deps);
  assert.equal(optimized.kind, legacy.kind);
  assert.equal(await geometryDigest(optimized.mesh), await geometryDigest(legacy.mesh));
  assert.deepEqual(optimized.mesh.stats, legacy.mesh.stats);
});

test('valid replacement DXF may change counts while both extractors agree', async () => {
  const text = await readFixtureDxf();
  const deps = await loadLegacyDependencies();
  assert.equal(
    await geometryDigest(parseDxfGeometry(text, deps).mesh),
    await geometryDigest(legacyExtractDxf(text, deps).mesh),
  );
});
```

Run: `node --test tests/dxf-core.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/dxf-core.js`.

- [ ] **Step 2: Implement immutable configuration**

```js
export const ALGORITHM_VERSION = 'dxf-v1';
export const AUTO_LOAD_PATHS = Object.freeze({
  manifest: 'data/assets-manifest.json',
  dxf: 'data/topografi.dxf',
  gzip: 'data/topografi.dxf.gz',
  csv: 'data/monitoring.csv',
});
export const DEFAULT_STATE = Object.freeze({
  opacity: 0.9, voxelSize: 2, showTopo: true, colorByElev: true,
  scaleH: 100, scaleV: 200, showH: true, showV: true, showLabels: false,
  zExag: 6, maxSlopeDeg: 90, maxEdgeLen: 1e9, edgeMultiplier: 4,
  faceted: true, preserveEdges: true, wireframe: false, showGrid: true,
  gridSpacing: 1000, dxfSolidColor: '#8B8B5E', currentView: 'iso',
});
```

- [ ] **Step 3: Implement typed-array geometry functions with unchanged formulas**

`parseDxfGeometry()` uses injected `DxfParser` and returns the exact legacy union: `{ kind: 'mesh', mesh }` for direct faces or `{ kind: 'points', points }` for line/polyline/point input. Direct meshes use Float64 coordinate arrays and Uint32 index arrays; point collections use a transferable Float64 representation. `buildMeshFromGeometry()`, `filterMesh()`, `voxelDownsample()`, and `triangulate()` preserve the current comparison order and constants. `validateMesh()` rejects non-finite coordinates, mismatched index arrays, and out-of-range indices.

```js
export function validateMesh(mesh) {
  if (!(mesh.x instanceof Float64Array) || !(mesh.i instanceof Uint32Array)) return false;
  if (mesh.x.length !== mesh.y.length || mesh.x.length !== mesh.z.length) return false;
  if (mesh.i.length !== mesh.j.length || mesh.i.length !== mesh.k.length || mesh.i.length === 0) return false;
  for (const values of [mesh.x, mesh.y, mesh.z]) for (const value of values) if (!Number.isFinite(value)) return false;
  for (const values of [mesh.i, mesh.j, mesh.k]) for (const value of values) if (value >= mesh.x.length) return false;
  return true;
}
```

After the new implementation passes the one-time historical baseline, replace the persistent production-DXF assertions in `tests/legacy-geometry.test.mjs` with a weekly-safe contract: the current canonical file must be non-empty and structurally valid, and the frozen legacy reference digest must equal the optimized digest. Likewise, replace production monitoring row/category counts in `tests/legacy-monitoring.test.mjs` with legacy-versus-optimized equality and structural validity, because monitoring data is also operational data. Keep fixed expected output only for the immutable small fixtures and visual baselines. This deliberately removes the old 21,002/41,832/hash/bounds and monitoring-count requirements from future CI while preserving them as initial refactor evidence in the design and final verification report.

- [ ] **Step 4: Write failing monitoring equivalence and transform tests**

```js
test('monitoring parser preserves all legacy values', async () => {
  const text = await readCanonicalMonitoring();
  const { Papa } = await loadLegacyDependencies();
  const legacy = legacyParseMonitoring(text, Papa);
  const optimized = parseMonitoringCsv(text, Papa);
  assert.deepEqual(optimized, legacy);
});

test('zero-horizontal point keeps north placeholder and minimum length', () => {
  const transforms = buildMonitoringTransforms([zeroHorizontalPoint], {
    scaleH: 100, scaleV: 200, sphereRadius: 2, zCenter: 0, zExag: 6,
    showH: true, showV: true,
  });
  assert.deepEqual(transforms.points[0].horizontal.direction, [0, 1, 0]);
  assert.equal(transforms.points[0].horizontal.length, 6);
});
```

Run: `node --test tests/monitoring-core.test.mjs`
Expected: FAIL because `src/monitoring-core.js` does not exist.

- [ ] **Step 5: Implement monitoring parsing and pure transform calculations**

```js
export function buildMonitoringTransforms(points, settings) {
  const minimumArrowLength = settings.sphereRadius * 3;
  const makeArrow = (direction, length, color) => {
    const headLength = Math.min(length * 0.35, settings.sphereRadius * 2.5, length * 0.5);
    return {
      direction, length, color, headLength,
      headWidth: Math.max(headLength * 0.5, settings.sphereRadius * 0.8),
    };
  };
  return { sphereRadius: settings.sphereRadius, points: points.map(point => {
    const horizontalLength = Math.max(point.disp2D * settings.scaleH, minimumArrowLength);
    const horizontalDirection = point.dE === 0 && point.dN === 0
      ? [0, 1, 0]
      : normalize3([point.dE, point.dN, 0]);
    const originZ = exaggerateZ(point.z0, settings.zCenter, settings.zExag);
    return {
      id: point.id,
      category: point.category,
      origin: [point.e0, point.n0, originZ],
      labelZ: originZ + settings.sphereRadius * 2,
      horizontal: settings.showH
        ? makeArrow(horizontalDirection, horizontalLength, point.category.color)
        : null,
      vertical: settings.showV && point.dZ !== 0
        ? makeArrow(
            [0, 0, point.dZ > 0 ? 1 : -1],
            Math.max(Math.abs(point.dZ) * settings.scaleV, minimumArrowLength),
            point.dZ < 0 ? 0x1f5f8b : 0x3498db,
          )
        : null,
    };
  }) };
}
```

Run: `node --test tests/dxf-core.test.mjs tests/monitoring-core.test.mjs`
Expected: PASS with exact geometry digest and monitoring deep equality.

- [ ] **Step 6: Commit the pure cores**

```bash
git add src/config.js src/dxf-core.js src/monitoring-core.js tests/dxf-core.test.mjs tests/monitoring-core.test.mjs tests/legacy-geometry.test.mjs tests/legacy-monitoring.test.mjs
git commit -m "refactor: extract tested geometry and monitoring cores"
```

### Task 3: Deterministic Site Build and Weekly DXF Validation

**Files:**
- Create: `scripts/build-site.mjs`
- Create: `tests/assets.test.mjs`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: canonical DXF, `ALGORITHM_VERSION`, runtime static files, and Task 2 validation.
- Produces: `_site/data/topografi.dxf.gz`, `_site/data/assets-manifest.json`, staged static site, and `buildSite({ root, outDir })`.

- [ ] **Step 1: Write failing deterministic-asset and replacement-DXF tests**

```js
test('site build creates byte-identical gzip and hash manifest', async () => {
  const firstDir = await temporaryDirectory();
  const secondDir = await temporaryDirectory();
  const first = await buildSite({ root: repositoryRoot, outDir: firstDir });
  const second = await buildSite({ root: repositoryRoot, outDir: secondDir });
  const raw = await readFile(join(firstDir, 'data/topografi.dxf'));
  const firstGzip = await readFile(join(firstDir, 'data/topografi.dxf.gz'));
  const secondGzip = await readFile(join(secondDir, 'data/topografi.dxf.gz'));
  assert.deepEqual(await gunzip(firstGzip), raw);
  assert.deepEqual(firstGzip, secondGzip);
  assert.deepEqual(first.manifest, second.manifest);
  assert.equal(first.manifest.dxf.sha256, createHash('sha256').update(raw).digest('hex'));
  assert.equal(first.manifest.algorithmVersion, 'dxf-v1');
});

test('valid weekly fixture builds without historical count assumptions', async () => {
  const outDir = await temporaryDirectory();
  const result = await buildSite({ root: repositoryRoot, outDir, dxfPath: fixtureDxfPath });
  assert.ok(result.geometryStats.vertexCount > 0);
  assert.equal(result.geometryStats.validTriangles, 6);
  assert.equal(result.manifest.dxf.sha256, await sha256File(fixtureDxfPath));
});
```

Run: `node --test tests/assets.test.mjs`
Expected: FAIL with missing `scripts/build-site.mjs`.

- [ ] **Step 2: Implement deterministic staging and manifest generation**

Use `gzipSync(raw, { level: 9, mtime: 0 })`. Before writing any artifact, parse and validate the chosen DXF with the production core; the persistent Task 2 contract separately checks it against the frozen legacy reference. Copy only deployable files (`index.html`, `src`, `lib`, raw DXF, monitoring CSV), never `.git`, tests, docs, or `node_modules`. Stage into a newly created empty output directory so removed runtime files cannot survive from a previous build.

```js
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { join, relative, resolve } from 'node:path';
import { ALGORITHM_VERSION, DEFAULT_STATE } from '../src/config.js';
import { buildMeshFromGeometry, parseDxfGeometry, validateMesh } from '../src/dxf-core.js';
import { loadLegacyDependencies } from '../tests/helpers/legacy-reference.mjs';

async function stageRuntimeFiles(root, outDir) {
  const rootPath = resolve(root);
  const outputPath = resolve(outDir);
  const sitePath = resolve(rootPath, '_site');
  const testOutputPath = resolve(rootPath, '.test-output');
  const relativeTestOutput = relative(testOutputPath, outputPath);
  const isTestOutput = relativeTestOutput && !relativeTestOutput.startsWith('..');
  if (outputPath !== sitePath && !isTestOutput) throw new Error('unsafe outDir');
  await rm(outputPath, { recursive: true, force: true });
  await mkdir(join(outputPath, 'data'), { recursive: true });
  await Promise.all([
    cp(join(rootPath, 'index.html'), join(outputPath, 'index.html')),
    cp(join(rootPath, 'src'), join(outputPath, 'src'), { recursive: true }),
    cp(join(rootPath, 'lib'), join(outputPath, 'lib'), { recursive: true }),
    cp(join(rootPath, 'data/monitoring.csv'), join(outputPath, 'data/monitoring.csv')),
  ]);
}

async function validateProductionDxf(raw) {
  const deps = await loadLegacyDependencies();
  const geometry = parseDxfGeometry(new TextDecoder().decode(raw), deps);
  const mesh = buildMeshFromGeometry(geometry, DEFAULT_STATE, deps);
  if (!validateMesh(mesh)) throw new Error('DXF did not produce a valid mesh');
  return { vertexCount: mesh.x.length, validTriangles: mesh.i.length };
}

export async function buildSite({ root, outDir, dxfPath = join(root, 'data/topografi.dxf') }) {
  const raw = await readFile(dxfPath);
  const geometryStats = await validateProductionDxf(raw);
  const gzip = gzipSync(raw, { level: 9, mtime: 0 });
  const sha256 = createHash('sha256').update(raw).digest('hex');
  const manifest = {
    schemaVersion: 1,
    algorithmVersion: ALGORITHM_VERSION,
    dxf: { path: 'data/topografi.dxf', gzipPath: 'data/topografi.dxf.gz', sha256, bytes: raw.length, gzipBytes: gzip.length },
  };
  await stageRuntimeFiles(root, outDir);
  await writeFile(join(outDir, 'data/topografi.dxf'), raw);
  await writeFile(join(outDir, 'data/topografi.dxf.gz'), gzip);
  await writeFile(join(outDir, 'data/assets-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, geometryStats };
}
```

The CLI entry point resolves `root` to the repository directory and `outDir` to `<root>/_site`; tests pass only fresh child directories under `<root>/.test-output/` and clean them in test teardown. Never accept the repository root, its parent, another repository directory, or a path outside these two explicit output locations as the removable output directory.

- [ ] **Step 3: Add `_site/` and `.test-output/` to `.gitignore` and merge the build commands into the existing scripts**

```json
"scripts": {
  "build:site": "node scripts/build-site.mjs",
  "verify:site": "node --test tests/assets.test.mjs"
}
```

Run: `npm run build:site`
Expected: `_site/` contains the viewer, raw DXF, gzip DXF, manifest, CSV, source modules, and libraries.

Run: `npm run verify:site`
Expected: PASS including byte round-trip and alternate weekly fixture.

- [ ] **Step 4: Commit deterministic weekly build support**

```bash
git add .gitignore package.json scripts/build-site.mjs tests/assets.test.mjs
git commit -m "build: generate validated weekly DXF Pages artifacts"
```

### Task 4: Worker Parsing Client with Synchronous Fallback

**Files:**
- Create: `src/workers/dxf-worker.js`
- Create: `src/dxf-client.js`
- Create: `tests/dxf-client.test.mjs`
- Modify: `tests/ui.spec.mjs`

**Interfaces:**
- Consumes: Task 2 DXF core and UMD parser dependencies.
- Produces: `createDxfClient({ workerFactory, syncParser, onProgress })`, whose `parse(buffer, settings)` and `reprocess(raw, settings)` return validated typed geometry.

- [ ] **Step 1: Write failing worker success, transfer, and fallback tests**

```js
test('client resolves a matching worker response and transfers the source buffer', async () => {
  const worker = new FakeWorker();
  const client = createDxfClient({ workerFactory: () => worker, syncParser: failIfCalled });
  const source = new TextEncoder().encode(fixtureDxfText).buffer;
  const pending = client.parse(source, DEFAULT_STATE);
  assert.equal(source.byteLength, 0);
  worker.respondSuccess(validFixtureGeometry());
  assert.equal((await pending).mesh.i.length, 6);
});

test('worker creation failure uses the synchronous compatibility path', async () => {
  const client = createDxfClient({
    workerFactory: () => { throw new Error('worker unavailable'); },
    syncParser: buffer => validFixtureGeometry(buffer),
  });
  assert.equal((await client.parse(fixtureBuffer(), DEFAULT_STATE)).mesh.i.length, 6);
});
```

Run: `node --test tests/dxf-client.test.mjs`
Expected: FAIL because `src/dxf-client.js` is missing.

- [ ] **Step 2: Implement the thin module worker**

```js
import '../../lib/dxf-parser.js';
import '../../lib/delaunator.min.js';
import { parseDxfGeometry, buildMeshFromGeometry, validateMesh } from '../dxf-core.js';

self.onmessage = async event => {
  const { id, operation, buffer, rawGeometry, settings } = event.data;
  try {
    const raw = operation === 'parse'
      ? parseDxfGeometry(new TextDecoder().decode(buffer), { DxfParser: self.DxfParser })
      : rawGeometry;
    const mesh = buildMeshFromGeometry(raw, settings, { Delaunator: self.Delaunator });
    if (!validateMesh(mesh)) throw new Error('Worker produced invalid mesh');
    self.postMessage({ id, type: 'success', rawGeometry: raw, mesh }, collectTransferables(raw, mesh));
  } catch (error) {
    self.postMessage({ id, type: 'error', stage: operation, message: String(error?.message || error) });
  }
};

function collectTransferables(...values) {
  const buffers = new Set();
  const visit = value => {
    if (ArrayBuffer.isView(value)) buffers.add(value.buffer);
    else if (value instanceof ArrayBuffer) buffers.add(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  values.forEach(visit);
  return [...buffers].filter(buffer => buffer.byteLength > 0);
}
```

- [ ] **Step 3: Implement request IDs, transfer lists, cleanup, and sync fallback**

The client permits one active heavy request, rejects/cleans pending promises on worker failure, and terminates the worker after success/error. Transfer lists are deduplicated because direct raw geometry and the rendered mesh may share coordinate buffers. The fallback receives an intact copy when worker startup is uncertain; if a worker accepts and detaches the only buffer before failing, refetch/manual reread is requested by the data loader instead of reading detached memory. Tests must cover shared-buffer deduplication and prove that returned raw buffers remain available for a later reprocess operation.

Run: `node --test tests/dxf-client.test.mjs`
Expected: PASS for success, mismatched ID ignored, worker error, timeout cleanup, and creation fallback.

- [ ] **Step 4: Add browser worker-versus-reference integration**

Intercept the fixture source, call the real module worker, expose result statistics through a test-only read API, and assert its digest equals the reference digest.

Run: `npm run test:visual -- --grep "worker geometry"`
Expected: PASS in Chromium.

- [ ] **Step 5: Commit worker parsing**

```bash
git add src/workers/dxf-worker.js src/dxf-client.js tests/dxf-client.test.mjs tests/ui.spec.mjs
git commit -m "perf: parse and reprocess DXF in a transferable worker"
```

### Task 5: Manifest Loader and Hash-Keyed Parsed Cache

**Files:**
- Create: `src/cache.js`
- Create: `src/data-loader.js`
- Create: `tests/cache.test.mjs`
- Create: `tests/data-loader.test.mjs`
- Modify: `tests/ui.spec.mjs`

**Interfaces:**
- Consumes: Task 3 manifest contract and Task 4 DXF client.
- Produces: `createIndexedDbBackend({ indexedDB, dbName, storeName })`, `createMeshCache({ backend })`, `createDataLoader(dependencies)`, and `loadAutoData({ settings, signal })`.

- [ ] **Step 1: Write failing cache validation tests**

```js
test('cache key includes source hash and algorithm version', () => {
  assert.equal(createCacheKey('abc123', 'dxf-v1'), 'abc123:dxf-v1');
});

test('malformed cache records are rejected and deleted', async () => {
  const backend = new MemoryCacheBackend({ 'abc:dxf-v1': { mesh: { x: [NaN] } } });
  const cache = createMeshCache({ backend });
  assert.equal(await cache.get('abc:dxf-v1'), null);
  assert.equal(backend.has('abc:dxf-v1'), false);
});
```

Run: `node --test tests/cache.test.mjs`
Expected: FAIL with missing `src/cache.js`.

- [ ] **Step 2: Implement validated cache with non-fatal failures**

`createIndexedDbBackend()` opens database `slope-viewer-cache` version 1 with object store `meshes` and implements `get`, `put`, `delete`, and `deleteExcept` using complete transaction promises. `createMeshCache()` validates the source hash, algorithm version, raw geometry, rendered typed arrays, statistics, and all indices before returning a record. Unsupported IndexedDB, blocked opens, quota errors, aborts, and corrupt records resolve as cache misses rather than load failures.

```js
export function createCacheKey(sourceHash, algorithmVersion) {
  return `${sourceHash}:${algorithmVersion}`;
}

export function createMeshCache({ backend }) {
  return {
    async get(key) {
      try {
        const record = await backend.get(key);
        if (!record || !validateCachedGeometry(record)) {
          if (record) await backend.delete(key);
          return null;
        }
        return record;
      } catch { return null; }
    },
    async put(key, record) {
      try { await backend.put(key, record); await backend.deleteExcept(key); return true; }
      catch { return false; }
    },
  };
}
```

- [ ] **Step 3: Write failing loader-order and fallback tests**

Tests cover cache hit, cache settings mismatch, gzip success, absent `DecompressionStream`, corrupt gzip, manifest 404, stale/hash-mismatched assets, raw 404, abort, and manual buffer path.

```js
test('corrupt gzip falls back to raw DXF', async () => {
  const calls = [];
  const loader = createDataLoader(fallbackFixtureDependencies(calls));
  const result = await loader.loadAutoData({ settings: DEFAULT_STATE });
  assert.equal(result.source, 'raw');
  assert.deepEqual(calls, ['manifest', 'cache:get', 'gzip', 'raw', 'worker:parse', 'cache:put']);
});
```

Run: `node --test tests/data-loader.test.mjs`
Expected: FAIL with missing `src/data-loader.js`.

- [ ] **Step 4: Implement manifest/cache/gzip/raw orchestration**

Fetch the manifest with `{ cache: 'no-store' }`, then append `?v=<short-sha256>` to gzip/raw asset URLs so a new Pages deployment cannot reuse last week's browser/CDN response. Hash canonical bytes with `crypto.subtle.digest('SHA-256', buffer)` before parsing and compare both hash and byte length with the manifest before the buffer is transferred. The gzip path uses `new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()`. Capability or validation failures enter raw fallback; raw failure returns a typed error that triggers manual mode. Cache records contain both validated raw geometry (needed by reprocess) and the current rendered mesh plus a deterministic mesh-settings fingerprint. If the source/algorithm key matches but mesh settings do not, skip download and parse, reprocess cached raw geometry, and replace only the rendered-mesh portion. Manual buffers use the same worker path but are cached only when their computed hash matches the current manifest hash.

Run: `node --test tests/cache.test.mjs tests/data-loader.test.mjs`
Expected: PASS for every ordered path and failure class.

- [ ] **Step 5: Add browser tests for cache hit and capability fallbacks**

Use Playwright init scripts to disable `DecompressionStream`, make IndexedDB throw, and count requested URLs. A second load with valid IndexedDB must not request either DXF asset.

Run: `npm run test:visual -- --grep "loader fallback|cache hit"`
Expected: PASS.

- [ ] **Step 6: Commit loader and cache**

```bash
git add src/cache.js src/data-loader.js tests/cache.test.mjs tests/data-loader.test.mjs tests/ui.spec.mjs
git commit -m "perf: load compressed DXF with validated parsed cache"
```

### Task 6: Invalidation-Driven Render Scheduler

**Files:**
- Create: `src/render-scheduler.js`
- Create: `tests/render-scheduler.test.mjs`

**Interfaces:**
- Consumes: injected RAF/cancel/document visibility/controls/render callbacks.
- Produces: `createRenderScheduler({ requestFrame, cancelFrame, isHidden, updateControls, render })` with `invalidate()`, `setVisible()`, and `dispose()`.

- [ ] **Step 1: Write failing deterministic scheduler tests**

```js
test('stable scene renders once and schedules no idle frames', () => {
  const clock = new FakeAnimationClock();
  const render = mock.fn();
  const scheduler = createRenderScheduler({ ...clock.dependencies(), isHidden: () => false, updateControls: () => false, render });
  scheduler.invalidate('initial');
  clock.flushOne();
  assert.equal(render.mock.callCount(), 1);
  assert.equal(clock.pendingCount(), 0);
});

test('damping continues only while controls report movement', () => {
  const movement = [true, true, false];
  const scheduler = makeScheduler({ updateControls: () => movement.shift() });
  scheduler.invalidate('controls');
  scheduler.clock.flushAll();
  assert.equal(scheduler.render.mock.callCount(), 3);
});
```

Run: `node --test tests/render-scheduler.test.mjs`
Expected: FAIL with missing scheduler module.

- [ ] **Step 2: Implement one-pending-frame invalidation**

```js
export function createRenderScheduler(deps) {
  let frameId = null;
  let disposed = false;
  const tick = () => {
    frameId = null;
    if (disposed || deps.isHidden()) return;
    const moving = deps.updateControls();
    deps.render();
    if (moving) invalidate('damping');
  };
  function invalidate() {
    if (disposed || deps.isHidden() || frameId !== null) return;
    frameId = deps.requestFrame(tick);
  }
  return {
    invalidate,
    setVisible(visible) { if (!visible && frameId !== null) { deps.cancelFrame(frameId); frameId = null; } else if (visible) invalidate('visible'); },
    dispose() { disposed = true; if (frameId !== null) deps.cancelFrame(frameId); frameId = null; },
  };
}
```

- [ ] **Step 3: Cover rapid invalidations, hide/show, and disposal**

Run: `node --test tests/render-scheduler.test.mjs`
Expected: PASS; 100 rapid invalidations create one frame, hidden creates zero, visible creates one, disposed creates zero.

- [ ] **Step 4: Commit scheduler**

```bash
git add src/render-scheduler.js tests/render-scheduler.test.mjs
git commit -m "perf: render only when the scene changes"
```

### Task 7: Scene Controller and Targeted Updates

**Files:**
- Create: `src/scene-controller.js`
- Create: `tests/scene-controller.test.mjs`
- Modify: `index.html`
- Create: `src/app.js`
- Modify: `tests/ui.spec.mjs`

**Interfaces:**
- Consumes: Task 2 cores, Task 5 loader, Task 6 scheduler, Three.js and addons.
- Produces: `SceneController` methods `setMesh`, `setMonitoring`, `setTerrainOpacity`, `setTerrainVisible`, `setSolidColor`, `setWireframe`, `setZExaggeration`, `setMonitoringOptions`, `setGridOptions`, `setPresetView`, `resize`, `render`, `getDiagnostics`, and `dispose`.

- [ ] **Step 1: Write failing targeted-update tests with injected Three.js resource spies**

```js
test('opacity change mutates material without rebuilding geometry', () => {
  const scene = createControllerFixture();
  scene.controller.setMesh(fixtureMesh);
  const geometry = scene.controller.debugHandles().terrain.geometry;
  scene.controller.setTerrainOpacity(0.5);
  assert.equal(scene.controller.debugHandles().terrain.geometry, geometry);
  assert.equal(scene.controller.debugHandles().terrain.material.opacity, 0.5);
});

test('grid change leaves terrain and monitoring identities untouched', () => {
  const scene = createControllerFixture();
  const before = scene.controller.debugHandles();
  scene.controller.setGridOptions({ showGrid: true, gridSpacing: 500 });
  const after = scene.controller.debugHandles();
  assert.equal(after.terrain, before.terrain);
  assert.equal(after.monitoring, before.monitoring);
});
```

Run: `node --test tests/scene-controller.test.mjs`
Expected: FAIL because `SceneController` is missing.

- [ ] **Step 2: Extract Three.js ownership without changing output**

Move renderer, camera, controls, lights, terrain geometry/material, helpers, labels, camera presets, frustum, and resource cleanup from the inline script. Keep numeric constants and operation order unchanged. Remove the invisible `Box3Helper`; use numeric bounding data.

```js
export class SceneController {
  constructor({ THREE, OrbitControls, CSS2DRenderer, CSS2DObject, container, debugElement, scheduler }) { /* exact legacy initialization */ }
  setTerrainOpacity(value) { this.state.opacity = value; this.terrain.material.opacity = value; this.scheduler.invalidate('opacity'); }
  setTerrainVisible(value) { this.state.showTopo = value; this.terrain.visible = value; this.scheduler.invalidate('terrain-visible'); }
  setGridOptions(next) { Object.assign(this.state, next); this.rebuildHelpers(); this.scheduler.invalidate('grid'); }
}
```

- [ ] **Step 3: Create `app.js` integration and retain DOM/CSS**

Change only the script wiring in `index.html`: retain import map, DOM markup, CSS, IDs, labels, defaults, and library versions. `app.js` loads data, binds controls to the smallest controller method, coalesces range inputs through the scheduler, and exposes `window.__SLOPE_VIEWER_TEST_API__` only when `?test=1` is present.

- [ ] **Step 4: Verify targeted resource lifecycle**

Tests exercise 50 opacity changes, 50 grid changes, 20 Z-exaggeration changes, mesh replacement, label toggles, and `dispose()`. Every replaced owned geometry/material is disposed once; shared resources are disposed once by the controller.

Run: `node --test tests/scene-controller.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run legacy visual snapshots before batching**

Run: `npm run test:visual`
Expected: all approved legacy screenshots pass with no updated baseline.

- [ ] **Step 6: Commit scene extraction and targeted updates**

```bash
git add index.html src/app.js src/scene-controller.js tests/scene-controller.test.mjs tests/ui.spec.mjs
git commit -m "refactor: target scene updates without visual changes"
```

### Task 8: Batch Monitoring Spheres and Arrows

**Files:**
- Create: `src/monitoring-batch.js`
- Create: `tests/monitoring-batch.test.mjs`
- Modify: `src/scene-controller.js`
- Modify: `tests/scene-controller.test.mjs`
- Modify: `tests/ui.spec.mjs`

**Interfaces:**
- Consumes: Task 2 pure transforms and Task 7 scene ownership.
- Produces: `createMonitoringBatch({ THREE, CSS2DObject, points, settings })` returning `{ group, drawObjectCount, update, dispose }`.

- [ ] **Step 1: Write failing legacy-transform equivalence tests**

```js
test('batched transforms equal every legacy sphere and ArrowHelper transform', () => {
  const legacy = legacyMonitoringVisuals(canonicalPoints, canonicalSettings);
  const optimized = computeBatchMatrices(canonicalPoints, canonicalSettings);
  assertMatricesClose(optimized.spheres, legacy.spheres, 1e-12);
  assertMatricesClose(optimized.horizontalHeads, legacy.horizontalHeads, 1e-12);
  assertMatricesClose(optimized.verticalHeads, legacy.verticalHeads, 1e-12);
  assert.deepEqual(optimized.shaftPositions, legacy.shaftPositions);
  assert.deepEqual(optimized.colors, legacy.colors);
});
```

Run: `node --test tests/monitoring-batch.test.mjs`
Expected: FAIL with missing batch module.

- [ ] **Step 2: Implement category InstancedMesh spheres**

Use one 16×16 `SphereGeometry` and one material per `Aman`, `Waspada`, and `Bahaya`. Preserve position, radius, color, and cast shadow.

- [ ] **Step 3: Implement batched shafts and ArrowHelper-compatible heads**

Use `LineSegments` with vertex colors for shafts. Use the same r160 ArrowHelper cone primitive (`CylinderGeometry(0, 0.5, 1, 5, 1)`) and transformation order for instanced heads, grouped by color. Preserve `headLen` and `headWidth` formulas exactly.

- [ ] **Step 4: Preserve conditional labels and lifecycle**

Create CSS2D labels only when enabled. `dispose()` removes every label DOM node and disposes each owned shared geometry/material exactly once.

Run: `node --test tests/monitoring-batch.test.mjs tests/scene-controller.test.mjs`
Expected: PASS, exact transform equivalence, default draw-object count below 25, and lifecycle assertions green.

- [ ] **Step 5: Run all visual views without updating snapshots**

Run: `npm run test:visual`
Expected: isometric, plan, front, side, solid, wireframe, and labels comparisons pass.

- [ ] **Step 6: Commit batching**

```bash
git add src/monitoring-batch.js src/scene-controller.js tests/monitoring-batch.test.mjs tests/scene-controller.test.mjs tests/ui.spec.mjs
git commit -m "perf: batch monitoring objects with identical transforms"
```

### Task 9: End-to-End Loading, Controls, and Performance Budgets

**Files:**
- Modify: `src/app.js`
- Modify: `src/data-loader.js`
- Modify: `src/scene-controller.js`
- Modify: `tests/ui.spec.mjs`

**Interfaces:**
- Consumes: all runtime modules from Tasks 2–8.
- Produces: complete auto-load/manual-upload/reprocess/control flows and diagnostics used by CI tests.

- [ ] **Step 1: Write failing integration tests for all user flows**

Tests cover auto gzip, raw fallback, cache hit, manual DXF-only, manual CSV-only, manual both, reprocess, presets, resize, rapid sliders, grid toggle, labels, document visibility, and replacement after a failed load.

```js
test('failed replacement keeps the previous valid scene', async ({ page }) => {
  await openValidFixture(page);
  const before = await page.evaluate(() => window.__SLOPE_VIEWER_TEST_API__.geometryDigest());
  await uploadInvalidDxf(page);
  await expect(page.locator('#error-container')).toContainText('Error');
  assert.equal(await page.evaluate(() => window.__SLOPE_VIEWER_TEST_API__.geometryDigest()), before);
});

test('stable viewer reaches zero pending frames and stays under draw budget', async ({ page }) => {
  await openValidFixture(page);
  const diagnostics = await page.evaluate(() => window.__SLOPE_VIEWER_TEST_API__.diagnostics());
  assert.equal(diagnostics.pendingFrames, 0);
  assert.ok(diagnostics.drawCalls < 25);
});
```

Run: `npm run test:visual -- --grep "user flow|performance budget"`
Expected: FAIL until integration is complete.

- [ ] **Step 2: Complete application orchestration**

Ensure each UI control calls the minimum controller operation defined in the spec. Use `textContent` for errors. Keep previous state until replacement data has fully parsed and validated. Abort superseded requests and ignore late responses by request ID.

- [ ] **Step 3: Add diagnostic counters without production overhead**

When `?test=1` is absent, the test API is undefined. When present, expose geometry digest, object/draw counts, pending frame count, rebuild counters, cache source, worker source, and disposal counters.

- [ ] **Step 4: Run complete clean-site verification**

Run: `npm run build:site`
Expected: clean `_site` build succeeds.

Run: `npm test`
Expected: all unit and Playwright integration/visual tests pass with no snapshot changes.

- [ ] **Step 5: Commit end-to-end integration**

```bash
git add src/app.js src/data-loader.js src/scene-controller.js tests/ui.spec.mjs
git commit -m "feat: integrate resilient lightweight slope viewer"
```

### Task 10: Custom GitHub Pages Validation and Weekly Deployment

**Files:**
- Create: `.github/workflows/verify-and-deploy.yml`
- Modify: `README.md`
- Create: `tests/workflow.test.mjs`

**Interfaces:**
- Consumes: `npm run build:site`, `npm test`, `_site`, and default-branch deployment rules.
- Produces: PR validation and successful-main-only Pages deployment; documented browser-only weekly update process.

- [ ] **Step 1: Write failing workflow-structure tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

function jobBlock(workflow, name) {
  const lines = workflow.split('\n');
  const start = lines.findIndex(line => line === `  ${name}:`);
  assert.notEqual(start, -1, `missing ${name} job`);
  let end = start + 1;
  while (end < lines.length && !/^  [A-Za-z0-9_-]+:\s*$/.test(lines[end])) end += 1;
  return lines.slice(start, end).join('\n');
}

test('workflow validates before deploy and never deploys pull requests', async () => {
  const workflow = await readFile('.github/workflows/verify-and-deploy.yml', 'utf8');
  const verify = jobBlock(workflow, 'verify');
  const deploy = jobBlock(workflow, 'deploy');
  assert.match(verify, /npm test/);
  assert.match(verify, /npm run build:site/);
  assert.match(verify, /upload-pages-artifact@v4/);
  assert.match(deploy, /^    needs:\s*verify\s*$/m);
  assert.match(deploy, /^    if:\s*github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'\s*$/m);
  assert.match(deploy, /^      pages:\s*write\s*$/m);
  assert.match(deploy, /^      id-token:\s*write\s*$/m);
  assert.match(deploy, /deploy-pages@v4/);
});
```

Run: `node --test tests/workflow.test.mjs`
Expected: FAIL because the workflow is absent.

- [ ] **Step 2: Implement verification and deployment workflow**

The `verify` job checks out, sets up Node 22, runs `npm ci`, installs pinned Chromium, runs `npm test`, and runs `npm run build:site`. On `main` pushes only, it configures Pages and uploads `_site` with `actions/upload-pages-artifact@v4`. The `deploy` job needs `verify`, uses the `github-pages` environment, has only `pages: write` and `id-token: write`, and runs only on successful pushes to `main`. Put concurrency on the deploy job (not the verify job) so a newer Pages deployment can supersede an older deployment without cancelling validation.

- [ ] **Step 3: Document the weekly web-only operation**

README instructions must state:

1. Replace only `data/topografi.dxf` through GitHub web.
2. Keep the same filename/path and expected coordinate/entity convention.
3. Browser upload supports files below 25 MiB; stop and use an approved alternate ingestion route if larger.
4. Open the Actions run and confirm verify/deploy success.
5. Failed validation leaves the last successful deployment live.
6. Wait for the new short source hash in the app diagnostics before accepting the weekly update.

- [ ] **Step 4: Verify workflow and documentation tests**

Run: `node --test tests/workflow.test.mjs`
Expected: PASS.

Run: `npm test`
Expected: full suite passes.

- [ ] **Step 5: Commit CI and operator documentation**

```bash
git add .github/workflows/verify-and-deploy.yml README.md tests/workflow.test.mjs
git commit -m "ci: validate and deploy weekly topography updates"
```

### Task 11: Optional Streaming 3DFACE Fast Path with Evidence Gate

**Files:**
- Create: `src/dxf-3dface-stream.js`
- Create: `tests/dxf-3dface-stream.test.mjs`
- Modify: `src/dxf-core.js`
- Modify: `src/workers/dxf-worker.js`
- Create: `scripts/benchmark-dxf.mjs`

**Interfaces:**
- Consumes: Task 1 legacy digest and Task 2 general parser path.
- Produces: `parse3dFaceStream(text)` and benchmark JSON; activation occurs only when equivalence and improvement gates pass.

- [ ] **Step 1: Write failing supported-layout, unsupported-layout, and equivalence tests**

```js
test('streaming parser exactly matches the canonical legacy geometry', async () => {
  const text = await readCanonicalDxf();
  const deps = await loadLegacyDependencies();
  const streamed = parse3dFaceStream(text);
  assert.equal(streamed.supported, true);
  assert.equal(
    await geometryDigest(streamed.mesh),
    await geometryDigest(legacyExtractDxf(text, deps).mesh),
  );
});

test('unsupported non-3DFACE geometry requests general-parser fallback', () => {
  assert.deepEqual(parse3dFaceStream(polylineFixture), { supported: false, reason: 'unsupported-entity' });
});
```

Run: `node --test tests/dxf-3dface-stream.test.mjs`
Expected: FAIL because the streaming parser is absent.

- [ ] **Step 2: Implement a strict ENTITIES/group-code parser**

Parse paired group-code/value lines, recognize `SECTION`/`ENTITIES`/`ENDSEC`, accept 3DFACE coordinate codes 10/20/30 through 13/23/33, and preserve the existing missing-Z and quad rules. Match the legacy branch decision exactly: when at least one 3DFACE exists, parse those faces and ignore other entities (including the canonical file's `INSERT`); when no 3DFACE exists, return unsupported so line/polyline/point geometry uses the general parser. Add a mixed 3DFACE-plus-INSERT fixture to prevent this rule from regressing. Apply the identical 0.001-unit vertex key.

- [ ] **Step 3: Add deterministic memory/time benchmark**

`benchmark-dxf.mjs` runs each path in a fresh Node process with `--expose-gc`, emits parse milliseconds, peak heap/RSS, vertex count, triangle count, and digest. It exits nonzero if digests differ.

Run: `node scripts/benchmark-dxf.mjs`
Expected: both digests equal and the report records time plus peak heap/RSS for both paths. The measured heap delta, rather than an assumed result, controls Step 4.

- [ ] **Step 4: Apply the activation gate**

If exact equivalence passes and peak heap improves by at least 30%, select streaming first with automatic general fallback. If either gate fails, keep the module and benchmark test but leave `USE_STREAMING_3DFACE = false`, record the measured reason in the commit message body, and do not alter production selection.

Run: `node --test tests/dxf-3dface-stream.test.mjs tests/dxf-core.test.mjs`
Expected: PASS for both selected and fallback paths.

- [ ] **Step 5: Run complete regression suite and commit**

Run: `npm test`
Expected: full suite passes with no screenshot changes.

```bash
git add src/dxf-3dface-stream.js src/dxf-core.js src/workers/dxf-worker.js tests/dxf-3dface-stream.test.mjs scripts/benchmark-dxf.mjs
git commit -m "perf: add geometry-verified 3DFACE streaming path"
```

### Task 12: Final Verification, Deployment Dry Run, and Release Notes

**Files:**
- Modify: `README.md`
- Create: `docs/performance-verification.md`
- Create: `tests/documentation.test.mjs`

**Interfaces:**
- Consumes: completed Tasks 1–11.
- Produces: reproducible verification report, final clean branch, and PR-ready evidence.

- [ ] **Step 1: Add a failing documentation-presence test**

```js
test('performance verification records required evidence', async () => {
  const report = await readFile('docs/performance-verification.md', 'utf8');
  for (const heading of ['Geometry equivalence', 'Visual equivalence', 'Network payload', 'Worker responsiveness', 'Idle rendering', 'Draw calls', 'Weekly replacement drill']) {
    assert.match(report, new RegExp(`^## ${heading}$`, 'm'));
  }
});
```

Run: `node --test tests/documentation.test.mjs`
Expected: FAIL because the report is absent.

- [ ] **Step 2: Run and record final measurements**

Run from a clean checkout/worktree:

```bash
npm ci
npm run build:site
npm test
node scripts/benchmark-dxf.mjs
```

Record exact command outputs, canonical/current replacement geometry results, raw/gzip sizes, cache-hit request count, worker/fallback results, stable-frame count, default draw calls, and screenshot summary in `docs/performance-verification.md`.

- [ ] **Step 3: Perform a weekly replacement dry run**

Build once with canonical DXF and once with `tests/fixtures/terrain-sample.dxf` as the injected production source. Confirm different source hashes, valid manifests, no historical count assumption, cache-key change, and successful viewer smoke render. Record results.

- [ ] **Step 4: Verify repository and deployment artifact hygiene**

Run: `git status --short`
Expected: only the verification report and intentional README/test updates are modified before commit; `_site`, `node_modules`, Playwright results, and worktree artifacts are ignored.

Run: `find _site -type l`
Expected: no output; Pages artifact contains no symlinks.

- [ ] **Step 5: Run the full suite one final time**

Run: `npm test`
Expected: all tests pass, zero snapshot changes, zero failures.

- [ ] **Step 6: Commit final evidence**

```bash
git add README.md docs/performance-verification.md tests/documentation.test.mjs
git commit -m "docs: record visual-identical performance verification"
```

---

## Whole-Branch Completion Contract

Before opening the pull request:

1. `git diff --check <merge-base>..HEAD` reports no whitespace errors.
2. `npm ci`, `npm run build:site`, and `npm test` pass from a clean checkout.
3. Current canonical geometry matches the legacy baseline digest during initial refactor verification.
4. Alternate weekly fixture validates without old count/hash assumptions.
5. All approved screenshots pass without baseline updates after the legacy baseline commit.
6. Raw fallback, no-worker fallback, no-cache fallback, and manual upload pass.
7. Stable scene has zero pending frames and default draw calls are below 25.
8. Repeated load/reprocess/toggle tests show balanced create/dispose counters.
9. Pages workflow validates pull requests and deploys only successful `main` pushes.
10. `docs/performance-verification.md` contains exact measured evidence and any streaming-parser gate ruling.
