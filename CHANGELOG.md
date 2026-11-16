# Changelog

Alle nennenswerten Änderungen an ZimaForge. Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionierung nach [SemVer](https://semver.org/lang/de/).

## [Unveröffentlicht]

### Neu
- Neues Logo (ZimaOS Toolkit) für App-Icon, Launcher, Store und README.
- Forge Pulse 2.0: aufgebaut wie das ZimaOS-System-Widget mit Ringanzeigen, Leistung in Watt (RAPL) und Temperatur; sitzt in der Widget-Spalte.
- `/_forge/api/metrics` liefert `powerWatts` (Summe der RAPL-Paketzonen, Überlauf berücksichtigt).
- `ZimaForge.dashboard`: gemeinsame API zum Einhängen von Widgets in die ZimaOS-Widget-Spalte.
- Neue Mods: Forge Wetter, Widget-Reihenfolge, ora Widgets, Tab-Titel, Forge Schnee, Emoji-Spur.

### Geändert
- Launcher und Widgets liegen jetzt unter ZimaOS-Fenstern wie dem App Store (niedriger z-index bzw. in der Widget-Spalte).

## [0.1.1] – 2026-11-16

### Neu
- `docker-compose.standardport.yml`: ZimaForge auf Port 80, ZimaOS dahinter auf 8081. Damit erscheinen die Mods unter der normalen Dashboard-Adresse.
- Der Proxy schickt `X-Forwarded-Port` mit, damit ZimaOS Links auf den Port von ZimaForge bezieht.

### Behoben
- Ein Klick auf die ZimaForge-Kachel innerhalb von ZimaForge öffnet jetzt direkt den Store statt eines zweiten Tabs.

## [0.1.0] – 2026-11-16

### Neu
- Reverse-Proxy vor dem ZimaOS-Gateway mit Loader-Injection, WebSocket-Tunnel und eigener Fehlerseite bei nicht erreichbarem Gateway.
- Mod-API (`/_forge/api`): aktive Mods, Store, Installieren/Entfernen (atomar), Aktivieren/Deaktivieren, Einstellungen je Mod, Systemwerte.
- Schreibschutz über die ZimaOS-Anmeldung (Sitzungsprüfung beim Gateway) sowie CSRF-Header und Origin-Prüfung.
- Store und Launcher als Web Components im ora-Design, Tastenkürzel <kbd>Alt</kbd>+<kbd>⇧</kbd>+<kbd>F</kbd>, Aufruf per `?forge`, Update-Hinweis über GitHub-Releases.
- Kompatibilität zu ZimaMOD- und CasaMOD-Mods (`zimamod.json`, `mod.js`/`mod.css`, `window.ZimaMOD`, `/mod/<id>/…`).
- Mitgelieferte Mods: Forge Pulse, Forge Sparks und ora Polish.
- Docker-Image auf Basis `scratch` für amd64 und arm64, ZimaOS-Compose mit `x-casaos`-Metadaten.
