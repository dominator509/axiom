#!/usr/bin/env bash
# POSIX-safe strict mode: dash (sh) rejects "set -o pipefail", so guard it.
set -eu
if [ -n "${BASH_VERSION:-}" ]; then set -o pipefail; fi
cd /root/axiom

# Ingest the entire blueprint pack at once
python3 /root/lightrag_workspace/lightrag_deepseek.py --action ingest-batch << 'FILES'
/root/axiom/AGENTS.md
/root/axiom/L0-governance/L0.0-governance-and-invariants.md
/root/axiom/L0-governance/L0.1-security-and-compliance.md
/root/axiom/L1-product/L1.0-product-vision-and-personas.md
/root/axiom/L1-product/L1.1-feature-catalog.md
/root/axiom/L2-architecture/L2.0-system-architecture-and-topology.md
/root/axiom/L2-architecture/L2.1-technology-stack.md
/root/axiom/L2-architecture/L2.3-social-connector-framework.md
/root/axiom/L2-architecture/L2.10-fanvue-mcp-tos-engine.md
/root/axiom/L2-architecture/L2.11-crm-mcp-server-agents.md
/root/axiom/L2-architecture/L2.5-llm-gateway-tokenkiller-generation.md
/root/axiom/L2-architecture/L2.6-network-isolation-failclosed.md
/root/axiom/L2-architecture/L2.7-relay-control-channel.md
/root/axiom/L2-architecture/L2.8-viral-memory-loop.md
/root/axiom/L2-architecture/L2.9-observability-incident-plane.md
/root/axiom/L3-specification/L3.0-api-and-mcp-contracts.md
/root/axiom/L3-specification/L3.1-database-ddl.md
/root/axiom/L3-specification/L3.2-connector-interfaces.md
/root/axiom/L3-specification/L3.3-relay-protocol.md
/root/axiom/L3-specification/L3.4-queue-and-idempotency.md
/root/axiom/L3-specification/L3.5-viral-loop-and-tokenkiller.md
/root/axiom/L4-execution/L4.0-execplan-index-and-roadmap.md
/root/axiom/L4-execution/L4.1-execplan-p0-foundation.md
/root/axiom/L4-execution/L4.2-execplan-p1-connectors-network.md
/root/axiom/L4-execution/L4.3-execplan-p2-intelligence.md
/root/axiom/L4-execution/L4.4-execplan-p3-control-learning-observability.md
/root/axiom/L4-execution/L4.5-execplan-p4-surface.md
FILES
echo "rag: ok"
