// Local HTTP regression against the dashboard's actual compression middleware.
// Controlled SSE fixture only: no accounts, cookies, provider requests or tokens.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../packages/dashboard/package.json', import.meta.url));
const compression = require('next/dist/compiled/compression');

async function firstEventBeforeEnd(cacheControl) {
  let ended = false;
  let timer;
  const middleware = compression();
  const server = createServer((request, response) => middleware(request, response, () => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': cacheControl });
    response.write('data: {"message":"synthetic device instructions"}\n\n');
    timer = setTimeout(() => { ended = true; response.end('event: connected\ndata: {}\n\n'); }, 800);
    response.once('close', () => clearTimeout(timer));
  }));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}`, {
      headers: { 'Accept-Encoding': 'gzip' }, signal: AbortSignal.timeout(5000),
    });
    const reader = response.body.getReader();
    try {
      const chunk = await reader.read();
      assert.equal(chunk.done, false);
      assert.match(new TextDecoder().decode(chunk.value), /synthetic device instructions/);
      return { beforeEnd: !ended, encoding: response.headers.get('content-encoding') };
    } finally { await reader.cancel(); }
  } finally {
    clearTimeout(timer); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
assert.deepEqual(await firstEventBeforeEnd('no-store'), { beforeEnd: false, encoding: 'gzip' });
assert.deepEqual(await firstEventBeforeEnd('no-store, no-transform'), { beforeEnd: true, encoding: null });
console.log('login stream: old gzip path buffered until EOF; no-transform delivered instructions before completion');
