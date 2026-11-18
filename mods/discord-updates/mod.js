// Discord-Updates – meldet App-Updates aus dem ZimaOS App Store per Webhook in Discord.
//
// Läuft im Browser, solange ein Dashboard offen ist. Die Prüfzeit und die schon
// gemeldeten Updates liegen in der Mod-Einstellung auf dem Server – mehrere Tabs oder
// Geräte prüfen deshalb nicht doppelt und melden jedes Update nur einmal.
(() => {
  "use strict";
  const F = window.ZimaForge;
  if (!F?.dashboard || document.querySelector(".zf-discord")) return;

  const ID = "discord-updates";
  const API = "/v2/app_management";
  // trigger: vor dem Abfragen wie „Check again“ eine Prüfung anstoßen.
  const DEFAULTS = { webhook: "", interval: 30, enabled: true, trigger: true, sent: {}, lastCheck: 0 };
  const INTERVALS = [15, 30, 60, 180, 360, 720, 1440];
  const LOCK_KEY = "zf-discord-updates:lock";
  const COLOR = 0xff006e; // ZimaForge-Pink: neue Version
  const COLOR_IMAGE = 0x00b4d8; // Cyan: neues Image unter gleichem Tag
  const LOCALE = (navigator.language || "de-DE").replace("-", "_");
  const AVATAR = "https://raw.githubusercontent.com/MarcelRuh/zimaforge/main/assets/icon.png";
  // Nur echte Discord-Webhooks – die Adresse landet in einer Anfrage aus deinem Browser.
  const WEBHOOK = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d{5,25}\/[\w-]{20,120}$/;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  // Discord-Markdown in Namen und Versionen nicht auswerten lassen.
  const md = (s) => String(s ?? "").replace(/([\\*_~`|>[\]()])/g, "\\$1");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const auth = () => ({ Authorization: F.sessionToken(), Accept: "application/json" });

  let config = { ...DEFAULTS };
  let state = { status: "idle", updates: [], message: "" };
  let editing = false;
  // Zuletzt hier gemeldet – falls das Speichern scheitert (z. B. kein Administrator),
  // trotzdem nicht jede Minute erneut nach Discord schicken.
  let memo = { lastCheck: 0, sent: {} };

  /* ───────────────────────── Einstellungen ───────────────────────── */

  async function loadConfig() {
    const c = (await F.getConfig(ID, null)) ?? {};
    config = { ...DEFAULTS, ...c, sent: { ...(c.sent ?? {}) } };
    if (!INTERVALS.includes(Number(config.interval))) config.interval = DEFAULTS.interval;
    if (memo.lastCheck > Number(config.lastCheck || 0)) {
      config.lastCheck = memo.lastCheck;
      config.sent = { ...config.sent, ...memo.sent };
    }
    return config;
  }

  /** Speichert Änderungen auf Basis des aktuellen Server-Stands (andere Geräte könnten gemeldet haben). */
  async function saveConfig(patch) {
    const fresh = (await F.getConfig(ID, null)) ?? {};
    const next = { ...DEFAULTS, ...fresh, ...patch };
    next.sent = { ...(fresh.sent ?? {}), ...(patch.sent ?? {}) };
    if (patch.prune) {
      for (const key of Object.keys(next.sent)) if (!patch.prune.includes(key)) delete next.sent[key];
    }
    delete next.prune;
    config = await F.setConfig(ID, next);
    return config;
  }

  /* ───────────────────────── ZimaOS: verfügbare Updates ───────────────────────── */

  const titleOf = (t, fallback) =>
    (t && typeof t === "object" ? t.de_de || t.de_DE || t.en_us || t.en_US || Object.values(t)[0] : t) || fallback;

  /** Neue Version aus dem App Store (`/apps/{id}/stable`), falls ZimaOS sie verrät. */
  async function stableVersion(storeAppId) {
    try {
      const res = await fetch(`${API}/apps/${encodeURIComponent(storeAppId)}/stable`, { headers: auth(), cache: "no-store" });
      if (!res.ok) return null;
      const d = (await res.json())?.data;
      const v = typeof d === "string" ? d : d?.tag ?? d?.Tag ?? d?.version ?? d?.stable ?? null;
      return v ? String(v) : null;
    } catch {
      return null;
    }
  }

  const getJson = async (path, init = {}) => {
    const res = await fetch(`${API}${path}`, {
      cache: "no-store",
      ...init,
      headers: { ...auth(), ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
    });
    if (res.status === 401) throw Object.assign(new Error("ZimaOS-Anmeldung abgelaufen."), { status: 401 });
    if (!res.ok) throw Object.assign(new Error(`ZimaOS antwortet mit ${res.status}.`), { status: res.status });
    return res.json();
  };
  const items = (body) => (Array.isArray(body?.data?.items) ? body.data.items : []);
  const clean = (v) => {
    const s = String(v ?? "").trim();
    // Wie der App Store: Platzhalter wie „0.0.0“, „n/a“, „unknown“ gelten als unbekannt.
    return !s || /^(?:v?0+(?:\.0+)*(?:[-+].*)?|n\/?a|unknown|none|null|undefined|[-–—]+)$/i.test(s) ? "" : s;
  };
  const shortDigest = (d) => String(d ?? "").replace(/^sha256:/, "").slice(0, 12);

  /**
   * Wie „Check again“ im App Store: Update-Prüfung für alle Apps (`items: []`) und einen
   * neuen Abgleich der Images anstoßen. Nur Abfragen – installiert wird nichts.
   */
  async function triggerCheck() {
    await Promise.allSettled([
      getJson("/zimaapp/update/check", { method: "POST", body: JSON.stringify({ items: [], locale: LOCALE, options: { sync: true } }) }),
      getJson("/zimaapp/v2app/images/drift/list", { method: "POST", body: JSON.stringify({ options: { sync: false } }) }),
    ]);
  }

  /** App-Updates aus dem App Store (neue Version). Ignorierte haben eine andere `availability`. */
  async function appUpdates() {
    return items(await getJson(`/zimaapp/updates?locale=${encodeURIComponent(LOCALE)}`))
      .filter((u) => u?.zimaapp_id && u.availability === "available")
      .map((u) => {
        const ch = (u.changes ?? []).find((c) => c?.type === "version")
          ?? (u.changes ?? []).find((c) => c?.current_version || c?.target_version) ?? {};
        const latest = clean(ch.target_version);
        return {
          kind: "app",
          id: String(u.zimaapp_id),
          title: titleOf(u.title, u.zimaapp_id).trim(),
          icon: typeof u.icon === "string" ? u.icon.trim() : "",
          version: clean(ch.current_version),
          latest,
          changelog: String(u.changelog ?? "").trim(),
          key: latest || String(u.changelog ?? "").trim().slice(0, 80) || "update",
        };
      });
  }

  /** Neue Images unter gleichem Tag (z. B. `:latest`) – „Image-Änderungen“ im App Store. */
  async function imageUpdates() {
    return items(await getJson("/zimaapp/v2app/images/drift/list"))
      .map((d) => {
        const changed = (d?.images ?? []).filter((img) => img?.target_digest
          && !(Array.isArray(img.current_digests) ? img.current_digests : []).includes(img.target_digest));
        if (!d?.zimaapp_id || !changed.length) return null;
        return {
          kind: "image",
          id: `image:${d.zimaapp_id}`,
          title: titleOf(d.title, d.name || d.zimaapp_id).trim(),
          icon: typeof d.icon === "string" ? d.icon.trim() : "",
          version: clean(d.installed_version),
          images: changed.map((img) => ({
            image: String(img.target_image || img.current_image || ""),
            from: shortDigest(img.current_digests?.[0]),
            to: shortDigest(img.target_digest),
          })),
          // Jede Änderung hat eine eigene Kennung – so wird jedes neue Image einmal gemeldet.
          key: String(d.drift_revision || changed.map((i) => i.target_digest).join(",")),
        };
      })
      .filter(Boolean);
  }

  /** Ältere ZimaOS-/CasaOS-Versionen ohne `zimaapp`-Schnittstelle. */
  async function legacyUpdates() {
    const body = await getJson("/apps/upgradable");
    const list = Array.isArray(body?.data) ? body.data : [];
    const apps = list
      .filter((a) => a?.store_app_id && a.status !== "updating")
      .map((a) => ({
        kind: "app",
        id: String(a.store_app_id),
        title: titleOf(a.title, a.store_app_id),
        version: a.version ? String(a.version) : "",
        icon: typeof a.icon === "string" ? a.icon : "",
        changelog: "",
      }));
    await Promise.all(apps.map(async (a) => { a.latest = await stableVersion(a.id); }));
    for (const a of apps) a.key = a.latest || `>${a.version}`;
    return apps;
  }

  /** Alles, was der Reiter „Aktualisieren“ zeigt: App-Updates und neue Images. */
  async function upgradable() {
    if (config.trigger !== false) await triggerCheck();
    let apps;
    try {
      apps = await appUpdates();
    } catch (err) {
      if (err.status !== 404) throw err;
      return legacyUpdates();
    }
    let images = [];
    try { images = await imageUpdates(); } catch (err) { if (err.status === 401) throw err; }
    // Hat eine App beides, reicht die Meldung mit der neuen Version.
    const withVersion = new Set(apps.map((a) => a.id));
    return [...apps, ...images.filter((i) => !withVersion.has(i.id.slice("image:".length)))];
  }

  /* ───────────────────────── Discord ───────────────────────── */

  function embedFor(app) {
    const where = "In ZimaOS unter **App Store → Meine Apps → Aktualisieren** installieren.";
    let title, description;
    if (app.kind === "image") {
      title = `Neues Image: ${app.title}`;
      const lines = app.images.slice(0, 5).map((i) => `\`${md(i.image)}\`${i.from ? ` · ${i.from} → ${i.to}` : ` · neu: ${i.to}`}`);
      description = `${lines.join("\n")}\n\nGleicher Tag, neuer Inhalt.${app.version ? ` Installiert: **${md(app.version)}**.` : ""}\n\n${where}`;
    } else {
      title = `Update verfügbar: ${app.title}`;
      const versions = app.latest
        ? (app.version ? `**${md(app.version)}** → **${md(app.latest)}**` : `Neue Version **${md(app.latest)}**`)
        : `Installiert: **${md(app.version || "?")}**`;
      // Änderungen (falls der App Store welche nennt), gekürzt – Discord erlaubt 4096 Zeichen.
      const notes = app.changelog ? `\n\n${app.changelog.length > 600 ? `${app.changelog.slice(0, 600)} …` : app.changelog}` : "";
      description = `${versions}${notes}\n\n${where}`;
    }
    const embed = {
      author: { name: "ZimaOS App Store" },
      title: title.slice(0, 256),
      url: `${location.origin}/`,
      description: description.slice(0, 4000),
      color: app.kind === "image" ? COLOR_IMAGE : COLOR,
      footer: { text: `ZimaForge · ${location.host}` },
      timestamp: new Date().toISOString(),
    };
    // Discord lädt Bilder selbst – nur öffentlich erreichbare https-Adressen.
    if (/^https:\/\//i.test(app.icon)) embed.thumbnail = { url: app.icon };
    return embed;
  }

  /**
   * Schickt eine Nachricht an den Webhook. Erst normal (mit Antwort und Fehlermeldung);
   * blockiert der Browser das (CORS), als Formular mit `payload_json` – das braucht keine
   * Freigabe, liefert aber keine Antwort.
   */
  async function post(webhook, payload) {
    const body = { username: "ZimaOS", avatar_url: AVATAR, allowed_mentions: { parse: [] }, ...payload };
    for (let attempt = 0; attempt < 3; attempt++) {
      let res;
      try {
        res = await fetch(`${webhook}?wait=true`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        const form = new FormData();
        form.append("payload_json", JSON.stringify(body));
        await fetch(webhook, { method: "POST", mode: "no-cors", body: form });
        return;
      }
      if (res.ok) return;
      if (res.status === 429) {
        const wait = Number((await res.json().catch(() => ({})))?.retry_after ?? 2);
        await sleep(Math.min(30, Math.max(1, wait)) * 1000);
        continue;
      }
      const err = await res.json().catch(() => null);
      throw new Error(res.status === 404 || res.status === 401
        ? "Webhook gibt es nicht (mehr) – Adresse prüfen."
        : `Discord: ${err?.message || res.status}`);
    }
    throw new Error("Discord: zu viele Anfragen, später erneut.");
  }

  async function notify(apps) {
    // Höchstens 10 Embeds je Nachricht (Discord-Grenze).
    for (let i = 0; i < apps.length; i += 10) {
      const chunk = apps.slice(i, i + 10);
      const content = i === 0
        ? (apps.length === 1 ? "📦 1 App-Update verfügbar" : `📦 ${apps.length} App-Updates verfügbar`)
        : undefined;
      await post(config.webhook, { content, embeds: chunk.map(embedFor) });
      if (i + 10 < apps.length) await sleep(1200);
    }
  }

  /* ───────────────────────── Prüfen ───────────────────────── */

  // Nur ein Tab dieses Browsers prüft gleichzeitig.
  function takeLock() {
    try {
      const held = Number(localStorage.getItem(LOCK_KEY) || 0);
      if (Date.now() - held < 2 * 60_000) return false;
      localStorage.setItem(LOCK_KEY, String(Date.now()));
    } catch { /* ohne localStorage: einfach prüfen */ }
    return true;
  }
  const releaseLock = () => { try { localStorage.removeItem(LOCK_KEY); } catch { /* egal */ } };

  let running = false;
  async function check({ manual = false } = {}) {
    if (running || !F.sessionToken()) return;
    const intervalMs = config.interval * 60_000;
    if (!manual) {
      if (!config.enabled || !WEBHOOK.test(config.webhook)) return;
      // Nach eigenem Stand noch nicht fällig: nicht einmal den Server fragen.
      if (Date.now() - Number(config.lastCheck || 0) < intervalMs) return;
      if (!takeLock()) return;
    }
    running = true;
    state = { ...state, status: "checking", message: "" };
    render();
    try {
      await loadConfig(); // aktueller Stand: vielleicht hat ein anderes Gerät schon gemeldet
      const due = Date.now() - Number(config.lastCheck || 0) >= intervalMs;
      if (!manual && !due) {
        state = { ...state, status: "idle" };
        return;
      }
      const apps = await upgradable();
      const fresh = apps.filter((a) => config.sent[a.id] !== a.key);
      if (fresh.length && WEBHOOK.test(config.webhook)) await notify(fresh);
      const sent = Object.fromEntries(apps.map((a) => [a.id, a.key]));
      memo = { lastCheck: Date.now(), sent };
      state = {
        status: "ok",
        updates: apps,
        message: fresh.length ? `${fresh.length} neu an Discord gemeldet.` : "",
      };
      // Erledigte Updates vergessen – kommt später eine neue Version, wird sie wieder gemeldet.
      await saveConfig({ lastCheck: memo.lastCheck, sent, prune: apps.map((a) => a.id) });
    } catch (err) {
      state = { ...state, status: "error", message: err.message };
      console.info("[Discord-Updates]", err);
    } finally {
      running = false;
      if (!manual) releaseLock();
      render();
    }
  }

  /* ───────────────────────── Widget ───────────────────────── */

  const card = document.createElement("section");
  card.className = "zf-discord";
  card.setAttribute("aria-label", "Discord-Updates");
  const body = document.createElement("div");
  card.append(body);
  F.dashboard.mountWidget(card, { position: "end" });

  const fmtTime = (t) => (t ? new Date(t).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "noch nie");

  function render() {
    if (editing) return;
    const configured = WEBHOOK.test(config.webhook);
    const n = state.updates.length;
    const line = !configured ? "Noch kein Webhook eingerichtet."
      : !config.enabled ? "Pausiert."
      : state.status === "checking" ? "Prüfe …"
      : state.status === "error" ? state.message
      : `${n ? `${n} Update${n === 1 ? "" : "s"} offen` : "Alle Apps aktuell"} · geprüft ${fmtTime(config.lastCheck)}`;
    body.innerHTML = `
      <div class="zf-discord-head">
        <span class="zf-discord-title">App-Updates <span aria-hidden="true">→</span> Discord</span>
        <button type="button" class="zf-discord-btn" data-act="settings" aria-label="Einstellungen" title="Einstellungen">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>
        </button>
      </div>
      <p class="zf-discord-line ${state.status === "error" ? "err" : ""}" aria-live="polite">${esc(line)}</p>
      ${n ? `<ul class="zf-discord-apps">${state.updates.slice(0, 5).map((a) => `
        <li>${/^https?:\/\//i.test(a.icon) || a.icon.startsWith("/") ? `<img src="${esc(a.icon)}" alt="" loading="lazy">` : `<i>${esc(a.title[0] ?? "?")}</i>`}
          <span>${esc(a.title)}</span><b>${esc(a.kind === "image" ? "neues Image" : a.latest ? (a.version ? `${a.version} → ${a.latest}` : a.latest) : a.version)}</b></li>`).join("")}</ul>` : ""}
      ${state.message && state.status === "ok" ? `<p class="zf-discord-note">${esc(state.message)}</p>` : ""}
      ${configured ? `<button type="button" class="zf-discord-link" data-act="check">Jetzt prüfen</button>` : ""}`;
  }

  function renderSettings(message = "", kind = "") {
    editing = true;
    body.innerHTML = `
      <div class="zf-discord-head"><span class="zf-discord-title">Discord-Updates</span></div>
      <form class="zf-discord-form">
        <label for="zf-discord-url">Webhook-Adresse</label>
        <input id="zf-discord-url" type="url" inputmode="url" autocomplete="off" spellcheck="false"
          placeholder="https://discord.com/api/webhooks/…" value="${esc(config.webhook)}">
        <p class="zf-discord-hint">Discord: Kanal bearbeiten → Integrationen → Webhooks → Neuer Webhook → URL kopieren.</p>
        <div class="zf-discord-row">
          <label for="zf-discord-int">Prüfen alle</label>
          <select id="zf-discord-int">${INTERVALS.map((m) => `<option value="${m}" ${m === Number(config.interval) ? "selected" : ""}>${m < 60 ? `${m} Min.` : `${m / 60} Std.`}</option>`).join("")}</select>
        </div>
        <label class="zf-discord-check"><input id="zf-discord-on" type="checkbox" ${config.enabled ? "checked" : ""}> Automatisch melden</label>
        ${message ? `<p class="zf-discord-note ${kind}" role="status">${esc(message)}</p>` : ""}
        <div class="zf-discord-actions">
          <button type="submit" data-act="save">Speichern</button>
          <button type="button" data-act="test" class="ghost">Test senden</button>
          <button type="button" data-act="cancel" class="ghost">Zurück</button>
        </div>
      </form>`;
    body.querySelector("#zf-discord-url").focus({ preventScroll: true });
  }

  const formValues = () => ({
    webhook: body.querySelector("#zf-discord-url").value.trim(),
    interval: Number(body.querySelector("#zf-discord-int").value),
    enabled: body.querySelector("#zf-discord-on").checked,
  });

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = formValues();
    if (v.webhook && !WEBHOOK.test(v.webhook)) return renderSettings("Das ist keine Discord-Webhook-Adresse.", "err");
    try {
      await saveConfig(v);
      editing = false;
      render();
      void check({ manual: true });
    } catch (err) {
      renderSettings(err.message, "err");
    }
  });

  body.addEventListener("click", async (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "settings") return renderSettings();
    if (act === "cancel") { editing = false; return render(); }
    if (act === "check") return void check({ manual: true });
    if (act === "test") {
      const v = formValues();
      if (!WEBHOOK.test(v.webhook)) return renderSettings("Das ist keine Discord-Webhook-Adresse.", "err");
      const keep = { ...config };
      try {
        config = { ...config, webhook: v.webhook };
        await post(v.webhook, {
          content: "✅ ZimaForge ist mit diesem Kanal verbunden.",
          embeds: [embedFor({ title: "Beispiel-App", version: "1.0.0", latest: "1.1.0", icon: AVATAR })],
        });
        config = keep;
        renderSettings("Testnachricht gesendet – schau in Discord nach.", "ok");
      } catch (err) {
        config = keep;
        renderSettings(err.message, "err");
      }
    }
  });

  /* ───────────────────────── Start ───────────────────────── */

  void loadConfig().then(() => {
    render();
    // Kurz nach dem Laden prüfen, danach jede Minute nachsehen, ob die Zeit um ist.
    setTimeout(() => void check(), 20_000);
    setInterval(() => void check(), 60_000);
  });
})();
