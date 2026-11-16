// Forge Schnee – fallende Flocken mit leichtem Neon-Schimmer (klick-durchlässig).
(() => {
  "use strict";
  const F = window.ZimaForge;
  if (!F?.effects || document.querySelector("canvas.zf-snow")) return;

  // „Bewegung reduzieren“: nicht abschalten (der Mod wurde bewusst installiert),
  // sondern ruhig – weniger und langsamere Flocken.
  const CALM = F.effects.reducedMotion();
  const DENSITY = CALM ? 0.4 : 1;
  const SPEED = CALM ? 0.45 : 1;

  const TINTS = ["255,255,255", "255,255,255", "190,230,255", "225,200,255"];
  const canvas = document.createElement("canvas");
  canvas.className = "zf-snow";
  // Eigene Ebene über dem Dashboard; ausgeblendet, solange ein ZimaOS-Fenster offen ist.
  F.effects.layer(canvas);
  F.dashboard?.ignore(canvas);

  const ctx = canvas.getContext("2d");
  let w = 0, h = 0, flakes = [], raf = 0, last = performance.now(), wind = 0;

  const flake = (anywhere) => {
    const depth = Math.random(); // 0 = fern, 1 = nah
    return {
      x: Math.random() * w,
      y: anywhere ? Math.random() * h : -10,
      r: 0.8 + depth * 2.6,
      vy: (14 + depth * 46) * SPEED,
      sway: (6 + Math.random() * 18) * SPEED,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.35 + depth * 0.55,
      tint: TINTS[(Math.random() * TINTS.length) | 0],
    };
  };

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    w = innerWidth; h = innerHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const target = Math.round(Math.min(160, (w * h) / 11000) * DENSITY);
    while (flakes.length < target) flakes.push(flake(true));
    flakes.length = target;
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    wind = Math.sin(now / 7000) * 12;
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < flakes.length; i++) {
      const f = flakes[i];
      f.y += f.vy * dt;
      f.x += (wind + Math.sin(now / 1300 + f.phase) * f.sway) * dt;
      if (f.y > h + 10 || f.x < -20 || f.x > w + 20) { flakes[i] = flake(false); continue; }
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${f.tint},${f.alpha})`;
      ctx.shadowColor = `rgba(${f.tint},0.8)`;
      ctx.shadowBlur = f.r * 3;
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    raf = requestAnimationFrame(frame);
  }

  const start = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  const stop = () => { cancelAnimationFrame(raf); raf = 0; };
  addEventListener("resize", resize, { passive: true });
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  resize();
  start();
})();
