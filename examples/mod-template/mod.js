// Vorlage: wird als klassisches Skript im obersten Dashboard-Dokument geladen.
// Für ES-Module im Manifest "module": true setzen.
(async () => {
  "use strict";
  const F = window.ZimaForge;
  // Nur einmal starten – der Loader kann bei Umbauten des Dashboards erneut laufen.
  if (!F || document.querySelector(".mein-mod-badge")) return;

  const MOD_ID = "mod-template"; // = Ordnername
  const DEFAULTS = { greeting: "Hallo aus ZimaForge!" };

  // Einstellungen lesen (nur angemeldet) – fehlende Felder mit Standardwerten auffüllen.
  const config = { ...DEFAULTS, ...((await F.getConfig(MOD_ID, null)) ?? {}) };

  const badge = document.createElement("div");
  badge.className = "mein-mod-badge";
  badge.textContent = config.greeting;
  badge.title = "Klicken zum Ändern";
  badge.addEventListener("click", async () => {
    const greeting = prompt("Neuer Text:", config.greeting);
    if (!greeting) return;
    try {
      // Schreiben dürfen nur ZimaOS-Administratoren.
      await F.setConfig(MOD_ID, { ...config, greeting });
      config.greeting = greeting;
      badge.textContent = greeting;
    } catch (err) {
      alert(err.message);
    }
  });
  document.body.append(badge);

  // Systemwerte gibt es unter F.metrics() – Fehler (z. B. offline) abfangen.
  try {
    const m = await F.metrics();
    badge.dataset.cpu = `${m.cpuPercent ?? "?"} %`;
  } catch { /* ohne Messwerte weiter */ }
})();
