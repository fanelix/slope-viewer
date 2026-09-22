import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { expect, test } from '@playwright/test';
import { productionDxfPath } from './helpers/production-dxf.mjs';

const testsDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testsDirectory, '..');
const fixtureDirectory = resolve(testsDirectory, 'fixtures');
const threeRoot = resolve(repositoryRoot, 'node_modules/three');
const terrainFixture = await readFile(resolve(fixtureDirectory, 'terrain-sample.dxf'));
const terrainFixtureSha256 = createHash('sha256')
  .update(terrainFixture)
  .digest('hex');
const monitoringFixture = await readFile(resolve(
  fixtureDirectory,
  'monitoring-sample.csv',
));
const replacementTerrain = Buffer.from(
  terrainFixture.toString('utf8').replaceAll('1200', '1250'),
);
const replacementMonitoring = Buffer.from(
  monitoringFixture.toString('utf8').trim().split('\n').slice(0, -1).join('\n'),
);
const productionTerrain = await readFile(productionDxfPath);
const productionTerrainSha256 = createHash('sha256')
  .update(productionTerrain)
  .digest('hex');

async function installLoaderFixtureRoutes(page, counts) {
  const raw = await readFile(resolve(fixtureDirectory, 'terrain-sample.dxf'));
  const gzip = gzipSync(raw, { level: 9, mtime: 0 });
  const manifest = {
    schemaVersion: 1,
    algorithmVersion: 'dxf-v1',
    dxf: {
      path: 'data/topografi.dxf',
      gzipPath: 'data/topografi.dxf.gz',
      sha256: terrainFixtureSha256,
      bytes: raw.length,
      gzipBytes: gzip.length,
    },
  };

  await page.route('**/data/assets-manifest.json', (route) => {
    counts.manifest += 1;
    return route.fulfill({
      body: JSON.stringify(manifest),
      contentType: 'application/json',
    });
  });
  await page.route(/\/data\/topografi\.dxf\.gz(?:\?.*)?$/, (route) => {
    counts.gzip += 1;
    return route.fulfill({
      body: gzip,
      contentType: 'application/gzip',
    });
  });
  await page.route(/\/data\/topografi\.dxf(?:\?.*)?$/, (route) => {
    counts.raw += 1;
    return route.fulfill({
      body: raw,
      contentType: 'text/plain; charset=utf-8',
    });
  });
}

async function openLoaderHarness(page) {
  await page.goto('/__loader_harness__.html');
}

async function loadThroughRuntimeModules(page, times = 1) {
  return page.evaluate(async (loadCount) => {
    const [
      { createDataLoader },
      { createDxfClient },
      { DEFAULT_STATE },
    ] = await Promise.all([
      import('/src/data-loader.js'),
      import('/src/dxf-client.js'),
      import('/src/config.js'),
    ]);
    const loader = createDataLoader({
      dxfClient: createDxfClient({
        syncParser: () => {
          throw new Error('Real worker unexpectedly used sync fallback');
        },
      }),
    });
    const results = [];
    for (let index = 0; index < loadCount; index += 1) {
      const loaded = await loader.loadAutoData({ settings: DEFAULT_STATE });
      results.push({
        source: loaded.source,
        vertexCount: loaded.mesh.x.length,
        triangleCount: loaded.mesh.i.length,
      });
    }
    return results;
  }, times);
}

