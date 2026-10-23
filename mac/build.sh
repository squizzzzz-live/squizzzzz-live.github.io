#!/usr/bin/env bash
# Baut „SQUIZZZzZ Pult.app“ (Apple Silicon + Intel), ad-hoc signiert, als ZIP. Läuft auf macOS (GitHub Actions).
set -euo pipefail
cd "$(dirname "$0")"
VER="${1:-0.0.0}"
OUT=build
APP="$OUT/SQUIZZZzZ Pult.app"
rm -rf "$OUT"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macos13.0" -o "$OUT/pult-$arch" Sources/main.swift
done
lipo -create -output "$APP/Contents/MacOS/SQUIZZZzZ Pult" "$OUT/pult-arm64" "$OUT/pult-x86_64"

sed "s/__VERSION__/$VER/; s/__BUILD__/${VER##*.}/" Info.plist > "$APP/Contents/Info.plist"
plutil -lint "$APP/Contents/Info.plist"

ICONSET="$OUT/AppIcon.iconset"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s ../icons/pult-512.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z $d $d ../icons/pult-512.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

codesign --force --deep --sign - "$APP"
codesign --verify --verbose=2 "$APP"
(cd "$OUT" && ditto -c -k --keepParent "SQUIZZZzZ Pult.app" "SQUIZZZzZ-Pult.zip")
ls -la "$OUT"
