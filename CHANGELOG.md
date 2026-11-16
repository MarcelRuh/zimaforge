# Changelog

Alle nennenswerten Änderungen an ZimaForge. Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionierung nach [SemVer](https://semver.org/lang/de/).

## [0.1.0] – 2026-11-16

### Neu
- Reverse-Proxy vor dem ZimaOS-Gateway mit Loader-Injection, WebSocket-Tunnel und eigener Fehlerseite bei nicht erreichbarem Gateway.
- Mod-API (`/_forge/api`): aktive Mods, Store, Installieren/Entfernen (atomar), Aktivieren/Deaktivieren, Einstellungen je Mod, Systemwerte.
- Schreibschutz über die ZimaOS-Anmeldung (Sitzungsprüfung beim Gateway) sowie CSRF-Header und Origin-Prüfung.
- Store und Launcher als Web Components im ora-Design, Tastenkürzel <kbd>Alt</kbd>+<kbd>⇧</kbd>+<kbd>F</kbd>, Aufruf per `?forge`, Update-Hinweis über GitHub-Releases.
- Kompatibilität zu ZimaMOD- und CasaMOD-Mods (`zimamod.json`, `mod.js`/`mod.css`, `window.ZimaMOD`, `/mod/<id>/…`).
- Mitgelieferte Mods: Forge Pulse, Forge Sparks und ora Polish.
- Docker-Image auf Basis `scratch` für amd64 und arm64, ZimaOS-Compose mit `x-casaos`-Metadaten.
