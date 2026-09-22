import { createHash } from 'node:crypto';
import {
  cp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { ALGORITHM_VERSION, DEFAULT_STATE } from '../src/config.js';
import {
  buildMeshFromGeometry,
  parseDxfGeometry,
  validateMesh,
} from '../src/dxf-core.js';
import { loadLegacyDependencies } from '../tests/helpers/legacy-reference.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), '..');

function isDescendant(parentPath, candidatePath) {
  const pathFromParent = relative(parentPath, candidatePath);
  return pathFromParent !== ''
    && pathFromParent !== '..'
    && !pathFromParent.startsWith(`..${sep}`)
    && !isAbsolute(pathFromParent);
}

function assertSafeOutputPath(root, outDir) {
  const rootPath = resolve(root);
  if (rootPath !== REPOSITORY_ROOT) {
    throw new Error(`unsafe root: ${rootPath}`);
  }
  const outputPath = resolve(outDir);
  const sitePath = resolve(rootPath, '_site');
  const testOutputPath = resolve(rootPath, '.test-output');
  if (
    outputPath !== sitePath
    && !isDescendant(testOutputPath, outputPath)
  ) {
    throw new Error(`unsafe outDir: ${outputPath}`);
  }
  return { rootPath, outputPath };
}

async function stageRuntimeFiles(root, outDir) {
  const { rootPath, outputPath } = assertSafeOutputPath(root, outDir);
  await rm(outputPath, { recursive: true, force: true });
  await mkdir(join(outputPath, 'data'), { recursive: true });
  await Promise.all([
    cp(join(rootPath, 'index.html'), join(outputPath, 'index.html')),
    cp(join(rootPath, 'src'), join(outputPath, 'src'), { recursive: true }),
    cp(join(rootPath, 'lib'), join(outputPath, 'lib'), { recursive: true }),
    cp(
      join(rootPath, 'data/monitoring.csv'),
      join(outputPath, 'data/monitoring.csv'),
    ),
  ]);
}

async function validateProductionDxf(raw) {
  const dependencies = await loadLegacyDependencies();
  const text = new TextDecoder().decode(raw);
  const geometry = parseDxfGeometry(text, dependencies);
  const mesh = buildMeshFromGeometry(
    geometry,
    DEFAULT_STATE,
    dependencies,
  );
  if (!validateMesh(mesh)) {
    throw new Error('DXF did not produce a valid mesh');
  }
  return {
    vertexCount: mesh.x.length,
    validTriangles: mesh.i.length,
  };
}

export async function buildSite({
  root,
  outDir,
  dxfPath = join(root, 'data/topografi.dxf'),
}) {
  const { outputPath } = assertSafeOutputPath(root, outDir);
  const raw = await readFile(dxfPath);
  const geometryStats = await validateProductionDxf(raw);
  const gzip = gzipSync(raw, { level: 9, mtime: 0 });
  const sha256 = createHash('sha256').update(raw).digest('hex');
  const manifest = {
    schemaVersion: 1,
    algorithmVersion: ALGORITHM_VERSION,
    dxf: {
      path: 'data/topografi.dxf',
      gzipPath: 'data/topografi.dxf.gz',
      sha256,
      bytes: raw.length,
      gzipBytes: gzip.length,
    },
  };

  await stageRuntimeFiles(root, outputPath);
  await writeFile(join(outputPath, 'data/topografi.dxf'), raw);
  await writeFile(join(outputPath, 'data/topografi.dxf.gz'), gzip);
  await writeFile(
    join(outputPath, 'data/assets-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return { manifest, geometryStats };
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  const configuredDxfPath = process.env.SLOPE_VIEWER_DXF_PATH;
  const result = await buildSite({
    root: REPOSITORY_ROOT,
    outDir: join(REPOSITORY_ROOT, '_site'),
    dxfPath: configuredDxfPath
      ? resolve(REPOSITORY_ROOT, configuredDxfPath)
      : join(REPOSITORY_ROOT, 'data/topografi.dxf'),
  });
  console.log(
    `Built _site: ${result.geometryStats.vertexCount.toLocaleString()} vertices, ${result.geometryStats.validTriangles.toLocaleString()} triangles, ${result.manifest.dxf.gzipBytes.toLocaleString()} gzip bytes`,
  );
}
