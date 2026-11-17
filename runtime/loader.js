// ZimaForge Loader – wird als ES-Modul in das ZimaOS-Dashboard eingeschleust.
// Stellt window.ZimaForge (und window.ZimaMOD zur Kompatibilität) bereit,
// lädt die aktiven Mods und den Store.

const VERSION = new URL(import.meta.url).searchParams.get("v") || "dev";
const BASE = "/_forge";
const API = `${BASE}/api`;

const skip =
  window.top !== window ||
  window.__POWERED_BY_WUJIE__ ||
  document.documentElement.dataset.zimaforge === "loaded";

/** Sitzungstoken des ZimaOS-Dashboards (Vue 2/3 Store, sonst localStorage). */
function sessionToken() {
  const app = document.querySelector("#app");
  const candidates = [
    () => app?.__vue__?.$store?.state?.access_token,
    () => app?.__vue_app__?.config?.globalProperties?.$store?.state?.access_token,
    () => localStorage.getItem("access_token"),
  ];
  for (const read of candidates) {
    try {
      const token = read();
      if (typeof token === "string" && token.trim()) return token.trim();
    } catch { /* nächste Quelle */ }
  }
  return "";
}

class ForgeError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ForgeError";
    this.status = status;
  }
}

/**
 * Anfrage an die ZimaForge-API. `write`: schreibend (Sitzung Pflicht, CSRF-Header);
 * `auth`: lesend mit Sitzung, falls vorhanden (z. B. Einstellungen).
 */
async function request(path, { method = "GET", body, write = false, auth = false } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = write || auth ? sessionToken() : "";
  if (write) {
    if (!token) throw new ForgeError("Bitte zuerst bei ZimaOS anmelden.", 401);
    headers["X-ZimaForge"] = "1";
  }
  if (token) headers.Authorization = token;
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
    cache: "no-store",
  });
  let data = null;
  try { data = await response.json(); } catch { /* leerer Body */ }
  if (!response.ok) {
    const message =
      response.status === 401 ? "ZimaOS-Anmeldung abgelaufen – bitte neu anmelden." :
      response.status === 403 ? (data?.error === "nur für ZimaOS-Administratoren"
        ? "Nur ZimaOS-Administratoren dürfen Mods verwalten."
        : "Anfrage abgelehnt (Sicherheitsprüfung).") :
      data?.error || `Fehler ${response.status}`;
    throw new ForgeError(message, response.status);
  }
  // z. B. eine HTML-Fehlerseite eines vorgeschalteten Proxys statt JSON
  if (data === null || typeof data !== "object") {
    throw new ForgeError("Unerwartete Antwort von ZimaForge.", response.status);
  }
  return data;
}

const listeners = new Map();
function emit(event, detail) {
  for (const fn of listeners.get(event) ?? []) {
    try { fn(detail); } catch (err) { console.error("[ZimaForge]", err); }
  }
}

const id = (modId) => encodeURIComponent(modId);

// Vom Server mit der Seite gelieferte Startdaten (aktive Mods): spart beim Laden
// die Wartezeit auf /mods.
const bootData = (() => {
  try {
    const data = JSON.parse(document.getElementById("zimaforge-boot")?.textContent || "null");
    return data && data.version === VERSION ? data : null;
  } catch { return null; }
})();

// Alle Einstellungen mit einer angemeldeten Anfrage, sobald der Loader startet –
// parallel zum Laden der Mod-Dateien. Jede wird einmal daraus bedient, danach
// (oder nach setConfig) frisch vom Server.
let bootConfig = null;
function prefetchConfig() {
  if (!sessionToken()) return Promise.resolve(new Map());
  bootConfig ??= request("/config", { auth: true })
    .then((r) => new Map(Object.entries(r.config ?? {})))
    .catch(() => new Map());
  return bootConfig;
}

