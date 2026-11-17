// Forge Pulse – System-Widget im Aufbau des ZimaOS-„System“-Widgets.
// Oben: Ringanzeigen für CPU und RAM (Leistung/Temperatur, RAM-Größe).
// Aufgeklappt: Tabs wie in btop – CPU (Kerne, Temperaturen, Apps), RAM, Disk,
// Netz, Prozesse – und ☰ für den Ressourcenmonitor (btop) von ZimaOS.
//
// Quellen: ZimaOS (/v1/sys/utilization) für die Ringe, wenn verfügbar – sonst
// /_forge/api/metrics. Details aus /_forge/api/system (nur wenn aufgeklappt).
(() => {
  "use strict";
  const F = window.ZimaForge;
  if (!F || document.querySelector(".zf-pulse")) return;

  const INTERVAL = 3000;
  const OPEN_KEY = "zf-pulse:details";
  const TAB_KEY = "zf-pulse:tab";
  const TABS = [["cpu", "CPU"], ["mem", "RAM"], ["disk", "Disk"], ["net", "Netz"], ["proc", "Proz."]];
  const ARC = 270;
  const R = 34;
  const CIRC = 2 * Math.PI * R;
  const ARC_LEN = (CIRC * ARC) / 360;

  /* ───────── Formatierung ───────── */

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const fmtBytes = (b, digits = 1) => {
    if (b == null || Number.isNaN(b)) return "–";
    const u = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return `${b.toFixed(i < 2 ? 0 : digits)} ${u[i]}`;
  };
  const fmtRate = (bps) => (bps == null ? "–" : `${fmtBytes(bps)}/s`);
  const fmtPct = (p, d = 1) => (p == null ? "–" : `${p.toFixed(d)} %`);
  const fmtUptime = (s) => {
    if (s == null) return "–";
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d ? `${d} T ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
  };
  const num = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
  const bar = (pct, cls = "") =>
    `<span class="zf-pulse-bar-h ${cls}"><i style="width:${Math.max(0, Math.min(100, pct ?? 0)).toFixed(1)}%"></i></span>`;
  const row = (label, value) => `<div class="zf-pulse-row"><dt>${label}</dt><dd>${value}</dd></div>`;

  /* ───────── Aufbau ───────── */

  const gauge = (key, label, from, to) => `
    <div class="zf-pulse-gauge" data-k="${key}">
      <svg viewBox="0 0 84 84" aria-hidden="true">
        <defs><linearGradient id="zf-pulse-${key}" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
        </linearGradient></defs>
        <circle class="zf-pulse-track" cx="42" cy="42" r="${R}"
          stroke-dasharray="${ARC_LEN} ${CIRC}" transform="rotate(135 42 42)"/>
        <circle class="zf-pulse-ring" cx="42" cy="42" r="${R}" stroke="url(#zf-pulse-${key})"
          stroke-dasharray="0 ${CIRC}" transform="rotate(135 42 42)"/>
      </svg>
      <div class="zf-pulse-value"><b>–</b><small>%</small><span>${label}</span></div>
      <div class="zf-pulse-sub">–</div>
    </div>`;

  const card = document.createElement("section");
  card.className = "zf-pulse";
  card.setAttribute("aria-label", "Forge Pulse – Systemwerte");
  card.innerHTML = `
    <button type="button" class="zf-pulse-head" aria-expanded="false" aria-controls="zf-pulse-details">
      <span class="zf-pulse-title">Pulse</span>
      <svg class="zf-pulse-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
    </button>
    <div class="zf-pulse-gauges">
      ${gauge("cpu", "CPU", "#00b4d8", "#8338ec")}
      ${gauge("mem", "RAM", "#8338ec", "#ff006e")}
    </div>
    <div class="zf-pulse-details" id="zf-pulse-details" hidden>
      <div class="zf-pulse-tabs" role="tablist">
        ${TABS.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}">${l}</button>`).join("")}
        <button type="button" class="zf-pulse-menu" title="Ressourcenmonitor (btop) öffnen" aria-label="Ressourcenmonitor (btop) öffnen">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
        </button>
      </div>
      <div class="zf-pulse-pane" role="tabpanel"><p class="zf-pulse-muted">Lade …</p></div>
      <p class="zf-pulse-note" hidden></p>
    </div>`;

  const head = card.querySelector(".zf-pulse-head");
  const details = card.querySelector(".zf-pulse-details");
  const pane = card.querySelector(".zf-pulse-pane");
  const note = card.querySelector(".zf-pulse-note");
  let tab = "cpu";
  let detail = null; // letzte /system-Antwort
  let prevDetail = null; // vorletzte – für Raten (Disk, Netz)
  let gaugeData = null;

  const setOpen = (open) => {
    details.hidden = !open;
    head.setAttribute("aria-expanded", String(open));
    card.classList.toggle("open", open);
    try { localStorage.setItem(OPEN_KEY, open ? "1" : "0"); } catch { /* egal */ }
    // Erst nach dem Start des Skripts abfragen – tick() und seine Variablen stehen weiter unten.
    if (open) setTimeout(() => void tick(), 0);
  };
  const setTab = (t) => {
    tab = TABS.some(([k]) => k === t) ? t : "cpu";
    for (const b of card.querySelectorAll("[data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
    try { localStorage.setItem(TAB_KEY, tab); } catch { /* egal */ }
    renderPane();
  };
  head.addEventListener("click", () => setOpen(details.hidden));
  card.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
  card.querySelector(".zf-pulse-menu").addEventListener("click", () => void openResourceMonitor());
  try { tab = localStorage.getItem(TAB_KEY) || "cpu"; } catch { /* egal */ }
  setTab(tab);
  try { setOpen(localStorage.getItem(OPEN_KEY) === "1"); } catch { setOpen(false); }

  // In die ZimaOS-Widget-Spalte direkt unter das native „System“-Widget.
  // Immer direkt unter der Uhr (ohne Uhr: unter „System“).
  F.dashboard.mountWidget(card, { after: ["clock", "system"], pin: true });

  /* ───────── Apps: Container -> ZimaOS-App (Titel, Icon) ───────── */

  // ZimaOS-App-Verwaltung: App-Liste (Titel, Icon) und je App die Container-IDs.
  // Vollständige Liste: 5 min gültig. Fehlt etwas (Abruf fehlgeschlagen, App neu gestartet
  // und damit neue Container-ID), wird nach spätestens 15 s neu geladen.
  let appIndex = null;
  let appIndexAt = 0;
  let appIndexComplete = false;
  let appIndexLoading = null;
  const knowsAll = (apps) => (apps ?? []).every((a) => a.containers.some((id) => appIndex?.has(id))
    || appIndex?.has(`name:${a.name.toLowerCase()}`));

  function loadAppIndex(apps) {
    const age = Date.now() - appIndexAt;
    const fresh = appIndex && (appIndexComplete && knowsAll(apps) ? age < 5 * 60_000 : age < 15_000);
    if (fresh) return Promise.resolve(appIndex);
    appIndexLoading ??= fetchAppIndex().finally(() => { appIndexLoading = null; });
    return appIndexLoading;
  }

  async function fetchAppIndex() {
    const map = new Map();
    let complete = false;
    const token = F.sessionToken();
    if (token) {
      const opts = { headers: { Authorization: token }, cache: "no-store" };
      try {
        const res = await fetch("/v2/app_management/web/appgrid", opts);
        const grid = res.ok ? (await res.json())?.data ?? [] : [];
        complete = res.ok;
        await Promise.all((Array.isArray(grid) ? grid : []).filter((a) => a?.name).map(async (a) => {
          const t = a.title;
          const title = (t && typeof t === "object" ? t.de_de || t.en_us || Object.values(t)[0] : t) || a.name;
          const meta = { title, icon: a.icon || null };
          map.set(`name:${String(a.name).toLowerCase()}`, meta);
          try {
            const r = await fetch(`/v2/app_management/compose/${encodeURIComponent(a.name)}/containers`, opts);
            if (!r.ok) { complete = false; return; }
            const containers = (await r.json())?.data?.containers ?? {};
            for (const [key, c] of Object.entries(containers)) {
              const id = String(c?.ID ?? c?.Id ?? c?.id ?? key).toLowerCase();
              if (/^[0-9a-f]{12,64}$/.test(id)) map.set(id.slice(0, 12), meta);
              // Containername (z. B. „jellyfin“) als zweiter Schlüssel.
              for (const n of [c?.Name, ...(Array.isArray(c?.Names) ? c.Names : [])]) {
                if (typeof n === "string" && n) map.set(`name:${n.replace(/^\//, "").toLowerCase()}`, meta);
              }
            }
          } catch { complete = false; }
        }));
      } catch { complete = false; }
    }
    // Ein fehlgeschlagener Abruf ersetzt keine bereits bekannte Zuordnung.
    if (complete || !appIndex?.size) appIndex = map;
    else for (const [k, v] of map) appIndex.set(k, v);
    appIndexComplete = complete;
    appIndexAt = Date.now();
    return appIndex;
  }
  void loadAppIndex();

  /** Verbrauch je ZimaOS-App: Container über die App-Verwaltung zuordnen und zusammenfassen. */
  function groupApps(apps) {
    const groups = new Map();
    for (const a of apps ?? []) {
      const meta = a.containers.map((id) => appIndex?.get(id)).find(Boolean)
        ?? appIndex?.get(`name:${a.name.toLowerCase()}`)
        ?? (/^[0-9a-f]{12}$/.test(a.name) ? null : { title: a.name, icon: null });
      // Nicht zuordenbar: trotzdem einzeln zeigen, nie zu einem Sammeleintrag zusammenfassen.
      const key = meta?.title ?? `Container ${a.name.slice(0, 12)}`;
      const g = groups.get(key) ?? { title: key, icon: meta?.icon ?? null, cpu: 0, mem: 0, other: !meta };
      g.cpu += a.cpuPercent;
      g.mem += a.memBytes;
      groups.set(key, g);
    }
    return [...groups.values()];
  }

  const appRows = (key) => {
    const groups = groupApps(detail?.apps);
    if (!groups.length) return '<p class="zf-pulse-muted">Keine laufenden Apps gefunden.</p>';
    const total = detail?.mem?.total || 1;
    const value = (g) => (key === "mem" ? (g.mem / total) * 100 : g.cpu);
    const sorted = groups.sort((a, b) => (a.other - b.other) || value(b) - value(a));
    return `<ul class="zf-pulse-apps">${sorted.map((g) => {
      const icon = g.icon
        ? `<img src="${esc(g.icon)}" alt="" loading="lazy">`
        : `<span class="zf-pulse-app-dot">${esc(g.title[0]?.toUpperCase())}</span>`;
      const tip = key === "mem" ? `${((g.mem / total) * 100).toFixed(1)} % des RAM` : `${g.cpu.toFixed(2)} % der gesamten CPU`;
      const shown = key === "mem" ? fmtBytes(g.mem) : `${g.cpu.toFixed(1)}%`;
      return `<li title="${esc(tip)}">${icon}<span class="zf-pulse-app-name">${esc(g.title)}</span><b>${shown}</b></li>`;
    }).join("")}</ul>`;
  };

  /* ───────── Tabs ───────── */

  function rate(key) {
    if (!detail || !prevDetail || detail[key] == null || prevDetail[key] == null) return null;
    const dt = (detail.timestampMs - prevDetail.timestampMs) / 1000;
    return dt > 0 ? Math.max(0, (detail[key] - prevDetail[key]) / dt) : null;
  }

  function renderPane() {
    if (!detail) return;
    const d = detail;
    let html = "";
    if (tab === "cpu") {
      // Wie im ZimaOS-System-Widget: nur die Apps mit ihrem CPU-Anteil.
      html += appRows("cpu");
    } else if (tab === "mem") {
      // Wie im ZimaOS-System-Widget: nur die Apps mit ihrem RAM-Anteil.
      html += appRows("mem");
    } else if (tab === "disk") {
      html += (d.disks ?? []).map((k) => `
        <div class="zf-pulse-disk"><div class="zf-pulse-row"><dt>${esc(k.label)}</dt><dd>${fmtBytes(k.used)} von ${fmtBytes(k.total)}</dd></div>
        ${bar((k.used / k.total) * 100, k.used / k.total > 0.9 ? "hot" : "")}
        <div class="zf-pulse-row zf-pulse-muted"><dt>frei</dt><dd>${fmtBytes(k.free)}</dd></div></div>`).join("")
        || '<p class="zf-pulse-muted">Keine Datenträgerinfo.</p>';
      html += `<dl class="zf-pulse-list">
        ${row("Lesen", fmtRate(rate("diskReadBytes")))}
        ${row("Schreiben", fmtRate(rate("diskWriteBytes")))}
      </dl>`;
    } else if (tab === "net") {
      const prevIf = new Map((prevDetail?.net ?? []).map((n) => [n.name, n]));
      const dt = prevDetail ? (d.timestampMs - prevDetail.timestampMs) / 1000 : 0;
      html += (d.net ?? []).map((n) => {
        const p = prevIf.get(n.name);
        const rx = p && dt > 0 ? Math.max(0, (n.rxBytes - p.rxBytes) / dt) : null;
        const tx = p && dt > 0 ? Math.max(0, (n.txBytes - p.txBytes) / dt) : null;
        return `<h4>${esc(n.name)}</h4><dl class="zf-pulse-list">
          ${row("↓ Download", fmtRate(rx))}${row("↑ Upload", fmtRate(tx))}
          ${row("Gesamt ↓ / ↑", `${fmtBytes(n.rxBytes)} / ${fmtBytes(n.txBytes)}`)}</dl>`;
      }).join("") || '<p class="zf-pulse-muted">Keine Netzwerkschnittstelle gefunden.</p>';
    } else if (tab === "proc") {
      html += `<table class="zf-pulse-procs"><thead><tr><th>Prozess</th><th>CPU</th><th>RAM</th></tr></thead><tbody>${
        (d.processes ?? []).map((p) => `<tr title="PID ${p.pid}${p.container ? ` · Container ${esc(p.container)}` : ""}">
          <td>${esc(p.name)}</td><td>${p.cpuPercent.toFixed(1)}%</td><td>${fmtBytes(p.memBytes)}</td></tr>`).join("")
      }</tbody></table>`;
    }
    pane.innerHTML = html;
  }

  /* ───────── Ressourcenmonitor (btop) von ZimaOS ───────── */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => Boolean(el && el.getClientRects().length);
  const leafWithText = (root, text) =>
    [...root.querySelectorAll("*")].find((el) => !el.childElementCount && visible(el) && el.textContent.trim().toLowerCase() === text);

  // Rechtestes anklickbares Element in derselben Bildschirmzeile wie `anchor`, rechts davon.
  function iconRightOf(root, anchor) {
    const a = anchor.getBoundingClientRect();
    const mid = a.top + a.height / 2;
    const candidates = [...root.querySelectorAll("button, [role=button], a, svg, i, img, span, div")]
      .filter((el) => {
        if (el.contains(anchor) || anchor.contains(el) || !visible(el)) return false;
        const r = el.getBoundingClientRect();
        const small = r.width > 0 && r.width <= 48 && r.height <= 48;
        const inRow = Math.abs(r.top + r.height / 2 - mid) <= Math.max(14, a.height);
        const isIcon = el.matches("button, [role=button], a, svg, i, img") || getComputedStyle(el).cursor === "pointer";
        return small && inRow && r.left >= a.right && isIcon;
      })
      .sort((x, y) => y.getBoundingClientRect().right - x.getBoundingClientRect().right);
    const el = candidates[0];
    return el ? el.closest("button, [role=button], a") || el : null;
  }

  // Nur ein click – weitere Zeiger-Ereignisse könnten Umschalter doppelt auslösen.
  const fire = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));

  /** Wartet bis zu `ms`, ob ZimaOS ein Fenster öffnet (btop läuft über ttyd auf wechselndem Port). */
  function watchWindowOpen(ms) {
    const original = window.open;
    let opened = null;
    const watched = function (...args) {
      opened = String(args[0] ?? "");
      return original.apply(this, args);
    };
    window.open = watched;
    return new Promise((resolve) => {
      const started = Date.now();
      const poll = setInterval(() => {
        if (opened !== null || Date.now() - started > ms) {
          clearInterval(poll);
          if (window.open === watched) window.open = original;
          resolve(opened);
        }
      }, 100);
    });
  }

  function describe(el) {
    const r = el.getBoundingClientRect();
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.className && typeof el.className === "string" ? `.${el.className.trim().split(/\s+/).join(".")}` : ""} @${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)}`;
  }

  /**
   * Adresse von btop aus der Antwort von `POST /v2/zimaos/tty/btop`.
   * Akzeptiert u. a. `{data: {port}}`, `{data: {url}}`, `{port}`, `{data: 32442}`.
   */
  function btopUrlFrom(body) {
    const d = body?.data ?? body;
    for (const c of [d?.url, d?.address, d?.link, typeof d === "string" ? d : null]) {
      if (typeof c === "string" && /^https?:\/\//i.test(c)) {
        const u = new URL(c);
        // ZimaOS kennt sich selbst oft nur als localhost – Host des Browsers verwenden.
        if (["127.0.0.1", "0.0.0.0", "localhost", "::1"].includes(u.hostname)) u.hostname = location.hostname;
        return u.href;
      }
    }
    const raw = d?.port ?? d?.Port ?? (typeof d === "number" || /^\d+$/.test(String(d ?? "")) ? d : null);
    const port = num(raw);
    return port && port > 0 && port < 65536 ? `${location.protocol}//${location.hostname}:${port}/` : null;
  }

  // Wie ☰ im ZimaOS-System-Widget: btop über ZimaOS starten (läuft über ZimaForge an den
  // eingestellten ZimaOS-Port, ZIMAFORGE_UPSTREAM) und die Adresse mit dem neuen Port öffnen.
  async function openResourceMonitor() {
    note.hidden = true;
    // Fenster sofort im Klick öffnen – nach dem await würde ein Popup-Blocker zuschlagen.
    const win = window.open("", "_blank");
    try {
      const res = await fetch("/v2/zimaos/tty/btop", {
        method: "POST",
        headers: { Authorization: F.sessionToken(), Accept: "application/json" },
        cache: "no-store",
      });
      const body = await res.json().catch(() => null);
      const url = res.ok ? btopUrlFrom(body) : null;
      if (url) {
        if (win && !win.closed) win.location.href = url;
        else window.open(url, "_blank");
        return;
      }
      console.info("[Forge Pulse] btop: Antwort von /v2/zimaos/tty/btop ohne Port", res.status, body);
    } catch (err) {
      console.info("[Forge Pulse] btop: /v2/zimaos/tty/btop nicht erreichbar", err);
    }
    if (win && !win.closed) win.close();
    await openViaNativeButton();
  }

  // Ausweg für ältere ZimaOS-Versionen: ☰ im nativen System-Widget anklicken.
  async function openViaNativeButton() {
    const system = F.dashboard.nativeWidget("system");
    let menu = null;
    if (system) {
      const findMenu = () => { const ram = leafWithText(system, "ram"); return ram ? iconRightOf(system, ram) : null; };
      menu = findMenu();
      if (!menu) {
        // Natives Widget zugeklappt: Pfeil rechts neben „System“ anklicken.
        const title = leafWithText(system, "system");
        const chevron = title && iconRightOf(system, title);
        if (chevron) {
          fire(chevron);
          for (let i = 0; i < 12 && !menu; i++) { await sleep(120); menu = findMenu(); }
        }
      }
    }
    if (menu) {
      // Wie ein Klick auf ☰ im System-Widget: ZimaOS startet btop und öffnet die Adresse.
      const watching = watchWindowOpen(5000);
      fire(menu);
      const url = await watching;
      if (url !== null) return;
      note.textContent = "ZimaOS hat btop nicht geöffnet. Details stehen in der Browser-Konsole.";
    } else {
      note.textContent = "btop-Button von ZimaOS nicht gefunden. Details stehen in der Browser-Konsole.";
    }
    note.hidden = false;
    const ram = system && leafWithText(system, "ram");
    console.info("[Forge Pulse] ☰ → btop fehlgeschlagen.", {
      systemWidget: system ? describe(system) : "(nicht gefunden)",
      ramTab: ram ? describe(ram) : "(nicht gefunden)",
      angeklickt: menu ? describe(menu) : "(nichts)",
      kandidaten: ram ? [...system.querySelectorAll("*")]
        .filter((el) => visible(el) && Math.abs(el.getBoundingClientRect().top - ram.getBoundingClientRect().top) < 30)
        .slice(0, 25).map(describe) : [],
      html: system ? system.outerHTML.slice(0, 3000) : "",
    });
  }

  /* ───────── Werte ───────── */

  let zimaPausedUntil = 0;
  let prevPower = null;
  async function zimaUtilization() {
    const token = F.sessionToken();
    if (!token || Date.now() < zimaPausedUntil) return null;
    try {
      const res = await fetch("/v1/sys/utilization", { headers: { Authorization: token }, cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const body = await res.json();
      const d = body?.data ?? body;
      const cpu = d?.cpu ?? {}, mem = d?.mem ?? {};
      let watts = null;
      const energy = num(cpu.power?.value ?? cpu.power);
      const now = performance.now();
      if (energy != null && prevPower && energy >= prevPower.e && now > prevPower.t) {
        const w = (energy - prevPower.e) / 1e6 / ((now - prevPower.t) / 1000);
        if (w >= 0 && w < 2000) watts = w;
      }
      if (energy != null) prevPower = { e: energy, t: now };
      const out = {
        cpuPercent: num(cpu.percent), temperature: num(cpu.temperature), watts,
        memPercent: num(mem.usedPercent), memTotal: num(mem.total),
      };
      return out.cpuPercent != null || out.memPercent != null ? out : null;
    } catch {
      zimaPausedUntil = Date.now() + 60_000;
      return null;
    }
  }

  function setGauge(key, percent, sub) {
    const g = card.querySelector(`[data-k=${key}]`);
    const v = percent == null ? null : Math.max(0, Math.min(100, percent));
    g.querySelector("b").textContent = v == null ? "–" : Math.round(v);
    g.querySelector(".zf-pulse-ring").setAttribute("stroke-dasharray", `${v == null ? 0 : (ARC_LEN * v) / 100} ${CIRC}`);
    g.classList.toggle("hot", v != null && v >= 85);
    g.querySelector(".zf-pulse-sub").textContent = sub;
  }

  let lastWatts = null;
  let timer = null;
  let busy = false;
  let detailTick = 0;

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      // Details (Prozess-Scan auf dem Server) nur jeden zweiten Takt, also alle 6 s.
      const wantDetail = !details.hidden && (!detail || ++detailTick % 2 === 0);
      // Details parallel holen, aber Ringanzeigen nicht darauf warten lassen
      // (der Prozess-Scan ist der langsamste Abruf).
      const detailReq = wantDetail
        ? fetch("/_forge/api/system", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
        : null;
      const [z, m] = await Promise.all([zimaUtilization(), F.metrics().catch(() => null)]);
      if (!z && !m) { card.classList.add("offline"); await detailReq; return; }
      card.classList.remove("offline");
      card.dataset.source = z ? "zimaos" : "zimaforge";
      card.title = z ? "Werte: ZimaOS (wie System-Widget)" : "Werte: ZimaForge-Messung";

      const watts = z?.watts ?? (z ? lastWatts : null) ?? m?.powerWatts ?? null;
      if (watts != null) lastWatts = watts;
      const temp = z?.temperature ?? m?.temperature;
      const memTotal = z?.memTotal ?? m?.memTotal;
      gaugeData = { watts, temp, load: m?.load, uptime: m?.uptimeSeconds };
      setGauge("cpu", z?.cpuPercent ?? m?.cpuPercent,
        [watts != null ? `${watts.toFixed(1)} W` : null, temp != null ? `${temp.toFixed(1)} °C` : null].filter(Boolean).join(" / ") || "–");
      setGauge("mem", z?.memPercent ?? m?.memPercent, memTotal ? fmtBytes(memTotal) : "–");

      const s = await detailReq;
      if (s) {
        prevDetail = detail;
        detail = s;
        // Auf App-Namen höchstens kurz warten; kommen sie später, wird nachgezeichnet.
        const index = loadAppIndex(s.apps);
        const inTime = await Promise.race([index.then(() => true), sleep(700).then(() => false)]);
        renderPane();
        if (!inTime) void index.then(() => renderPane());
      }
    } finally {
      busy = false;
    }
  }

  const start = () => { if (!timer) { void tick(); timer = setInterval(tick, INTERVAL); } };
  const stop = () => { clearInterval(timer); timer = null; };
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  start();
})();
