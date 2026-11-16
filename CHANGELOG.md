# Changelog

Alle nennenswerten Änderungen an ZimaForge. Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionierung nach [SemVer](https://semver.org/lang/de/).

## [0.3.3] – 2026-11-16

### Performance
- Proxy entfernt `Accept-Encoding` nur noch bei Seitenaufrufen (HTML, für die Loader-Injection). JS, CSS, Bilder und API-Antworten von ZimaOS kommen wieder komprimiert.
- ZimaForge komprimiert eigene Antworten und die HTML-Seite mit Loader (gzip/Brotli, schnellste Stufe) – Loader, Store und API rund 60–70 % kleiner.
- Browser-Cache: Dateien mit Version in der URL sind `immutable`, sonst ETag mit `304 Not Modified`. Mod-Dateien tragen einen Änderungsstempel (`rev`), damit Änderungen trotzdem sofort ankommen.
- Widget-Spalte wird gemerkt statt bei jeder DOM-Änderung neu gesucht. Messung im Mock mit 100 Uhr-Ticks in 10 s: vorher 2352 Volldurchsuchungen und 6696 Layout-Abfragen, jetzt 0.
- Forge Pulse holt die Detailwerte nur noch alle 6 s.

## [0.3.2] – 2026-11-16

### Behoben
- Update-Hinweis im Store blieb nach einem Update auf „Update verfügbar“ hängen. Gespeichert wird jetzt nur die neueste GitHub-Version; ob ein Update verfügbar ist, wird bei jeder Anzeige neu berechnet. Nach einem Versionswechsel wird sofort neu geprüft, sonst höchstens alle 2 Stunden.
- Auch im Zustand „Update verfügbar“ gibt es jetzt den Knopf „Erneut prüfen“.

### Geändert
- Forge Pulse 2.4: ☰ startet btop direkt über ZimaOS (`POST /v2/zimaos/tty/btop`, läuft über ZimaForge an den eingestellten ZimaOS-Port) und öffnet die Adresse mit dem jeweils neuen Port. Das Fenster öffnet sofort im Klick, damit kein Popup-Blocker greift. Ausweg für ältere ZimaOS-Versionen: Klick auf ☰ im System-Widget.
- Store-Einstellungen zeigen unter „Verbindung“, an welche ZimaOS-Adresse ZimaForge weiterleitet (`ZIMAFORGE_UPSTREAM`); `/_forge/api/health` liefert dafür `upstream` und `port`.

## [0.3.1] – 2026-11-16

### Geändert
- Forge Pulse 2.3: CPU- und RAM-Tab zeigen wie im ZimaOS-System-Widget nur die Apps mit Icon und Prozentwert. Die Zuordnung Container → App kommt direkt aus der ZimaOS-App-Verwaltung (`/v2/app_management/web/appgrid` und `/compose/{app}/containers`) – ohne Docker-Ordner.
- ☰ klickt den btop-Button im ZimaOS-System-Widget; ZimaOS startet btop und öffnet die Adresse mit wechselndem Port. Pulse prüft, ob sich btop geöffnet hat, und meldet sonst einen Hinweis mit Details in der Konsole.

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