async function fetchConfig(modId) {
  // Ein kurzer Netzaussetzer soll nicht als „keine Einstellungen“ gelten – sonst
  // überschreibt der Mod beim nächsten Speichern die gespeicherten Werte.
  for (let attempt = 0; ; attempt++) {
    try { return (await request(`/config/${id(modId)}`, { auth: true })).config; }
    catch (err) {
      if (attempt >= 1 || err.status === 401 || err.status === 404) throw err;
      await new Promise((r) => setTimeout(r, 600));
    }
  }
}

const ZimaForge = Object.freeze({
  version: VERSION,
  platform: "zimaos",
  ForgeError,
  assetUrl: (modId, rel) => `${BASE}/mods/${id(modId)}/${String(rel).replace(/^\/+/, "")}`,
  runtimeUrl: (rel) => `${BASE}/runtime/${rel}?v=${encodeURIComponent(VERSION)}`,
  sessionToken,
  async getConfig(modId, fallback = null) {
    const prefetched = await prefetchConfig();
    if (prefetched.has(modId)) {
      const value = prefetched.get(modId);
      prefetched.delete(modId);
      return value ?? fallback;
    }
    try { return (await fetchConfig(modId)) ?? fallback; }
    catch { return fallback; }
  },
  async setConfig(modId, config) {
    (await prefetchConfig()).delete(modId);
    const result = await request(`/config/${id(modId)}`, { method: "PUT", body: config, write: true });
    emit("config", { id: modId, config: result.config });
    return result.config;
  },
  metrics: () => request("/metrics", { auth: true }),
  session: () => request("/session", { write: true }),
  store: Object.freeze({
    list: async () => (await request("/store")).mods ?? [],
    active: async () => (await request("/mods")).mods ?? [],
    async install(modId) {
      const r = await request(`/store/${id(modId)}`, { method: "POST", write: true });
      emit("change", { id: modId, action: "install" });
      return r;
    },
    async uninstall(modId) {
      const r = await request(`/store/${id(modId)}`, { method: "DELETE", write: true });
      emit("change", { id: modId, action: "uninstall" });
      return r;
    },
    async setEnabled(modId, enabled) {
      const r = await request(`/mods/${id(modId)}/enabled`, { method: "PUT", body: { enabled }, write: true });
      emit("change", { id: modId, action: enabled ? "enable" : "disable" });
      return r;
    },
  }),
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event)?.delete(fn);
  },
  async openStore(view) {
    await import(`./store.js?v=${encodeURIComponent(VERSION)}`);
    document.querySelector("zimaforge-store")?.open(view);
  },
  dashboard: createDashboard(),
  effects: createEffects(),
});

/**
 * Hilfen für die Widget-Spalte des ZimaOS-Dashboards (links: Uhr, System,
 * Storage, Network …). Mods hängen ihre Karten hier ein, statt sie schwebend
 * über das Dashboard zu legen – dann liegen ZimaOS-Fenster automatisch darüber.
 */

/**
 * Gemeinsame Ebene für Effekt-Mods (Schnee, Funken, Emoji-Spur): liegt über dem
 * Dashboard, lässt alle Klicks durch und blendet sich aus, solange ein ZimaOS-Fenster
 * (App Store, Einstellungen, Dialoge) offen ist.
 */
