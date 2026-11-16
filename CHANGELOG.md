# Changelog

Alle nennenswerten Änderungen an ZimaForge. Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionierung nach [SemVer](https://semver.org/lang/de/).

## [0.3.0] – 2026-11-16

### Neu
- `/_forge/api/system`: Detailwerte wie in btop – Auslastung je Kern, Kerntemperaturen (coretemp/k10temp), CPU-Modell und Takt, RAM-Aufteilung (belegt, Cache, frei, Swap), Belegung des DATA-Laufwerks, Lese-/Schreibzähler, Netzwerk je Schnittstelle, Top-Prozesse und Verbrauch je App (Prozesse über cgroups den Docker-Containern zugeordnet).
- Forge Pulse 2.2: Tabs CPU, RAM, Disk, Netz und Prozesse; Apps-Liste nach CPU bzw. RAM wie im ZimaOS-System-Widget, mit Titel und Icon aus ZimaOS.
- Optionaler Compose-Block für die Docker-Metadaten (App-Namen).

### Geändert
- ☰ in Forge Pulse sucht den btop-Button von ZimaOS über die Position auf dem Bildschirm (Icon rechts neben „RAM“) statt über den DOM-Aufbau.

## [0.2.1] – 2026-11-16

### Geändert
- Forge Pulse 2.1: liest CPU, RAM, Temperatur und Leistung bevorzugt aus derselben ZimaOS-Schnittstelle wie das System-Widget (`/v1/sys/utilization`), damit die Werte übereinstimmen; sonst eigene Messung.
- Forge Pulse: Details mit CPU/RAM-Tabs wie bei ZimaOS, eine Zeile pro Wert (keine Überschneidungen mehr).

### Neu
- Forge Pulse: ☰-Button öffnet den Ressourcenmonitor von ZimaOS (klappt das System-Widget bei Bedarf auf).

## [0.2.0] – 2026-11-16

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
