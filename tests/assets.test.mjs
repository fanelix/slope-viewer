import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSite } from '../scripts/build-site.mjs';

const gunzipAsync = promisify(gunzip);
const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const testOutputRoot = join(repositoryRoot, '.test-output');
const fixtureDxfPath = join(
  repositoryRoot,
  'tests/fixtures/terrain-sample.dxf',
);

async function temporaryDirectory(t) {
  await mkdir(testOutputRoot, { recursive: true });
  const directory = await mkdtemp(join(testOutputRoot, 'assets-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

test('site build creates byte-identical gzip and hash manifest', async (t) => {
  const firstDir = await temporaryDirectory(t);
  const secondDir = await temporaryDirectory(t);
  const first = await buildSite({ root: repositoryRoot, outDir: firstDir });
  const second = await buildSite({ root: repositoryRoot, outDir: secondDir });
  const raw = await readFile(join(firstDir, 'data/topografi.dxf'));
  const firstGzip = await readFile(join(firstDir, 'data/topografi.dxf.gz'));
  const secondGzip = await readFile(join(secondDir, 'data/topografi.dxf.gz'));

  assert.deepEqual(await gunzipAsync(firstGzip), raw);
  assert.deepEqual(firstGzip, secondGzip);
  assert.deepEqual(first.manifest, second.manifest);
  assert.equal(first.manifest.dxf.sha256, sha256(raw));
  assert.equal(first.manifest.dxf.bytes, raw.length);
  assert.equal(first.manifest.dxf.gzipBytes, firstGzip.length);
  assert.equal(first.manifest.algorithmVersion, 'dxf-v1');
  assert.deepEqual(
    JSON.parse(await readFile(
      join(firstDir, 'data/assets-manifest.json'),
      'utf8',
    )),
    first.manifest,
  );
});

test('valid weekly fixture builds without historical count assumptions', async (t) => {
  const outDir = await temporaryDirectory(t);
  const result = await buildSite({
    root: repositoryRoot,
    outDir,
    dxfPath: fixtureDxfPath,
  });
  const fixture = await readFile(fixtureDxfPath);

  assert.equal(result.geometryStats.vertexCount, 8);
  assert.equal(result.geometryStats.validTriangles, 6);
  assert.equal(result.manifest.dxf.sha256, sha256(fixture));
  assert.deepEqual(
    await readFile(join(outDir, 'data/topografi.dxf')),
    fixture,
  );
});

test('site build stages only runtime files', async (t) => {
  const outDir = await temporaryDirectory(t);
  await buildSite({ root: repositoryRoot, outDir });

  await Promise.all([
    access(join(outDir, 'index.html')),
    access(join(outDir, 'src/config.js')),
    access(join(outDir, 'lib/dxf-parser.js')),
    access(join(outDir, 'data/monitoring.csv')),
  ]);
  await assert.rejects(access(join(outDir, 'tests')));
  await assert.rejects(access(join(outDir, 'node_modules')));
  await assert.rejects(access(join(outDir, '.git')));
});

test('site build refuses unsafe output directories before removal', async () => {
  await assert.rejects(
    buildSite({ root: repositoryRoot, outDir: repositoryRoot }),
    /unsafe outDir/i,
  );
  await assert.rejects(
    buildSite({ root: repositoryRoot, outDir: dirname(repositoryRoot) }),
    /unsafe outDir/i,
  );
});

test('site build refuses a different repository root before removal', async (t) => {
  const fakeRoot = await temporaryDirectory(t);
  const fakeOutput = join(fakeRoot, '_site');
  const sentinel = join(fakeOutput, 'keep.txt');
  await mkdir(fakeOutput);
  await writeFile(sentinel, 'must remain');

  await assert.rejects(
    buildSite({
      root: fakeRoot,
      outDir: fakeOutput,
      dxfPath: fixtureDxfPath,
    }),
    /unsafe root/i,
  );
  assert.equal(await readFile(sentinel, 'utf8'), 'must remain');
});
