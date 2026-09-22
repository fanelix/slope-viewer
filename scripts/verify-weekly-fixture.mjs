import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const environment = {
  ...process.env,
  SLOPE_VIEWER_DXF_PATH: 'tests/fixtures/terrain-sample.dxf',
};

function run(args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(npmCommand, args, {
      cwd: repositoryRoot,
      env: environment,
      stdio: 'inherit',
    });
    child.on('error', rejectRun);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(new Error(
        `${npmCommand} ${args.join(' ')} failed (${signal || code})`,
      ));
    });
  });
}

await run(['test']);
await run(['run', 'build:site']);
