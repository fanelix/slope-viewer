import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const testPort = Number.parseInt(process.env.PORT || '4173', 10);
const mimeTypes = new Map([
  ['.csv', 'text/csv; charset=utf-8'],
  ['.dxf', 'text/plain; charset=utf-8'],
  ['.gz', 'application/gzip'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
]);

function containedPath(pathname) {
  const decoded = decodeURIComponent(pathname);
  const relativePath = decoded === '/' ? 'index.html' : decoded.slice(1);
  const candidate = resolve(repositoryRoot, relativePath);
  const fromRoot = relative(repositoryRoot, candidate);
  if (fromRoot.startsWith(`..${sep}`) || fromRoot === '..') return null;
  return candidate;
}

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
    let filePath = containedPath(requestUrl.pathname);
    if (!filePath) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    if ((await stat(filePath)).isDirectory()) filePath = resolve(filePath, 'index.html');
    const body = await readFile(filePath);
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': mimeTypes.get(extname(filePath)) || 'application/octet-stream',
    });
    response.end(body);
  } catch (error) {
    const status = error?.code === 'ENOENT' ? 404 : 500;
    response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(status === 404 ? 'Not found' : 'Internal server error');
  }
});

server.listen(testPort, '127.0.0.1', () => {
  console.log(`Test server listening on http://127.0.0.1:${testPort}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
