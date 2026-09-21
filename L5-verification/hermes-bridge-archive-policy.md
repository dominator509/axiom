# Hermes bridge archive policy

Status: active maintenance rule for Codex-led bridge coordination.

## Shared-surface rules

- Keep `CURRENT_TASK.json` and the active nonterminal task visible.
- Treat a message as terminal only when its protocol body explicitly says
  `TERMINAL: YES`; do not infer terminal state from filenames, filesystem
  order, or timestamps.
- When the top-level inbox has more than 10 terminal records, Codex performs
  a compaction pass before opening or delegating another feature lane.
- Terminal inbox records are copied with SHA-256 verification into a private
  Codex-owned archive and then removed from the shared inbox. The archive
  location is intentionally not disclosed to Hermes.
- Codex never archives a current marker, active task, or unconsumed
  maintenance notice.
- Nested source copies, manifests, and delivery artifacts are not message
  records and are not removed by this policy.

## Coordination rules

- Hermes receives a signed maintenance notice before a compaction pass and is
  told to use only the current marker and the latest explicit Codex task.
- Missing historical files are not treated as missing work, rejection, or
  authorization to resume a lane.
- All feature requests, approvals, implementation asks, and deliveries flow
  through Codex; Hermes does not access or request the private archive.
- Ordering and correlation use `TASK`, `WIRE`, `SEQ`, `STATE`, and
  `TERMINAL`; no wall-clock comparison is used.
- The pass is read-only with respect to source, deployment, database,
  providers, credentials, permissions, systemd, and runtime services.

## Permission boundary

The Codex bridge identity can safely compact the shared inbox. Reply and
status directories are read-only to Codex under the existing bridge boundary;
they are not mutated by this policy. Their historical records remain
authoritative evidence but are not active work unless the current marker or a
new explicit Codex task names them.
