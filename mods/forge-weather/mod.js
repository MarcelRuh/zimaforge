// Forge Wetter – Wetter-Widget für die ZimaOS-Widget-Spalte (Daten: Open-Meteo).
(() => {
  "use strict";
  const F = window.ZimaForge;
  if (!F || document.querySelector(".zf-weather")) return;

  const ID = "forge-weather";
  const LOCAL_KEY = "zf-weather:config";
  const REFRESH_MS = 15 * 60 * 1000;
  const DAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

  // WMO-Wettercodes -> Beschreibung und Symbol
  const CODES = [
    [[0], "Klar", "☀️", "🌙"],
    [[1], "Überwiegend klar", "🌤️", "🌙"],
    [[2], "Teilweise bewölkt", "⛅", "☁️"],
    [[3], "Bedeckt", "☁️", "☁️"],
    [[45, 48], "Nebel", "🌫️", "🌫️"],
    [[51, 53, 55, 56, 57], "Nieselregen", "🌦️", "🌧️"],
    [[61, 63, 65, 66, 67, 80, 81, 82], "Regen", "🌧️", "🌧️"],
    [[71, 73, 75, 77, 85, 86], "Schnee", "🌨️", "🌨️"],
    [[95, 96, 99], "Gewitter", "⛈️", "⛈️"],
  ];
  const describe = (code, day = true) => {
    const hit = CODES.find(([codes]) => codes.includes(code)) ?? [[], "Unbekannt", "🌡️", "🌡️"];
    return { text: hit[1], icon: day ? hit[2] : hit[3] };
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  const card = document.createElement("section");
  card.className = "zf-weather";
  card.setAttribute("aria-label", "Forge Wetter");
  // Inhalt in einen inneren Container, damit Zusätze anderer Mods (z. B. Verschiebe-Griff) erhalten bleiben.
  const body = document.createElement("div");
  card.append(body);
  F.dashboard.mountWidget(card, { after: "system" });

  let config = null;
  let timer = null;

  async function loadConfig() {
    let c = await F.getConfig(ID, null);
    if (!c) {
      try { c = JSON.parse(localStorage.getItem(LOCAL_KEY) || "null"); } catch { c = null; }
    }
    return c && typeof c.latitude === "number" ? c : null;
  }

  async function saveConfig(c) {
    config = c;
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(c)); } catch { /* egal */ }
    try { await F.setConfig(ID, c); } catch (err) { console.info("[Forge Wetter] nur lokal gespeichert:", err.message); }
  }

  function renderSetup(message = "") {
    body.innerHTML = `
      <div class="zf-weather-head"><span class="zf-weather-title">Wetter</span></div>
      <form class="zf-weather-setup">
        <label for="zf-weather-q">Ort festlegen</label>
        <div class="zf-weather-row">
          <input id="zf-weather-q" type="search" placeholder="z. B. Berlin" autocomplete="off" required>
          <button type="submit">Suchen</button>
        </div>
        <ul class="zf-weather-results"></ul>
        ${message ? `<p class="zf-weather-msg">${esc(message)}</p>` : ""}
        ${config ? '<button type="button" class="zf-weather-cancel">Abbrechen</button>' : ""}
      </form>`;
    const form = card.querySelector("form");
    const list = card.querySelector(".zf-weather-results");
    card.querySelector(".zf-weather-cancel")?.addEventListener("click", () => void refresh());
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const q = card.querySelector("input").value.trim();
      list.innerHTML = '<li class="zf-weather-msg">Suche …</li>';
      try {
        const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=de&format=json`);
        const data = await res.json();
        const hits = data.results ?? [];
        list.innerHTML = hits.length
          ? hits.map((h, i) => `<li><button type="button" data-i="${i}">${esc(h.name)}<small>${esc([h.admin1, h.country].filter(Boolean).join(", "))}</small></button></li>`).join("")
          : '<li class="zf-weather-msg">Kein Ort gefunden.</li>';
        list.querySelectorAll("button").forEach((b) => b.addEventListener("click", async () => {
          const h = hits[Number(b.dataset.i)];
          await saveConfig({ name: h.name, latitude: h.latitude, longitude: h.longitude, timezone: h.timezone || "auto" });
          void refresh();
        }));
      } catch {
        list.innerHTML = '<li class="zf-weather-msg">Ortssuche nicht erreichbar.</li>';
      }
    });
  }

  function renderWeather(data) {
    const cur = data.current;
    const now = describe(cur.weather_code, cur.is_day === 1);
    const daily = data.daily;
    const days = daily.time.slice(0, 4).map((t, i) => {
      const d = describe(daily.weather_code[i]);
      const label = i === 0 ? "Heute" : DAYS[new Date(`${t}T12:00`).getDay()];
      return `<li><span>${label}</span><i title="${esc(d.text)}">${d.icon}</i><b>${Math.round(daily.temperature_2m_max[i])}°</b><em>${Math.round(daily.temperature_2m_min[i])}°</em></li>`;
    }).join("");
    body.innerHTML = `
      <div class="zf-weather-head">
        <span class="zf-weather-title">${esc(config.name)}</span>
        <button type="button" class="zf-weather-edit" aria-label="Ort ändern" title="Ort ändern">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>
        </button>
      </div>
      <div class="zf-weather-now">
        <i class="zf-weather-icon" aria-hidden="true">${now.icon}</i>
        <div><b>${Math.round(cur.temperature_2m)}<small>°C</small></b><span>${esc(now.text)}</span></div>
      </div>
      <dl class="zf-weather-facts">
        <div><dt>Gefühlt</dt><dd>${Math.round(cur.apparent_temperature)}°</dd></div>
        <div><dt>Feuchte</dt><dd>${Math.round(cur.relative_humidity_2m)} %</dd></div>
        <div><dt>Wind</dt><dd>${Math.round(cur.wind_speed_10m)} km/h</dd></div>
      </dl>
      <ul class="zf-weather-days">${days}</ul>`;
    card.querySelector(".zf-weather-edit").addEventListener("click", () => renderSetup());
  }

  async function refresh() {
    config = config ?? (await loadConfig());
    if (!config) return renderSetup();
    try {
      const url = "https://api.open-meteo.com/v1/forecast"
        + `?latitude=${config.latitude}&longitude=${config.longitude}`
        + "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day"
        + "&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=4"
        + `&timezone=${encodeURIComponent(config.timezone || "auto")}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      renderWeather(await res.json());
      card.classList.remove("offline");
    } catch {
      card.classList.add("offline");
      if (!card.querySelector(".zf-weather-now")) renderSetup("Wetterdienst gerade nicht erreichbar.");
    }
  }

  void refresh();
  timer = setInterval(() => { if (!document.hidden) void refresh(); }, REFRESH_MS);
  F.on("config", ({ id, config: c }) => { if (id === ID && c) { config = c; void refresh(); } });
  void timer;
})();