async function installThreeRoutes(page) {
  await page.route('https://unpkg.com/three@0.160.0/**', async (route) => {
    const requestUrl = new URL(route.request().url());
    const marker = '/three@0.160.0/';
    const requestedPath = resolve(threeRoot, requestUrl.pathname.split(marker)[1]);
    const fromRoot = relative(threeRoot, requestedPath);
    if (fromRoot.startsWith(`..${sep}`) || fromRoot === '..') {
      await route.abort('blockedbyclient');
      return;
    }
    await route.fulfill({
      body: await readFile(requestedPath),
      contentType: 'text/javascript; charset=utf-8',
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  });
}

async function installRuntimeFixtureRoutes(page) {
  await page.route('**/data/monitoring.csv', (route) => route.fulfill({
    body: monitoringFixture,
    contentType: 'text/csv; charset=utf-8',
  }));
  await installThreeRoutes(page);
}

async function installFixtureRoutes(page) {
  await page.route('**/data/topografi.dxf', (route) => route.fulfill({
    body: terrainFixture,
    contentType: 'text/plain; charset=utf-8',
  }));
  await installRuntimeFixtureRoutes(page);
}

async function installProductionTerrainRoute(page) {
  await page.route('**/data/topografi.dxf', (route) => route.fulfill({
    body: productionTerrain,
    contentType: 'text/plain; charset=utf-8',
  }));
}

async function openLegacyFixture(page) {
  await installFixtureRoutes(page);
  await page.goto('/');
  await expect(page.locator('#stat-triangles')).toHaveText('6');
  await expect(page.locator('#stat-points')).toHaveText('6');
  await expect(page.locator('#loading')).toHaveClass(/hidden/);
  await page.waitForTimeout(250);
}

async function waitForStableViewer(page) {
  await page.waitForFunction(() => {
    const diagnostics = window.__SLOPE_VIEWER_TEST_API__?.diagnostics();
    return diagnostics
      && diagnostics.pendingFrames === 0
      && (diagnostics.pendingControlUpdates ?? 0) === 0;
  });
}

async function openTestFixture(page) {
  await installFixtureRoutes(page);
  await page.goto('/?test=1');
  await expect(page.locator('#loading')).toHaveClass(/hidden/);
  await expect(page.locator('#stat-triangles')).toHaveText('6');
  await waitForStableViewer(page);
}

async function openUploadSection(page) {
  const section = page.locator('#upload-section');
  if (await section.evaluate((element) => (
    element.classList.contains('section-collapsed')
  ))) {
    await page.locator('#upload-section-toggle').evaluate((element) => {
      element.click();
    });
  }
}

async function uploadManualFiles(page, { dxf, csv }) {
  await openUploadSection(page);
  if (dxf) {
    await page.locator('#dxf-input').setInputFiles({
      name: dxf.name,
      mimeType: 'application/dxf',
      buffer: dxf.buffer,
    });
  }
  if (csv) {
    await page.locator('#csv-input').setInputFiles({
      name: csv.name,
      mimeType: 'text/csv',
      buffer: csv.buffer,
    });
  }
  await page.locator('#load-btn').click();
  await expect(page.locator('#loading')).toHaveClass(/hidden/);
  await waitForStableViewer(page);
}

async function capture(page, filename) {
  await page.waitForTimeout(150);
  await expect(page.locator('#canvas-container')).toHaveScreenshot(filename);
}

test('legacy isometric fixture baseline', async ({ page }) => {
  await openLegacyFixture(page);
  await capture(page, 'legacy-isometric.png');
});

for (const view of ['plan', 'front', 'side']) {
  test(`legacy ${view} fixture baseline`, async ({ page }) => {
    await openLegacyFixture(page);
    await page.locator(`#view-${view}`).click();
    await capture(page, `legacy-${view}.png`);
  });
}

test('legacy solid-color fixture baseline', async ({ page }) => {
  await openLegacyFixture(page);
  await page.locator('#color-by-elev').uncheck();
  await capture(page, 'legacy-solid.png');
});

test('legacy wireframe fixture baseline', async ({ page }) => {
  await openLegacyFixture(page);
  await page.locator('#wireframe').check();
  await capture(page, 'legacy-wireframe.png');
});

test('legacy labels fixture baseline', async ({ page }) => {
  await openLegacyFixture(page);
  await page.locator('#show-labels').check();
  await capture(page, 'legacy-labels.png');
});

test('worker geometry matches the immutable fixture reference', async ({ page }) => {
  await installFixtureRoutes(page);
  await page.goto('/?test=1');
  await expect(page.locator('#loading')).toHaveClass(/hidden/);

  const result = await page.evaluate(async () => {
    const [{ createDxfClient }, { DEFAULT_STATE }] = await Promise.all([
      import('/src/dxf-client.js'),
      import('/src/config.js'),
    ]);
    const source = await fetch('/data/topografi.dxf').then((response) => (
      response.arrayBuffer()
    ));
    const client = createDxfClient({
      syncParser: () => {
        throw new Error('Real worker unexpectedly fell back to synchronous parsing');
      },
    });
    const parsed = await client.parse(source, DEFAULT_STATE);

    const byteLength = (
      parsed.mesh.x.length
      + parsed.mesh.y.length
      + parsed.mesh.z.length
    ) * 8 + (
      parsed.mesh.i.length
      + parsed.mesh.j.length
      + parsed.mesh.k.length
    ) * 4;
    const serialized = new ArrayBuffer(byteLength);
    const view = new DataView(serialized);
    let offset = 0;
    for (const values of [parsed.mesh.x, parsed.mesh.y, parsed.mesh.z]) {
      for (const value of values) {
        view.setFloat64(offset, value, true);
        offset += 8;
      }
    }
    for (const values of [parsed.mesh.i, parsed.mesh.j, parsed.mesh.k]) {
      for (const value of values) {
        view.setUint32(offset, value, true);
        offset += 4;
      }
    }
    const digestBytes = new Uint8Array(
      await crypto.subtle.digest('SHA-256', serialized),
    );
    const digest = [...digestBytes]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
    window.__SLOPE_VIEWER_WORKER_TEST_RESULT__ = {
      vertexCount: parsed.mesh.x.length,
      triangleCount: parsed.mesh.i.length,
      digest,
    };
    return window.__SLOPE_VIEWER_WORKER_TEST_RESULT__;
  });

  expect(result).toEqual({
    vertexCount: 8,
    triangleCount: 6,
    digest: '84dd01dc560fa3df5c02c0ee3e184145578e113ff7778476b0ad9818aefb4e88',
  });
});

test('loader fallback survives missing decompression and IndexedDB', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, 'DecompressionStream', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: {
        open() {
          throw new Error('IndexedDB intentionally unavailable');
        },
      },
    });
  });
  const counts = { manifest: 0, gzip: 0, raw: 0 };
  await installLoaderFixtureRoutes(page, counts);
  await openLoaderHarness(page);

  expect(await loadThroughRuntimeModules(page)).toEqual([{
    source: 'raw',
    vertexCount: 8,
    triangleCount: 6,
  }]);
  expect(counts).toEqual({ manifest: 1, gzip: 0, raw: 1 });
});

