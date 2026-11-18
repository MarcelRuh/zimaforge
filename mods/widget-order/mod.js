// Widget-Reihenfolge – Widgets der ZimaOS-Spalte per Griff verschieben, Reihenfolge merken.
(() => {
  "use strict";
  const F = window.ZimaForge;
  if (!F?.dashboard || window.__zfWidgetOrder) return;
  window.__zfWidgetOrder = true;

  const ID = "widget-order";
  const LOCAL_KEY = "zf-widget-order";
  // Uhr zuerst: Ihr erster Text ohne Ziffern kann der Wochentag sein und würde sich
  // sonst täglich als Schlüssel ändern.
  const KNOWN = ["clock", "system", "storage", "network"];
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

  /**
   * Die Spalte als Folge von Blöcken: Ein natives Widget bildet mit den daran
   * angehefteten Mod-Widgets (z. B. Wetter über, Pulse unter der Uhr) einen Block.
   * Verschoben wird immer an Blockgrenzen – sonst landet ein Widget zwischen Uhr und
   * Pulse, ZimaForge rückt Pulse zurück, und das Widget springt scheinbar zurück.
   */
  function blocks(column) {
    const kids = [...column.children];
    const anchorFor = (p) => anchorOf(p.dataset.zfPinBefore || p.dataset.zfPinAfter);
    const out = [];
    for (const el of kids) {
      if (isPinned(el) && kids.includes(anchorFor(el))) continue; // gehört zum Block seines Ankers
      out.push([
        ...kids.filter((p) => isPinned(p) && p.dataset.zfPinBefore && anchorFor(p) === el),
        el,
        ...kids.filter((p) => isPinned(p) && p.dataset.zfPinAfter && anchorFor(p) === el),
      ]);
    }
    return out;
  }

  /** Block von `el` vor bzw. hinter einen anderen Block setzen (alle Elemente zusammen). */
  function moveBlock(column, block, target, after) {
    const ref = after ? target[target.length - 1].nextElementSibling : target[0];
    for (const node of block) column.insertBefore(node, ref);
  }

  // Der Griff gehört nicht zum Widget: Klicks und Drücken nicht an ZimaOS weitergeben
  // (dort öffnet ein Klick auf Storage/Network z. B. die Einstellungen).
  const swallow = (e) => { e.stopPropagation(); if (e.type === "click") e.preventDefault(); };

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
      for (const type of ["click", "mousedown", "mouseup", "touchstart", "dblclick"]) grip.addEventListener(type, swallow);
      grip.addEventListener("pointerdown", (e) => { e.stopPropagation(); startDrag(e, el, column); });
      grip.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        e.stopPropagation();
        const list = blocks(column);
        const i = list.findIndex((b) => b.includes(el));
        const j = e.key === "ArrowUp" ? i - 1 : i + 1;
        if (i < 0 || j < 0 || j >= list.length) return;
        moveBlock(column, list[i], list[j], e.key === "ArrowDown");
        grip.focus();
        void persist(column);
      });
    }
  }

  // Während des Ziehens nichts wiederherstellen – sonst springt das Widget zurück,
  // weil ZimaForge die Umsortierung als Umbau meldet.
  let dragging = false;

  function startDrag(e, el, column) {
    if (e.button !== 0 || dragging) return;
    e.preventDefault();
    dragging = true;
    const grip = e.currentTarget;
    el.classList.add("zf-order-dragging");
    column.classList.add("zf-order-active");
    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      const list = blocks(column);
      const mine = list.find((b) => b.includes(el));
      if (!mine) return;
      for (const b of list) {
        if (b === mine) continue;
        const top = b[0].getBoundingClientRect().top;
        const bottom = b[b.length - 1].getBoundingClientRect().bottom;
        const mid = (top + bottom) / 2;
        const mineBelow = Boolean(b[0].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
        // Zeiger über der Mitte eines höheren Blocks -> davor; unter der Mitte eines tieferen -> dahinter.
        if (mineBelow && ev.clientY < mid && ev.clientY >= top) { moveBlock(column, mine, b, false); break; }
        if (!mineBelow && ev.clientY > mid && ev.clientY <= bottom) { moveBlock(column, mine, b, true); break; }
      }
    };
    const end = (ev) => {
      if (ev && "pointerId" in ev && ev.pointerId !== e.pointerId) return;
      removeEventListener("pointermove", move, true);
      removeEventListener("pointerup", end, true);
      removeEventListener("pointercancel", end, true);
      removeEventListener("blur", end);
      dragging = false;
      el.classList.remove("zf-order-dragging");
      column.classList.remove("zf-order-active");
      grip.focus({ preventScroll: true });
      void persist(column);
    };
    // Am Fenster lauschen, nicht am Griff: Beim Umsetzen wird das Widget samt Griff neu
    // eingehängt, dabei verliert der Griff den Zeiger – Bewegungen und das Loslassen
    // kämen sonst nie an, und das Ziehen endete nicht.
    addEventListener("pointermove", move, true);
    addEventListener("pointerup", end, true);
    addEventListener("pointercancel", end, true);
    addEventListener("blur", end);
  }

  function persist(column) {
    // Angeheftete Widgets gehören nicht zur gespeicherten Reihenfolge.
    const order = [...column.children].filter((el) => !isPinned(el)).map(keyOf).filter(Boolean);
    return save(order);
  }

  function apply() {
    if (dragging) return;
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
