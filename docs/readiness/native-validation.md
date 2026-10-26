# Native build validation

The mobile package declares Android, iOS and web, but its normal build exports
web. The CI build job now additionally runs the installed Expo SDK compatibility
check and real Android/iOS Hermes exports through
`node scripts/rehearse-native-export.mjs --isolated-fixture`.

The installed Expo 57 manifest requires SecureStore in the `~57.0.1` range and
SVG `15.15.4`. At baseline `f030e9fd3a37c81881f9f33f9344151f5da005d8`, the
offline CLI check exited 1 for installed SecureStore `15.0.8` and SVG `15.15.5`.
Both native Hermes exports nevertheless passed. This demonstrates why successful
JavaScript compilation alone does not settle native SDK compatibility.

SecureStore now resolves to `57.0.4`, and SVG is pinned to `15.15.4`. The same
installed-SDK check reports no differences and exits 0. Offline validation uses
the installed SDK manifest; it does not claim a fresh registry compatibility
lookup or establish that every newer SVG patch is incompatible.

The rehearsal requires a clean committed source tree and pinned Node. It passes
only an explicit environment allowlist to Expo, disables dotenv loading and
telemetry, uses offline mode and a synthetic loopback API origin, and does not
pass database/provider credentials. Each run owns its output and temporary
cache directory. The receipt records source, package/lock/log hashes, actual
commands, counts, both bundle hashes, cleanup, and unchanged-source readback.
Hermes bytecode is required for both platforms; JavaScript-only output cannot
pass. The fixture retains output artifacts and removes only its temporary cache.

On a machine with limited system-drive space, provide an absolute output root:
`node scripts/rehearse-native-export.mjs --isolated-fixture --output-root F:/axiom-native-validation`.
Build workspace dependencies first, as the normal CI build job does. No EAS
account, release signing, app publication or paid service is involved.

These checks do not establish native binary or runtime acceptance. A rebuilt
Android app must still run on an owned emulator/device against an isolated real
API/PostgreSQL fixture, exercising sign-in, authenticated critical actions,
SecureStore restoration after restart, sign-out/revocation, six locales and
accessibility. iOS runtime/hardware and owner release signing remain separate.
Mobile browser emulation cannot replace either platform's native journeys.
No release acceptance row is promoted by this build gate.

Native cookie-authenticated requests must send the configured API origin to
satisfy the existing server CSRF checks. Metro selects `requestOrigin.native.ts`
on Android/iOS; the default implementation leaves browser-controlled Origin
unchanged. Sign-out sends a JSON object so the auth endpoint accepts its content
type. Do not disable CSRF or expand trusted origins to accommodate native clients.
Runtime validation must inspect server-session deletion, not just navigation back
to login: a rejected sign-out still clears local state. Also exercise re-login
after sign-out and server revocation while the native process is stopped.

Dashboard acceptance must cover both owners and operators. Organization settings
remain owner-only; other roles must still load their permitted digests, crash
reports and language preference. An individual panel failure must preserve the
other successful responses and must not render a false empty/healthy result.
After each language change, verify the confirmation is in the newly persisted
language. Exercise Japanese and long account names on-device to check that the
greeting wraps while sign-out remains fully visible. These checks do not replace
system safe-area, other-screen, or iOS acceptance.

Consent uploads must pass actual File/Blob bytes to Expo fetch. Legacy React
Native `{ uri, name, type }` multipart parts are rejected by the installed Expo
fetch converter before a request reaches the API. Preserve the picked filename
when a native content-provider URI ends in an ID, check both picker metadata and
the readable file size against 25 MiB, and avoid creating plaintext cache copies.
Native acceptance must exercise real document selection, upload, encrypted
database persistence, hash-preserving authorized download, tenant denial, and
revocation with UI readback. An HTTP success alone does not close these checks.

Official Expo references:
- https://docs.expo.dev/versions/latest/sdk/filesystem/
- https://github.com/expo/expo/blob/main/docs/pages/more/expo-cli.mdx
- https://github.com/expo/expo/blob/main/docs/pages/develop/development-builds/use-development-builds.mdx
