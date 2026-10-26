# Partial Android locale and safe-area rehearsal — 2026-10-26

This records a local, synthetic-operator rehearsal. It is supporting progress
for F-89 only; it is not an acceptance receipt for the full release criterion.
`FUNCTIONAL-9` remains `unverified` in `release-evidence.json`.

## Source and environment

- Mobile source candidate: `eddfa04f9425ecc54997f86c95c2f732de6a2014`.
- Main SHA recorded by the fixture: `06c46aeecc6b5572d18ecb4eeb7f174305a3cfd8`.
- Installed debug APK SHA-256: `cd9d2830f4497f11cdae73816fdbc8cbc5735b7ae698d9bd36b03816c896d389`.
- API fixture source SHA: `fe22c072d2f641cb63f847ad8a23d095286a4837`; local API image ID: `sha256:25153130c40ce51c422c380add9134970993b0820a8f1dc4a69cc5eae8bbaa4c`.
- Database image: `timescale/timescaledb:2.29.2-pg16@sha256:289d55704b1b3ee8263cd3805c6930f9cd54506835a8f19f9b85dad17d5c5a8a`.
- HTTPS fixture image: `node:22.23.3-alpine3.23@sha256:baf676f7d0e552f3231945c2f979055ca121bce128c152f7a34e6bd1728b1c5a`.
- Device: isolated Android AVD `axiom_native_eu3j5q`, emulator `emulator-5580`, portrait 1080×2400, font scale 1.0.
- Authenticated role: synthetic `operator`; the owner fixture did not match (`ownerFixtureMatched: false`).
- Local helper: `node var/check-native-safearea-owner-locales.mjs`. The helper is ignored local tooling and is not part of this repository change.

## Observed result

The receipt reports 6 of 6 requested locale iterations passed and restores English
with a fresh persisted-locale audit entry. Each locale selected successfully,
showed a translated dashboard overview, persisted the selected locale to the
operator's organization-scoped database preference, and recorded no overlap
among the brand and four tab labels. Status-bar bounds were `[0,0,1080,128]`;
navigation-bar bounds were `[0,2337,1080,2400]`.

| Locale | Persisted value | Dashboard translated | Label overlaps | Screenshot SHA-256 |
|---|---|---:|---:|---|
| `es` | `es` | Yes | 0 | `e1df28f8e3a42ee6450d5d82258164a1a1e82f61b4dae5f16c3379b5976be3e7` |
| `ja` | `ja` | Yes | 0 | `9d487c78e75e80ee845a9099c3b9548757e69adc3ebcf5a3aab778de5236c3de` |
| `it` | `it` | Yes | 0 | `c1e2d61a0c4388de9966729141340d16cb2b71ebdd9fc99370d5e9afffcf1767` |
| `pt-BR` | `pt-BR` | Yes | 0 | `9eace44f30288d94aa01a277c1f9c8c8167d27ec67219e072b3614f59ad73001` |
| `en` | `en` | Yes | 0 | `feaeb290154c5712136f4f665c46fbd530dbc8f1c67e869cec21ae34e333540b` |
| `de` | `de` | Yes | 0 | `2d99220dc9e88c11a1d3b0ae7043dc856ef5924394314e9cb97674f95598483b` |

The original local receipt is `F:\axiom-android-binary-EU3j5q\native-safearea-dashboard-operator-locale-acceptance.json`, SHA-256 `4a3803a13d4f6d1ac3169fa4c8df9ef30ba44eb31c6e780ebb406066ff9ae26c`. Its locale observations ran from `2026-10-26T06:03:18.900Z` through `2026-10-26T06:03:47.593Z`.

## Limits and disposition

- The receipt is operator-only and used an older API fixture source. It does not prove owner acceptance or a full-source current binary.
- Only Android portrait at font scale 1.0 was exercised. iOS, enlarged-font/accessibility checks, desktop/mobile parity, fallback behavior, full catalog completeness, and all critical native actions remain open.
- The local receipt has no GitHub Actions run/job or raw job-log digest, which the canonical register requires. It is therefore documented here but not appended as accepted register evidence; `FUNCTIONAL-9` remains unverified and no criterion is promoted.
- After verification, the task-owned emulator and API/DB/HTTPS containers were stopped. The ADB device list was empty and all three named containers reported `exited`; their fixture data was preserved.
