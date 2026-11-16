// ZimaForge Store – Launcher und Store-Dialog als Web Components (Shadow DOM),
// damit Dashboard-CSS und Store-CSS sich nicht gegenseitig beeinflussen.

const F = window.ZimaForge;
const VERSION = F?.version ?? "dev";
const CORE_ID = "zimaforge";
const REPO = "MarcelRuh/zimaforge";
const UPDATE_KEY = "zimaforge:update";
const UPDATE_TTL = 8 * 60 * 60 * 1000;
const SHORTCUT = (e) => e.altKey && e.shiftKey && e.code === "KeyF";

const DEFAULT_SETTINGS = { launcher: "bottom-right", updateCheck: true };

const ICONS = {
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  download: '<path d="M12 3v12m0 0-4-4m4 4 4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"/>',
  up: '<path d="M12 19V5m0 0-6 6m6-6 6 6"/>',
  external: '<path d="M14 4h6v6M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
};
const icon = (name, cls = "") =>
  `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const safeUrl = (value) => {
  try {
    const url = new URL(value, location.origin);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch { return ""; }
};

const LOGO = `<img class="logo" src="${F.runtimeUrl("logo.svg")}" alt="" width="40" height="40">`;

function cmpVersion(a, b) {
  const pa = String(a).replace(/^v/, "").split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/, "").split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

async function checkForUpdate(force = false) {
  try {
    const cached = JSON.parse(localStorage.getItem(UPDATE_KEY) || "null");
    if (!force && cached && Date.now() - cached.at < UPDATE_TTL) return cached.data;
  } catch { /* kein Cache */ }
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const release = await res.json();
  const data = {
    latest: String(release.tag_name || "").replace(/^v/, ""),
    url: release.html_url,
    available: cmpVersion(release.tag_name, VERSION) > 0 && VERSION !== "dev",
  };
  try { localStorage.setItem(UPDATE_KEY, JSON.stringify({ at: Date.now(), data })); } catch { /* egal */ }
  return data;
}

let settingsCache = null;
async function loadSettings() {
  settingsCache = { ...DEFAULT_SETTINGS, ...((await F.getConfig(CORE_ID, {})) || {}) };
  return settingsCache;
}

/* ───────────────────────── Launcher ───────────────────────── */

class ForgeLauncher extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <link rel="stylesheet" href="${F.runtimeUrl("store.css")}">
      <button class="launcher" type="button" aria-label="ZimaForge Store öffnen (Alt+Umschalt+F)">
        <img src="${F.runtimeUrl("logo.svg")}" alt="" width="30" height="30">
        <span class="dot" hidden></span>
        <span class="tip">ZimaForge <kbd>Alt</kbd><kbd>⇧</kbd><kbd>F</kbd></span>
      </button>`;
    root.querySelector("button").addEventListener("click", () => F.openStore());
  }
  set position(value) {
    this.dataset.position = value;
    this.hidden = value === "hidden";
  }
  set updateAvailable(value) {
    this.shadowRoot?.querySelector(".dot")?.toggleAttribute("hidden", !value);
  }
}

/* ───────────────────────── Store ───────────────────────── */

class ForgeStore extends HTMLElement {
  #root;
  #view = "discover";
  #query = "";
  #mods = [];
  #busy = new Set();
  #needsReload = false;
  #update = null;
  #loading = false;
  #error = "";

