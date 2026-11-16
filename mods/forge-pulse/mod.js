// Forge Pulse – Live-Systemwerte als schwebendes Widget.
(() => {
  "use strict";
  const F = window.ZimaForge;
  if (!F || document.querySelector(".zf-pulse")) return;

  const ID = "forge-pulse";
  const POS_KEY = "zf-pulse:pos";
  const INTERVAL = 3000;
  const HISTORY = 40;

  const fmtBytes = (b) => {
    if (b == null) return "–";
    const u = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return `${b.toFixed(b >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
  };
  const fmtRate = (bps) => (bps == null ? "–" : `${fmtBytes(bps)}/s`);
  const fmtUptime = (s) => {
    if (s == null) return "–";
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d ? `${d} T ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
  };

  const el = document.createElement("section");
  el.className = "zf-pulse";
  el.setAttribute("aria-label", "Forge Pulse – Systemwerte");
  el.innerHTML = `
    <header class="zf-pulse-head" title="Ziehen zum Verschieben">
      <span class="zf-pulse-title"><i class="zf-pulse-led"></i>PULSE</span>
      <button type="button" class="zf-pulse-toggle" aria-label="Einklappen" aria-expanded="true">–</button>
    </header>
    <div class="zf-pulse-body">
      <div class="zf-pulse-row" data-k="cpu"><span>CPU</span><b>–</b><canvas width="120" height="26"></canvas></div>
      <div class="zf-pulse-row" data-k="mem"><span>RAM</span><b>–</b><canvas width="120" height="26"></canvas></div>
      <dl class="zf-pulse-facts">
        <div><dt>Temp</dt><dd data-f="temp">–</dd></div>
        <div><dt>Last</dt><dd data-f="load">–</dd></div>
        <div><dt>↓ Netz</dt><dd data-f="rx">–</dd></div>
        <div><dt>↑ Netz</dt><dd data-f="tx">–</dd></div>
        <div class="wide"><dt>Laufzeit</dt><dd data-f="up">–</dd></div>
      </dl>
    </div>`;
  document.body.append(el);

  // Position (lokal je Browser) wiederherstellen.
  try {
    const pos = JSON.parse(localStorage.getItem(POS_KEY) || "null");
    if (pos) {
      el.style.left = `${Math.min(pos.x, innerWidth - 80)}px`;
      el.style.top = `${Math.min(pos.y, innerHeight - 40)}px`;
      el.style.right = "auto";
      el.classList.toggle("collapsed", Boolean(pos.collapsed));
    }
  } catch { /* Standardposition */ }

  const save = () => {
    const r = el.getBoundingClientRect();
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top), collapsed: el.classList.contains("collapsed") }));
    } catch { /* egal */ }
  };

  const toggle = el.querySelector(".zf-pulse-toggle");
  const syncToggle = () => {
    const c = el.classList.contains("collapsed");
    toggle.textContent = c ? "+" : "–";
    toggle.setAttribute("aria-expanded", String(!c));
    toggle.setAttribute("aria-label", c ? "Ausklappen" : "Einklappen");
  };
  syncToggle();
  toggle.addEventListener("click", () => { el.classList.toggle("collapsed"); syncToggle(); save(); });

  // Ziehen per Pointer Events.
  const head = el.querySelector(".zf-pulse-head");
  head.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    head.setPointerCapture(e.pointerId);
    el.classList.add("dragging");
    const move = (ev) => {
      el.style.left = `${Math.max(0, Math.min(innerWidth - r.width, ev.clientX - dx))}px`;
      el.style.top = `${Math.max(0, Math.min(innerHeight - 40, ev.clientY - dy))}px`;
      el.style.right = "auto";
    };
    const up = () => {
      head.removeEventListener("pointermove", move);
      el.classList.remove("dragging");
      save();
    };
    head.addEventListener("pointermove", move);
    head.addEventListener("pointerup", up, { once: true });
    head.addEventListener("pointercancel", up, { once: true });
  });

  const series = { cpu: [], mem: [] };
  const colors = { cpu: ["#ff006e", "#8338ec"], mem: ["#00b4d8", "#8338ec"] };

  function spark(key) {
    const canvas = el.querySelector(`[data-k=${key}] canvas`);
    const ctx = canvas.getContext("2d");
    const dpr = devicePixelRatio || 1;
    const w = 120, h = 26;
    if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.width = `${w}px`; canvas.style.height = `${h}px`; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const data = series[key];
    if (data.length < 2) return;
    const step = w / (HISTORY - 1);
    const x0 = w - (data.length - 1) * step;
    const y = (v) => h - 2 - (Math.max(0, Math.min(100, v)) / 100) * (h - 4);
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, colors[key][1]);
    grad.addColorStop(1, colors[key][0]);
    ctx.beginPath();
    data.forEach((v, i) => (i ? ctx.lineTo(x0 + i * step, y(v)) : ctx.moveTo(x0, y(v))));
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.8;
    ctx.shadowColor = colors[key][0];
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineTo(w, h);
    ctx.lineTo(x0, h);
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, 0, 0, h);
    fill.addColorStop(0, `${colors[key][0]}40`);
    fill.addColorStop(1, `${colors[key][0]}00`);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function setRow(key, value) {
    const row = el.querySelector(`[data-k=${key}]`);
    row.querySelector("b").textContent = value == null ? "–" : `${Math.round(value)} %`;
    row.classList.toggle("hot", value != null && value >= 85);
    if (value != null) {
      series[key].push(value);
      if (series[key].length > HISTORY) series[key].shift();
    }
    spark(key);
  }

  const fact = (k, v) => { el.querySelector(`[data-f=${k}]`).textContent = v; };
  let prevNet = null;
  let timer = null;

  async function tick() {
    try {
      const m = await F.metrics();
      setRow("cpu", m.cpuPercent);
      setRow("mem", m.memPercent);
      fact("temp", m.temperature == null ? "–" : `${m.temperature.toFixed(0)} °C`);
      el.querySelector("[data-f=temp]").classList.toggle("hot", (m.temperature ?? 0) >= 80);
      fact("load", m.load ? m.load[0].toFixed(2) : "–");
      fact("up", fmtUptime(m.uptimeSeconds));
      if (m.netRxBytes != null && prevNet) {
        const dt = (m.timestampMs - prevNet.t) / 1000;
        if (dt > 0) {
          fact("rx", fmtRate(Math.max(0, (m.netRxBytes - prevNet.rx) / dt)));
          fact("tx", fmtRate(Math.max(0, (m.netTxBytes - prevNet.tx) / dt)));
        }
      }
      if (m.netRxBytes != null) prevNet = { rx: m.netRxBytes, tx: m.netTxBytes, t: m.timestampMs };
      el.classList.remove("offline");
      el.querySelector(".zf-pulse-row[data-k=mem]").title =
        m.memTotal ? `${fmtBytes(m.memTotal - m.memAvailable)} von ${fmtBytes(m.memTotal)}` : "";
    } catch {
      el.classList.add("offline");
    }
  }

  function start() { if (!timer) { void tick(); timer = setInterval(tick, INTERVAL); } }
  function stop() { clearInterval(timer); timer = null; }
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  start();
  console.info(`[${ID}] aktiv`);
})();