test('loader recovers from asynchronous worker startup failure and timeout', async ({ page }) => {
  const counts = { manifest: 0, gzip: 0, raw: 0 };
  await installLoaderFixtureRoutes(page, counts);
  await openLoaderHarness(page);

  const results = await page.evaluate(async () => {
    const [
      { createDataLoader },
      { createDxfClient },
      { DEFAULT_STATE },
    ] = await Promise.all([
      import('/src/data-loader.js'),
      import('/src/dxf-client.js'),
      import('/src/config.js'),
    ]);
    const fixtureResult = () => {
      const mesh = {
        x: new Float64Array([0, 1, 0]),
        y: new Float64Array([0, 0, 1]),
        z: new Float64Array([0, 0, 0]),
        i: new Uint32Array([0]),
        j: new Uint32Array([1]),
        k: new Uint32Array([2]),
        stats: { vertexCount: 3, validTriangles: 1 },
      };
      return { rawGeometry: { kind: 'mesh', mesh }, mesh };
    };
    const load = async (mode) => {
      let syncCalls = 0;
      const workerFactory = () => ({
        onmessage: null,
        onerror: null,
        onmessageerror: null,
        postMessage(message, transfer) {
          structuredClone(message, { transfer });
          if (mode === 'crash') {
            queueMicrotask(() => this.onerror?.({
              error: new Error('module failed to load'),
              message: 'module failed to load',
              preventDefault() {},
            }));
          }
        },
        terminate() {},
      });
      const dxfClient = createDxfClient({
        workerFactory,
        timeoutMs: 5,
        syncParser: () => {
          syncCalls += 1;
          return fixtureResult();
        },
      });
      const loader = createDataLoader({ dxfClient, cache: null });
      const loaded = await loader.loadAutoData({ settings: DEFAULT_STATE });
      return { source: loaded.source, syncCalls };
    };
    return Promise.all([load('crash'), load('timeout')]);
  });

  expect(results).toEqual([
    { source: 'gzip', syncCalls: 1 },
    { source: 'gzip', syncCalls: 1 },
  ]);
  expect(counts).toEqual({ manifest: 2, gzip: 2, raw: 0 });
});

test('cache hit avoids every DXF asset request on second load', async ({ page }) => {
  const counts = { manifest: 0, gzip: 0, raw: 0 };
  await installLoaderFixtureRoutes(page, counts);
  await openLoaderHarness(page);
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('slope-viewer-cache');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Cache deletion blocked'));
  }));

  expect(await loadThroughRuntimeModules(page, 2)).toEqual([
    { source: 'gzip', vertexCount: 8, triangleCount: 6 },
    { source: 'cache', vertexCount: 8, triangleCount: 6 },
  ]);
  expect(counts).toEqual({ manifest: 2, gzip: 1, raw: 0 });
});

