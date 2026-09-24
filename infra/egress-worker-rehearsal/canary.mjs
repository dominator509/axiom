import http from 'node:http';

const server = http.createServer((request, response) => {
  if (request.url !== '/permitted') {
    response.writeHead(404).end('not found');
    return;
  }
  response.writeHead(200, { 'content-type': 'text/plain' }).end('model-namespace-canary');
});

server.listen(18991, '127.0.0.1', () => {
  console.log('EGRESS_RUNTIME_CANARY_READY');
});
