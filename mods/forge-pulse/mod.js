// Forge Pulse – System-Widget im Aufbau des ZimaOS-„System“-Widgets:
// zwei Ringanzeigen (CPU, RAM), darunter Leistung/Temperatur und RAM-Größe.
// Sitzt in der Widget-Spalte von ZimaOS; ohne Spalte als schwebende Karte.
(() => {
  "use strict";
  const F = window.ZimaForge;
  if (!F || document.querySelector(".zf-pulse")) return;

  const INTERVAL = 3000;
  const OPEN_KEY = "zf-pulse:details";
  const ARC = 270; // Grad, unten offen
  const R = 34;
  const CIRC = 2 * Math.PI * R;
  const ARC_LEN = (CIRC * ARC) / 360;

  const fmtBytes = (b, digits = 1) => {
    if (b == null) return "–";
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
    <dl class="zf-pulse-details" id="zf-pulse-details" hidden>
      <div><dt>Last (1 min)</dt><dd data-f="load">–</dd></div>
      <div><dt>Kerne</dt><dd data-f="cores">–</dd></div>
      <div><dt>↓ Netzwerk</dt><dd data-f="rx">–</dd></div>
      <div><dt>↑ Netzwerk</dt><dd data-f="tx">–</dd></div>
      <div><dt>RAM belegt</dt><dd data-f="used">–</dd></div>
      <div><dt>Laufzeit</dt><dd data-f="up">–</dd></div>
    </dl>`;

  const head = card.querySelector(".zf-pulse-head");
  const details = card.querySelector(".zf-pulse-details");
  const setOpen = (open) => {
    details.hidden = !open;
    head.setAttribute("aria-expanded", String(open));
    card.classList.toggle("open", open);
    try { localStorage.setItem(OPEN_KEY, open ? "1" : "0"); } catch { /* egal */ }
  };
  head.addEventListener("click", () => setOpen(details.hidden));
  try { setOpen(localStorage.getItem(OPEN_KEY) === "1"); } catch { setOpen(false); }

  // In die ZimaOS-Widget-Spalte direkt unter das native „System“-Widget.
  F.dashboard.mountWidget(card, { after: "system" });

  /* ───────── Werte ───────── */

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
  let timer = null;

  async function tick() {
    try {
      const m = await F.metrics();
      const cpuSub = [
        m.powerWatts != null ? `${m.powerWatts.toFixed(1)} W` : null,
        m.temperature != null ? `${m.temperature.toFixed(1)} °C` : null,
      ].filter(Boolean).join(" / ") || "–";
      setGauge("cpu", m.cpuPercent, cpuSub);
      setGauge("mem", m.memPercent, m.memTotal ? fmtBytes(m.memTotal) : "–");

      fact("load", m.load ? m.load[0].toFixed(2) : "–");
      fact("cores", m.cpuCores ?? "–");
      fact("up", fmtUptime(m.uptimeSeconds));
      fact("used", m.memTotal && m.memAvailable != null
        ? `${fmtBytes(m.memTotal - m.memAvailable)} von ${fmtBytes(m.memTotal)}` : "–");
      if (m.netRxBytes != null && prevNet) {
        const dt = (m.timestampMs - prevNet.t) / 1000;
        if (dt > 0) {
          fact("rx", fmtRate(Math.max(0, (m.netRxBytes - prevNet.rx) / dt)));
          fact("tx", fmtRate(Math.max(0, (m.netTxBytes - prevNet.tx) / dt)));
        }
      }
      if (m.netRxBytes != null) prevNet = { rx: m.netRxBytes, tx: m.netTxBytes, t: m.timestampMs };
      card.classList.remove("offline");
    } catch {
      card.classList.add("offline");
    }
  }

  const start = () => { if (!timer) { void tick(); timer = setInterval(tick, INTERVAL); } };
  const stop = () => { clearInterval(timer); timer = null; };
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  start();
})();