test('scene test API is gated and opacity avoids geometry rebuilds', async ({ page }) => {
  await installFixtureRoutes(page);
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/);
  expect(await page.evaluate(() => window.__SLOPE_VIEWER_TEST_API__)).toBeUndefined();

  await page.goto('/?test=1');
  await expect(page.locator('#stat-triangles')).toHaveText('6');
  await page.waitForFunction(() => (
    window.__SLOPE_VIEWER_TEST_API__?.diagnostics().pendingFrames === 0
  ));
  const before = await page.evaluate(() => (
    window.__SLOPE_VIEWER_TEST_API__.diagnostics()
  ));
  expect(before.monitoringDrawObjects).toBeLessThan(25);
  await page.locator('#opacity').evaluate((element) => {
    element.value = '50';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => (
    window.__SLOPE_VIEWER_TEST_API__.diagnostics().pendingFrames === 0
  ));
  const after = await page.evaluate(() => (
    window.__SLOPE_VIEWER_TEST_API__.diagnostics()
  ));

  expect(after.terrainGeometryRebuilds).toBe(before.terrainGeometryRebuilds);
  expect(after.terrainMaterialRebuilds).toBe(before.terrainMaterialRebuilds);
  expect(after.monitoringRebuilds).toBe(before.monitoringRebuilds);
  expect(after.gridRebuilds).toBe(before.gridRebuilds);
  expect(after.renders).toBeGreaterThan(before.renders);
});

test('user flow auto gzip and cache hit expose their runtime sources', async ({ page }) => {
  const counts = { manifest: 0, gzip: 0, raw: 0 };
  await installLoaderFixtureRoutes(page, counts);
  await installRuntimeFixtureRoutes(page);

  await page.goto('/?test=1');
  await expect(page.locator('#stat-triangles')).toHaveText('6');
  await waitForStableViewer(page);
  expect(await page.evaluate(() => (
    window.__SLOPE_VIEWER_TEST_API__.diagnostics()
  ))).toMatchObject({
    loaderSource: 'gzip',
    workerSource: 'worker',
    shortSourceHash: terrainFixtureSha256.slice(0, 12),
  });

  await page.reload();
  await expect(page.locator('#stat-triangles')).toHaveText('6');
  await waitForStableViewer(page);
  expect(await page.evaluate(() => (
    window.__SLOPE_VIEWER_TEST_API__.diagnostics()
  ))).toMatchObject({
    loaderSource: 'cache',
    workerSource: 'cache',
    shortSourceHash: terrainFixtureSha256.slice(0, 12),
  });
  expect(counts).toEqual({ manifest: 2, gzip: 1, raw: 0 });
});

test('user flow auto raw fallback remains fully interactive', async ({ page }) => {
  await openTestFixture(page);

  expect(await page.evaluate(() => (
    window.__SLOPE_VIEWER_TEST_API__.diagnostics()
  ))).toMatchObject({
    loaderSource: 'raw',
    workerSource: 'worker',
  });
  await page.locator('#view-plan').click();
  await waitForStableViewer(page);
  await expect(page.locator('#view-plan')).toHaveClass(/active-view/);
});

test('terrain auto-load failure keeps monitoring but exposes manual recovery', async ({ page }) => {
  await installRuntimeFixtureRoutes(page);
  await page.route('**/data/topografi.dxf', (route) => route.fulfill({
    status: 503,
    body: 'terrain unavailable',
  }));
  await page.goto('/?test=1');
  await expect(page.locator('#loading')).toHaveClass(/hidden/);

  await expect(page.locator('#mode-indicator')).toHaveText('Manual');
  await expect(page.locator('#error-container')).toContainText(/topografi/i);
  await expect(page.locator('#upload-section')).not.toHaveClass(/section-collapsed/);
  expect(await page.evaluate(() => (
    window.__SLOPE_VIEWER_TEST_API__.state()
  ))).toMatchObject({
    dataSource: 'none',
    hasMesh: false,
    hasMonitoring: true,
  });
});

