# Lokaler End-to-End-Test (ohne Firebase)

`tests/fake/` ersetzt die Firebase-Module durch einen kleinen Nachbau im Browser-Speicher (localStorage). So können Host und mehrere Test-Handys lokal spielen. Sicherheitsregeln werden dabei **nicht** geprüft.

## Ablauf
1. `bash tests/e2e/prepare.sh` legt die Testkopie unter `tests/e2e/.work` an und startet `http://localhost:8770`.
2. Zwei Rundendateien nach `tests/e2e/rounds/` kopieren. **Sie gehören nie ins Repository** (Quizinhalte), der Ordner ist in `.gitignore`.
   - `keypad.sqq`: eine Keypad-Runde, gern mit wenigen Fragen
   - `buzz.sqb`: eine Buzzin-Runde mit mindestens 10 Fragen
3. Playwright starten, mit Arbeitsordner `tests/e2e`:
   - `node run-buzz.cjs`: Buzzin mit 4 Spielern, Sperren, Buzzername-Ton, Springen
   - `node run-plan.cjs`: Regieplan mit 8 Blöcken, Mac-Brücke und QLab nachgebaut, „QLab befüllen“, komplett mit der Leertaste durchgespielt

   Erwartet wird am Ende `ERRORS []`. Bildschirmfotos landen in `tests/e2e/shots/`.

Playwright/Chromium: In der Cloud-Umgebung von Oskar liegt Chromium unter `/opt/pw-browsers/chromium` (siehe `executablePath` in den Skripten). Lokal auf dem Mac `executablePath` entfernen und `npx playwright install chromium` nutzen.
