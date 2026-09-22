import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { parse3dFaceStream } from '../src/dxf-3dface-stream.js';
import { parseDxfGeometry } from '../src/dxf-core.js';

const MINIMUM_HEAP_IMPROVEMENT_RATIO = 0.3;
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

function geometryDigest(mesh) {
  const hash = createHash('sha256');
  for (const [array, byteWidth] of [
    [mesh.x, 8],
    [mesh.y, 8],
    [mesh.z, 8],
    [mesh.i, 4],
    [mesh.j, 4],
    [mesh.k, 4],
  ]) {
    const buffer = Buffer.allocUnsafe(array.length * byteWidth);
    const view = new DataView(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength,
    );
    for (let index = 0; index < array.length; index += 1) {
      if (byteWidth === 8) {
        view.setFloat64(index * byteWidth, Number(array[index]), true);
      } else {
        view.setUint32(index * byteWidth, Number(array[index]), true);
      }
    }
    hash.update(buffer);
  }
  return hash.digest('hex');
}

async function loadDxfParser() {
  const source = await readFile(
    new URL('../lib/dxf-parser.js', import.meta.url),
    'utf8',
  );
  const context = vm.createContext({ console, globalThis: null });
  context.globalThis = context;
  context.self = context;
  new vm.Script(source, { filename: 'lib/dxf-parser.js' }).runInContext(context);
  return context.DxfParser;
}

async function runChild(mode, dxfPath) {
  if (typeof global.gc !== 'function') {
    throw new Error('benchmark child requires --expose-gc');
  }
  const text = await readFile(dxfPath, 'utf8');
  const DxfParser = mode === 'general' ? await loadDxfParser() : null;

  global.gc();
  const before = process.memoryUsage();
  const startedAt = performance.now();
  const parsed = mode === 'general'
    ? parseDxfGeometry(text, {
        DxfParser,
        useStreaming3dFace: false,
      })
    : parse3dFaceStream(text);
  const parseMilliseconds = performance.now() - startedAt;
  const after = process.memoryUsage();

  if (mode === 'streaming' && !parsed.supported) {
    throw new Error(`streaming parser declined input: ${parsed.reason}`);
  }
  if (parsed.kind !== 'mesh') {
    throw new Error(`benchmark requires mesh geometry, received ${parsed.kind}`);
  }

  const maxRssBytes = process.resourceUsage().maxRSS * 1024;
  return {
    parseMilliseconds,
    peakHeapBytes: Math.max(before.heapUsed, after.heapUsed),
    peakRssBytes: Math.max(before.rss, after.rss, maxRssBytes),
    heapDeltaBytes: Math.max(0, after.heapUsed - before.heapUsed),
    rssDeltaBytes: Math.max(0, after.rss - before.rss),
    vertexCount: parsed.mesh.x.length,
    triangleCount: parsed.mesh.i.length,
    digest: geometryDigest(parsed.mesh),
  };
}

function runIsolated(mode, dxfPath) {
  const child = spawnSync(
    process.execPath,
    ['--expose-gc', scriptPath, '--child', mode, dxfPath],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    },
  );
  if (child.status !== 0) {
    throw new Error(
      `${mode} benchmark failed (${child.status}): ${child.stderr || child.stdout}`,
    );
  }
  return JSON.parse(child.stdout);
}

async function main() {
  const [command, mode, childPath] = process.argv.slice(2);
  if (command === '--child') {
    if ((mode !== 'general' && mode !== 'streaming') || !childPath) {
      throw new Error('invalid benchmark child arguments');
    }
    process.stdout.write(`${JSON.stringify(await runChild(mode, childPath))}\n`);
    return;
  }

  const inputPath = command
    ? resolve(process.cwd(), command)
    : fileURLToPath(new URL('../data/topografi.dxf', import.meta.url));
  const general = runIsolated('general', inputPath);
  const streaming = runIsolated('streaming', inputPath);
  const equivalent = general.digest === streaming.digest
    && general.vertexCount === streaming.vertexCount
    && general.triangleCount === streaming.triangleCount;
  const heapImprovementRatio = general.heapDeltaBytes > 0
    ? (general.heapDeltaBytes - streaming.heapDeltaBytes)
      / general.heapDeltaBytes
    : 0;
  const report = {
    schemaVersion: 1,
    file: relative(repositoryRoot, inputPath),
    equivalent,
    activationGate: {
      minimumHeapImprovementRatio: MINIMUM_HEAP_IMPROVEMENT_RATIO,
      heapImprovementRatio,
      qualifies: equivalent
        && heapImprovementRatio >= MINIMUM_HEAP_IMPROVEMENT_RATIO,
    },
    general,
    streaming,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!equivalent) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
