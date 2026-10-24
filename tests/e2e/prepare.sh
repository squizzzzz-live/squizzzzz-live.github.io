#!/usr/bin/env bash
# Baut tests/e2e/.work: Kopie der Seite mit nachgebauten Firebase-Modulen (tests/fake) und startet den Testserver auf :8770.
# Aufruf (aus dem Repo-Hauptordner):  bash tests/e2e/prepare.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
W=tests/e2e/.work
rm -rf "$W"; mkdir -p "$W"
cp -r index.html version.json manifest.webmanifest favicon.svg css js host icons sounds "$W"/
cp -r tests/fake "$W"/fake
sed -i.bak 's#https://www.gstatic.com/firebasejs/10.12.2/#/fake/#g' "$W"/js/*.js "$W"/index.html "$W"/host/index.html
sed -i.bak 's#https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js#/fake/qrcode.js#' "$W"/host/index.html
find "$W" -name "*.bak" -delete
# Testserver (läuft im Hintergrund weiter)
if ! (lsof -i :8770 >/dev/null 2>&1 || fuser 8770/tcp >/dev/null 2>&1); then
  (cd "$W" && nohup python3 -m http.server 8770 >/dev/null 2>&1 &)
  sleep 1
fi
echo "Testseite bereit: http://localhost:8770  (Rundendateien nach tests/e2e/rounds/ legen – siehe tests/README.md)"
