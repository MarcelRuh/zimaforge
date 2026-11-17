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

  // Je Farbton eine vorgerenderte, leuchtende Flocke – drawImage statt shadowBlur pro
  // Flocke und Bild (der Schatten ist beim Canvas-Zeichnen sehr teuer).
  const sprites = new Map(TINTS.map((rgb) => {
    const s = document.createElement("canvas");
    s.width = s.height = 32;
    const c = s.getContext("2d");
    const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, `rgba(${rgb},1)`);
    g.addColorStop(0.28, `rgba(${rgb},0.9)`);
    g.addColorStop(0.45, `rgba(${rgb},0.3)`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    c.fillStyle = g;
    c.fillRect(0, 0, 32, 32);
    return [rgb, s];
  }));

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
      // Sprite: Kern etwa ein Drittel, Rest ist Schimmer – wie Radius plus Glühen.
      const size = f.r * 3.6;
      ctx.globalAlpha = f.alpha;
      ctx.drawImage(sprites.get(f.tint), f.x - size, f.y - size, size * 2, size * 2);
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
