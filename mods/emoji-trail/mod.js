// Emoji-Spur – kurze Emoji-Spur hinter Maus und Finger.
(async () => {
  "use strict";
  const F = window.ZimaForge;
  if (!F?.effects || window.__zfEmojiTrail) return;
  window.__zfEmojiTrail = true;

  // „Bewegung reduzieren“: ruhiger statt aus – seltener, kürzer, ohne Drehung.
  const CALM = F.effects.reducedMotion();
  const MIN_MS = CALM ? 120 : 40;
  const MIN_PX = CALM ? 40 : 14;

  const DEFAULT = "✨⚡💜🔥";
  const cfg = (await F.getConfig("emoji-trail", null)) ?? {};
  // Intl.Segmenter hält zusammengesetzte Emojis (👍🏽, 🏳️‍🌈) zusammen; ältere Browser: Zeichen.
  const text = String(cfg.emojis || DEFAULT);
  const parts = typeof Intl.Segmenter === "function"
    ? [...new Intl.Segmenter().segment(text)].map((s) => s.segment)
    : Array.from(text);
  const emojis = parts.filter((s) => s.trim());
  if (!emojis.length) return;

  const layer = document.createElement("div");
  layer.className = "zf-emoji-trail";
  layer.style.overflow = "hidden";
  // Eigene Ebene über dem Dashboard; ausgeblendet, solange ein ZimaOS-Fenster offen ist.
  F.effects.layer(layer);
  F.dashboard?.ignore(layer);

  const POOL = 24;
  const pool = Array.from({ length: POOL }, () => {
    const el = document.createElement("span");
    Object.assign(el.style, {
      position: "absolute", left: "0", top: "0", fontSize: "18px", lineHeight: "1",
      willChange: "transform, opacity", opacity: "0", userSelect: "none",
    });
    layer.append(el);
    return el;
  });

  let next = 0, lastX = 0, lastY = 0, lastAt = 0;
  function spawn(x, y) {
    const el = pool[next];
    next = (next + 1) % POOL;
    el.textContent = emojis[(Math.random() * emojis.length) | 0];
    const dx = CALM ? 0 : (Math.random() - 0.5) * 30;
    const rot = CALM ? 0 : (Math.random() - 0.5) * 60;
    const fall = CALM ? 10 : 26;
    el.getAnimations().forEach((a) => a.cancel());
    el.animate(
      [
        { transform: `translate(${x - 9}px, ${y - 9}px) scale(1) rotate(0deg)`, opacity: 1 },
        { transform: `translate(${x - 9 + dx}px, ${y + fall}px) scale(.4) rotate(${rot}deg)`, opacity: 0 },
      ],
      { duration: CALM ? 600 : 800 + Math.random() * 300, easing: "cubic-bezier(.2,.7,.4,1)", fill: "forwards" },
    );
  }

  // Capture-Phase: kommt auch an, wenn ZimaOS Ereignisse unterwegs anhält.
  document.addEventListener("pointermove", (e) => {
    if (layer.style.visibility === "hidden") return;
    const now = performance.now();
    const moved = Math.hypot(e.clientX - lastX, e.clientY - lastY);
    if (now - lastAt < MIN_MS || moved < MIN_PX) return;
    lastAt = now; lastX = e.clientX; lastY = e.clientY;
    spawn(e.clientX, e.clientY);
  }, { passive: true, capture: true });
})();
