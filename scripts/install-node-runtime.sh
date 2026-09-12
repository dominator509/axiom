#!/usr/bin/env bash
# Install the downloaded official Linux runtime into a new private directory.
# No system Node, shell defaults, package lockfiles or credentials are changed.
set -euo pipefail
[[ $# -eq 3 ]] || { echo 'usage: install-node-runtime.sh ARCHIVE SHASUMS NEW_DIRECTORY' >&2; exit 2; }
archive=$(realpath -e -- "$1")
checksums=$(realpath -e -- "$2")
destination=$3
[[ "$destination" = /* && "$destination" != / && ! -e "$destination" ]]
filename=$(basename -- "$archive")
[[ "$filename" =~ ^node-v22\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz$ ]]
expected=$(awk -v name="$filename" '$2 == name { print $1 }' "$checksums")
[[ "$expected" =~ ^[0-9a-f]{64}$ ]]
actual=$(sha256sum -- "$archive")
[[ "${actual%% *}" = "$expected" ]]
umask 077
mkdir -p -- "$(dirname -- "$destination")"
mkdir -- "$destination"
tar --extract --xz --file "$archive" --directory "$destination" --strip-components=1 --no-same-owner
"$destination/bin/node" --version
echo 'Official Node archive checksum verified; private runtime installed'
