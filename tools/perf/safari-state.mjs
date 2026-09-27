// usage: node safari-state.mjs [url]   Safari: load the site, start it, and report its state and any errors
import { execFileSync } from 'node:child_process';
const URL = process.argv[2] || 'http://localhost:5173/';
const WD = 'http://localhost:4444';
const req = async (method, path, body) => { const r = await fetch(WD + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (j.value && j.value.error) throw new Error(j.value.error + ': ' + j.value.message); return j.value; };
const { sessionId } = await req('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } });
const S = `/session/${sessionId}`;
const run = (script) => req('POST', S + '/execute/sync', { script, args: [] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  await req('POST', S + '/window/rect', { x: 0, y: 0, width: 1440, height: 900 });
  await req('POST', S + '/url', { url: URL });
  execFileSync('osascript', ['-e', 'tell application "Safari" to activate']);
  await run('window.__errs = []; window.addEventListener("error", (e) => window.__errs.push(String(e.message))); window.addEventListener("unhandledrejection", (e) => window.__errs.push("rejection: " + String(e.reason)));');
  for (let i = 0; i < 60; i++) { const s = await run('return { ready: typeof window.begin === "function", portfolio: !!window.portfolio, loader: document.getElementById("loader-sub")?.textContent, errs: window.__errs }'); console.log(JSON.stringify(s)); if (s.ready) break; await wait(1000); }
  await run('window.begin()'); await wait(3000);
  console.log(await run('return JSON.stringify({ t: window.world.time, state: window.portfolio.state, errs: window.__errs, vis: document.visibilityState })'));
  await wait(2000);
  console.log(await run('return JSON.stringify({ t: window.world.time, errs: window.__errs })'));
} finally { await req('DELETE', S); }
