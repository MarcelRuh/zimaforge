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
  const own = new Set(); // von Mods eingehängte Elemente
  const registrations = new Map(); // Element -> Optionen

  const isOwn = (el) => [...own].some((o) => o.contains(el));

  function titleElements(root = document) {
    const out = [];
    for (const el of root.querySelectorAll("span, div, p, h1, h2, h3, h4")) {
      if (el.childElementCount || isOwn(el)) continue;
      const text = (el.textContent || "").trim().toLowerCase();
      if (ALL.includes(text) && el.getClientRects().length) out.push(el);
    }
    return out;
  }

  /** Kleinster gemeinsamer Vorfahr von mindestens zwei nativen Widget-Titeln. */
  function widgetColumn() {
    const titles = titleElements();
    if (titles.length < 2) return null;
    for (let node = titles[0].parentElement; node && node !== document.body; node = node.parentElement) {
      if (titles.filter((t) => node.contains(t)).length < 2) continue;
      const r = node.getBoundingClientRect();
      const inDialog = node.closest('[role="dialog"], [aria-modal="true"]');
      return r.width >= 200 && r.width <= 560 && !inDialog ? node : null;
    }
    return null;
  }

  /** Direktes Kind der Spalte, das das native Widget `name` (system, storage, network) enthält. */
  function nativeWidget(name, column = widgetColumn()) {
    if (!column) return null;
    const names = TITLES[name] ?? [String(name).toLowerCase()];
    let node = titleElements(column).find((t) => names.includes(t.textContent.trim().toLowerCase()));
    while (node && node.parentElement !== column) node = node.parentElement;
    return node || null;
  }

  function place(el, opts) {
    const column = widgetColumn();
    if (column) {
      el.classList.add("zf-widget-embedded");
      el.classList.remove("zf-widget-floating");
      const anchor = opts.after ? nativeWidget(opts.after, column) : null;
      const wanted = anchor ? anchor.nextSibling : opts.position === "end" ? null : column.firstChild;
      // Schon in der Spalte: Position nicht erzwingen (Nutzer darf umsortieren).
      if (el.parentElement !== column) column.insertBefore(el, wanted);
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
      for (const [el, opts] of registrations) place(el, opts);
      emit("dashboard", { column: widgetColumn() });
    }, 300);
  };
  let observer = null;
  const observe = () => {
    if (observer || !document.body) return;
    observer = new MutationObserver((records) => {
      if (records.every((r) => isOwn(r.target))) return;
      refresh();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  };

  return Object.freeze({
    widgetColumn,
    nativeWidget,
    /** Alle direkten Kinder der Widget-Spalte (native und eingehängte Widgets). */
    widgets: () => [...(widgetColumn()?.children ?? [])],
    /**
     * Hängt `el` in die Widget-Spalte (nach `after`: "system" | "storage" | "network",
     * sonst oben bzw. mit `position: "end"` unten) und hält es dort, wenn ZimaOS neu
     * rendert. Ohne Spalte landet es schwebend im Body (Klasse `zf-widget-floating`).
     * Gibt eine Funktion zum Entfernen zurück.
     */
    mountWidget(el, opts = {}) {
      own.add(el);
      registrations.set(el, opts);
      place(el, opts);
      observe();
      return () => {
        registrations.delete(el);
        own.delete(el);
        el.remove();
      };
    },
    /** Meldet ZimaForge, dass Änderungen in `el` keine Neuplatzierung auslösen sollen. */
    ignore(el) { own.add(el); },
    /** Ruft `fn({ column })` auf, sobald ZimaOS die Seite umbaut. Gibt eine Abmeldefunktion zurück. */
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
  style.textContent = `@font-face{font-family:"ZF Orbitron";src:url("${BASE}/runtime/fonts/Orbitron-Variable.ttf") format("truetype");font-weight:400 900;font-display:swap}`;
  document.head.append(style);
}

function loadStyle(mod, rel) {
  const href = `${ZimaForge.assetUrl(mod.id, rel)}?v=${encodeURIComponent(mod.version)}`;
  if (document.querySelector(`link[href="${CSS.escape(href)}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.zimaforgeMod = mod.id;
  document.head.append(link);
}

function loadScript(mod, rel) {
  const src = `${ZimaForge.assetUrl(mod.id, rel)}?v=${encodeURIComponent(mod.version)}`;
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
