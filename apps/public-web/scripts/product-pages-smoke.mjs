import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const chrome = process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/google-chrome');
if (!existsSync(chrome)) throw new Error(`Chrome not found: ${chrome}`);
const base = process.env.NPW_PREVIEW_URL || 'http://127.0.0.1:8082';
const out = process.env.NPW_QA_DIR || join(tmpdir(), 'nelyon-npw-c-qa');
mkdirSync(out, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'nelyon-product-qa-'));
const browser = spawn(chrome, ['--headless=new','--no-first-run','--disable-gpu','--no-sandbox','--remote-allow-origins=*','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'], { stdio: 'ignore' });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
try {
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i=0;i<100 && !existsSync(portFile);i++) await wait(100);
  if (!existsSync(portFile)) throw new Error('Chrome DevTools did not start');
  const port = Number(readFileSync(portFile, 'utf8').split(/\r?\n/)[0]);
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(base + '/')}`, { method: 'PUT' })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject) => { socket.addEventListener('open',resolve,{once:true}); socket.addEventListener('error',reject,{once:true}); });
  let id=0;
  const pending=new Map();
  socket.addEventListener('message', ({data}) => { const message=JSON.parse(data); if(!message.id)return; const task=pending.get(message.id); if(!task)return; pending.delete(message.id); message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result); });
  const send=(method,params={}) => new Promise((resolve,reject) => { const next=++id; pending.set(next,{resolve,reject}); socket.send(JSON.stringify({id:next,method,params})); });
  const evaluate=async(expression) => { const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true}); if(result.exceptionDetails)throw new Error(result.exceptionDetails.text); return result.result.value; };
  await send('Page.enable'); await send('Runtime.enable');
  const routes=['features','business','ads','marketplace','creators','live'];
  const widths=[320,375,390,430,600,768,1024,1280,1366,1440,1728,1920];
  const results=[];
  for(const route of routes) {
    const response=await fetch(`${base}/${route}`);
    if(response.status!==200) throw new Error(`${route}: HTTP ${response.status}`);
    for(const width of widths) {
      await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
      await send('Page.navigate',{url:`${base}/${route}`});
      for(let i=0;i<70;i++) { if(await evaluate('document.readyState')==='complete')break; await wait(100); }
      await evaluate('(async()=>{await Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,2500))]);document.querySelectorAll("img[loading=lazy]").forEach(i=>i.loading="eager");await Promise.race([Promise.all(Array.from(document.images,im=>im.decode().catch(()=>{}))),new Promise(r=>setTimeout(r,4000))]);window.scrollTo(0,0)})()');
      const metrics=await evaluate('({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,lang:document.documentElement.lang,h1:document.querySelectorAll("h1").length,main:document.querySelectorAll("main").length,nav:document.querySelectorAll("nav").length,footer:document.querySelectorAll("footer").length,brokenImages:Array.from(document.images).filter(i=>i.complete&&i.naturalWidth===0).map(i=>i.src),missingAlt:Array.from(document.images).filter(i=>!i.hasAttribute("alt")).map(i=>i.src),title:document.title,description:document.querySelector("meta[name=description]")?.content,canonical:document.querySelector("link[rel=canonical]")?.href,robots:document.querySelector("meta[name=robots]")?.content})');
      results.push({route,width,...metrics});
      if([390,1440].includes(width)) {
        await wait(900);
        const full=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height:Math.ceil(metrics.height),scale:1}});
        writeFileSync(join(out,`${route}-${width}.png`),Buffer.from(full.data,'base64'));
      }
    }
  }
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await send('Page.navigate',{url:`${base}/live`});
  await wait(400);
  const reduced=await evaluate('({hero:getComputedStyle(document.querySelector(".product-hero h1")).animationName,media:getComputedStyle(document.querySelector(".product-hero-image")).animationName})');
  const errors=results.filter(item=>item.scrollWidth>item.width||item.lang!=='en'||item.h1!==1||item.main!==1||item.nav<1||item.footer!==1||item.brokenImages.length||item.missingAlt.length||!item.description||!item.canonical.endsWith(`/${item.route}`)||item.robots!=='noindex,nofollow');
  console.log(JSON.stringify({out,checked:results.length,errors:errors.map(({route,width,scrollWidth,canonical,brokenImages,missingAlt})=>({route,width,scrollWidth,canonical,brokenImages,missingAlt})),reduced,screenshots:routes.flatMap(route=>[`${route}-390.png`,`${route}-1440.png`])},null,2));
  if(errors.length||reduced.hero!=='none'||reduced.media!=='none')process.exitCode=1;
} finally { socket?.close(); browser.kill(); }