  connectedCallback() {
    if (this.#root) return;
    this.#root = this.attachShadow({ mode: "open" });
    this.#root.innerHTML = `
      <link rel="stylesheet" href="${F.runtimeUrl("store.css")}">
      <dialog class="store" aria-labelledby="zf-title">
        <aside class="side">
          <div class="brand">${LOGO}<div><div class="word">ZIMA<span>FORGE</span></div><div class="ver">v${esc(VERSION)}</div></div></div>
          <nav class="nav" aria-label="Bereiche">
            <button type="button" data-view="discover">${icon("compass")}<span>Entdecken</span></button>
            <button type="button" data-view="installed">${icon("check")}<span>Installiert</span><b class="count" data-count="installed"></b></button>
            <button type="button" data-view="updates">${icon("up")}<span>Updates</span><b class="count hot" data-count="updates"></b></button>
            <button type="button" data-view="settings">${icon("settings")}<span>Einstellungen</span></button>
          </nav>
          <section class="update" aria-live="polite"></section>
          <p class="note">Mods laufen mit deiner ZimaOS-Sitzung. Installiere nur Mods, deren Quelle du vertraust.</p>
        </aside>
        <main class="main">
          <header class="head">
            <div>
              <div class="kicker" id="zf-kicker">Mod Store</div>
              <h1 id="zf-title">Entdecken</h1>
            </div>
            <label class="search">${icon("search")}<input type="search" placeholder="Mods durchsuchen…" aria-label="Mods durchsuchen" autofocus></label>
            <button class="icon-btn close" type="button" aria-label="Schließen">${icon("close")}</button>
          </header>
          <div class="reload" hidden>
            <span>Änderungen werden nach dem Neuladen des Dashboards aktiv.</span>
            <button type="button" class="btn primary sm" data-act="reload">Jetzt neu laden</button>
          </div>
          <div class="content" tabindex="-1"></div>
        </main>
        <div class="toasts" role="status" aria-live="polite"></div>
      </dialog>`;

    const $ = (s) => this.#root.querySelector(s);
    this.dialog = $("dialog");
    $(".close").addEventListener("click", () => this.close());
    this.dialog.addEventListener("click", (e) => { if (e.target === this.dialog) this.close(); });
    this.dialog.addEventListener("close", () => document.documentElement.style.removeProperty("overflow"));
    $(".nav").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-view]");
      if (btn) this.#show(btn.dataset.view);
    });
    $(".search input").addEventListener("input", (e) => {
      this.#query = e.target.value.trim().toLowerCase();
      if (this.#view === "settings") this.#view = "discover";
      this.#render();
    });
    $(".reload button").addEventListener("click", () => location.reload());
    $(".content").addEventListener("click", (e) => this.#onAction(e));
    $(".content").addEventListener("change", (e) => this.#onChange(e));
    $(".update").addEventListener("click", (e) => {
      if (e.target.closest("[data-act=check]")) void this.#checkUpdate(true);
    });
  }

  async open(view) {
    if (!this.dialog.open) {
      this.dialog.showModal();
      document.documentElement.style.overflow = "hidden";
    }
    this.#show(view || this.#view);
    await this.refresh();
    if (settingsCache?.updateCheck !== false) void this.#checkUpdate(false);
  }

  close() {
    this.dialog.close();
  }

  async refresh() {
    this.#loading = true;
    this.#error = "";
    this.#render();
    try {
      this.#mods = await F.store.list();
    } catch (err) {
      this.#error = err.message;
    } finally {
      this.#loading = false;
      this.#render();
    }
  }

  #show(view) {
    this.#view = ["discover", "installed", "updates", "settings"].includes(view) ? view : "discover";
    for (const b of this.#root.querySelectorAll(".nav button")) {
      b.toggleAttribute("aria-current", b.dataset.view === this.#view);
    }
    this.#render();
  }

  #toast(message, kind = "ok") {
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.textContent = message;
    this.#root.querySelector(".toasts").append(el);
    setTimeout(() => el.classList.add("out"), 3200);
    setTimeout(() => el.remove(), 3700);
  }

  async #checkUpdate(force) {
    const box = this.#root.querySelector(".update");
    box.innerHTML = `<div class="u-row"><span class="u-label">Version ${esc(VERSION)}</span><span class="spinner" aria-label="Prüfe"></span></div>`;
    try {
      this.#update = await checkForUpdate(force);
    } catch {
      this.#update = null;
    }
    const u = this.#update;
    const launcher = document.querySelector("zimaforge-launcher");
    if (launcher) launcher.updateAvailable = Boolean(u?.available);
    box.classList.toggle("has", Boolean(u?.available));
    box.innerHTML = u?.available
      ? `<div class="u-row"><span class="u-label">Update verfügbar</span><span class="pill hot">v${esc(u.latest)}</span></div>
         <p>In ZimaOS die App „ZimaForge“ aktualisieren oder das Image neu ziehen.</p>
         <a class="link" href="${esc(safeUrl(u.url))}" target="_blank" rel="noopener">Release ansehen ${icon("external")}</a>`
      : `<div class="u-row"><span class="u-label">${u ? "Aktuell" : "Version"} · v${esc(VERSION)}</span>
         <button type="button" class="icon-btn sm" data-act="check" aria-label="Nach Updates suchen">${icon("refresh")}</button></div>`;
  }

  #filtered() {
    const q = this.#query;
    let list = this.#mods;
    if (this.#view === "installed") list = list.filter((m) => m.installed);
    if (this.#view === "updates") list = list.filter((m) => m.updateAvailable);
    if (q) {
      list = list.filter((m) =>
        [m.name, m.description, m.category, ...(m.tags ?? []), ...(m.authors ?? []).map((a) => a.name)]
          .join(" ").toLowerCase().includes(q));
    }
    return list;
  }

  #render() {
    if (!this.#root) return;
    const titles = { discover: "Entdecken", installed: "Installiert", updates: "Updates", settings: "Einstellungen" };
    this.#root.querySelector("#zf-title").textContent = titles[this.#view];
    this.#root.querySelector("#zf-kicker").textContent = this.#view === "settings" ? "ZimaForge" : "Mod Store";
    this.#root.querySelector(".reload").hidden = !this.#needsReload;

    const counts = {
      installed: this.#mods.filter((m) => m.installed).length,
      updates: this.#mods.filter((m) => m.updateAvailable).length,
    };
    for (const [k, v] of Object.entries(counts)) {
      const el = this.#root.querySelector(`[data-count=${k}]`);
      el.textContent = v || "";
      el.hidden = !v;
    }

    const content = this.#root.querySelector(".content");
    if (this.#view === "settings") {
      content.innerHTML = this.#settingsHtml();
      return;
    }
    if (this.#loading && !this.#mods.length) {
      content.innerHTML = `<div class="grid">${'<div class="card skeleton"></div>'.repeat(6)}</div>`;
      return;
    }
    if (this.#error) {
      content.innerHTML = `<div class="empty"><h2>Store nicht erreichbar</h2><p>${esc(this.#error)}</p>
        <button type="button" class="btn" data-act="retry">${icon("refresh")} Erneut versuchen</button></div>`;
      return;
    }
    const list = this.#filtered();
    if (!list.length) {
      const msg = this.#query ? "Keine Mods passen zur Suche." :
        this.#view === "updates" ? "Alle installierten Mods sind aktuell." :
        this.#view === "installed" ? "Noch keine Mods installiert." : "Der Katalog ist leer.";
      content.innerHTML = `<div class="empty"><h2>${esc(msg)}</h2></div>`;
      return;
    }
    content.innerHTML = `<div class="grid">${list.map((m) => this.#cardHtml(m)).join("")}</div>`;
  }

  #cardHtml(m) {
    const busy = this.#busy.has(m.id);
    const authors = (m.authors ?? []).map((a) => esc(a.name)).join(", ");
    const origin = m.origin?.type;
    const badges = [
      m.format === "zimamod" || origin === "compatible" || origin === "adapted"
        ? '<span class="pill cyan">ZimaMOD-kompatibel</span>' : "",
      !m.inCatalog ? '<span class="pill">Lokal</span>' : "",
      m.updateAvailable ? `<span class="pill hot">Update ${esc(m.catalogVersion)}</span>` : "",
    ].join("");
    const iconUrl = m.installed
      ? F.assetUrl(m.id, m.icon)
      : `/_forge/catalog/${encodeURIComponent(m.id)}/${m.icon}`;
    const art = m.icon
      ? `<img class="art" src="${esc(iconUrl)}" alt="" loading="lazy">`
      : `<div class="art hex" aria-hidden="true">${esc((m.name || m.id).slice(0, 1).toUpperCase())}</div>`;

    let actions;
    if (!m.installed) {
      actions = `<button type="button" class="btn primary" data-act="install" ${busy ? "disabled" : ""}>${icon("download")} Installieren</button>`;
    } else {
      actions = `
        <label class="switch" title="${m.enabled ? "Aktiv" : "Inaktiv"}">
          <input type="checkbox" data-act="toggle" ${m.enabled ? "checked" : ""} ${busy ? "disabled" : ""}>
          <span class="track"></span><span class="sw-label">${m.enabled ? "Aktiv" : "Aus"}</span>
        </label>
        <span class="spacer"></span>
        ${m.updateAvailable ? `<button type="button" class="btn primary sm" data-act="install" ${busy ? "disabled" : ""}>${icon("up")} Aktualisieren</button>` : ""}
        <button type="button" class="icon-btn danger" data-act="uninstall" aria-label="${esc(m.name)} entfernen" ${busy ? "disabled" : ""}>${icon("trash")}</button>`;
    }
    const home = safeUrl(m.homepage || m.origin?.source || "");
    return `
      <article class="card ${m.installed ? "installed" : ""} ${busy ? "busy" : ""}" data-id="${esc(m.id)}">
        <div class="card-top">
          ${art}
          <div class="meta">
            <h3>${esc(m.name)}</h3>
            <div class="sub">v${esc(m.installedVersion || m.version)}${authors ? ` · ${authors}` : ""}</div>
          </div>
        </div>
        <div class="cat">${esc(m.category)}</div>
        <p class="desc">${esc(m.description || "Keine Beschreibung.")}</p>
        <div class="badges">${badges}${home ? `<a class="link" href="${esc(home)}" target="_blank" rel="noopener">Quelle ${icon("external")}</a>` : ""}</div>
        <div class="actions">${actions}</div>
      </article>`;
  }

  #settingsHtml() {
    const s = settingsCache ?? DEFAULT_SETTINGS;
    const opt = (v, label) => `<option value="${v}" ${s.launcher === v ? "selected" : ""}>${label}</option>`;
    return `
      <div class="settings">
        <section class="panel">
          <h2>Launcher</h2>
          <p>Das Sechseck-Symbol öffnet den Store. Unabhängig davon funktioniert immer <kbd>Alt</kbd> + <kbd>⇧</kbd> + <kbd>F</kbd>.</p>
          <label class="field"><span>Position</span>
            <select data-setting="launcher">${opt("bottom-right", "Unten rechts")}${opt("bottom-left", "Unten links")}${opt("hidden", "Ausgeblendet")}</select>
          </label>
        </section>
        <section class="panel">
          <h2>Updates</h2>
          <label class="switch">
            <input type="checkbox" data-setting="updateCheck" ${s.updateCheck !== false ? "checked" : ""}>
            <span class="track"></span><span class="sw-label">Auf GitHub nach neuen Versionen suchen</span>
          </label>
          <p class="hint">Der Browser fragt <code>api.github.com</code> höchstens alle 8 Stunden ab.</p>
        </section>
        <section class="panel">
          <h2>Eigene Mods</h2>
          <p>Lege einen Ordner mit <code>forge.json</code> (oder <code>zimamod.json</code>, <code>mod.js</code>, <code>mod.css</code>) unter
          <code>/DATA/AppData/zimaforge/mods/&lt;id&gt;</code> ab. Er erscheint danach unter „Installiert“.</p>
          <a class="link" href="https://github.com/${REPO}/blob/main/docs/MODS.md" target="_blank" rel="noopener">Mod-Entwicklung ${icon("external")}</a>
        </section>
        <section class="panel">
          <h2>Über</h2>
          <p>ZimaForge ${esc(VERSION)} · MIT · <a class="link" href="https://github.com/${REPO}" target="_blank" rel="noopener">github.com/${REPO} ${icon("external")}</a></p>
          <p class="hint">Unabhängiges Community-Projekt, nicht mit ZimaOS/IceWhale verbunden.</p>
        </section>
      </div>`;
  }

  async #onAction(e) {
    const btn = e.target.closest("[data-act]");
    if (!btn || btn.tagName === "INPUT") return;
    const act = btn.dataset.act;
    if (act === "retry") return void this.refresh();
    const card = btn.closest(".card");
    const mod = this.#mods.find((m) => m.id === card?.dataset.id);
    if (!mod) return;
    if (act === "uninstall" && !confirm(`„${mod.name}“ entfernen?`)) return;
    await this.#run(mod, async () => {
      if (act === "install") {
        await F.store.install(mod.id);
        this.#toast(mod.installed ? `${mod.name} aktualisiert` : `${mod.name} installiert`);
      } else if (act === "uninstall") {
        await F.store.uninstall(mod.id);
        this.#toast(`${mod.name} entfernt`);
      }
    });
  }

