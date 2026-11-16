// Tab-Titel – zeigt Server und Netz im Browser-Tab, z. B. „ZimaOS · nas (LAN)“.
(() => {
  "use strict";
  if (window.__zfTabTitle) return;
  window.__zfTabTitle = true;

  const host = location.hostname || "localhost";

  // Privat/lokal: RFC 1918, Loopback, Link-Local, CGNAT (Tailscale & Co.), .local/.lan/.home
  function isLocal(h) {
    if (/^(localhost|.*\.(local|lan|home|internal|localdomain))$/i.test(h)) return true;
    if (h.startsWith("[")) return /^\[(::1|f[cd][0-9a-f]{2}:|fe80:)/i.test(h);
    const p = h.split(".").map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n))) return !h.includes(".");
    return p[0] === 10 || p[0] === 127 || (p[0] === 192 && p[1] === 168)
      || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 169 && p[1] === 254)
      || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
  }

  const label = isLocal(host) ? "LAN" : "Remote";
  const suffix = ` · ${host} (${label})`;
  const base = () => document.title.replace(/ · \S+ \((LAN|Remote)\)$/, "");

  function apply() {
    const want = base() + suffix;
    if (document.title !== want) document.title = want;
  }

  // ZimaOS setzt den Titel bei Seitenwechseln neu – wieder anhängen.
  const titleEl = () => document.querySelector("head > title");
  let observed = null;
  function watch() {
    const el = titleEl();
    if (!el || el === observed) return;
    observed = el;
    new MutationObserver(apply).observe(el, { childList: true, characterData: true, subtree: true });
  }
  new MutationObserver(() => { watch(); apply(); }).observe(document.head, { childList: true });
  watch();
  apply();
})();