function createEffects() {
  const DIALOGS = '[aria-modal="true"], [role="dialog"], .modal.is-active, .el-dialog__wrapper, .v-modal';
  const layers = new Set();
  let timer = null;

  // Nur Fenster, die einen großen Teil des Bildschirms bedecken – kleine, dauerhaft
  // sichtbare Panels mit role="dialog" sollen die Effekte nicht abschalten.
  const dialogOpen = () => {
    const screen = innerWidth * innerHeight;
    for (const el of document.querySelectorAll(DIALOGS)) {
      if (el.closest("zimaforge-store, zimaforge-launcher")) continue;
      const r = el.getBoundingClientRect();
      if (r.width * r.height < screen * 0.2) continue;
      if (getComputedStyle(el).visibility !== "hidden") return true;
    }
    return false;
  };

  const check = () => {
    if (document.hidden) return; // Hintergrund-Tab: nichts prüfen
    const hide = dialogOpen();
    for (const l of layers) {
      if (!l.isConnected) { layers.delete(l); continue; }
      const was = l.style.visibility === "hidden";
      if (was === hide) continue;
      l.style.visibility = hide ? "hidden" : "";
      // Mods können darauf ihre Animation anhalten (Ereignis „zimaforge:visibility“).
      l.dispatchEvent(new CustomEvent("zimaforge:visibility", { detail: { hidden: hide } }));
    }
    if (!layers.size) { clearInterval(timer); timer = null; }
  };

  return Object.freeze({
    /** Nutzer hat „Bewegung reduzieren“ eingestellt – Effekte dann ruhiger laufen lassen. */
    reducedMotion: () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    /**
     * Macht `el` (Canvas oder Container) zur klick-durchlässigen Effekt-Ebene über dem
     * Dashboard. Solange ein ZimaOS-Fenster offen ist, ist sie ausgeblendet; dann und
     * beim Wiedereinblenden feuert `el` das Ereignis `zimaforge:visibility`
     * (`event.detail.hidden`). `F.effects.hidden(el)` fragt den Zustand ab.
     */
    hidden: (el) => el.style.visibility === "hidden" || document.hidden,
    layer(el) {
      Object.assign(el.style, {
        position: "fixed", inset: "0", width: "100vw", height: "100vh",
        pointerEvents: "none", zIndex: "2147480000",
      });
      el.setAttribute("aria-hidden", "true");
      if (!el.isConnected) document.body.append(el);
      layers.add(el);
      if (!timer) timer = setInterval(check, 600);
      check();
      return el;
    },
  });
}

