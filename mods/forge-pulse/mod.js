// Forge Pulse – System-Widget im Aufbau des ZimaOS-„System“-Widgets:
// zwei Ringanzeigen (CPU, RAM), darunter Leistung/Temperatur und RAM-Größe,
// aufklappbar mit CPU/RAM-Tabs und ☰-Button für den ZimaOS-Ressourcenmonitor.
//
// Werte: bevorzugt dieselbe Quelle wie das ZimaOS-Widget (/v1/sys/utilization),
// sonst die eigene Messung von ZimaForge (/_forge/api/metrics).
(() => {
  "use strict";
  const F = window.ZimaForge;
  if (!F || document.querySelector(".zf-pulse")) return;

  const INTERVAL = 3000;
  const OPEN_KEY = "zf-pulse:details";
  const TAB_KEY = "zf-pulse:tab";
  const ARC = 270; // Grad, unten offen
  const R = 34;
  const CIRC = 2 * Math.PI * R;
  const ARC_LEN = (CIRC * ARC) / 360;

  const fmtBytes = (b, digits = 1) => {
    if (b == null || Number.isNaN(b)) return "–";
    const u = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return `${b.toFixed(i < 2 ? 0 : digits)} ${u[i]}`;
  };
  const fmtRate = (bps) => (bps == null ? "–" : `${fmtBytes(bps)}/s`);
  const fmtUptime = (s) => {
    if (s == null) return "–";
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d ? `${d} T ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
  };
  const num = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

  const gauge = (key, label, from, to) => `
    <div class="zf-pulse-gauge" data-k="${key}">
      <svg viewBox="0 0 84 84" aria-hidden="true">
        <defs><linearGradient id="zf-pulse-${key}" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
        </linearGradient></defs>
        <circle class="zf-pulse-track" cx="42" cy="42" r="${R}"
          stroke-dasharray="${ARC_LEN} ${CIRC}" transform="rotate(135 42 42)"/>
        <circle class="zf-pulse-bar" cx="42" cy="42" r="${R}" stroke="url(#zf-pulse-${key})"
          stroke-dasharray="0 ${CIRC}" transform="rotate(135 42 42)"/>
      </svg>
      <div class="zf-pulse-value"><b>–</b><small>%</small><span>${label}</span></div>
      <div class="zf-pulse-sub" data-sub="${key}">–</div>
    </div>`;

  const row = (label, key) => `<div class="zf-pulse-row"><dt>${label}</dt><dd data-f="${key}">–</dd></div>`;

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
        <button type="button" role="tab" data-tab="cpu">CPU</button>
        <button type="button" role="tab" data-tab="mem">RAM</button>
        <button type="button" class="zf-pulse-menu" title="Ressourcenmonitor öffnen" aria-label="Ressourcenmonitor öffnen">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
        </button>
      </div>
      <dl class="zf-pulse-pane" data-pane="cpu">
        ${row("Auslastung", "cpu")}${row("Leistung", "power")}${row("Temperatur", "temp")}
        ${row("Last (1 / 5 / 15 min)", "load")}${row("Kerne", "cores")}
      </dl>
      <dl class="zf-pulse-pane" data-pane="mem" hidden>
        ${row("Belegt", "used")}${row("Verfügbar", "avail")}${row("Gesamt", "total")}${row("Swap belegt", "swap")}
      </dl>
      <dl class="zf-pulse-pane zf-pulse-common">
        ${row("↓ Netzwerk", "rx")}${row("↑ Netzwerk", "tx")}${row("Laufzeit", "up")}
      </dl>
      <p class="zf-pulse-note" hidden></p>
    </div>`;

  const head = card.querySelector(".zf-pulse-head");
  const details = card.querySelector(".zf-pulse-details");
  const note = card.querySelector(".zf-pulse-note");
  const setOpen = (open) => {
    details.hidden = !open;
    head.setAttribute("aria-expanded", String(open));
    card.classList.toggle("open", open);
    try { localStorage.setItem(OPEN_KEY, open ? "1" : "0"); } catch { /* egal */ }
  };
  const setTab = (tab) => {
    for (const b of card.querySelectorAll("[data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
    for (const p of card.querySelectorAll("[data-pane]")) p.hidden = p.dataset.pane !== tab;
    try { localStorage.setItem(TAB_KEY, tab); } catch { /* egal */ }
  };
  head.addEventListener("click", () => setOpen(details.hidden));
  card.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
  card.querySelector(".zf-pulse-menu").addEventListener("click", () => void openResourceMonitor());
  try {
    setOpen(localStorage.getItem(OPEN_KEY) === "1");
    setTab(localStorage.getItem(TAB_KEY) === "mem" ? "mem" : "cpu");
  } catch { setOpen(false); setTab("cpu"); }

  // In die ZimaOS-Widget-Spalte direkt unter das native „System“-Widget.
  F.dashboard.mountWidget(card, { after: "system" });

  /* ───────── Ressourcenmonitor von ZimaOS öffnen ───────── */

  const leafWithText = (root, text) =>
    [...root.querySelectorAll("*")].find((el) => !el.childElementCount && el.textContent.trim().toLowerCase() === text);
  const clickable = (el) =>
    el.matches("button, a, [role=button]") || getComputedStyle(el).cursor === "pointer";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Kleinster Vorfahr von `start`, der neben `start` ein anklickbares Icon (svg/i/img) enthält.
  function iconButtonNear(start, exclude = []) {
    for (let row = start.parentElement; row && row !== document.body; row = row.parentElement) {
      const icons = [...row.querySelectorAll("button, [role=button], svg, i, img")]
        .filter((el) => !exclude.some((x) => x.contains(el) || el.contains(x)))
        .map((el) => (el.matches("svg, i, img") ? el.closest("button, [role=button], a") || el : el))
        .filter((el) => el.getClientRects().length && (clickable(el) || clickable(el.parentElement)));
      if (icons.length) return icons[icons.length - 1];
      if (row.getBoundingClientRect().height > 80) return null; // nicht über die Zeile hinaus
    }
    return null;
  }

  const visible = (el) => Boolean(el && el.getClientRects().length);

  function findMenuButton(system) {
    // Nur sichtbare Tabs zählen – zugeklappt sind sie zwar im DOM, aber unsichtbar.
    const cpu = leafWithText(system, "cpu");
    const ram = leafWithText(system, "ram");
    if (!visible(cpu) || !visible(ram)) return null;
    // Die Tab-Zeile ist der kleinste Vorfahr mit CPU und RAM; der ☰-Button ist
    // das letzte sichtbare Icon genau in dieser Zeile (nie darüber hinaus suchen).
    let tabRow = ram.parentElement;
    while (tabRow && !tabRow.contains(cpu)) tabRow = tabRow.parentElement;
    if (!tabRow || tabRow.getBoundingClientRect().height > 80) return null;
    const icons = [...tabRow.querySelectorAll("button, [role=button], svg, i, img")]
      .filter((el) => !el.contains(cpu) && !el.contains(ram) && !cpu.contains(el) && !ram.contains(el))
      .map((el) => (el.matches("svg, i, img") ? el.closest("button, [role=button], a") || el : el))
      .filter((el) => tabRow.contains(el) && visible(el));
    return icons[icons.length - 1] ?? null;
  }

  // Direkt auf das Element klicken – das Ereignis steigt zu Handlern an Eltern auf.
  const fire = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));

  async function openResourceMonitor() {
    note.hidden = true;
    const system = F.dashboard.nativeWidget("system");
    if (system) {
      let menu = findMenuButton(system);
      if (!menu) {
        // Natives Widget zugeklappt: über den Pfeil in der Titelzeile aufklappen.
        const title = leafWithText(system, "system");
        const chevron = title && iconButtonNear(title, [title]);
        if (chevron) {
          fire(chevron);
          for (let i = 0; i < 10 && !menu; i++) { await sleep(120); menu = findMenuButton(system); }
        }
      }
      if (menu) { fire(menu); return; }
    }
    note.textContent = "Ressourcenmonitor nicht gefunden. Details stehen in der Browser-Konsole.";
    note.hidden = false;
    console.info("[Forge Pulse] Ressourcenmonitor-Button nicht gefunden. System-Widget:", system ?? "(nicht gefunden)");
  }

  /* ───────── Werte ───────── */

  // ZimaOS-eigene Werte (wie im System-Widget). Bei Fehlern 60 s Pause.
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
      // Leistung: ZimaOS liefert den RAPL-Zähler (µJ); Watt = Differenz / Zeit.
      let watts = null;
      const energy = num(cpu.power?.value ?? cpu.power);
      const now = performance.now();
      if (energy != null && prevPower && energy >= prevPower.e && now > prevPower.t) {
        const w = (energy - prevPower.e) / 1e6 / ((now - prevPower.t) / 1000);
        if (w >= 0 && w < 2000) watts = w;
      }
      if (energy != null) prevPower = { e: energy, t: now };
      const out = {
        cpuPercent: num(cpu.percent),
        temperature: num(cpu.temperature),
        watts,
        memPercent: num(mem.usedPercent),
        memTotal: num(mem.total),
        memUsed: num(mem.used),
        memAvailable: num(mem.available),
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
    g.querySelector(".zf-pulse-bar").setAttribute("stroke-dasharray", `${v == null ? 0 : (ARC_LEN * v) / 100} ${CIRC}`);
    g.classList.toggle("hot", v != null && v >= 85);
    g.querySelector(".zf-pulse-sub").textContent = sub;
  }

  const fact = (k, v) => { card.querySelector(`[data-f=${k}]`).textContent = v; };
  let prevNet = null;
  let lastWatts = null;
  let timer = null;

  async function tick() {
    const [z, m] = await Promise.all([zimaUtilization(), F.metrics().catch(() => null)]);
    if (!z && !m) { card.classList.add("offline"); return; }
    card.classList.remove("offline");
    card.dataset.source = z ? "zimaos" : "zimaforge";
    card.title = z ? "Werte: ZimaOS (wie System-Widget)" : "Werte: ZimaForge-Messung";

    const cpuPercent = z?.cpuPercent ?? m?.cpuPercent;
    const temp = z?.temperature ?? m?.temperature;
    // ZimaOS-Leistung braucht zwei Abrufe; bis dahin die eigene Messung.
    const watts = z?.watts ?? (z ? lastWatts : null) ?? m?.powerWatts ?? null;
    if (watts != null) lastWatts = watts;
    const memTotal = z?.memTotal ?? m?.memTotal;
    const memAvail = z?.memAvailable ?? m?.memAvailable;
    const memUsed = z?.memUsed ?? (memTotal != null && memAvail != null ? memTotal - memAvail : null);
    const memPercent = z?.memPercent ?? m?.memPercent;

    const cpuSub = [
      watts != null ? `${watts.toFixed(1)} W` : null,
      temp != null ? `${temp.toFixed(1)} °C` : null,
    ].filter(Boolean).join(" / ") || "–";
    setGauge("cpu", cpuPercent, cpuSub);
    setGauge("mem", memPercent, memTotal ? fmtBytes(memTotal) : "–");

    fact("cpu", cpuPercent == null ? "–" : `${cpuPercent.toFixed(1)} %`);
    fact("power", watts == null ? "nicht verfügbar" : `${watts.toFixed(1)} W`);
    fact("temp", temp == null ? "–" : `${temp.toFixed(1)} °C`);
    fact("load", m?.load ? m.load.map((l) => l.toFixed(2)).join(" / ") : "–");
    fact("cores", m?.cpuCores ?? "–");
    fact("used", memUsed == null ? "–" : `${fmtBytes(memUsed)}${memPercent != null ? ` (${Math.round(memPercent)} %)` : ""}`);
    fact("avail", fmtBytes(memAvail));
    fact("total", fmtBytes(memTotal));
    fact("swap", m?.swapTotal ? `${fmtBytes(m.swapTotal - (m.swapFree ?? 0))} von ${fmtBytes(m.swapTotal)}` : "kein Swap");
    fact("up", fmtUptime(m?.uptimeSeconds));
    if (m?.netRxBytes != null && prevNet) {
      const dt = (m.timestampMs - prevNet.t) / 1000;
      if (dt > 0) {
        fact("rx", fmtRate(Math.max(0, (m.netRxBytes - prevNet.rx) / dt)));
        fact("tx", fmtRate(Math.max(0, (m.netTxBytes - prevNet.tx) / dt)));
      }
    }
    if (m?.netRxBytes != null) prevNet = { rx: m.netRxBytes, tx: m.netTxBytes, t: m.timestampMs };
  }

  const start = () => { if (!timer) { void tick(); timer = setInterval(tick, INTERVAL); } };
  const stop = () => { clearInterval(timer); timer = null; };
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  start();
})();
