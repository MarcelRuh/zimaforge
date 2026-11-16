// Vorlage: wird als klassisches Skript im obersten Dashboard-Dokument geladen.
// Für ES-Module im Manifest "module": true setzen.
(async () => {
  "use strict";
  const F = window.ZimaForge;
  if (!F) return;

  const MOD_ID = "mod-template"; // = Ordnername

  // Einstellungen lesen (öffentlich) – Schreiben erfordert eine ZimaOS-Anmeldung.
  const config = await F.getConfig(MOD_ID, { greeting: "Hallo aus ZimaForge!" });

  const badge = document.createElement("div");
  badge.className = "mein-mod-badge";
  badge.textContent = config.greeting;
  badge.title = "Klicken zum Ändern";
  badge.addEventListener("click", async () => {
    const greeting = prompt("Neuer Text:", config.greeting);
    if (!greeting) return;
    try {
      await F.setConfig(MOD_ID, { ...config, greeting });
      config.greeting = greeting;
      badge.textContent = greeting;
    } catch (err) {
      alert(err.message);
    }
  });
  document.body.append(badge);

  // Systemwerte gibt es unter F.metrics().
  const m = await F.metrics();
  badge.dataset.cpu = `${m.cpuPercent ?? "?"} %`;
})();
