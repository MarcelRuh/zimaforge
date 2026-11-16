// Emoji-Spur – kurze Emoji-Spur hinter Maus und Finger.
(async () => {
  "use strict";
  const F = window.ZimaForge;
  if (window.__zfEmojiTrail) return;
  window.__zfEmojiTrail = true;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const DEFAULT = "✨⚡💜🔥";
  const cfg = (await F?.getConfig("emoji-trail", null)) ?? {};
  const emojis = [...new Intl.Segmenter().segment(String(cfg.emojis || DEFAULT))].map((s) => s.segment).filter((s) => s.trim());
  if (!emojis.length) return;

  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  Object.assign(layer.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "30", overflow: "hidden" });
  document.body.append(layer);
  F?.dashboard?.ignore(layer);

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
    const dx = (Math.random() - 0.5) * 30;
    const rot = (Math.random() - 0.5) * 60;
    el.getAnimations().forEach((a) => a.cancel());
    el.animate(
      [
        { transform: `translate(${x - 9}px, ${y - 9}px) scale(1) rotate(0deg)`, opacity: 1 },
        { transform: `translate(${x - 9 + dx}px, ${y + 26}px) scale(.4) rotate(${rot}deg)`, opacity: 0 },
      ],
      { duration: 800 + Math.random() * 300, easing: "cubic-bezier(.2,.7,.4,1)", fill: "forwards" },
    );
  }

  addEventListener("pointermove", (e) => {
    const now = performance.now();
    const moved = Math.hypot(e.clientX - lastX, e.clientY - lastY);
    if (now - lastAt < 40 || moved < 14) return;
    lastAt = now; lastX = e.clientX; lastY = e.clientY;
    spawn(e.clientX, e.clientY);
  }, { passive: true });
})();
