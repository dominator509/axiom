---
tags:
  - axiom
  - operations
---

# Operations

Back to [[Welcome]]. [COMMANDS.md](../COMMANDS.md) remains the canonical command contract.

## Boot sequence

```sh
sh scripts/ledger.sh tail 30
sh scripts/preflight.sh
sh scripts/graph-next.sh
```

Follow the one-line graph dispatch. Do not patch around failed audit gates unless explicitly asked.

## Validation

```sh
sh scripts/build.sh
sh scripts/test.sh
sh scripts/verify.sh
pnpm typecheck
cargo test --workspace
pnpm run audit:dependencies
```

`verify.sh` must print `verify: ok` for a green ship claim. Embedded errors still count as failures even if a wrapper exits successfully.

## Local runtime prerequisites

- PostgreSQL 16 needs TimescaleDB, pgvector, and pgcrypto before restore.
- Confirm the endpoint named by `REDIS_URL` answers `PING`.
- Run `pnpm run setup:vision-model`; it downloads a pinned ONNX revision into ignored `var/models/` and verifies SHA-256 before installation.

## Local safety

- Never commit `.env` or copy secret values into notes.
- Keep `.obsidian/` and `.serena/` as local tooling state.
- Treat cloudflared, nginx, and systemd recovery artifacts as reference-only unless deployment is explicitly authorized.
- Use Git for Windows `sh` on this workstation; production networking validation belongs on Linux.

## Session notes

Create new sessions from [[Templates/Work Session]].
