# Mods für ZimaForge entwickeln

Ein Mod ist ein Ordner mit JavaScript und/oder CSS, den ZimaForge in das oberste Dokument des ZimaOS-Dashboards lädt. In Micro-Apps (Wujie), Iframes oder Shadow Roots wird **nicht** geladen.

## Aufbau

```text
mein-mod/            ← Ordnername = Mod-ID: a–z, 0–9, „-“, max. 64 Zeichen
├── forge.json
├── mod.js
├── mod.css
└── icon.svg         ← optional, wird im Store angezeigt
```

### `forge.json`

```json
{
  "name": "Mein Mod",
  "version": "1.0.0",
  "description": "Was der Mod tut – ein bis zwei Sätze.",
  "category": "Widgets",
  "authors": [{ "name": "Dein Name", "url": "https://github.com/dein-name" }],
  "origin": { "type": "native", "source": "https://github.com/dein-name/mein-mod" },
  "homepage": "https://github.com/dein-name/mein-mod",
  "tags": ["system", "widget"],
  "icon": "icon.svg",
  "scripts": ["mod.js"],
  "styles": ["mod.css"],
  "module": false,
  "enabled": true
}
```

| Feld       | Pflicht | Bedeutung                                                                 |
|------------|---------|---------------------------------------------------------------------------|
| `name`     | –       | Anzeigename (Vorgabe: Ordnername)                                         |
| `version`  | –       | SemVer. Weicht die Katalogversion ab, zeigt der Store „Update“ an         |
| `scripts`  | –       | relative Pfade, in dieser Reihenfolge geladen                             |
| `styles`   | –       | relative Pfade                                                            |
| `module`   | –       | `true` lädt die Skripte als ES-Module (`import`/`export` möglich)         |
| `enabled`  | –       | `false` liefert den Mod deaktiviert aus                                   |
| `origin.type` | –    | `native`, `adapted` oder `compatible` (für die Store-Kennzeichnung)       |

Pfade dürfen nur `a–z A–Z 0–9 . _ - /` enthalten, nicht mit `/` oder `.` beginnen und kein `..` enthalten.

**Kompatibilität:** Statt `forge.json` funktioniert auch eine `zimamod.json` (ZimaMOD-Format) oder einfach nur `mod.js`/`mod.css` (CasaMOD-Stil).

## JavaScript-API: `window.ZimaForge`

```js
const F = window.ZimaForge;

F.version                         // "0.1.0"
F.assetUrl("mein-mod", "img/a.png")  // URL einer Datei im eigenen Mod-Ordner

await F.getConfig("mein-mod", { farbe: "pink" })  // Einstellungen lesen (öffentlich)
await F.setConfig("mein-mod", { farbe: "cyan" })  // speichern – braucht ZimaOS-Anmeldung

await F.metrics()   // { cpuPercent, cpuCores, memTotal, memAvailable, memPercent,
                    //   load: [1,5,15], uptimeSeconds, temperature, netRxBytes, netTxBytes, timestampMs }

await F.store.list()               // Katalog und installierte Mods
await F.store.active()             // aktive Mods
F.openStore("installed")           // Store öffnen: discover | installed | updates | settings

F.on("config", ({ id, config }) => { /* … */ })   // Ereignisse: ready, change, config
```

Schreibende Aufrufe werfen bei fehlender oder abgelaufener Anmeldung einen `ZimaForge.ForgeError` mit `status` 401 und einer verständlichen deutschen Meldung.

Für ältere Mods gibt es zusätzlich `window.ZimaMOD` mit `assetUrl`, `getConfig`, `setConfig`, `getSystemMetrics`, `listStore`, `installMod` und `uninstallMod`.

## Gute Praxis

- **Doppelt laden verhindern:** Am Anfang prüfen, ob dein Element schon existiert.
- **Nicht auf Dashboard-Klassen verlassen:** ZimaOS ändert sein DOM zwischen Versionen. Eigene, fixierte Elemente (`position: fixed`) sind am robustesten.
- **Präfix für CSS-Klassen**, zum Beispiel `.mein-mod-…`, damit nichts kollidiert.
- **Rücksicht nehmen:** Bei `document.hidden` pausieren und `prefers-reduced-motion` respektieren.
- **z-index** unter `2147483000` halten. Darüber liegen Launcher und Store.
- **Keine Geheimnisse** in `config` speichern. Einstellungen sind ohne Anmeldung lesbar.

## Testen

1. Den Ordner nach `/DATA/AppData/zimaforge/mods/<id>/` kopieren (lokal: `dev-data/data/mods/<id>/`).
2. Das Dashboard neu laden. Der Mod erscheint im Store unter „Installiert“ mit dem Hinweis „Lokal“.

## In den Katalog aufnehmen

Pull Request mit dem Ordner unter `mods/<id>/`. Der Test `tests/catalog.rs` verlangt `forge.json`, Beschreibung, SemVer, Icon, Autor und alle referenzierten Dateien.
