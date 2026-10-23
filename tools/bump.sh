#!/usr/bin/env bash
# Setzt einen neuen Build-Stempel: ?v= an allen CSS/JS-Imports, <meta name="sqz-build"> und version.json.
set -euo pipefail
cd "$(dirname "$0")/.."
V=$(TZ=Europe/Berlin date +%Y%m%d%H%M)
files=$(grep -rlE '\?v=[0-9]{12}|name="sqz-build"' --include=*.html --include=*.js --exclude-dir=tests --exclude-dir=tools . || true)
for f in $files; do
  sed -i -E "s/\?v=[0-9]{12}/?v=$V/g; s/(name=\"sqz-build\" content=\")[0-9]{12}/\1$V/" "$f"
done
printf '{ "build": "%s" }\n' "$V" > version.json
echo "Build $V"
