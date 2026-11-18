<p align="center">
  <img src="assets/logo.png" alt="ZimaForge – ZimaOS Toolkit" width="360">
</p>

<h1 align="center">ZimaForge</h1>

<p align="center"><b>Mods für dein ZimaOS-Dashboard</b>: ein einzelnes Rust-Binary, eingebauter Mod-Store, ZimaMOD-kompatibel.</p>

ZimaForge sitzt als Reverse-Proxy vor dem ZimaOS-Dashboard, schleust einen kleinen Loader ein und lädt JavaScript- und CSS-Mods. Installieren, aktivieren und konfigurieren läuft über einen Store direkt im Dashboard, gestaltet im **ora-Design** von [Proxora](https://github.com/MarcelRuh/proxora) und [Remora](https://github.com/MarcelRuh/remora).

> **Unabhängiges Community-Projekt.** ZimaForge ist nicht mit ZimaOS, IceWhale, CasaOS, CasaMOD oder ZimaMOD verbunden. Mods laufen mit deiner ZimaOS-Sitzung im Browser. Installiere nur Mods, deren Quelle du vertraust. Nutzung auf eigenes Risiko.

## Was ZimaForge anders macht

|                           | ZimaForge                                                                  |
|---------------------------|----------------------------------------------------------------------------|
| **Laufzeit**              | Ein statisches Rust-Binary (axum/hyper/tokio) in einem leeren `scratch`-Image, ohne Node, Nginx oder Shell |
| **Container**             | **einer** statt zwei, ein Port                                             |
| **Schreibschutz**         | die **ZimaOS-Anmeldung selbst**, kein API-Schlüssel zum Kopieren; dazu CSRF-Header und Origin-Prüfung |
| **Oberfläche**            | Web Components mit Shadow DOM, dadurch keine CSS-Konflikte mit dem Dashboard; nativer `<dialog>` |
| **Kompatibilität**        | lädt `forge.json`-, `zimamod.json`- und reine `mod.js`/`mod.css`-Mods; stellt `window.ZimaMOD` bereit |
| **Installation von Mods** | atomar (Staging-Ordner, dann Umbenennen); Updates aus dem Katalog mit einem Klick |
| **Architekturen**         | `linux/amd64` und `linux/arm64`, nativ gebaut, mit SBOM und Provenance     |

## Mitgelieferte Mods

| Mod                     | Beschreibung                                                                                          |
|-------------------------|-------------------------------------------------------------------------------------------------------|
| **Forge Pulse**         | System-Widget im Aufbau des ZimaOS-System-Widgets: Ringanzeigen für CPU und RAM, **Leistung in Watt**, Temperatur, RAM-Größe; aufklappbar mit Apps, Datenträgern, Netzwerk und Prozessen, ☰ öffnet btop |
| **Forge Wetter**        | Wetter-Widget mit aktueller Lage und 4-Tage-Vorschau (Open-Meteo, ohne API-Schlüssel), Ort per Suche  |
| **Widget-Reihenfolge**  | Widgets der ZimaOS-Spalte per Griff (oder Pfeiltasten) umsortieren; Reihenfolge bleibt gespeichert    |
| **ora Widgets**         | Neon-Rahmen und Glas-Look für die nativen ZimaOS-Widgets                                              |
| **ora Polish**          | Pinke Textauswahl, Neon-Scrollbars, cyanfarbene Fokusrahmen und dezente Vignette                      |
| **Tab-Titel**           | Zeigt Server und Netz im Browser-Tab, z. B. „ZimaOS · nas (LAN)“                                      |
| **Discord-Updates**     | Meldet App-Updates aus dem ZimaOS App Store als Embed in einen Discord-Kanal (Webhook), jedes Update nur einmal. Prüft, solange ein Dashboard offen ist |
| **Forge Sparks**        | Aufsteigende Neon-Funken über dem Dashboard                                                           |
| **Forge Schnee**        | Fallender Schnee mit leichtem Neon-Schimmer                                                           |
| **Emoji-Spur**          | Emoji-Spur hinter Maus und Finger, Emojis frei wählbar                                                |

Widgets hängen sich in die **Widget-Spalte von ZimaOS** ein. Damit liegen Fenster wie der App Store automatisch darüber. Effekte (Schnee, Funken, Emoji-Spur) liegen über dem Dashboard, blenden sich bei offenen ZimaOS-Fenstern aus, pausieren im Hintergrund-Tab und laufen bei „Bewegung reduzieren“ ruhiger.

**Watt-Anzeige:** Die Leistung kommt aus dem RAPL-Energiezähler des Prozessors (`/sys/class/powercap/intel-rapl:*`, Intel und aktuelle AMD-Kernel). Sie misst die CPU-Pakete, nicht das ganze Gerät an der Steckdose. Gibt es keinen Zähler, zeigt Pulse nur die Temperatur.

**App-Verbrauch in Forge Pulse:** ZimaForge ordnet Prozesse über die cgroups ihren Docker-Containern zu. Pulse fragt bei der ZimaOS-App-Verwaltung nach, welcher Container zu welcher App gehört, und zeigt die Apps mit Titel und Icon wie das System-Widget. Der optionale Docker-Block in der Compose-Datei wird dafür nicht gebraucht; er liefert nur Namen für Container, die keine ZimaOS-App sind.

Mods aus dem Katalog werden **nicht** automatisch installiert. Du wählst sie im Store aus.

## Installation auf ZimaOS

### Per Docker-Compose-Import (empfohlen, ohne SSH)

1. In ZimaOS den **App Store** öffnen und oben rechts **„+“ → Benutzerdefinierte App installieren** wählen.
2. Im Dialog oben rechts auf **Import** klicken und **Docker Compose** wählen.
3. Die Compose-Datei angeben, auf einem von zwei Wegen:
   - **Einfügen:** den YAML-Block aus den Notizen des [neuesten Releases](https://github.com/MarcelRuh/zimaforge/releases/latest) kopieren (Kopier-Symbol oben rechts am Block) und in das Textfeld einfügen.
   - **Hochladen:** [`zimaforge-docker-compose.yml`](https://github.com/MarcelRuh/zimaforge/releases/latest/download/zimaforge-docker-compose.yml) aus dem neuesten Release herunterladen und auswählen.

   Nimm die Compose-Datei aus dem Release, nicht aus dem `main`-Zweig: Dort kann schon eine Version stehen, deren Image noch nicht veröffentlicht ist.
4. Mit **Absenden** bzw. **Importieren** bestätigen. Das Formular füllt sich von selbst. Prüfe kurz: Bildname `ghcr.io/marcelruh/zimaforge`, **Netzwerktyp `host`** (nicht *bridge*), Port **8077**.
5. Unten rechts auf **Installieren** klicken.
6. Die Kachel *ZimaForge* öffnen und wie gewohnt bei ZimaOS anmelden. Der Store öffnet sich automatisch. Später erreichst du ihn über das **Sechseck unten rechts** oder mit <kbd>Alt</kbd>+<kbd>⇧</kbd>+<kbd>F</kbd>.

### Mods direkt auf dem Standardport

Damit die Mods unter der normalen Adresse `http://<ZIMAOS-IP>/` erscheinen, tauschen ZimaForge und ZimaOS die Ports:

1. In ZimaOS unter **Einstellungen** den Dashboard-Port auf **8081** stellen.
2. Statt `zimaforge-docker-compose.yml` die Datei [`zimaforge-docker-compose-standardport.yml`](https://github.com/MarcelRuh/zimaforge/releases/latest/download/zimaforge-docker-compose-standardport.yml) aus dem neuesten Release importieren (`ZIMAFORGE_PORT: "80"`, `ZIMAFORGE_UPSTREAM: http://127.0.0.1:8081`). Der Hinweis zum Port 8081 erscheint auch vor der Installation in ZimaOS.
3. `http://<ZIMAOS-IP>/` öffnen: Das ist jetzt dein Dashboard mit Mods.

Läuft ZimaForge einmal nicht, ist das Dashboard weiter direkt unter `:8081` erreichbar.

### Per SSH

```bash
mkdir -p /DATA/AppData/zimaforge && cd /DATA/AppData/zimaforge
curl -fsSL -o docker-compose.yml https://github.com/MarcelRuh/zimaforge/releases/latest/download/zimaforge-docker-compose.yml
docker compose up -d
```

Das ursprüngliche Dashboard auf Port 80 bleibt unverändert. ZimaForge verändert nichts am System, sondern liegt nur davor.

### Konfiguration

| Variable              | Vorgabe                  | Bedeutung                                   |
|-----------------------|--------------------------|---------------------------------------------|
| `ZIMAFORGE_PORT`      | `8077`                   | Port des gemoddeten Dashboards              |
| `ZIMAFORGE_BIND`      | `0.0.0.0`                | Bind-Adresse (`::` für IPv6)                |
| `ZIMAFORGE_UPSTREAM`  | `http://127.0.0.1:80`    | ZimaOS-Gateway                              |
| `ZIMAFORGE_DATA`      | `/data`                  | installierte Mods, Einstellungen, Status    |
| `ZIMAFORGE_CATALOG`   | `/opt/zimaforge/catalog` | mitgelieferter Katalog (im Image)           |
| `ZIMAFORGE_PROC`/`_SYS` | `/host/proc`, `/host/sys` | Host-Systemwerte für Forge Pulse         |
| `ZIMAFORGE_DOCKER`    | `/host/docker/containers` | optional: Docker-Metadaten für App-Namen in Forge Pulse (siehe oben) |
| `ZIMAFORGE_LOG`       | `info`                   | Log-Level (`debug`, `zimaforge=trace` …)    |

### Datenablage

```text
/DATA/AppData/zimaforge/
├── mods/<id>/        installierte Mods (eigene Mods einfach hier ablegen)
├── config/<id>.json  Einstellungen je Mod
└── state.json        deaktivierte Mods
```

Zum **Deinstallieren** die App in ZimaOS entfernen und optional `/DATA/AppData/zimaforge` löschen.

## Sicherheit

- **Lesende** Routen für Mod-Liste und Systemwerte sind ohne Anmeldung erreichbar, damit Mods beim Start laden können. **Einstellungen** der Mods (z. B. der Wetter-Ort) gibt es nur mit gültiger ZimaOS-Sitzung; sie stehen auch nicht in der ausgelieferten Seite.
- **Schreibende** Routen (installieren, entfernen, aktivieren, Einstellungen speichern) verlangen
  1. den Header `X-ZimaForge: 1`; fremde Seiten lösen damit einen CORS-Preflight aus, den ZimaForge nie erlaubt,
  2. einen zum `Host` passenden `Origin`, falls der Browser einen mitschickt,
  3. einen **gültigen ZimaOS-Sitzungstoken eines Administrators**. ZimaForge prüft ihn bei `/v1/users/current` des Gateways und merkt sich das Ergebnis 60 Sekunden lang als SHA-256-Hash. Meldet ZimaOS eine andere Rolle als `admin`, lehnt ZimaForge ab – Mods laufen im Browser jedes Benutzers.
- Einstellungen lassen sich nur für ZimaForge selbst und installierte Mods speichern.
- Downloads, Videos und Archive aus ZimaOS reicht ZimaForge unverändert durch; komprimiert wird nur Text.
- Mod-IDs und Dateipfade werden streng geprüft (kein `..`, keine versteckten Dateien, keine Symlinks beim Kopieren).
- Standardmäßig läuft die Verbindung über HTTP im LAN. Für fremde Netze gehört ZimaForge hinter HTTPS, zum Beispiel hinter [Proxora](https://github.com/MarcelRuh/proxora).
- Mods selbst sind **nicht** abgeschottet. Sie laufen im Dashboard-Ursprung mit deiner Sitzung.

## Eigene Mods

Siehe **[docs/MODS.md](docs/MODS.md)**. Kurzfassung:

```text
mods/mein-mod/
├── forge.json   { "name": "Mein Mod", "version": "1.0.0", "scripts": ["mod.js"], "styles": ["mod.css"] }
├── mod.js       window.ZimaForge.getConfig / setConfig / metrics / store …
└── mod.css
```

Eine Vorlage liegt in [`examples/mod-template`](examples/mod-template).

## Entwicklung

Voraussetzungen: Rust ≥ 1.89 (Edition 2024), Node ≥ 20 (nur für das Mock-Gateway).

```bash
cargo test                      # Unit- und Ende-zu-Ende-Tests (inkl. WebSocket-Tunnel)
node dev/mock-zimaos.mjs        # simuliertes ZimaOS auf :8081 mit lebenden /proc-Werten
```

```bash
ZIMAFORGE_UPSTREAM=http://127.0.0.1:8081 ZIMAFORGE_DATA=dev-data/data ZIMAFORGE_CATALOG=mods \
ZIMAFORGE_PROC=dev-data/proc ZIMAFORGE_SYS=dev-data/sys cargo run
```

Danach `http://127.0.0.1:8077` öffnen und unten links „Anmelden (Mock)“ klicken. Im Debug-Build liest ZimaForge `runtime/` bei jedem Abruf neu von der Platte, sodass Änderungen an Loader und Store ohne Neustart sichtbar werden.

### Aufbau

```text
src/
├── main.rs      Start, Signale, Healthcheck-Modus
├── lib.rs       Router, Module und Versionsnummer
├── config.rs    Konfiguration aus Umgebungsvariablen
├── state.rs     gemeinsamer Zustand aller Handler
├── proxy.rs     Reverse-Proxy, HTML-Injection, WebSocket-Tunnel
├── inject.rs    Loader-Tag einfügen
├── boot.rs      Startdaten und Preloads in der Dashboard-Seite
├── api.rs       /_forge/api, /_forge/runtime, /_forge/mods, /_forge/catalog, /mod (Kompatibilität)
├── auth.rs      Prüfung der ZimaOS-Sitzung und CSRF-Schutz
├── mods.rs      Manifeste, Katalog, atomare Installation, Konfiguration
├── metrics.rs   /proc- und /sys-Auswertung
└── sysinfo.rs   Prozesse, Apps und Temperaturen für Forge Pulse
runtime/         Loader und Store (ES-Module, Web Components), ins Binary eingebettet
mods/            mitgelieferter Katalog
```

### Releases

- Push auf `main` erzeugt das Image `ghcr.io/marcelruh/zimaforge:edge`.
- Ein Tag `vX.Y.Z` (passend zu `Cargo.toml`) erzeugt `:X.Y.Z`, `:X.Y` und `:latest` sowie ein GitHub-Release mit den Notizen aus dem [CHANGELOG](CHANGELOG.md).

## Lizenz

[MIT](LICENSE). Die Schrift Orbitron steht unter der [SIL Open Font License](runtime/fonts/OFL.txt). Danksagungen stehen in der [NOTICE](NOTICE).