for (const manualCase of [
  {
    name: 'DXF-only',
    files: {
      dxf: { name: 'replacement.dxf', buffer: replacementTerrain },
    },
    expectedPoints: '6',
    digestChanges: true,
  },
  {
    name: 'CSV-only',
    files: {
      csv: { name: 'replacement.csv', buffer: replacementMonitoring },
    },
    expectedPoints: '5',
    digestChanges: false,
  },
  {
    name: 'DXF-and-CSV',
    files: {
      dxf: { name: 'replacement.dxf', buffer: replacementTerrain },
      csv: { name: 'replacement.csv', buffer: replacementMonitoring },
    },
    expectedPoints: '5',
    digestChanges: true,
  },
]) {
  test(`user flow manual ${manualCase.name} replacement is atomic`, async ({ page }) => {
    await openTestFixture(page);
    const beforeDigest = await page.evaluate(() => (
      window.__SLOPE_VIEWER_TEST_API__.geometryDigest()
    ));

    await uploadManualFiles(page, manualCase.files);

    const afterDigest = await page.evaluate(() => (
      window.__SLOPE_VIEWER_TEST_API__.geometryDigest()
    ));
    expect(afterDigest === beforeDigest).toBe(!manualCase.digestChanges);
    await expect(page.locator('#stat-points')).toHaveText(manualCase.expectedPoints);
    await expect(page.locator('#stat-source')).toHaveText('Upload');
    expect(await page.evaluate(() => (
      window.__SLOPE_VIEWER_TEST_API__.state().dataSource
    ))).toBe('manual');
  });
}

test('user flow failed replacement preserves the scene and permits recovery', async ({ page }) => {
  await openTestFixture(page);
  const beforeDigest = await page.evaluate(() => (
    window.__SLOPE_VIEWER_TEST_API__.geometryDigest()
  ));

  await uploadManualFiles(page, {
    dxf: { name: 'invalid.dxf', buffer: Buffer.from('not a valid DXF') },
  });

  await expect(page.locator('#error-container')).toContainText('Error:');
  expect(await page.evaluate(() => (
    window.__SLOPE_VIEWER_TEST_API__.geometryDigest()
  ))).toBe(beforeDigest);
  expect(await page.evaluate(() => (
    window.__SLOPE_VIEWER_TEST_API__.state().dataSource
  ))).toBe('auto');
  await expect(page.locator('#stat-triangles')).toHaveText('6');

  await uploadManualFiles(page, {
    dxf: { name: 'recovered.dxf', buffer: replacementTerrain },
  });
  await expect(page.locator('#error-container')).toBeEmpty();
  expect(await page.evaluate(() => (
    window.__SLOPE_VIEWER_TEST_API__.geometryDigest()
  ))).not.toBe(beforeDigest);
  await expect(page.locator('#stat-source')).toHaveText('Upload');
});

test('user flow manual replacement supersedes a late auto-load response', async ({ page }) => {
  await installRuntimeFixtureRoutes(page);
  await page.route('**/data/topografi.dxf', async (route) => {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 600));
    await route.fulfill({
      body: terrainFixture,
      contentType: 'text/plain; charset=utf-8',
    }).catch(() => {});
  });
  await page.goto('/?test=1');

  await uploadManualFiles(page, {
    dxf: { name: 'replacement.dxf', buffer: replacementTerrain },
    csv: { name: 'replacement.csv', buffer: replacementMonitoring },
  });
  const manualDigest = await page.evaluate(() => (
    window.__SLOPE_VIEWER_TEST_API__.geometryDigest()
  ));
  await page.waitForTimeout(800);
  await waitForStableViewer(page);

  expect(await page.evaluate(() => (
    window.__SLOPE_VIEWER_TEST_API__.geometryDigest()
  ))).toBe(manualDigest);
  expect(await page.evaluate(() => (
    window.__SLOPE_VIEWER_TEST_API__.state().dataSource
  ))).toBe('manual');
  await expect(page.locator('#stat-points')).toHaveText('5');
});

