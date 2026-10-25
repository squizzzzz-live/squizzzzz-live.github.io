# Lokaler End-to-End-Test (ohne Firebase)

`tests/fake/` ersetzt die Firebase-Module durch einen kleinen Nachbau im Browser-Speicher (localStorage). So können Host und mehrere Test-Handys lokal spielen. Sicherheitsregeln werden dabei **nicht** geprüft.

## Einmalig einrichten (Mac)
1. Node per Homebrew: `brew install node`
2. Im Ordner `tests/e2e`: `npm install` (holt Playwright laut `package.json`), dann `npx playwright install chromium`
3. Zwei Rundendateien nach `tests/e2e/rounds/` kopieren. **Sie gehören nie ins Repository** (Quizinhalte), der Ordner ist in `.gitignore`.
   - `keypad.sqq`: eine Keypad-Runde, gern mit wenigen Fragen
   - `buzz.sqb`: eine Buzzin-Runde mit mindestens 10 Fragen

   Auf Martins Mac liegen sie im festen Klon unter `05 App/30 App-Repo/tests/e2e/rounds/` (Kraut und Rüben, Zehnerkarte Deck 4). Die Skripte finden sie dort auch, wenn Claude Code in einem Worktree arbeitet.

## Ablauf
1. `bash tests/e2e/prepare.sh` legt die Testkopie unter `tests/e2e/.work` an und startet `http://localhost:8770`.
2. Mit Arbeitsordner `tests/e2e`:
   - `node run-buzz.cjs` (oder `npm run buzz`): Buzzin mit 4 Spielern, Sperren, Buzzername-Ton, Blitz beim Schnellsten, Springen
   - `node run-plan.cjs` (oder `npm run plan`): Regieplan mit 8 Blöcken, Mac-Brücke und QLab nachgebaut, „QLab befüllen“, komplett mit der Leertaste durchgespielt

   Erwartet wird am Ende `ERRORS []`. Bildschirmfotos landen in `tests/e2e/shots/`.

In der Cloud-Umgebung (Cowork) liegt Chromium unter `/opt/pw-browsers/chromium`. Die Skripte nehmen es dort automatisch, sonst das Chromium von Playwright.