function createDashboard() {
  const TITLES = {
    system: ["system"],
    storage: ["storage", "speicher"],
    network: ["network", "netzwerk"],
    settings: ["widget settings", "widget-einstellungen"],
  };
  const ALL = Object.values(TITLES).flat();
  const own = new Set(); // von Mods eingehängte oder ignorierte Elemente
  const registrations = new Map(); // Element -> Optionen

  // Zwischenspeicher: Die Spalte wird nur neu gesucht, wenn die gemerkte ungültig ist.
  let column = null;
  let columnTitles = [];
  let lastFullScan = 0;
  const natives = new Map(); // Name -> direktes Kind der Spalte

  const isOwn = (el) => {
    for (const o of own) if (o.contains(el)) return true;
    return false;
  };

  function titleElements(root) {
    const out = [];
    for (const el of root.querySelectorAll("span, div, p, h1, h2, h3, h4")) {
      if (el.childElementCount) continue;
      const text = (el.textContent || "").trim().toLowerCase();
      if (ALL.includes(text) && !isOwn(el) && el.getClientRects().length) out.push(el);
    }
    return out;
  }

  // Billig: Spalte noch im Dokument und noch mindestens zwei ihrer Titel darin?
  const columnValid = () =>
    Boolean(column?.isConnected) && columnTitles.filter((t) => t.isConnected && column.contains(t)).length >= 2;

  /** Kleinster gemeinsamer Vorfahr von mindestens zwei nativen Widget-Titeln (gemerkt). */
  function widgetColumn() {
    if (columnValid()) return column;
    // Volle Suche höchstens einmal pro Sekunde (z. B. auf der Login-Seite ohne Spalte).
    const now = performance.now();
    if (!column && now - lastFullScan < 1000) return null;
    lastFullScan = now;
    column = null;
    columnTitles = [];
    natives.clear();
    const titles = titleElements(document);
    if (titles.length < 2) return null;
    for (let node = titles[0].parentElement; node && node !== document.body; node = node.parentElement) {
      const inside = titles.filter((t) => node.contains(t));
      if (inside.length < 2) continue;
      const r = node.getBoundingClientRect();
      const inDialog = node.closest('[role="dialog"], [aria-modal="true"]');
      if (r.width >= 200 && r.width <= 560 && !inDialog) {
        column = node;
        columnTitles = inside;
      }
      break;
    }
    return column;
  }

  // Uhrzeit wie „22:05“, „9:41 PM“ oder „22:05:12“ – daran erkennt ZimaForge das Uhr-Widget.
  const TIME = /^\d{1,2}:\d{2}(:\d{2})?(\s?[ap]\.?m\.?)?$/i;

  /** Direktes Kind der Spalte mit dem Uhr-Widget (erkennbar an der angezeigten Uhrzeit). */
  function clockWidget(col) {
    for (const child of col.children) {
      if (isOwn(child)) continue;
      for (const el of child.querySelectorAll("span, div, p, h1, h2, h3, h4, time")) {
        if (!el.childElementCount && TIME.test((el.textContent || "").trim())) return child;
      }
    }
    return null;
  }

  /**
   * Direktes Kind der Spalte mit dem nativen Widget `name`:
   * "clock" (Uhr), "system", "storage", "network".
   */
  function nativeWidget(name, col = widgetColumn()) {
    if (!col) return null;
    const cached = natives.get(name);
    if (cached?.isConnected && cached.parentElement === col) return cached;
    let node = null;
    if (name === "clock") {
      node = clockWidget(col);
    } else {
      const names = TITLES[name] ?? [String(name).toLowerCase()];
      node = titleElements(col).find((t) => names.includes(t.textContent.trim().toLowerCase())) ?? null;
      while (node && node.parentElement !== col) node = node.parentElement;
    }
    if (node) natives.set(name, node);
    return node;
  }

  // Erstes vorhandene native Widget aus einer Liste von Namen, z. B. ["clock", "system"].
  const firstNative = (names, col) => {
    for (const n of [].concat(names ?? [])) {
      const w = nativeWidget(n, col);
      if (w) return w;
    }
    return null;
  };

  /**
   * Steht `el` schon am gewünschten Platz neben seinem Anker? Andere eingehängte
   * Widgets dazwischen zählen nicht – sonst würden zwei Widgets mit demselben Anker
   * einander endlos verdrängen.
   */
  function inPlace(el, opts, col) {
    if (el.parentElement !== col) return false;
    if (!opts.pin) return true; // nicht angeheftet: Nutzer darf umsortieren
    const skip = (n, dir) => { while (n && registrations.has(n)) n = n[dir]; return n; };
    const before = opts.before ? firstNative(opts.before, col) : null;
    if (before) return skip(el.nextElementSibling, "nextElementSibling") === before;
    const after = opts.after ? firstNative(opts.after, col) : null;
    if (after) return skip(el.previousElementSibling, "previousElementSibling") === after;
    return true;
  }

  /**
   * Abstand wie bei den nativen Widgets: Deren berechnete Margins übernehmen (nutzt
   * ZimaOS `gap` in der Spalte, sind sie 0 – dann passt es ebenfalls). Als Muster dient
   * das letzte native Widget, damit auch Regeln wie `.widget + .widget` greifen.
   */
  function matchSpacing(el, col) {
    let sample = null;
    for (let i = col.children.length - 1; i >= 0 && !sample; i--) {
      const c = col.children[i];
      if (!isOwn(c) && c.getClientRects().length) sample = c;
    }
    if (!sample) return;
    const cs = getComputedStyle(sample);
    el.style.marginTop = cs.marginTop;
    el.style.marginBottom = cs.marginBottom;
  }

  function place(el, opts) {
    const col = widgetColumn();
    if (col) {
      el.style.removeProperty("display");
      el.classList.add("zf-widget-embedded");
      el.classList.remove("zf-widget-floating");
      matchSpacing(el, col);
      if (inPlace(el, opts, col)) return;
      const before = opts.before ? firstNative(opts.before, col) : null;
      const after = !before && opts.after ? firstNative(opts.after, col) : null;
      const wanted = before ?? (after ? after.nextSibling : opts.position === "end" ? null : col.firstChild);
      if (wanted !== el) col.insertBefore(el, wanted);
    } else {
      // Ohne Widget-Spalte nur schwebend zeigen, wenn eine ZimaOS-Sitzung besteht –
      // also nicht auf der Anmeldeseite.
      const loggedIn = Boolean(sessionToken()) && !/login/i.test(location.hash + location.pathname);
      el.style.display = loggedIn ? "" : "none";
      if (!el.isConnected || el.classList.contains("zf-widget-embedded")) {
        el.classList.remove("zf-widget-embedded");
        el.classList.add("zf-widget-floating");
        el.style.marginTop = el.style.marginBottom = "";
        document.body.append(el);
      }
    }
  }

  let pending = false;
  const refresh = () => {
    if (pending) return;
    pending = true;
    // Ohne Spalte (Anmeldeseite, andere Ansicht) seltener nachsehen.
    setTimeout(() => {
      pending = false;
      const before = column;
      for (const [el, opts] of registrations) place(el, opts);
      const col = widgetColumn();
      if (col || before) emit("dashboard", { column: col, changed: col !== before });
    }, column ? 250 : 1000);
  };

  let observer = null;
  const observe = () => {
    if (observer || !document.body) return;
    observer = new MutationObserver((records) => {
      // Nur reagieren, wenn es die Spalte betrifft – Uhr-Ticks, Messwerte und
      // Änderungen in eingehängten Widgets lösen nichts aus.
      if (!columnValid()) {
        // Änderungen nur innerhalb von Mod-Elementen (Messwerte, Effekte) ignorieren.
        if (records.every((r) => isOwn(r.target))) return;
        return refresh();
      }
      for (const [el, opts] of registrations) if (!inPlace(el, opts, column)) return refresh();
      for (const r of records) if (r.target === column) return refresh();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  };

  return Object.freeze({
    widgetColumn,
    nativeWidget,
    /** Alle direkten Kinder der Widget-Spalte (native und eingehängte Widgets). */
    widgets: () => [...(widgetColumn()?.children ?? [])],
    /**
     * Hängt `el` in die Widget-Spalte – vor `before` bzw. nach `after` (Name oder Liste
     * von Namen: "clock", "system", "storage", "network"; der erste vorhandene zählt),
     * sonst oben bzw. mit `position: "end"` unten. Mit `pin: true` rückt das Widget
     * bei jedem Umbau wieder an diesen Platz; sonst darf der Nutzer es verschieben.
     * Ohne Spalte landet es schwebend im Body (Klasse `zf-widget-floating`), auf der
     * Anmeldeseite unsichtbar. Gibt eine Funktion zum Entfernen zurück.
     */
    mountWidget(el, opts = {}) {
      own.add(el);
      // Angeheftete Widgets markieren – „Widget-Reihenfolge“ lässt sie an ihrem Anker.
      if (opts.pin) {
        if (opts.before) el.dataset.zfPinBefore = [].concat(opts.before).join(",");
        else if (opts.after) el.dataset.zfPinAfter = [].concat(opts.after).join(",");
      }
      registrations.set(el, opts);
      place(el, opts);
      observe();
      return () => {
        registrations.delete(el);
        own.delete(el);
        el.remove();
      };
    },
    /**
     * Meldet ZimaForge, dass `el` zu einem Mod gehört: Es wird bei der Suche nach
     * nativen Widgets übersprungen, und Änderungen darin lösen keine Neusuche aus.
     */
    ignore(el) { own.add(el); },
    /**
     * Ruft `fn({ column, changed })` auf, wenn sich die Widget-Spalte ändert (neue oder
     * entfernte Widgets, neu aufgebaute Spalte). Gibt eine Abmeldefunktion zurück.
     */
    watch(fn) {
      observe();
      if (!listeners.has("dashboard")) listeners.set("dashboard", new Set());
      listeners.get("dashboard").add(fn);
      return () => listeners.get("dashboard")?.delete(fn);
    },
  });
}

/** Kompatibilitätsschicht für Mods, die für ZimaMOD geschrieben wurden. */
const ZimaMODShim = {
  platform: "zimaos",
  forge: true,
  assetUrl: (modId, rel) => `/mod/${id(modId)}/${String(rel).replace(/^\/+/, "")}`,
  getConfig: ZimaForge.getConfig,
  setConfig: ZimaForge.setConfig,
  getSystemMetrics: ZimaForge.metrics,
  async listStore() {
    return (await ZimaForge.store.list()).map((m) => ({ ...m, installed: m.installed }));
  },
  installMod: ZimaForge.store.install,
  uninstallMod: ZimaForge.store.uninstall,
  async getUpdateStatus() {
    return { checkAvailable: false, updateAvailable: false, currentVersion: VERSION };
  },
  clearWriteToken() {},
  async copyApiToken() {
    throw new Error("ZimaForge nutzt die ZimaOS-Anmeldung – kein API-Schlüssel nötig.");
  },
};

function addFontFace() {
  if (document.getElementById("zimaforge-fonts")) return;
  const style = document.createElement("style");
  style.id = "zimaforge-fonts";
  style.textContent = `@font-face{font-family:"ZF Orbitron";src:url("${BASE}/runtime/fonts/Orbitron-Variable.ttf?v=${encodeURIComponent(VERSION)}") format("truetype");font-weight:400 900;font-display:swap}`;
  document.head.append(style);
}

function loadStyle(mod, rel) {
  const href = `${ZimaForge.assetUrl(mod.id, rel)}?v=${encodeURIComponent(`${mod.version}-${mod.rev ?? 0}`)}`;
  // Nur echte Stylesheets zählen – der Preload-Hinweis des Servers hat dieselbe Adresse.
  if (document.querySelector(`link[rel="stylesheet"][href="${CSS.escape(href)}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.zimaforgeMod = mod.id;
  document.head.append(link);
}

function loadScript(mod, rel) {
  const src = `${ZimaForge.assetUrl(mod.id, rel)}?v=${encodeURIComponent(`${mod.version}-${mod.rev ?? 0}`)}`;
  if (document.querySelector(`script[src="${CSS.escape(src)}"]`)) return;
  const script = document.createElement("script");
  if (mod.module) script.type = "module";
  else script.async = false; // Reihenfolge innerhalb eines Mods beibehalten
  script.src = src;
  script.dataset.zimaforgeMod = mod.id;
  script.addEventListener("error", () => console.warn(`[ZimaForge] ${mod.id}: ${rel} konnte nicht geladen werden`));
  document.body.append(script);
}

async function boot() {
  window.ZimaForge = ZimaForge;
  if (!window.ZimaMOD) window.ZimaMOD = ZimaMODShim;
  addFontFace();
  void prefetchConfig(); // Einstellungen laden, während die Mod-Dateien laden

  // Store-Oberfläche (Launcher, Tastenkürzel, Dialog).
  import(`./store.js?v=${encodeURIComponent(VERSION)}`).catch((err) =>
    console.error("[ZimaForge] Store konnte nicht geladen werden", err));

  try {
    const mods = Array.isArray(bootData?.mods) ? bootData.mods : await ZimaForge.store.active();
    for (const mod of mods) {
      for (const style of mod.styles ?? []) loadStyle(mod, style);
      for (const script of mod.scripts ?? []) loadScript(mod, script);
    }
    console.info(`%c⬢ ZimaForge ${VERSION}%c ${mods.length} Mod(s) aktiv`,
      "color:#ff006e;font-weight:700", "color:inherit");
    emit("ready", { mods });
  } catch (err) {
    console.error("[ZimaForge] Mods konnten nicht geladen werden", err);
  }
}

// Erst ganz am Ende starten: alle const-Deklarationen oben sind dann initialisiert.
if (!skip) {
  document.documentElement.dataset.zimaforge = "loaded";
  boot();
}
