import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

function jobBlock(workflow, name) {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => line === `  ${name}:`);
  assert.notEqual(start, -1, `missing ${name} job`);
  let end = start + 1;
  while (
    end < lines.length
    && !/^  [A-Za-z0-9_-]+:\s*$/.test(lines[end])
  ) {
    end += 1;
  }
  return lines.slice(start, end).join('\n');
}

test('workflow validates before deploy and never deploys pull requests', async () => {
  const workflow = await readFile(
    '.github/workflows/verify-and-deploy.yml',
    'utf8',
  );
  const verify = jobBlock(workflow, 'verify');
  const deploy = jobBlock(workflow, 'deploy');

  assert.match(workflow, /^  pull_request:\s*$/m);
  assert.match(workflow, /^  workflow_dispatch:\s*$/m);
  assert.match(verify, /actions\/checkout@v4/);
  assert.match(verify, /actions\/setup-node@v4/);
  assert.match(verify, /^          node-version:\s*22\s*$/m);
  assert.match(verify, /npm ci/);
  assert.match(verify, /prepareChromium/);
  assert.match(verify, /npm test/);
  assert.match(verify, /npm run build:site/);
  assert.match(
    verify,
    /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'\n        uses: actions\/configure-pages@v5/,
  );
  assert.match(
    verify,
    /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'\n        uses: actions\/upload-pages-artifact@v4/,
  );
  assert.match(verify, /^          path:\s*_site\s*$/m);
  assert.match(deploy, /^    needs:\s*verify\s*$/m);
  assert.match(
    deploy,
    /^    if:\s*github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'\s*$/m,
  );
  assert.match(deploy, /^      pages:\s*write\s*$/m);
  assert.match(deploy, /^      id-token:\s*write\s*$/m);
  assert.match(deploy, /^    concurrency:\s*$/m);
  assert.match(deploy, /^      cancel-in-progress:\s*true\s*$/m);
  assert.match(deploy, /^      name:\s*github-pages\s*$/m);
  assert.match(deploy, /actions\/deploy-pages@v4/);

  const beforeJobs = workflow.slice(0, workflow.indexOf('\njobs:'));
  assert.doesNotMatch(beforeJobs, /^concurrency:/m);
});

test('README documents the browser-only weekly DXF replacement gate', async () => {
  const readme = await readFile('README.md', 'utf8');

  assert.match(readme, /data\/topografi\.dxf/);
  assert.match(readme, /GitHub web/i);
  assert.match(readme, /nama dan path yang sama/i);
  assert.match(readme, /koordinat.*3DFACE/is);
  assert.match(readme, /25 MiB/);
  assert.match(readme, /jangan.*upload.*lebih besar/is);
  assert.match(readme, /Actions.*verify.*deploy/is);
  assert.match(readme, /validasi gagal.*deployment terakhir/is);
  assert.match(readme, /short source hash/i);
  assert.match(readme, /\?test=1/);
});