  async #onChange(e) {
    const input = e.target;
    if (input.dataset.act === "toggle") {
      const mod = this.#mods.find((m) => m.id === input.closest(".card")?.dataset.id);
      if (!mod) return;
      await this.#run(mod, async () => {
        await F.store.setEnabled(mod.id, input.checked);
        this.#toast(`${mod.name} ${input.checked ? "aktiviert" : "deaktiviert"}`);
      });
      return;
    }
    if (input.dataset.setting) {
      const key = input.dataset.setting;
      const value = input.type === "checkbox" ? input.checked : input.value;
      const next = { ...(settingsCache ?? DEFAULT_SETTINGS), [key]: value };
      try {
        settingsCache = await F.setConfig(CORE_ID, next);
        applySettings(settingsCache);
        this.#toast("Gespeichert");
      } catch (err) {
        this.#toast(err.message, "err");
        this.#render();
      }
    }
  }

  async #run(mod, fn) {
    this.#busy.add(mod.id);
    this.#render();
    try {
      await fn();
      this.#needsReload = true;
      this.#mods = await F.store.list();
    } catch (err) {
      this.#toast(err.message, "err");
    } finally {
      this.#busy.delete(mod.id);
      this.#render();
    }
  }
}

function applySettings(s) {
  const launcher = document.querySelector("zimaforge-launcher");
  if (launcher) launcher.position = s.launcher;
}

