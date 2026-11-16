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

async function request(path, { method = "GET", body, write = false } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (write) {
    const token = sessionToken();
    if (!token) throw new ForgeError("Bitte zuerst bei ZimaOS anmelden.", 401);
    headers["X-ZimaForge"] = "1";
    headers.Authorization = token;
  }
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
      response.status === 403 ? "Anfrage abgelehnt (Sicherheitsprüfung)." :
      data?.error || `Fehler ${response.status}`;
    throw new ForgeError(message, response.status);
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

const ZimaForge = Object.freeze({
  version: VERSION,
  platform: "zimaos",
  ForgeError,
  assetUrl: (modId, rel) => `${BASE}/mods/${id(modId)}/${String(rel).replace(/^\/+/, "")}`,
  runtimeUrl: (rel) => `${BASE}/runtime/${rel}?v=${encodeURIComponent(VERSION)}`,
  sessionToken,
  async getConfig(modId, fallback = null) {
    try { return (await request(`/config/${id(modId)}`)).config ?? fallback; }
    catch { return fallback; }
  },
  async setConfig(modId, config) {
    const result = await request(`/config/${id(modId)}`, { method: "PUT", body: config, write: true });
    emit("config", { id: modId, config: result.config });
    return result.config;
  },
  metrics: () => request("/metrics"),
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
});

/**
 * Hilfen für die Widget-Spalte des ZimaOS-Dashboards (links: Uhr, System,
 * Storage, Network …). Mods hängen ihre Karten hier ein, statt sie schwebend
 * über das Dashboard zu legen – dann liegen ZimaOS-Fenster automatisch darüber.
 */
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

  /** Steht `el` schon am gewünschten Platz neben seinem Anker? */
  function inPlace(el, opts, col) {
    if (el.parentElement !== col) return false;
    if (!opts.pin) return true; // nicht angeheftet: Nutzer darf umsortieren
    const before = opts.before ? firstNative(opts.before, col) : null;
    if (before) return el.nextElementSibling === before;
    const after = opts.after ? firstNative(opts.after, col) : null;
    if (after) return el.previousElementSibling === after;
    return true;
  }

  function place(el, opts) {
    const col = widgetColumn();
    if (col) {
      el.classList.add("zf-widget-embedded");
      el.classList.remove("zf-widget-floating");
      if (inPlace(el, opts, col)) return;
      const before = opts.before ? firstNative(opts.before, col) : null;
      const after = !before && opts.after ? firstNative(opts.after, col) : null;
      const wanted = before ?? (after ? after.nextSibling : opts.position === "end" ? null : col.firstChild);
      if (wanted !== el) col.insertBefore(el, wanted);
    } else if (!el.isConnected || el.classList.contains("zf-widget-embedded")) {
      el.classList.remove("zf-widget-embedded");
      el.classList.add("zf-widget-floating");
      document.body.append(el);
    }
  }

  let pending = false;
  const refresh = () => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      const before = column;
      for (const [el, opts] of registrations) place(el, opts);
      const col = widgetColumn();
      emit("dashboard", { column: col, changed: col !== before });
    }, 250);
  };

  let observer = null;
  const observe = () => {
    if (observer || !document.body) return;
    observer = new MutationObserver((records) => {
      // Nur reagieren, wenn es die Spalte betrifft – Uhr-Ticks, Messwerte und
      // Änderungen in eingehängten Widgets lösen nichts aus.
      if (!columnValid()) return refresh();
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
     * Bleibt dort, wenn ZimaOS neu rendert.| "storage" | "network",
     * sonst oben bzw. mit `position: "end"` unten) und hält es dort, wenn ZimaOS neu
     * rendert. Ohne Spalte landet es schwebend im Body (Klasse `zf-widget-floating`).
     * Gibt eine Funktion zum Entfernen zurück.
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
    /** Meldet ZimaForge, dass `el` zu einem Mod gehört (wird bei der Titelsuche übersprungen). */
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
  if (document.querySelector(`link[href="${CSS.escape(href)}"]`)) return;
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

  // Store-Oberfläche (Launcher, Tastenkürzel, Dialog).
  import(`./store.js?v=${encodeURIComponent(VERSION)}`).catch((err) =>
    console.error("[ZimaForge] Store konnte nicht geladen werden", err));

  try {
    const mods = await ZimaForge.store.active();
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
