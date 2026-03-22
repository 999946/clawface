#!/bin/bash

set -euo pipefail

DESKTOP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE_DIR="$DESKTOP_DIR/release"
PRODUCT_NAME="ClawFace Gateway"

cd "$DESKTOP_DIR"

VERSION="$(node -p "require('./package.json').version")"

if [ "$#" -eq 0 ]; then
  case "$(uname -m)" in
    arm64) ARCHES=(arm64) ;;
    x86_64) ARCHES=(x64) ;;
    *)
      echo "Unsupported host architecture: $(uname -m)" >&2
      exit 1
      ;;
  esac
else
  ARCHES=("$@")
fi

mkdir -p "$RELEASE_DIR"

for arch in "${ARCHES[@]}"; do
  case "$arch" in
    arm64|x64) ;;
    *)
      echo "Unsupported target architecture: $arch" >&2
      exit 1
      ;;
  esac

  OUTPUT_DIR="$RELEASE_DIR/build-$arch"
  STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/clawface-dmg-$arch.XXXXXX")"
  DMG_PATH="$RELEASE_DIR/$PRODUCT_NAME-$VERSION-$arch.dmg"

  echo "==> Building $arch app bundle"
  pnpm exec electron-builder --mac dir "--$arch" "-c.directories.output=$OUTPUT_DIR"

  APP_PATH="$(find "$OUTPUT_DIR" -maxdepth 3 -type d -name "$PRODUCT_NAME.app" -print -quit)"
  if [ -z "$APP_PATH" ]; then
    echo "Failed to locate packaged app for $arch in $OUTPUT_DIR" >&2
    exit 1
  fi

  echo "==> Creating $arch DMG"
  ditto "$APP_PATH" "$STAGE_DIR/$PRODUCT_NAME.app"
  ln -s /Applications "$STAGE_DIR/Applications"
  hdiutil create \
    -volname "$PRODUCT_NAME" \
    -srcfolder "$STAGE_DIR" \
    -ov \
    -format UDZO \
    "$DMG_PATH" >/dev/null

  echo "Built $DMG_PATH"
done
