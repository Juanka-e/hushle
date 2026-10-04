import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const serverPath = fileURLToPath(new URL('./server.cjs', import.meta.url));
const child = spawn(process.execPath, [serverPath, '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
const errors = [];
child.stderr.on('data', chunk => errors.push(chunk.toString()));
try {
  const base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server startup timeout')), 5000);
    const cleanup = () => clearTimeout(timeout);
    child.once('error', error => { cleanup(); reject(error); });
    child.once('exit', code => { cleanup(); reject(new Error('Server exited: ' + code)); });
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { cleanup(); resolve(match[0]); }
    });
  });
  for (const [path, mime] of [['/', 'text/html'], ['/app.js', 'text/javascript'], ['/session.mjs', 'text/javascript'], ['/public.js', 'text/javascript'], ['/reference-cards.png', 'image/png']]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.ok(response.headers.get('content-type').startsWith(mime), path);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    await response.arrayBuffer();
  }
  const head = await fetch(base + '/public.html', { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  assert.equal((await fetch(base + '/public.html', { method: 'POST' })).status, 405);
  for (const path of ['/.env', '/server.cjs', '/test-server.mjs', '/../package.json', '/%2e%2e%2fpackage.json']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
  const html = await (await fetch(base + '/public.html')).text();
  assert.match(html, /public\.js/); assert.doesNotMatch(html, /app\.js|KUTUP IŞIKLARI/);
  assert.equal((await fetch(base + '/favicon.ico')).status, 204);
  assert.deepEqual(errors, []);
  console.log('PASS prototype HTTP assets, MIME, HEAD, method guard, allowlist and public page.');
} finally {
  if (child.exitCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill(); await exited;
  }
}
