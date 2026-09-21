import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const chrome = process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/google-chrome');
if (!existsSync(chrome)) throw new Error(`Chrome not found: ${chrome}`);
const base = process.env.NPW_PREVIEW_URL || 'http://127.0.0.1:8082';
const profile = mkdtempSync(join(tmpdir(), 'nelyon-performance-chrome-'));
const browser = spawn(chrome, ['--headless=new', '--no-first-run', '--disable-gpu', '--no-sandbox', '--remote-allow-origins=*', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;

try {
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await wait(100);
  if (!existsSync(portFile)) throw new Error('Chrome DevTools did not start');
  const port = Number(readFileSync(portFile, 'utf8').split(/\r?\n/)[0]);
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(base + '/')}`, { method: 'PUT' })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let id = 0;
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
    const next = ++id;
    pending.set(next, { resolve, reject });
    socket.send(JSON.stringify({ id: next, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__npwVitals = { lcp: 0, cls: 0, longTasks: [] };
    try { new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__npwVitals.lcp = entry.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch {}
    try { new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__npwVitals.cls += entry.value; }).observe({ type: 'layout-shift', buffered: true }); } catch {}
    try { new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__npwVitals.longTasks.push(entry.duration); }).observe({ type: 'longtask', buffered: true }); } catch {}
  ` });

  const cases = [
    { page: '/', viewport: 'mobile', width: 390, height: 844 },
    { page: '/', viewport: 'desktop', width: 1440, height: 900 },
    { page: '/features', viewport: 'mobile', width: 390, height: 844 },
    { page: '/whats-new', viewport: 'mobile', width: 390, height: 844 },
    { page: '/download', viewport: 'mobile', width: 390, height: 844 },
  ];
  const results = [];
  for (const item of cases) {
    await send('Emulation.setDeviceMetricsOverride', { width: item.width, height: item.height, deviceScaleFactor: item.viewport === 'mobile' ? 2 : 1, mobile: item.viewport === 'mobile' });
    await send('Page.navigate', { url: base + item.page });
    for (let i = 0; i < 100; i++) {
      if (await evaluate("document.readyState === 'complete'")) break;
      await wait(100);
    }
    await evaluate('(async()=>{await Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,3000))]);await new Promise(r=>setTimeout(r,1500))})()');
    const metrics = await evaluate(`(() => {
      const navigation = performance.getEntriesByType('navigation')[0];
      const resources = performance.getEntriesByType('resource');
      const bytes = (type) => resources.filter((entry) => entry.initiatorType === type).reduce((sum, entry) => sum + (entry.encodedBodySize || 0), 0);
      const longTasks = window.__npwVitals?.longTasks || [];
      return {
        lcpMs: Math.round(window.__npwVitals?.lcp || 0),
        fcpMs: Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0),
        cls: Number((window.__npwVitals?.cls || 0).toFixed(4)),
        tbtProxyMs: Math.round(longTasks.reduce((sum, duration) => sum + Math.max(0, duration - 50), 0)),
        domContentLoadedMs: Math.round(navigation?.domContentLoadedEventEnd || 0),
        loadMs: Math.round(navigation?.loadEventEnd || 0),
        resourceCount: resources.length,
        imageBytes: bytes('img'),
        cssBytes: bytes('link'),
        scriptBytes: bytes('script'),
        externalOrigins: [...new Set(resources.map((entry) => new URL(entry.name).origin).filter((origin) => origin !== location.origin))],
      };
    })()`);
    results.push({ ...item, ...metrics });
  }
  console.log(JSON.stringify({ method: 'Chrome PerformanceObserver on the local production build; no network or CPU throttling', results }, null, 2));
  if (results.some((result) => result.fcpMs <= 0 || result.cls < 0 || result.scriptBytes !== 0)) process.exitCode = 1;
} finally {
  socket?.close();
  browser.kill();
}
