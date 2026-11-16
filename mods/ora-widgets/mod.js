// ora Widgets – markiert die nativen Widgets der ZimaOS-Spalte für den ora-Look.
(() => {
  "use strict";
  const F = window.ZimaForge;
  if (!F?.dashboard || window.__zfOraWidgets) return;
  window.__zfOraWidgets = true;

  function apply() {
    const column = F.dashboard.widgetColumn();
    if (!column) return;
    column.classList.add("zf-ora-column");
    for (const el of column.children) {
      // Eigene ZimaForge-Widgets bringen ihren Stil schon mit.
      if (!el.classList.contains("zf-widget-embedded")) el.classList.add("zf-ora-widget");
    }
  }

  F.dashboard.watch(apply);
  apply();
  // Erste Darstellung von ZimaOS kann nach dem Laden der Mods kommen.
  setTimeout(apply, 1500);
})();
