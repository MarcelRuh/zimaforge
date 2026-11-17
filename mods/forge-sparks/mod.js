// Forge Sparks – aufsteigende Neon-Funken als Overlay (klick-durchlässig).
(() => {
  "use strict";
  const F = window.ZimaForge;
  if (!F?.effects || document.querySelector("canvas.zf-sparks")) return;

  // „Bewegung reduzieren“: ruhiger statt aus – weniger und langsamere Funken.
  const CALM = F.effects.reducedMotion();
  const DENSITY = CALM ? 0.4 : 1;
  const SPEED = CALM ? 0.45 : 1;

  const COLORS = ["255,0,110", "131,56,236", "0,180,216"];
  const canvas = document.createElement("canvas");
  canvas.className = "zf-sparks";
  // Eigene Ebene über dem Dashboard; ausgeblendet, solange ein ZimaOS-Fenster offen ist.
  F.effects.layer(canvas);
  canvas.style.mixBlendMode = "screen";
  F.dashboard?.ignore(canvas);

  const ctx = canvas.getContext("2d");
  let w = 0, h = 0, dpr = 1;
  let sparks = [];
  let raf = 0;
  let last = performance.now();

  // Ein vorgerenderter Glüh-Punkt je Farbe – günstig zu zeichnen.
  const sprites = COLORS.map((rgb) => {
    const s = document.createElement("canvas");
    s.width = s.height = 32;
    const c = s.getContext("2d");
    const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.18, `rgba(${rgb},0.95)`);
    g.addColorStop(0.5, `rgba(${rgb},0.25)`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    c.fillStyle = g;
    c.fillRect(0, 0, 32, 32);
    return s;
  });

  const spawn = (initial) => ({
    x: Math.random() * w,
    y: initial ? Math.random() * h : h + 10,
    vy: (18 + Math.random() * 42) * SPEED,
    vx: (Math.random() - 0.5) * 10 * SPEED,
    size: 6 + Math.random() * 11,
    life: 0,
    max: (6 + Math.random() * 9) / SPEED,
    phase: Math.random() * Math.PI * 2,
    sprite: sprites[(Math.random() * sprites.length) | 0],
  });

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = innerWidth;
    h = innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const target = Math.round(Math.min(70, (w * h) / 26000) * DENSITY);
    while (sparks.length < target) sparks.push(spawn(true));
    sparks.length = target;
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < sparks.length; i++) {
      const s = sparks[i];
      s.life += dt;
      s.y -= s.vy * dt;
      s.x += (s.vx + Math.sin(now / 900 + s.phase) * 8) * dt;
      const t = s.life / s.max;
      if (t >= 1 || s.y < -20) { sparks[i] = spawn(false); continue; }
      const alpha = Math.sin(Math.PI * t) * (0.7 + 0.3 * Math.sin(now / 240 + s.phase));
      ctx.globalAlpha = Math.max(0, alpha);
      const size = s.size * (1 - t * 0.5);
      ctx.drawImage(s.sprite, s.x - size, s.y - size, size * 2, size * 2);
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  }

  const start = () => { if (!raf && !F.effects.hidden(canvas)) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  const stop = () => { cancelAnimationFrame(raf); raf = 0; };

  // Größenänderung höchstens einmal pro Bild verarbeiten.
  let resizeQueued = false;
  addEventListener("resize", () => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => { resizeQueued = false; resize(); });
  }, { passive: true });
  // Pausieren im Hintergrund-Tab und solange ein ZimaOS-Fenster die Ebene verdeckt.
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  canvas.addEventListener("zimaforge:visibility", (e) => { if (e.detail.hidden) { stop(); ctx.clearRect(0, 0, w, h); } else start(); });
  resize();
  start();
})();
