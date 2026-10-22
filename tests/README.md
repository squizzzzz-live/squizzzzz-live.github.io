# Lokaler End-to-End-Test (ohne Firebase)

`tests/fake/` ersetzt die Firebase-Module durch einen kleinen Nachbau im Browser-Speicher (localStorage),
damit Host und mehrere Test-Handys lokal eine Runde spielen können. Sicherheitsregeln werden dabei **nicht** geprüft.

Ablauf (Oskar): Repo in einen Testordner kopieren, gstatic-Importe auf `/fake/…` umbiegen, lokalen Server starten,
mit Playwright Host + 2 Spieler öffnen, eine .sqq-Runde laden und spielen. **Echte Rundendateien nie ins Repository legen.**
