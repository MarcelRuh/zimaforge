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

F.version                         // laufende ZimaForge-Version, z. B. "0.5.0"
F.assetUrl("mein-mod", "img/a.png")  // URL einer Datei im eigenen Mod-Ordner
F.runtimeUrl("logo.png")          // Datei der ZimaForge-Laufzeit (versioniert)
F.sessionToken()                  // ZimaOS-Sitzungstoken oder ""
await F.session()                 // wirft ForgeError, wenn nicht angemeldet

await F.getConfig("mein-mod", { farbe: "pink" })  // Einstellungen lesen – braucht ZimaOS-Anmeldung
await F.setConfig("mein-mod", { farbe: "cyan" })  // speichern – braucht ZimaOS-Administrator

await F.metrics()   // { cpuPercent, cpuCores, memTotal, memAvailable, memPercent, powerWatts,
                    //   load: [1,5,15], uptimeSeconds, temperature, netRxBytes, netTxBytes, timestampMs }

await F.store.list()               // Katalog und installierte Mods
await F.store.active()             // aktive Mods
await F.store.install(id) / F.store.uninstall(id) / F.store.setEnabled(id, true)  // nur Administratoren
F.openStore("installed")           // Store öffnen: discover | installed | updates | settings

F.on("config", ({ id, config }) => { /* … */ })   // Ereignisse: ready, change, config, dashboard

// Widget-Spalte von ZimaOS (Uhr, System, Storage, Network …)
F.dashboard.mountWidget(el, { after: "system" })  // einhängen und dort halten; gibt unmount() zurück
F.dashboard.mountWidget(el, { before: "clock", pin: true })  // immer direkt über der Uhr
F.dashboard.mountWidget(el, { after: ["clock", "system"], pin: true })  // unter der Uhr, sonst unter System
F.dashboard.mountWidget(el, { position: "end" })  // ganz unten (ohne Anker)
F.dashboard.widgetColumn()        // Spalten-Element oder null
F.dashboard.nativeWidget("storage")  // natives Widget-Element: "clock", "system", "storage", "network"
F.dashboard.widgets()             // alle direkten Kinder der Spalte (native und eingehängte)
F.dashboard.watch(fn)             // fn({ column, changed }) bei jedem Umbau aufrufen; gibt Abmeldung zurück
F.dashboard.ignore(el)            // el gehört zu deinem Mod: wird bei der Widget-Suche übersprungen

// Effekte (Schnee, Funken …): klick-durchlässige Ebene über dem Dashboard,
// automatisch ausgeblendet, solange ein ZimaOS-Fenster (App Store …) offen ist.
// Liegt bewusst ganz oben (z-index 2147480000) und blendet sich selbst aus.
F.effects.layer(canvas)
canvas.addEventListener("zimaforge:visibility", (e) => e.detail.hidden ? stop() : start())
F.effects.hidden(canvas)          // true, solange verdeckt oder der Tab im Hintergrund ist
F.effects.reducedMotion()         // true bei „Bewegung reduzieren“ – dann ruhiger animieren
```

Schreibende Aufrufe werfen bei fehlender oder abgelaufener Anmeldung einen `ZimaForge.ForgeError` mit `status` 401, ohne Administratorrechte mit `status` 403 – jeweils mit einer verständlichen deutschen Meldung.

`getConfig` liefert ohne Anmeldung (z. B. auf der Anmeldeseite) den Standardwert. Beim Start holt der Loader alle Einstellungen mit einer Anfrage; der erste `getConfig`-Aufruf je Mod wird daraus bedient, jeder weitere fragt den Server.

Für ältere Mods gibt es zusätzlich `window.ZimaMOD` mit `assetUrl`, `getConfig`, `setConfig`, `getSystemMetrics`, `listStore`, `installMod` und `uninstallMod`.

## Gute Praxis

- **Doppelt laden verhindern:** Am Anfang prüfen, ob dein Element schon existiert.
- **Nicht auf Dashboard-Klassen verlassen:** ZimaOS ändert sein DOM zwischen Versionen. Eigene, fixierte Elemente (`position: fixed`) sind am robustesten.
- **Präfix für CSS-Klassen**, zum Beispiel `.mein-mod-…`, damit nichts kollidiert.
- **Rücksicht nehmen:** Bei `document.hidden` und bei verdeckter Effekt-Ebene (`zimaforge:visibility`) pausieren; nicht abfragen, solange dein Widget unsichtbar ist; bei `F.effects.reducedMotion()` ruhiger animieren (weniger, langsamer) statt ganz abzuschalten – sonst wirkt der Mod für viele Windows-Nutzer kaputt.
- **z-index niedrig halten** (unter 100), damit Fenster von ZimaOS wie der App Store darüber liegen. Widgets am besten in die Widget-Spalte einhängen (siehe Forge Pulse). Ausnahme ist `F.effects.layer`, die sich selbst ausblendet.
- **Möglichst keine Geheimnisse** in `config`: Einstellungen sind für jeden angemeldeten ZimaOS-Benutzer lesbar (nicht aber ohne Anmeldung).

## Testen

1. Den Ordner nach `/DATA/AppData/zimaforge/mods/<id>/` kopieren (lokal: `dev-data/data/mods/<id>/`).
2. Das Dashboard neu laden. Der Mod erscheint im Store unter „Installiert“ mit dem Hinweis „Lokal“.

## In den Katalog aufnehmen

Pull Request mit dem Ordner unter `mods/<id>/`. Der Test `tests/catalog.rs` verlangt `forge.json`, Beschreibung, SemVer, Icon, Autor und alle referenzierten Dateien.
