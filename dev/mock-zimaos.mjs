// Nachgebautes ZimaOS-Gateway für die lokale Entwicklung (ohne Abhängigkeiten).
//
//   node dev/mock-zimaos.mjs            # Gateway auf :8081, simuliert /proc in dev-data/
//   ZIMAFORGE_UPSTREAM=http://127.0.0.1:8081 ZIMAFORGE_DATA=dev-data/data \
//   ZIMAFORGE_CATALOG=mods ZIMAFORGE_PROC=dev-data/proc ZIMAFORGE_SYS=dev-data/sys ZIMAFORGE_DOCKER=dev-data/docker cargo run
//
// Danach http://127.0.0.1:8077 öffnen. Der Fake-Login setzt localStorage.access_token.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const PORT = Number(process.env.MOCK_PORT || 8081);
const TOKEN = "dev-session-token";
const ROOT = path.resolve(process.argv[2] || "dev-data");
// MOCK_FLAKY=n: die ersten n Abrufe der App-Liste schlagen fehl (wie ein ZimaOS beim Start).
let flaky = Number(process.env.MOCK_FLAKY || 0);
let mockChecks = 0; // wie oft „Check again“ (update/check) angestoßen wurde

const page = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZimaOS (Mock)</title>
<style>
  body{margin:0;min-height:100vh;font:14px system-ui,sans-serif;color:#fff;
    background:linear-gradient(160deg,#1b2b4a,#0d1424 55%,#1a1030)}
  .bar{display:flex;align-items:center;gap:12px;padding:14px 24px;background:#ffffff14;backdrop-filter:blur(10px)}
  .bar b{font-size:16px}.bar span{opacity:.7}
  .layout{display:flex;gap:28px;padding:28px 24px}
  .widgets{width:320px;flex:none;display:flex;flex-direction:column;min-height:520px}
  .widget{border-radius:12px;background:#1b1d22b8;backdrop-filter:blur(12px);padding:14px 16px;margin-bottom:12px}
  .widget .t{font-size:17px;font-weight:600;margin-bottom:10px}
  .widget .row{opacity:.8;font-size:13px}
  .grid{flex:1;display:grid;grid-template-columns:repeat(auto-fill,140px);gap:18px;align-content:start}
  .app{height:140px;border-radius:16px;background:#ffffff1f;display:grid;place-items:center;text-align:center;cursor:pointer}
  .app i{display:block;width:56px;height:56px;margin:0 auto 10px;border-radius:14px;background:#3a86ff}
  #login{position:fixed;left:24px;bottom:24px;padding:8px 14px;border-radius:8px;border:0;cursor:pointer}
  .modal{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;background:#0008}
  .modal[hidden]{display:none}
  .modal section{width:min(900px,90vw);height:70vh;border-radius:16px;background:#f4f5f7;color:#222;padding:24px}
  .hd{display:flex;justify-content:space-between;align-items:center}.chev{background:none;border:0;color:#fff;cursor:pointer;font-size:16px}
  .tabs{display:flex;gap:12px;align-items:center;margin-top:10px}.tabs[hidden]{display:none}.tabs .menu{margin-left:auto;cursor:pointer}
</style></head>
<body><div id="app">
  <div class="bar"><b>ZimaOS</b><span>Mock-Dashboard für ZimaForge</span></div>
  <div class="layout">
    <aside class="widgets">
      <div class="widget"><div class="t">Uhr</div><div class="row">20:15</div></div>
      <div class="widget" id="sys"><div class="t hd"><span>System</span><button class="chev" type="button" aria-label="aufklappen">⌄</button></div>
        <div class="row">CPU 3 % · RAM 7 %</div>
        <div class="tabs" hidden><span>CPU</span><span>RAM</span><svg class="menu" viewBox="0 0 24 24" width="18" height="18"><path d="M4 7h16M4 12h16M4 17h16" stroke="#fff" stroke-width="2"/></svg></div></div>
      <div class="widget"><div class="t">Storage</div><div class="row">1,2 TB frei</div></div>
      <div class="widget"><div class="t">Network</div><div class="row">↓ 2 MB/s ↑ 300 KB/s</div></div>
    </aside>
    <div class="grid">
      ${["App Store", "Files", "Jellyfin", "Immich", "ZimaForge", "Settings"]
        .map((n, i) => `<div class="app" data-app-name="${n}"><div><i style="background:hsl(${i * 55},70%,55%)"></i>${n}</div></div>`)
        .join("")}
    </div>
  </div>
  <button id="login" type="button"></button>
  <div class="modal" id="monitor" role="dialog" aria-modal="true" hidden>
    <section><h2>Ressourcenmonitor (Mock)</h2><p>Klick daneben schließt.</p></section>
  </div>
  <div class="modal" id="appstore" role="dialog" aria-modal="true" hidden>
    <section><h2>App Store (Mock)</h2><p>Klick daneben schließt.</p></section>
  </div>
</div>
<script>
  const b=document.getElementById("login");
  const sync=()=>b.textContent=localStorage.getItem("access_token")?"Abmelden (Mock)":"Anmelden (Mock)";
  b.onclick=()=>{localStorage.getItem("access_token")?localStorage.removeItem("access_token"):localStorage.setItem("access_token","${TOKEN}");sync()};
  sync();
  const store=document.getElementById("appstore");
  store.onclick=(e)=>{if(e.target===store)store.hidden=true};
  const mon=document.getElementById("monitor");
  mon.onclick=(e)=>{if(e.target===mon)mon.hidden=true};
  document.querySelector("#sys .chev").onclick=()=>{const t=document.querySelector("#sys .tabs");t.hidden=!t.hidden};
  // Wie ZimaOS: btop über ttyd auf wechselndem Port in neuem Tab.
  document.querySelector("#sys .menu").addEventListener("click",()=>{window.open(location.protocol+"//"+location.hostname+":"+(31000+Math.floor(Math.random()*2000))+"/","_blank")});
  // Wie ZimaOS: Kachel öffnet die Web-URL der App (Host + port_map + index) in einem neuen Tab.
  const urls={ZimaForge:"8077/?forge",Jellyfin:"8096/"};
  document.querySelectorAll(".app").forEach(t=>t.onclick=()=>{
    if(t.dataset.appName==="App Store"){store.hidden=false;return}
    const u=urls[t.dataset.appName]; if(u) window.open(location.protocol+"//"+location.hostname+":"+u,"_blank");
  });
</script></body></html>`;

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/v1/users/current") {
      const ok = req.headers.authorization === TOKEN;
      res.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
      return res.end(ok ? '{"data":{"username":"admin"}}' : '{"message":"unauthorized"}');
    }
    if (url.pathname === "/__mock/checks") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ checks: mockChecks })); }
    // ZimaOS-App-Store („zimaapp“-Schnittstelle, Form wie auf einem echten ZimaOS).
    if (url.pathname.startsWith("/v2/app_management/zimaapp/")) {
      if (req.headers.authorization !== TOKEN) { res.writeHead(401); return res.end(); }
      const send = (data) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ data, message: "OK" })); };
      const sub = url.pathname.slice("/v2/app_management/zimaapp".length);
      if (sub === "/update/check" && req.method === "POST") { mockChecks++; return send({ succeeded: [], failed: [] }); }
      if (sub === "/updates") {
        return send({ items: [
          { zimaapp_id: "zimaapp://v2app/plex", title: "Plex", icon: "https://cdn.jsdelivr.net/gh/IceWhaleTech/CasaOS-AppStore@main/Apps/Plex/icon.png", availability: "available",
            changes: [{ type: "version", current_version: "1.41.2", target_version: "1.41.3" }], changelog: "Fehlerbehebungen und schnellere Bibliothekssuche." },
          { zimaapp_id: "zimaapp://v2app/immich", title: "Immich", icon: "", availability: "ignored",
            changes: [{ type: "version", current_version: "v1.119.0", target_version: "v1.120.1" }] },
        ] });
      }
      if (sub === "/update/ignored") return send({ items: [] });
      if (sub === "/v2app/images/drift/list") {
        return send({ items: [{
          compose_revision: "sha256:ad2c2376", drift_revision: "651b6d73bf5e5901",
          icon: "https://github.com/MarcelRuh/zimaforge/blob/main/assets/icon.png?raw=true",
          id: "custom__zf", name: "custom__zf", installed_version: "0.1.0", zimaapp_id: "zimaapp://v2app/custom__zf",
          title: { custom: "ZimaForge", de_de: "ZimaForge", en_us: "ZimaForge" },
          images: [{ current_digests: ["sha256:b608ad7a1bd5a2ec7d41"], current_image: "ghcr.io/marcelruh/zimaforge:latest", service: "zimaforge",
            target_digest: "sha256:a8945eed1cb5b7def20a", target_image: "ghcr.io/marcelruh/zimaforge:latest" }],
        }] });
      }
      res.writeHead(404); return res.end();
    }
    // App Store → Meine Apps → Aktualisieren (Form wie CasaOS-AppManagement; ältere Systeme).
    if (url.pathname === "/v2/app_management/apps/upgradable") {
      if (req.headers.authorization !== TOKEN) { res.writeHead(401); return res.end(); }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ message: "ok", data: [
        { store_app_id: "plex", title: "Plex", version: "1.41.2", status: "idle", icon: "https://cdn.jsdelivr.net/gh/IceWhaleTech/CasaOS-AppStore@main/Apps/Plex/icon.png" },
        { store_app_id: "immich", title: { en_us: "Immich" }, version: "v1.119.0", status: "idle", icon: "" },
      ] }));
    }
    const stableMatch = url.pathname.match(/^\/v2\/app_management\/apps\/([^/]+)\/stable$/);
    if (stableMatch) {
      if (req.headers.authorization !== TOKEN) { res.writeHead(401); return res.end(); }
      const tags = { plex: "1.41.3", immich: "v1.120.1" };
      const tag = tags[decodeURIComponent(stableMatch[1])];
      res.writeHead(tag ? 200 : 404, { "content-type": "application/json" });
      return res.end(JSON.stringify(tag ? { message: "ok", data: { tag } } : { message: "not found" }));
    }
    if (url.pathname === "/v2/app_management/web/appgrid") {
      if (req.headers.authorization !== TOKEN) { res.writeHead(401); return res.end(); }
      if (flaky > 0) { flaky--; res.writeHead(500); return res.end(); }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ data: [
        { name: "plex", title: { en_us: "Plex" }, icon: "https://cdn.jsdelivr.net/gh/IceWhaleTech/CasaOS-AppStore@main/Apps/Plex/icon.png" },
        { name: "immich", title: { en_us: "Immich" } },
        { name: "aliasvault", title: { en_us: "AliasVault" } },
      ] }));
    }
    if (url.pathname === "/v2/zimaos/tty/btop" && req.method === "POST") {
      if (req.headers.authorization !== TOKEN) { res.writeHead(401); return res.end(); }
      // ZimaOS startet ttyd mit btop auf einem freien Port und meldet ihn zurück.
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ success: 200, message: "ok", data: { port: 31000 + Math.floor(Math.random() * 2000) } }));
    }
    const containersMatch = url.pathname.match(/^\/v2\/app_management\/compose\/([^/]+)\/containers$/);
    if (containersMatch) {
      if (req.headers.authorization !== TOKEN) { res.writeHead(401); return res.end(); }
      // Wie CasaOS-AppManagement: data.containers = { <ID>: ContainerSummary }
      const app = APPS.find(([n]) => n === decodeURIComponent(containersMatch[1]));
      if (!app) { res.writeHead(404); return res.end(); }
      const id = app[1].repeat(32);
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ data: { main: app[0], containers: { [id]: { ID: id, Name: app[0], Project: app[0], Service: app[0] } } } }));
    }
    if (url.pathname === "/v1/sys/utilization") {
      if (req.headers.authorization !== TOKEN) { res.writeHead(401); return res.end(); }
      // Form wie CasaOS/ZimaOS: Prozentwerte direkt, Leistung als RAPL-Zähler (µJ).
      const total = 16 * 1024 ** 3;
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ success: 200, data: {
        cpu: { percent: 3, num: 4, temperature: 32, power: { timestamp: String(Date.now()), value: String(Math.round(performance.now() * 11000)) } },
        mem: { total, available: total * 0.93, used: total * 0.07, usedPercent: 7 },
      } }));
    }
    if (url.pathname === "/v2/settings/fe.custom") {
      res.writeHead(400);
      return res.end();
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(page);
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end('{"message":"not found"}');
  })
  .listen(PORT, "127.0.0.1", () => console.log(`Mock-ZimaOS auf http://127.0.0.1:${PORT}`));

// Simuliertes /proc und /sys, damit „Forge Pulse“ lebendige Werte zeigt.
const proc = path.join(ROOT, "proc");
const sys = path.join(ROOT, "sys/class/thermal/thermal_zone0");
fs.mkdirSync(path.join(proc, "net"), { recursive: true });
fs.mkdirSync(sys, { recursive: true });
let busy = 0, idle = 0, rx = 0, tx = 0, t = 0;
const write = () => {
  t += 1;
  const load = 0.25 + 0.2 * Math.sin(t / 6) + Math.random() * 0.15;
  busy += Math.round(400 * load);
  idle += Math.round(400 * (1 - load));
  rx += Math.round(2e6 + Math.random() * 3e6);
  tx += Math.round(3e5 + Math.random() * 6e5);
  const cores = [0.9, 1.1, 0.7, 1.3]
    .map((f, i) => `cpu${i} ${Math.round((busy / 4) * f)} 0 0 ${Math.round((idle / 4) * (2 - f))} 0\n`)
    .join("");
  fs.writeFileSync(path.join(proc, "stat"), `cpu  ${busy} 0 0 ${idle} 0 0 0 0 0 0\n${cores}`);
  const total = 16 * 1024 * 1024;
  const avail = Math.round(total * (0.45 + 0.05 * Math.sin(t / 9)));
  fs.writeFileSync(path.join(proc, "meminfo"), `MemTotal: ${total} kB\nMemAvailable: ${avail} kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n`);
  fs.writeFileSync(path.join(proc, "loadavg"), `${(load * 4).toFixed(2)} 0.80 0.70 1/300 4242\n`);
  fs.writeFileSync(path.join(proc, "uptime"), `${300000 + t} 1\n`);
  fs.writeFileSync(path.join(proc, "net/dev"), `h\nh\n  eth0: ${rx} 0 0 0 0 0 0 0 ${tx} 0 0 0 0 0 0 0\n`);
  fs.writeFileSync(path.join(sys, "temp"), `${Math.round(46000 + 6000 * load)}\n`);
};
// Simulierte Prozesse in Containern (für Apps- und Prozess-Ansicht in Forge Pulse)
const docker = path.join(ROOT, "docker");
const APPS = [["plex", "a1"], ["immich", "b2"], ["aliasvault", "c3"]];
for (const [name, p] of APPS) {
  const id = p.repeat(32);
  fs.mkdirSync(path.join(docker, id), { recursive: true });
  fs.writeFileSync(path.join(docker, id, "config.v2.json"), JSON.stringify({ Name: "/" + name, Config: { Labels: { "com.docker.compose.project": name } } }));
}
const PROCS = [[101, "Plex Media Serv", 0, 0.6, 22000], [102, "Plex Transcoder", 0, 1.4, 31000], [201, "immich", 1, 0.4, 110000], [202, "python", 1, 0.3, 40000], [301, "dotnet", 2, 0.2, 60000], [401, "zimaos-gateway", -1, 0.1, 17000], [402, "btop", -1, 0.05, 7000]];
const ticks = new Map();
const hw = path.join(ROOT, "sys/class/hwmon/hwmon0");
fs.mkdirSync(hw, { recursive: true });
fs.writeFileSync(path.join(hw, "name"), "coretemp\n");
fs.writeFileSync(
  path.join(proc, "cpuinfo"),
  Array.from({ length: 4 }, (_, i) => `processor\t: ${i}\nmodel name\t: 12th Gen Intel(R) Core(TM) i5-1235U\ncpu MHz\t\t: ${4200 + i * 50}.000\n`).join("\n"),
);
let rd = 0, wr = 0;
const writeExtra = () => {
  for (const [pid, name, app, share, rssKb] of PROCS) {
    const d = path.join(proc, String(pid));
    fs.mkdirSync(d, { recursive: true });
    const tk = (ticks.get(pid) ?? 0) + Math.round(share * 4 * (0.5 + Math.random()));
    ticks.set(pid, tk);
    fs.writeFileSync(path.join(d, "stat"), `${pid} (${name}) S 1 1 1 0 0 0 0 0 0 0 ${tk} 0 0 0`);
    fs.writeFileSync(path.join(d, "statm"), `0 ${rssKb / 4} 0 0 0 0 0`);
    fs.writeFileSync(path.join(d, "cgroup"), app >= 0 ? `0::/system.slice/docker-${APPS[app][1].repeat(32)}.scope` : "0::/system.slice/zimaos.service");
  }
  const temps = [["Package id 0", 49], ["Core 0", 49], ["Core 4", 38], ["Core 8", 32]];
  temps.forEach(([label, c], i) => {
    fs.writeFileSync(path.join(hw, `temp${i + 1}_label`), label);
    fs.writeFileSync(path.join(hw, `temp${i + 1}_input`), String((c + Math.round(Math.random() * 3)) * 1000));
  });
  rd += Math.round(Math.random() * 4000); wr += Math.round(Math.random() * 9000);
  fs.writeFileSync(path.join(proc, "diskstats"), `   8       0 sda 1 0 ${rd} 0 1 0 ${wr} 0 0 0 0\n   7       0 loop0 1 0 99 0 0 0 0 0 0 0 0\n`);
};
const writeAll = () => { write(); writeExtra(); };
writeAll();
setInterval(writeAll, 1000);
