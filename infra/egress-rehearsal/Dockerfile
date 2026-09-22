# Test-only image. Never used as a deployment image.
ARG EGRESS_TEST_BASE=rust:1.96.1-slim
FROM ${EGRESS_TEST_BASE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
    iproute2 iptables wireguard-tools util-linux curl openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates/ ./crates/
RUN cargo test --locked -p egress-plane --no-run
ENV AXIOM_EGRESS_ISOLATED_REHEARSAL=1
CMD ["cargo", "test", "--locked", "--offline", "--no-fail-fast", "-p", "egress-plane", "--", "--include-ignored", "--test-threads=1", "--nocapture"]
