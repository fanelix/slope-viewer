import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const productionDxfPath = process.env.SLOPE_VIEWER_DXF_PATH
  ? isAbsolute(process.env.SLOPE_VIEWER_DXF_PATH)
    ? process.env.SLOPE_VIEWER_DXF_PATH
    : resolve(repositoryRoot, process.env.SLOPE_VIEWER_DXF_PATH)
  : resolve(repositoryRoot, 'data/topografi.dxf');

export function readProductionDxf(encoding) {
  return readFile(productionDxfPath, encoding);
}
