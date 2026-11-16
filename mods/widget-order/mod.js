// Widget-Reihenfolge – Widgets der ZimaOS-Spalte per Griff verschieben, Reihenfolge merken.
(() => {
  "use strict";
  const F = window.ZimaForge;
  if (!F?.dashboard || window.__zfWidgetOrder) return;
  window.__zfWidgetOrder = true;

  const ID = "widget-order";
  const LOCAL_KEY = "zf-widget-order";
  const KNOWN = ["system", "storage", "network"];
  let saved = [];

  /** Stabiler Schlüssel je Widget – unabhängig von wechselnden Inhalten wie der Uhrzeit. */
  function keyOf(el) {
    const wid = el.getAttribute("widget-id") || el.querySelector("[widget-id]")?.getAttribute("widget-id");
    if (wid) return `w:${wid}`;
    const zf = [...el.classList].find((c) => c.startsWith("zf-") && !/^zf-(widget|ora|order)/.test(c));
    if (zf) return `zf:${zf}`;
    for (const name of KNOWN) if (F.dashboard.nativeWidget(name) === el) return `n:${name}`;
    // Erster kurzer Text ohne Ziffern (keine Uhrzeit, keine Messwerte)
    for (const leaf of el.querySelectorAll("span, div, p, h1, h2, h3, h4")) {
      const t = leaf.childElementCount ? "" : (leaf.textContent || "").trim();
      if (t && t.length <= 30 && !/\d/.test(t)) return `t:${t.toLowerCase()}`;
    }
    return null;
  }

  async function load() {
    const cfg = await F.getConfig(ID, null);
    if (Array.isArray(cfg?.order)) return cfg.order;
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]"); } catch { return []; }
  }

  async function save(order) {
    saved = order;
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(order)); } catch { /* egal */ }
    try { await F.setConfig(ID, { order }); } catch (err) { console.info("[Widget-Reihenfolge] nur lokal gespeichert:", err.message); }
  }

  // Von Mods angeheftete Widgets (z. B. Pulse unter, Wetter über der Uhr) – ZimaForge
  // hält sie an ihrem Anker; hier werden sie nicht sortiert und bekommen keinen Griff.
  const isPinned = (el) => Boolean(el.dataset.zfPinBefore || el.dataset.zfPinAfter);
  const anchorOf = (names) => {
    for (const n of names.split(",")) {
      const w = F.dashboard.nativeWidget(n);
      if (w) return w;
    }
    return null;
  };

  /**
   * Bekannte Widgets in gespeicherte Reihenfolge bringen; unbekannte behalten ihren Platz.
   * Angeheftete Widgets werden danach wieder direkt vor bzw. hinter ihren Anker gesetzt.
   */
  function restore(column) {
    if (!saved.length) return;
    const kids = [...column.children];
    const free = kids.filter((el) => !isPinned(el));
    const rank = (el) => saved.indexOf(keyOf(el));
    const known = free.filter((el) => rank(el) >= 0).sort((a, b) => rank(a) - rank(b));
    let i = 0;
    const ordered = free.map((el) => (rank(el) >= 0 ? known[i++] : el));
    const wanted = [];
    for (const el of ordered) {
      for (const p of kids) if (isPinned(p) && p.dataset.zfPinBefore && anchorOf(p.dataset.zfPinBefore) === el) wanted.push(p);
      wanted.push(el);
      for (const p of kids) if (isPinned(p) && p.dataset.zfPinAfter && anchorOf(p.dataset.zfPinAfter) === el) wanted.push(p);
    }
    // Angeheftete ohne gefundenen Anker behalten ihren Platz vorne.
    for (const p of kids) if (isPinned(p) && !wanted.includes(p)) wanted.unshift(p);
    if (wanted.every((el, idx) => el === kids[idx])) return;
    for (const el of wanted) column.append(el);
  }

  function addGrips(column) {
    for (const el of column.children) {
      if (isPinned(el)) continue;
      if (el.querySelector(":scope > .zf-order-grip")) continue;
      el.classList.add("zf-order-item");
      const grip = document.createElement("button");
      grip.type = "button";
      grip.className = "zf-order-grip";
      grip.title = "Ziehen zum Verschieben";
      grip.setAttribute("aria-label", "Widget verschieben (Pfeiltasten hoch/runter)");
      F.dashboard.ignore(grip);
      el.prepend(grip);
      grip.addEventListener("pointerdown", (e) => startDrag(e, el, column));
      grip.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        const sib = e.key === "ArrowUp" ? el.previousElementSibling : el.nextElementSibling;
        if (!sib) return;
        column.insertBefore(el, e.key === "ArrowUp" ? sib : sib.nextSibling);
        grip.focus();
        void persist(column);
      });
    }
  }

  function startDrag(e, el, column) {
    e.preventDefault();
    const grip = e.currentTarget;
    try { grip.setPointerCapture(e.pointerId); } catch { /* Zeiger schon weg */ }
    el.classList.add("zf-order-dragging");
    column.classList.add("zf-order-active");
    const move = (ev) => {
      for (const sib of column.children) {
        if (sib === el) continue;
        const r = sib.getBoundingClientRect();
        const mid = r.top + r.height / 2;
        // el liegt unter sib und Zeiger über dessen Mitte -> nach oben; umgekehrt nach unten.
        const elBelow = Boolean(sib.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
        if (elBelow && ev.clientY < mid && ev.clientY > r.top) { column.insertBefore(el, sib); break; }
        if (!elBelow && ev.clientY > mid && ev.clientY < r.bottom) { column.insertBefore(el, sib.nextSibling); break; }
      }
    };
    const end = () => {
      grip.removeEventListener("pointermove", move);
      el.classList.remove("zf-order-dragging");
      column.classList.remove("zf-order-active");
      void persist(column);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", end, { once: true });
    grip.addEventListener("pointercancel", end, { once: true });
  }

  function persist(column) {
    // Angeheftete Widgets gehören nicht zur gespeicherten Reihenfolge.
    const order = [...column.children].filter((el) => !isPinned(el)).map(keyOf).filter(Boolean);
    return save(order);
  }

  function apply() {
    const column = F.dashboard.widgetColumn();
    if (!column) return;
    restore(column);
    addGrips(column);
  }

  load().then((order) => {
    saved = order;
    apply();
    F.dashboard.watch(apply);
    setTimeout(apply, 1500);
  });
})();
