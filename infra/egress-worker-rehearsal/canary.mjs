import http from 'node:http';

let targetHits = 0;
let proxyEnabled = true;
let proxyServer;

const targetServer = http.createServer((request, response) => {
  if (request.url === '/_fixture/status') {
    response.writeHead(200, { 'content-type': 'application/json', connection: 'close' })
      .end(JSON.stringify({ targetHits, proxyEnabled }));
    return;
  }
  if (request.url === '/_fixture/disable-proxy' && request.method === 'POST') {
    if (!proxyEnabled) {
      response.writeHead(200, { connection: 'close' }).end('proxy-disabled');
      return;
    }
    proxyEnabled = false;
    proxyServer.close(error => {
      if (error) {
        response.writeHead(500, { connection: 'close' }).end('proxy-close-failed');
        return;
      }
      response.writeHead(200, { connection: 'close' }).end('proxy-disabled');
    });
    proxyServer.closeAllConnections();
    return;
  }
  if (request.url !== '/permitted' || request.method !== 'GET') {
    response.writeHead(404).end('not found');
    return;
  }
  targetHits += 1;
  response.writeHead(200, { 'content-type': 'text/plain', connection: 'close' }).end('model-namespace-canary');
});

proxyServer = http.createServer((request, response) => {
  let destination;
  try {
    destination = new URL(request.url ?? '');
  } catch {
    response.writeHead(400, { connection: 'close' }).end('absolute target required');
    return;
  }
  if (request.method !== 'GET' || destination.origin !== 'http://127.0.0.1:18991'
    || destination.pathname !== '/permitted' || destination.search || destination.hash) {
    response.writeHead(403, { connection: 'close' }).end('fixture proxy target denied');
    return;
  }

  const upstreamRequest = http.request({
    hostname: '127.0.0.1',
    port: 18991,
    method: 'GET',
    path: '/permitted',
    headers: { connection: 'close' },
  }, upstreamResponse => {
    response.writeHead(upstreamResponse.statusCode ?? 502, {
      'content-type': upstreamResponse.headers['content-type'] ?? 'text/plain',
      connection: 'close',
    });
    upstreamResponse.pipe(response);
  });
  upstreamRequest.on('error', () => {
    if (!response.headersSent) response.writeHead(502, { connection: 'close' });
    response.end('fixture upstream unavailable');
  });
  request.pipe(upstreamRequest);
});

targetServer.listen(18991, '127.0.0.1', () => {
  proxyServer.listen(18992, '127.0.0.1', () => {
    console.log('EGRESS_RUNTIME_CANARY_READY');
  });
});
