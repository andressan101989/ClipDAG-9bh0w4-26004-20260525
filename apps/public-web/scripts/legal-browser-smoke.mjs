import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const base = process.env.NPW_PREVIEW_URL || 'http://127.0.0.1:8082';
const output = process.env.NPW_QA_DIR || mkdtempSync(join(tmpdir(), 'nelyon-npw-f-c3-shots-'));
if (!existsSync(chrome)) throw new Error(`Chrome not found: ${chrome}`);
const profile = mkdtempSync(join(tmpdir(), 'nelyon-npw-f-c3-chrome-'));
const browser = spawn(chrome, ['--headless=new', '--no-first-run', '--disable-gpu', '--no-sandbox', '--remote-allow-origins=*', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
try {
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await wait(100);
  if (!existsSync(portFile)) throw new Error('Chrome DevTools did not start');
  const port = Number(readFileSync(portFile, 'utf8').split(/\r?\n/)[0]);
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(base + '/support')}`, { method: 'PUT' })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => { const message = JSON.parse(data); if (!message.id) return; const task = pending.get(message.id); if (!task) return; pending.delete(message.id); message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result); });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const next = ++id; pending.set(next, { resolve, reject }); socket.send(JSON.stringify({ id: next, method, params })); });
  const evaluate = async (expression) => { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result.value; };
  await send('Page.enable'); await send('Runtime.enable');
  const results = [];
  for (const route of ['/support', '/contact', '/privacy', '/terms']) {
    for (const width of [320, 390, 430, 768, 1024, 1280, 1440, 1920]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await send('Page.navigate', { url: base + route });
      for (let i = 0; i < 80; i++) { if (await evaluate(`location.pathname === '${route}' && document.readyState === 'complete'`)) break; await wait(100); }
      if (!await evaluate(`location.pathname === '${route}' && document.readyState === 'complete'`)) throw new Error(`${route} navigation did not complete`);
      await evaluate('(async()=>{await Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,3000))]);await Promise.race([Promise.all(Array.from(document.images,im=>im.decode().catch(()=>{}))),new Promise(r=>setTimeout(r,5000))])})()');
      const metrics = await evaluate(`({route:location.pathname,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,h1:document.querySelectorAll('h1').length,main:document.querySelectorAll('main').length,nav:document.querySelectorAll('nav').length,footer:document.querySelectorAll('footer').length,brokenImages:Array.from(document.images).filter(i=>i.complete&&i.naturalWidth===0).length,missingAlt:Array.from(document.images).filter(i=>!i.hasAttribute('alt')).length,robots:document.querySelector('meta[name=robots]')?.content,mailto:document.querySelectorAll('a[href^="mailto:"]').length,leak:/draft-c2-unapproved|evidenceRefs|decisionState|blocked_unknown|owner_decision_required|legal_review_required/.test(document.body.innerText)})`);
      results.push(metrics);
      if ([390, 1440].includes(width)) {
        // The local Astro dev toolbar is not part of the published page.
        await evaluate("document.querySelector('astro-dev-toolbar')?.remove()");
        const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.ceil(metrics.height), scale: 1 } });
        writeFileSync(join(output, `${route.slice(1)}-${width}.png`), Buffer.from(shot.data, 'base64'));
      }
    }
  }
  const errors = results.filter((x) => x.scrollWidth > x.width || x.h1 !== 1 || x.main !== 1 || x.nav < 1 || x.footer !== 1 || x.brokenImages || x.missingAlt || x.robots !== 'noindex,nofollow' || x.leak);
  console.log(JSON.stringify({ output, results, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally { socket?.close(); browser.kill(); }
