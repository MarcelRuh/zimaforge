// Nachgebautes ZimaOS-Gateway für die lokale Entwicklung (ohne Abhängigkeiten).
//
//   node dev/mock-zimaos.mjs            # Gateway auf :8081, simuliert /proc in dev-data/
//   ZIMAFORGE_UPSTREAM=http://127.0.0.1:8081 ZIMAFORGE_DATA=dev-data/data \
//   ZIMAFORGE_CATALOG=mods ZIMAFORGE_PROC=dev-data/proc ZIMAFORGE_SYS=dev-data/sys cargo run
//
// Danach http://127.0.0.1:8077 öffnen. Der Fake-Login setzt localStorage.access_token.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const PORT = Number(process.env.MOCK_PORT || 8081);
const TOKEN = "dev-session-token";
const ROOT = path.resolve(process.argv[2] || "dev-data");

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
</style></head>
<body><div id="app">
  <div class="bar"><b>ZimaOS</b><span>Mock-Dashboard für ZimaForge</span></div>
  <div class="layout">
    <aside class="widgets">
      <div class="widget"><div class="t">Uhr</div><div class="row">20:15</div></div>
      <div class="widget"><div class="t">System</div><div class="row">CPU 3 % · RAM 7 %</div></div>
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
  fs.writeFileSync(path.join(proc, "stat"), `cpu  ${busy} 0 0 ${idle} 0 0 0 0 0 0\ncpu0 0 0 0 0\ncpu1 0 0 0 0\ncpu2 0 0 0 0\ncpu3 0 0 0 0\n`);
  const total = 16 * 1024 * 1024;
  const avail = Math.round(total * (0.45 + 0.05 * Math.sin(t / 9)));
  fs.writeFileSync(path.join(proc, "meminfo"), `MemTotal: ${total} kB\nMemAvailable: ${avail} kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n`);
  fs.writeFileSync(path.join(proc, "loadavg"), `${(load * 4).toFixed(2)} 0.80 0.70 1/300 4242\n`);
  fs.writeFileSync(path.join(proc, "uptime"), `${300000 + t} 1\n`);
  fs.writeFileSync(path.join(proc, "net/dev"), `h\nh\n  eth0: ${rx} 0 0 0 0 0 0 0 ${tx} 0 0 0 0 0 0 0\n`);
  fs.writeFileSync(path.join(sys, "temp"), `${Math.round(46000 + 6000 * load)}\n`);
};
write();
setInterval(write, 1000);
