# Changelog

Alle nennenswerten Änderungen an ZimaForge. Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionierung nach [SemVer](https://semver.org/lang/de/).

## [0.5.0] – 2026-11-17

Durchsicht des gesamten Projekts.

### Sicherheit
- Mods installieren, entfernen, umschalten und Einstellungen speichern dürfen nur noch ZimaOS-Administratoren (Rolle aus `/v1/users/current`).
- Mod-Einstellungen sind nur noch mit gültiger ZimaOS-Sitzung lesbar und stehen nicht mehr in der ausgelieferten Seite (also auch nicht auf der Anmeldeseite). Der Loader holt sie angemeldet mit **einer** Anfrage (`/_forge/api/config`).
- Einstellungen lassen sich nur für ZimaForge selbst und installierte Mods anlegen.
- `X-Forwarded-For` wird ersetzt statt ergänzt; ein mitgeschickter Wert kann ZimaOS nichts vortäuschen.
- Docker: `no-new-privileges` und nicht benötigte Capabilities entfernt (Compose-Dateien).

### Behoben
- Downloads, Videos und Archive aus ZimaOS wurden unterwegs neu komprimiert (CPU-Last, keine Größenangabe, kein Fortsetzen). Komprimiert wird jetzt nur Text.
- HEAD-Anfragen und per `fetch` geladene HTML-Dateien (z. B. Dateivorschau) bekamen den Loader eingefügt; sehr große HTML-Dateien endeten mit 502.
- Healthcheck beachtet `ZIMAFORGE_BIND` und hat eine Zeitgrenze.
- Store: Fokus bleibt nach Klicks auf dem Bedienelement; Scrollsperre wird beim Schließen sicher gelöst; der aktuelle Bereich wird Screenreadern richtig gemeldet; ältere Antworten überschreiben keine neueren; Update-Prüfung respektiert die Einstellung auch beim direkten Öffnen und fragt GitHub nach einem Fehler 15 Minuten nicht erneut.
- Zwei angeheftete Widgets mit demselben Anker verdrängten einander endlos.
- Widget-Reihenfolge 1.1.1: Das gezogene Widget sprang während langsamen Ziehens zurück.
- Forge Wetter 1.1.2: Die Ortssuche wurde von der Aktualisierung überschrieben; kein doppelter Abruf beim Speichern; nach Rückkehr in den Tab wird veraltetes Wetter nachgeladen; gespeicherte Orte werden geprüft.
- Forge Pulse 2.5.5: kein „NaN %“ bei leeren Datenträgern; ☰ startet btop nicht doppelt; keine Abfragen, solange die Karte unsichtbar ist.
- Emoji-Spur 1.1.1 läuft auch in Browsern ohne `Intl.Segmenter`.

### Verbessert
- Forge Schnee 1.1.1 zeichnet vorgerenderte Flocken statt teurem Schatten pro Flocke. Schnee und Forge Sparks 1.1.1 pausieren, solange ein ZimaOS-Fenster sie verdeckt (neues Ereignis `zimaforge:visibility`, `F.effects.hidden()`).
- Weniger Arbeit pro Seitenaufruf: Startdaten werden 5 s zwischengespeichert (bei Änderungen sofort erneuert); gleichzeitige Abrufe von `/metrics` und `/system` teilen sich eine Messung; versionierte Dateien werden nicht mehr bei jedem Abruf gehasht.
- Ohne Widget-Spalte (Anmeldeseite) sucht der Loader seltener und ignoriert Änderungen in Mod-Elementen.
- Einstellungen werden beim Schreiben mit `fsync` gesichert; eine beschädigte `state.json` wird protokolliert.
- Release: läuft nur für Tags auf `main`, prüft Format, Clippy und CHANGELOG, testet das veröffentlichte Image vor `latest`; korrekte OCI-Labels; Dependabot für Actions und Cargo.
- Dokumentation: Mod-API in `docs/MODS.md` vollständig, Vorlage hält sich an die eigenen Regeln, README verweist auf die Compose-Dateien im Release.

## [0.4.0] – 2026-11-17

### Verbessert
- Schnellerer Start: ZimaForge liefert die aktiven Mods und ihre Einstellungen direkt mit der Dashboard-Seite aus. Dadurch entfallen beim Laden die Abfrage der Mod-Liste und eine Abfrage je Mod-Einstellung. Mod-Dateien und Store laden per Preload parallel zu ZimaOS.
- Forge Pulse 2.5.4: Die Ringanzeigen erscheinen sofort und warten nicht mehr auf die Prozessliste. Die App-Namen bremsen die Anzeige höchstens 0,7 Sekunden.
- Weniger Last auf dem Server: Die Prozessliste liest je Prozess nur noch eine Datei statt drei. Die Container-Zuordnung wird je Prozess gemerkt.

## [0.3.9] – 2026-11-17

### Behoben
- Forge Pulse 2.5.3: Im CPU- und RAM-Reiter stand zeitweise nur „Sonstige Container“. Schlug das Laden der ZimaOS-App-Liste einmal fehl oder bekam eine App nach einem Neustart eine neue Container-ID, blieb die Zuordnung bis zu 5 Minuten leer. Jetzt lädt Pulse dann nach spätestens 15 Sekunden neu und behält bekannte Zuordnungen. Nicht zuordenbare Container erscheinen einzeln statt als Sammeleintrag.

## [0.3.8] – 2026-11-17

### Behoben
- Forge Pulse 2.5.2: Mit beim letzten Mal aufgeklapptem Detailbereich schlug die erste Aktualisierung fehl („Cannot access 'busy' before initialization“).
- Widgets ohne gefundene Widget-Spalte (z. B. auf der ZimaOS-Anmeldeseite) erscheinen nur noch schwebend, wenn eine ZimaOS-Sitzung besteht.

## [0.3.7] – 2026-11-17

### Behoben
- Forge Schnee, Forge Sparks und Emoji-Spur blieben unsichtbar, wenn das System „Bewegung reduzieren“ meldet (z. B. Windows mit ausgeschalteten Animationseffekten) oder ZimaOS sie überdeckte. Sie laufen jetzt in diesem Fall ruhiger statt gar nicht und liegen auf einer eigenen Ebene über dem Dashboard.

### Neu
- `ZimaForge.effects`: klick-durchlässige Effekt-Ebene über dem Dashboard, die sich ausblendet, solange ein ZimaOS-Fenster (App Store, Dialoge) offen ist; `reducedMotion()` für ruhigere Animationen.
- Emoji-Spur hört Mausbewegungen in der Capture-Phase, damit ZimaOS sie nicht abfängt.

## [0.3.6] – 2026-11-16

### Behoben
- Ungleiche Abstände in der Widget-Spalte: Eingehängte Widgets (Pulse, Wetter) übernehmen jetzt die berechneten Abstände der nativen ZimaOS-Widgets statt eines festen Werts. Funktioniert mit `margin`, `gap` und Geschwister-Regeln (im Mock alle drei geprüft).

## [0.3.5] – 2026-11-16

### Neu
- Widgets lassen sich an die Uhr heften: `mountWidget(el, { before | after: "clock", pin: true })`. Die Uhr erkennt ZimaForge an der angezeigten Uhrzeit.
- Forge Pulse 2.5 sitzt immer direkt unter der Uhr, Forge Wetter 1.1 immer direkt darüber.
- Widget-Reihenfolge 1.1 lässt angeheftete Widgets an ihrem Anker (kein Griff, nicht Teil der gespeicherten Reihenfolge).

## [0.3.4] – 2026-11-16

### Behoben
- App-Icon in ZimaOS fehlte bei Installationen aus der Compose-Datei von v0.1.x (`assets/icon.svg` war mit dem neuen Logo entfernt worden). Die Datei ist zurück und enthält das neue Logo.

### Geändert
- Forge Pulse 2.4.2: Der RAM-Tab zeigt den Verbrauch je App in MB/GB statt in Prozent (Prozent im Tooltip).

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
