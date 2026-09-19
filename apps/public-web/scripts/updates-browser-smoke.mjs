import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const chrome = process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/google-chrome');
if (!existsSync(chrome)) throw new Error(`Chrome not found: ${chrome}`);
const base = process.env.NPW_PREVIEW_URL || 'http://127.0.0.1:8082';
const out = process.env.NPW_QA_DIR || join(tmpdir(), 'nelyon-npw-d-qa');
mkdirSync(out, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'nelyon-updates-chrome-'));
const browser = spawn(chrome, ['--headless=new', '--no-first-run', '--disable-gpu', '--no-sandbox', '--remote-allow-origins=*', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
try {
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await wait(100);
  if (!existsSync(portFile)) throw new Error('Chrome DevTools did not start');
  const port = Number(readFileSync(portFile, 'utf8').split(/\r?\n/)[0]);
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(base + '/')}`, { method: 'PUT' });
  const target = await response.json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id) return;
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  const widths = [320, 390, 430, 768, 1024, 1280, 1366, 1440, 1920];
  const paths = ['/whats-new', '/whats-new/nelyon-business-preview'];
  const results = [];
  for (const path of paths) for (const width of widths) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: base + path });
    for (let i = 0; i < 80; i++) { if ((await evaluate('document.readyState')) === 'complete') break; await wait(100); }
    await evaluate('(async()=>{await Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,3000))]);document.querySelectorAll("img[loading=lazy]").forEach(i=>i.loading="eager");await Promise.race([Promise.all(Array.from(document.images,im=>im.decode().catch(()=>{}))),new Promise(r=>setTimeout(r,6000))])})()');
    const metrics = await evaluate('({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,h1:document.querySelectorAll("h1").length,main:document.querySelectorAll("main").length,article:document.querySelectorAll("article").length,brokenImages:Array.from(document.images).filter(i=>i.complete&&i.naturalWidth===0).map(i=>i.src),missingAlt:Array.from(document.images).filter(i=>!i.hasAttribute("alt")).map(i=>i.src),noindex:document.querySelector("meta[name=robots]")?.content,canonical:document.querySelector("link[rel=canonical]")?.href})');
    results.push({ path, ...metrics });
    if ([390, 1440].includes(width)) {
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.ceil(metrics.height), scale: 1 } });
      writeFileSync(join(out, `${path.includes('preview') ? 'detail' : 'index'}-${width}.png`), Buffer.from(shot.data, 'base64'));
    }
  }
  const statuses = Object.fromEntries(await Promise.all(['/whats-new', ...paths.slice(1), '/whats-new/not-a-story'].map(async (path) => [path, (await fetch(base + path)).status])));
  console.log(JSON.stringify({ out, results, statuses }, null, 2));
  if (results.some((item) => item.scrollWidth > item.width || item.h1 !== 1 || item.main !== 1 || item.brokenImages.length || item.missingAlt.length || item.noindex !== 'noindex,nofollow' || !item.canonical || (item.path.includes('preview') && item.article !== 1)) || statuses['/whats-new/not-a-story'] !== 404 || Object.entries(statuses).some(([path, status]) => path !== '/whats-new/not-a-story' && status !== 200)) process.exitCode = 1;
} finally { socket?.close(); browser.kill(); }
