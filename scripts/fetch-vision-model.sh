#!/usr/bin/env sh
set -eu

PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
MODEL_DIR=${1:-"$PROJECT_ROOT/var/models"}
MODEL_FILE="$MODEL_DIR/nsfw-vit.onnx"
PART_FILE="$MODEL_FILE.part"
MODEL_SHA256=2605f68c77b9262e51afa0ff022971c7a8dabcfa51f55c78321b711b889b0e93
MODEL_URL='https://huggingface.co/onnx-community/nsfw-image-detector-ONNX/resolve/6626debca038a8f7aa1729b1eaee3bd4eb929ad6/onnx/model.onnx?download=true'

mkdir -p "$MODEL_DIR"

if [ -f "$MODEL_FILE" ] && printf '%s  %s\n' "$MODEL_SHA256" "$MODEL_FILE" | sha256sum -c - >/dev/null 2>&1; then
  echo "vision-model: ok (already verified)"
  exit 0
fi

trap 'rm -f "$PART_FILE"' EXIT HUP INT TERM
curl --fail --location --retry 3 --silent --show-error --output "$PART_FILE" "$MODEL_URL"
printf '%s  %s\n' "$MODEL_SHA256" "$PART_FILE" | sha256sum -c -
mv -f "$PART_FILE" "$MODEL_FILE"
trap - EXIT HUP INT TERM

echo "vision-model: ok (downloaded and verified)"
