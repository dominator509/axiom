# Test-only image. Never used as a deployment image.
# Match the shipped Rust builder rather than inheriting undeclared tools from
# a previously built local rehearsal image.
ARG EGRESS_TEST_BASE=rust:1.97-slim-bookworm@sha256:2775a09d208ff0d7c1f50490c45b62db929e87ba1dcbc3f2132ac71a704bcdd3
FROM ${EGRESS_TEST_BASE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev \
    iproute2 iptables wireguard-tools util-linux curl openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates/ ./crates/
RUN cargo test --locked -p egress-plane -p egress-provisioner --no-run
ENV AXIOM_EGRESS_ISOLATED_REHEARSAL=1
CMD ["cargo", "test", "--locked", "--offline", "--no-fail-fast", "-p", "egress-plane", "-p", "egress-provisioner", "--", "--include-ignored", "--test-threads=1", "--nocapture"]
