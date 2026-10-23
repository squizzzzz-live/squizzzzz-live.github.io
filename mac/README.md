# SQUIZZZzZ Pult für Mac

Eine dünne Mac-App rund um die Host-Seite. Sie zeigt `https://squizzzzz-live.github.io/host/` in einem eigenen Fenster und kann zusätzlich:

- **Rundendateien per Pfad lesen**, nur lesend und nur innerhalb von `~/Desktop/SQUIZZZzZ`
- **QLab per OSC steuern** über UDP 53000 auf diesem Mac. Der Passcode liegt im Mac-Schlüsselbund.
- **Ton ohne „Ton an“-Klick** abspielen und den Bildschirm während der Show wach halten

Die Brücke (`window.webkit.messageHandlers.sqz`) antwortet nur der Hauptseite von `squizzzzz-live.github.io` über https.
Fremde Links öffnen im normalen Browser.

**Bauen:** über GitHub Actions (`.github/workflows/mac-app.yml`) auf macOS. Das Ergebnis erscheint als Release `pult-latest` (ZIP).
Die App ist ad-hoc signiert und nicht notarisiert. macOS fragt deshalb beim ersten Öffnen nach: Systemeinstellungen → Datenschutz & Sicherheit → „Trotzdem öffnen“.

**Testseite:** Menü Darstellung → Mac-Test (⌘2) bzw. `host/mac-test.html`.
