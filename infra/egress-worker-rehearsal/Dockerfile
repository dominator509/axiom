# Disposable runtime fixture for the Node egress caller boundary. The harness
# stages the already-built artifacts only after its caller has rebuilt them
# locally and recorded their hashes; the fixture itself needs no registry.
FROM node:22.23.3-alpine3.23@sha256:baf676f7d0e552f3231945c2f979055ca121bce128c152f7a34e6bd1728b1c5a

USER root
RUN apk add --no-cache iproute2 util-linux
WORKDIR /app
COPY runtime-packages/core/package.json ./packages/core/package.json
COPY runtime-packages/core/dist ./packages/core/dist
COPY runtime-packages/llm-gateway/egress.js ./packages/llm-gateway/dist/egress.js
COPY runtime-packages/undici ./node_modules/undici
COPY infra/egress-worker-rehearsal ./infra/egress-worker-rehearsal
RUN mkdir -p /app/node_modules/@axiom && ln -s ../../packages/core /app/node_modules/@axiom/core

CMD ["sh", "/app/infra/egress-worker-rehearsal/run.sh"]
