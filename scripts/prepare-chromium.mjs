import {
  chmod,
  mkdir,
  rename,
  stat,
} from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { createBrotliDecompress } from 'node:zlib';

import tarFs from 'tar-fs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageBin = resolve(
  repositoryRoot,
  'node_modules/@sparticuz/chromium/bin',
);
const browserRoot = resolve(repositoryRoot, '.test-browser/chromium-153');
const executable = resolve(browserRoot, 'chromium');
const fontDirectory = resolve(browserRoot, 'fonts');
const chromiumBytes = 209_022_176;

async function usableExecutable(path) {
  try {
    const metadata = await stat(path);
    return metadata.isFile() && metadata.size === chromiumBytes;
  } catch {
    return false;
  }
}

async function inflateFile(source, destination) {
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  await pipeline(
    createReadStream(source),
    createBrotliDecompress(),
    createWriteStream(temporary, { mode: 0o700 }),
  );
  await chmod(temporary, 0o700);
  await rename(temporary, destination);
}

async function inflateTar(source, destination) {
  await mkdir(destination, { recursive: true });
  await pipeline(
    createReadStream(source),
    createBrotliDecompress(),
    tarFs.extract(destination, { chown: false }),
  );
}

export async function prepareChromium() {
  if (!(await usableExecutable(executable))) {
    await mkdir(browserRoot, { recursive: true });
    await Promise.all([
      inflateFile(resolve(packageBin, 'chromium.br'), executable),
      inflateTar(resolve(packageBin, 'fonts.tar.br'), fontDirectory),
      inflateTar(resolve(packageBin, 'swiftshader.tar.br'), browserRoot),
    ]);
  }
  process.env.FONTCONFIG_PATH = fontDirectory;
  return executable;
}
