<p align="center">
  <img src="assets/icon.svg" alt="ZimaForge" width="140">
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

| Mod               | Beschreibung                                                                                          |
|-------------------|-------------------------------------------------------------------------------------------------------|
| **Forge Pulse**   | Schwebendes Live-Widget mit CPU, RAM, Temperatur, Netzwerk und Laufzeit; verschiebbar und einklappbar |
| **Forge Sparks**  | Aufsteigende Neon-Funken über dem Hintergrund; pausiert im Hintergrund-Tab und respektiert „Bewegung reduzieren“ |
| **ora Polish**    | Pinke Textauswahl, Neon-Scrollbars, cyanfarbene Fokusrahmen und dezente Vignette                      |

Mods aus dem Katalog werden **nicht** automatisch installiert. Du wählst sie im Store aus.

## Installation auf ZimaOS

1. In ZimaOS **App Store → Eigene App installieren → Import** wählen und die [`docker-compose.yml`](docker-compose.yml) einfügen.
2. Installieren. ZimaForge startet auf Port **8077**.
3. Das Dashboard über `http://<ZIMAOS-IP>:8077` öffnen und wie gewohnt bei ZimaOS anmelden.
4. Den Store über das **Sechseck unten rechts** oder mit <kbd>Alt</kbd>+<kbd>⇧</kbd>+<kbd>F</kbd> öffnen.

Alternativ per SSH:

```bash
mkdir -p /DATA/AppData/zimaforge && cd /DATA/AppData/zimaforge
curl -fsSLO https://raw.githubusercontent.com/MarcelRuh/zimaforge/main/docker-compose.yml
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

- **Lesende** Routen (Mod-Liste, Einstellungen, Systemwerte) sind ohne Anmeldung erreichbar, damit Mods beim Start laden können.
- **Schreibende** Routen (installieren, entfernen, aktivieren, Einstellungen speichern) verlangen
  1. den Header `X-ZimaForge: 1`; fremde Seiten lösen damit einen CORS-Preflight aus, den ZimaForge nie erlaubt,
  2. einen zum `Host` passenden `Origin`, falls der Browser einen mitschickt,
  3. einen **gültigen ZimaOS-Sitzungstoken**. ZimaForge prüft ihn bei `/v1/users/current` des Gateways und merkt sich das Ergebnis 60 Sekunden lang als SHA-256-Hash.
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
├── proxy.rs     Reverse-Proxy, HTML-Injection, WebSocket-Tunnel
├── api.rs       /_forge/api, /_forge/runtime, /_forge/mods, /mod (Kompatibilität)
├── auth.rs      Prüfung der ZimaOS-Sitzung und CSRF-Schutz
├── mods.rs      Manifeste, Katalog, atomare Installation, Konfiguration
├── metrics.rs   /proc- und /sys-Auswertung
└── inject.rs    Loader-Tag einfügen
runtime/         Loader und Store (ES-Module, Web Components), ins Binary eingebettet
mods/            mitgelieferter Katalog
```

### Releases

- Push auf `main` erzeugt das Image `ghcr.io/marcelruh/zimaforge:edge`.
- Ein Tag `vX.Y.Z` (passend zu `Cargo.toml`) erzeugt `:X.Y.Z`, `:X.Y` und `:latest` sowie ein GitHub-Release mit den Notizen aus dem [CHANGELOG](CHANGELOG.md).

## Lizenz

[MIT](LICENSE). Die Schrift Orbitron steht unter der [SIL Open Font License](runtime/fonts/OFL.txt). Danksagungen stehen in der [NOTICE](NOTICE).