if (!customElements.get("zimaforge-store")) {
  customElements.define("zimaforge-launcher", ForgeLauncher);
  customElements.define("zimaforge-store", ForgeStore);

  const launcher = document.createElement("zimaforge-launcher");
  launcher.position = DEFAULT_SETTINGS.launcher;
  document.body.append(launcher, document.createElement("zimaforge-store"));

  loadSettings().then((s) => {
    applySettings(s);
    if (s.updateCheck !== false) {
      checkForUpdate(false).then((u) => { launcher.updateAvailable = Boolean(u?.available); }).catch(() => {});
    }
  });

  document.addEventListener("keydown", (e) => {
    if (SHORTCUT(e)) {
      e.preventDefault();
      void F.openStore();
    }
  }, true);

  interceptSelfLinks();

  const params = new URLSearchParams(location.search);
  if (params.has("forge") || location.hash === "#forge") void F.openStore(params.get("forge") || undefined);
}

/**
 * Prüft, ob eine URL auf genau diese ZimaForge-Seite zeigt, z. B. wenn ZimaOS die
 * eigene ZimaForge-Kachel öffnet (`http://<host>:8077/?forge`).
 */
function isSelfUrl(raw) {
  try {
    const url = new URL(String(raw), location.href);
    if (url.origin !== location.origin) return false;
    return url.searchParams.has("forge") || url.hash === "#forge";
  } catch {
    return false;
  }
}

/**
 * Klick auf die ZimaForge-Kachel innerhalb von ZimaForge: statt eines zweiten Tabs
 * direkt den Store öffnen. Greift für `window.open(...)` und für Links mit
 * `target="_blank"`, unabhängig vom Dashboard-DOM.
 */
function interceptSelfLinks() {
  const nativeOpen = window.open;
  window.open = function forgeOpen(url, target, features) {
    if (url != null && isSelfUrl(url) && target !== "_self") {
      const view = new URL(String(url), location.href).searchParams.get("forge") || undefined;
      void F.openStore(view);
      // Aufrufer erwarten meist ein Fensterobjekt (z. B. für .focus()).
      return window;
    }
    return nativeOpen.call(this, url, target, features);
  };

  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const link = e.composedPath().find((el) => el instanceof HTMLAnchorElement && el.href);
    if (!link || link.target !== "_blank" || !isSelfUrl(link.href)) return;
    e.preventDefault();
    e.stopPropagation();
    void F.openStore(new URL(link.href).searchParams.get("forge") || undefined);
  }, true);
}
