import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const chrome = process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/google-chrome');
if (!existsSync(chrome)) throw new Error(`Chrome not found: ${chrome}`);
const base = process.env.NPW_PREVIEW_URL || 'http://127.0.0.1:8082';
const out = process.env.NPW_QA_DIR || join(tmpdir(), 'nelyon-npw-e-qa');
mkdirSync(out, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'nelyon-download-chrome-'));
const browser = spawn(chrome, ['--headless=new', '--no-first-run', '--disable-gpu', '--no-sandbox', '--remote-allow-origins=*', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
try {
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await wait(100);
  if (!existsSync(portFile)) throw new Error('Chrome DevTools did not start');
  const port = Number(readFileSync(portFile, 'utf8').split(/\r?\n/)[0]);
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(base + '/download')}`, { method: 'PUT' })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => { const message = JSON.parse(data); if (!message.id) return; const task = pending.get(message.id); if (!task) return; pending.delete(message.id); message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result); });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const next = ++id; pending.set(next, { resolve, reject }); socket.send(JSON.stringify({ id: next, method, params })); });
  const evaluate = async (expression) => { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result.value; };
  await send('Page.enable'); await send('Runtime.enable');
  const results = [];
  for (const width of [320, 390, 430, 768, 1024, 1280, 1366, 1440, 1920]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `${base}/download` });
    for (let i = 0; i < 80; i++) { if (await evaluate("location.pathname === '/download' && document.readyState === 'complete'")) break; await wait(100); }
    if (!await evaluate("location.pathname === '/download' && document.readyState === 'complete'")) throw new Error('Download navigation did not complete');
    await evaluate('(async()=>{await Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,3000))]);await Promise.race([Promise.all(Array.from(document.images,im=>im.decode().catch(()=>{}))),new Promise(r=>setTimeout(r,5000))])})()');
    const metrics = await evaluate(`({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,h1:document.querySelectorAll('h1').length,main:document.querySelectorAll('main').length,nav:document.querySelectorAll('nav').length,footer:document.querySelectorAll('footer').length,brokenImages:Array.from(document.images).filter(i=>i.complete&&i.naturalWidth===0).map(i=>i.src),missingAlt:Array.from(document.images).filter(i=>!i.hasAttribute('alt')).map(i=>i.src),robots:document.querySelector('meta[name=robots]')?.content,canonical:document.querySelector('link[rel=canonical]')?.href,storeLinks:Array.from(document.querySelectorAll('a[href*="apps.apple.com"],a[href*="play.google.com"]')).length,businessLink:Array.from(document.querySelectorAll('a[href="/business/home"]')).length})`);
    results.push(metrics);
    if ([390, 768, 1280, 1440].includes(width)) {
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.ceil(metrics.height), scale: 1 } });
      writeFileSync(join(out, `download-${width}.png`), Buffer.from(shot.data, 'base64'));
    }
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/download` });
  for (let i = 0; i < 80; i++) { if (await evaluate("location.pathname === '/download' && document.readyState === 'complete'")) break; await wait(100); }
  if (!await evaluate("location.pathname === '/download' && document.readyState === 'complete'")) throw new Error('Menu test navigation did not complete');
  const menu = await evaluate(`(()=>{const button=document.querySelector('[data-menu-toggle]');button.click();const opened=button.getAttribute('aria-expanded')==='true';document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return {opened,closed:button.getAttribute('aria-expanded')==='false',focusRestored:document.activeElement===button}})()`);
  const statuses = Object.fromEntries(await Promise.all(['/download', '/business', '/ads'].map(async (path) => [path, (await fetch(base + path)).status])));
  const errors = results.filter((item) => item.scrollWidth > item.width || item.h1 !== 1 || item.main !== 1 || item.nav < 1 || item.footer !== 1 || item.brokenImages.length || item.missingAlt.length || item.robots !== 'noindex,nofollow' || item.canonical !== 'https://nelyon.app/download' || item.storeLinks !== 0 || item.businessLink < 1);
  console.log(JSON.stringify({ out, results, menu, statuses, errors: errors.length }, null, 2));
  if (errors.length || !menu.opened || !menu.closed || !menu.focusRestored || Object.values(statuses).some((status) => status !== 200)) process.exitCode = 1;
} finally { socket?.close(); browser.kill(); }