test('user flow presets resize rapid sliders grid labels and visibility', async ({ page }) => {
  await openTestFixture(page);

  for (const view of ['plan', 'front', 'side', 'iso']) {
    await page.locator(`#view-${view}`).click();
    await waitForStableViewer(page);
    await expect(page.locator(`#view-${view}`)).toHaveClass(/active-view/);
    expect(await page.evaluate(() => (
      window.__SLOPE_VIEWER_TEST_API__.state().currentView
    ))).toBe(view);
  }

  await page.setViewportSize({ width: 1200, height: 800 });
  await page.waitForFunction(() => {
    const { camera } = window.__SLOPE_VIEWER_TEST_API__.handles();
    const container = document.getElementById('canvas-container');
    return Math.abs(
      camera.aspect - container.clientWidth / container.clientHeight
    ) < 1e-12;
  });
  await waitForStableViewer(page);
  const resizeState = await page.evaluate(() => {
    const { camera } = window.__SLOPE_VIEWER_TEST_API__.handles();
    const container = document.getElementById('canvas-container');
    return {
      aspect: camera.aspect,
      expectedAspect: container.clientWidth / container.clientHeight,
    };
  });
  expect(resizeState.aspect).toBeCloseTo(resizeState.expectedAspect, 12);

  const beforeRapid = await page.evaluate(() => (
    window.__SLOPE_VIEWER_TEST_API__.diagnostics()
  ));
  await page.locator('#zexag').evaluate((slider) => {
    for (let index = 0; index < 20; index += 1) {
      slider.value = String(1 + index * 0.5);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await page.waitForTimeout(100);
  await waitForStableViewer(page);
  const afterRapid = await page.evaluate(() => (
    window.__SLOPE_VIEWER_TEST_API__.diagnostics()
  ));
  expect(afterRapid.terrainGeometryRebuilds).toBe(
    beforeRapid.terrainGeometryRebuilds + 1,
  );
  expect(await page.evaluate(() => (
    window.__SLOPE_VIEWER_TEST_API__.state().zExag
  ))).toBe(10.5);

  await page.locator('#opacity').evaluate((slider) => {
    for (let value = 90; value >= 50; value -= 2) {
      slider.value = String(value);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await page.waitForTimeout(100);
  await waitForStableViewer(page);
  expect(await page.evaluate(() => (
    window.__SLOPE_VIEWER_TEST_API__.handles().terrain.material.opacity
  ))).toBe(0.5);

  const beforeGrid = await page.evaluate(() => (
    window.__SLOPE_VIEWER_TEST_API__.diagnostics()
  ));
  await page.locator('#show-grid').uncheck();
  await waitForStableViewer(page);
  const afterGrid = await page.evaluate(() => (
    window.__SLOPE_VIEWER_TEST_API__.diagnostics()
  ));
  expect(afterGrid.gridRebuilds).toBe(beforeGrid.gridRebuilds + 1);
  expect(afterGrid.terrainGeometryRebuilds).toBe(
    beforeGrid.terrainGeometryRebuilds,
  );
  expect(afterGrid.monitoringRebuilds).toBe(beforeGrid.monitoringRebuilds);

  const beforeLabels = afterGrid;
  await page.locator('#show-labels').check();
  await waitForStableViewer(page);
  await expect(page.locator('.monitor-label')).toHaveCount(6);
  const afterLabels = await page.evaluate(() => (
    window.__SLOPE_VIEWER_TEST_API__.diagnostics()
  ));
  expect(afterLabels.terrainGeometryRebuilds).toBe(
    beforeLabels.terrainGeometryRebuilds,
  );
  expect(afterLabels.monitoringRebuilds).toBe(
    beforeLabels.monitoringRebuilds + 1,
  );

  const beforeHidden = await page.evaluate(() => {
    window.__TEST_DOCUMENT_HIDDEN__ = true;
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => window.__TEST_DOCUMENT_HIDDEN__,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    const checkbox = document.getElementById('show-grid');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    return window.__SLOPE_VIEWER_TEST_API__.diagnostics();
  });
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (
    window.__SLOPE_VIEWER_TEST_API__.diagnostics().renders
  ))).toBe(beforeHidden.renders);
  expect(await page.evaluate(() => (
    window.__SLOPE_VIEWER_TEST_API__.diagnostics().pendingFrames
  ))).toBe(0);

  await page.evaluate(() => {
    window.__TEST_DOCUMENT_HIDDEN__ = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await waitForStableViewer(page);
  expect(await page.evaluate(() => (
    window.__SLOPE_VIEWER_TEST_API__.diagnostics().renders
  ))).toBeGreaterThan(beforeHidden.renders);
});

test('persisted pagehide suspends and pageshow restores the same viewer', async ({ page }) => {
  await openTestFixture(page);
  const before = await page.evaluate(() => ({
    renders: window.__SLOPE_VIEWER_TEST_API__.diagnostics().renders,
    canvases: document.querySelectorAll('#canvas-container canvas').length,
  }));

  await page.evaluate(() => {
    const hidden = new Event('pagehide');
    Object.defineProperty(hidden, 'persisted', { value: true });
    window.dispatchEvent(hidden);
  });
  expect(await page.evaluate(() => ({
    canvases: document.querySelectorAll('#canvas-container canvas').length,
    hasTerrain: Boolean(window.__SLOPE_VIEWER_TEST_API__.handles().terrain),
    pendingFrames: window.__SLOPE_VIEWER_TEST_API__.diagnostics().pendingFrames,
  }))).toEqual({ canvases: 1, hasTerrain: true, pendingFrames: 0 });

  await page.evaluate(() => {
    const shown = new Event('pageshow');
    Object.defineProperty(shown, 'persisted', { value: true });
    window.dispatchEvent(shown);
  });
  await waitForStableViewer(page);
  expect(await page.evaluate(() => ({
    canvases: document.querySelectorAll('#canvas-container canvas').length,
    hasTerrain: Boolean(window.__SLOPE_VIEWER_TEST_API__.handles().terrain),
    renders: window.__SLOPE_VIEWER_TEST_API__.diagnostics().renders,
  }))).toEqual({
    canvases: before.canvases,
    hasTerrain: true,
    renders: before.renders + 1,
  });
});

test('user flow repeated reprocess keeps one scene and releases old resources', async ({ page }) => {
  await openTestFixture(page);
  const before = await page.evaluate(() => (
    window.__SLOPE_VIEWER_TEST_API__.diagnostics()
  ));

  for (const maxSlope of ['85', '80', '75']) {
    await page.locator('#maxslope').fill(maxSlope);
    await page.locator('#reprocess-btn').click();
    await expect(page.locator('#loading')).toHaveClass(/hidden/);
    await waitForStableViewer(page);
  }

  const after = await page.evaluate(() => (
    window.__SLOPE_VIEWER_TEST_API__.diagnostics()
  ));
  expect(after.terrainGeometryRebuilds).toBe(
    before.terrainGeometryRebuilds + 3,
  );
  expect(after.objectCount).toBe(before.objectCount);
  expect(after.resourceDisposals).toBeGreaterThan(before.resourceDisposals);
  expect(after).toMatchObject({
    workerSource: 'worker',
    lastWorkerOperation: 'reprocess',
  });
  await expect(page.locator('#stat-triangles')).toHaveText('6');
});

test('performance budget stable viewer stops frames and stays below 25 draws', async ({ page }) => {
  await openTestFixture(page);
  const stable = await page.evaluate(() => (
    window.__SLOPE_VIEWER_TEST_API__.diagnostics()
  ));

  expect(stable.pendingFrames).toBe(0);
  expect(stable.drawCalls).toBeLessThan(25);
  expect(stable.monitoringDrawObjects).toBeLessThan(25);
  expect(stable.shadowAutoUpdate).toBe(false);
  await page.waitForTimeout(300);
  const later = await page.evaluate(() => (
    window.__SLOPE_VIEWER_TEST_API__.diagnostics()
  ));
  expect(later.pendingFrames).toBe(0);
  expect(later.renders).toBe(stable.renders);
});

test('current production data loads without historical count assumptions', async ({ page }) => {
  await installThreeRoutes(page);
  await installProductionTerrainRoute(page);
  await page.goto('/?test=1');
  await expect(page.locator('#loading')).toHaveClass(/hidden/);
  await page.waitForFunction(() => (
    window.__SLOPE_VIEWER_TEST_API__?.state().hasMesh === true
  ));
  await expect(page.locator('#stat-triangles')).toHaveText(/^[1-9][\d,]*$/);
  await waitForStableViewer(page);

  const stable = await page.evaluate(() => (
    window.__SLOPE_VIEWER_TEST_API__.diagnostics()
  ));
  expect(stable).toMatchObject({
    pendingFrames: 0,
    monitoringDrawObjects: 9,
    shadowAutoUpdate: false,
    workerSource: 'worker',
    sourceHash: productionTerrainSha256,
  });
  expect(stable.drawCalls).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  const later = await page.evaluate(() => (
    window.__SLOPE_VIEWER_TEST_API__.diagnostics()
  ));
  expect(later.pendingFrames).toBe(0);
  expect(later.renders).toBe(stable.renders);
});
