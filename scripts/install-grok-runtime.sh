#!/usr/bin/env bash
# Install a locally verified patched binary without replacing a stock CLI or
# touching credentials. Arguments: CLI launcher new-directory expected-CLI-SHA256.
set -euo pipefail
if [ "$#" -ne 4 ]; then
  echo 'usage: install-grok-runtime.sh CLI LAUNCHER NEW_DIRECTORY CLI_SHA256' >&2
  exit 2
fi
cli=$(realpath -e -- "$1")
launcher=$(realpath -e -- "$2")
destination=$3
expected=$4
[[ "$destination" = /* && "$destination" != / && ! -e "$destination" ]]
[[ "$expected" =~ ^[0-9a-f]{64}$ ]]
[[ -f "$cli" && -f "$launcher" ]]
actual=$(sha256sum -- "$cli")
[[ "${actual%% *}" = "$expected" ]]
umask 077
mkdir -p -- "$(dirname -- "$destination")"
mkdir -- "$destination"
install -m 500 -- "$cli" "$destination/grok"
install -m 500 -- "$launcher" "$destination/axiom-grok-image-launch"
sha256sum -- "$destination/grok" "$destination/axiom-grok-image-launch"
GROK_DISABLE_AUTOUPDATER=1 timeout -k 1 15 "$destination/grok" --version
