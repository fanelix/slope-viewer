import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { expect, test } from '@playwright/test';

const testsDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testsDirectory, '..');
const fixtureDirectory = resolve(testsDirectory, 'fixtures');
const threeRoot = resolve(repositoryRoot, 'node_modules/three');

async function installLoaderFixtureRoutes(page, counts) {
  const raw = await readFile(resolve(fixtureDirectory, 'terrain-sample.dxf'));
  const gzip = gzipSync(raw, { level: 9, mtime: 0 });
  const sha256 = createHash('sha256').update(raw).digest('hex');
  const manifest = {
    schemaVersion: 1,
    algorithmVersion: 'dxf-v1',
    dxf: {
      path: 'data/topografi.dxf',
      gzipPath: 'data/topografi.dxf.gz',
      sha256,
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

async function installFixtureRoutes(page) {
  await page.route('**/data/topografi.dxf', (route) => route.fulfill({
    path: resolve(fixtureDirectory, 'terrain-sample.dxf'),
    contentType: 'text/plain; charset=utf-8',
  }));
  await page.route('**/data/monitoring.csv', (route) => route.fulfill({
    path: resolve(fixtureDirectory, 'monitoring-sample.csv'),
    contentType: 'text/csv; charset=utf-8',
  }));
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

async function openLegacyFixture(page) {
  await installFixtureRoutes(page);
  await page.goto('/');
  await expect(page.locator('#stat-triangles')).toHaveText('6');
  await expect(page.locator('#stat-points')).toHaveText('6');
  await expect(page.locator('#loading')).toHaveClass(/hidden/);
  await page.waitForTimeout(250);
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
