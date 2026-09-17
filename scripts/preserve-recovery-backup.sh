#!/usr/bin/env bash
# Keep a verified logical archive outside the container's ephemeral layer.
set -euo pipefail
[[ $# -eq 3 ]] || { echo 'usage: preserve-recovery-backup.sh CONTAINER_ARCHIVE EXPECTED_SHA PRIVATE_PARENT' >&2; exit 2; }
source_path=$1
expected=$2
parent=$3
[[ "$source_path" =~ ^/tmp/axiom-recovery-backup\.[A-Za-z0-9]+/database\.dump$ ]]
[[ "$expected" =~ ^[a-f0-9]{64}$ ]]
[[ "$parent" = /* && "$parent" != / && ! -L "$parent" ]]
umask 077
mkdir -p -- "$parent"
chmod 700 -- "$parent"
directory=$(mktemp -d "$parent/backup.XXXXXXXX")
if command -v docker.exe >/dev/null 2>&1 && command -v wslpath >/dev/null 2>&1; then
  # Docker Desktop's Linux shim may exist even when distro integration is off.
  # Use the existing Windows client and WSL UNC path; do not enable integration.
  destination=$(wslpath -w "$directory/database.dump")
  docker.exe cp "axiom-recovery-postgres:$source_path" "$destination"
else
  docker cp "axiom-recovery-postgres:$source_path" "$directory/database.dump"
fi
chmod 600 -- "$directory/database.dump"
actual=$(sha256sum -- "$directory/database.dump")
[[ "${actual%% *}" = "$expected" ]]
printf 'Private persistent backup verified: %s\n' "$directory/database.dump"
