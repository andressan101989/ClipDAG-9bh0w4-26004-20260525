import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chrome =
  process.env.CHROME_PATH ||
  (process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "/usr/bin/google-chrome");
if (!existsSync(chrome)) throw new Error(`Chrome not found: ${chrome}`);
const base = process.env.NPW_PREVIEW_URL || "http://127.0.0.1:8082";
const out = process.env.NPW_QA_DIR || join(tmpdir(), "nelyon-npw-b-qa");
mkdirSync(out, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "nelyon-qa-chrome-"));
const browser = spawn(
  chrome,
  [
    "--headless=new",
    "--no-first-run",
    "--disable-gpu",
    "--no-sandbox",
    "--remote-allow-origins=*",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
try {
  const portFile = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await wait(100);
  if (!existsSync(portFile)) throw new Error("Chrome DevTools did not start");
  const port = Number(readFileSync(portFile, "utf8").split(/\r?\n/)[0]);
  const targetResponse = await fetch(
    `http://127.0.0.1:${port}/json/new?${encodeURIComponent(base + "/")}`,
    { method: "PUT" },
  );
  const target = await targetResponse.json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id) return;
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    if (message.error) task.reject(new Error(message.error.message));
    else task.resolve(message.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  await send("Page.enable");
  await send("Runtime.enable");
  const widths = [320, 375, 390, 430, 600, 768, 1024, 1280, 1366, 1440, 1728, 1920];
  const results = [];
  for (const width of widths) {
    console.log(`Checking ${width}px`);
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send("Page.navigate", { url: base + "/" });
    for (let i = 0; i < 60; i++) {
      if ((await evaluate("document.readyState")) === "complete") break;
      await wait(100);
    }
    await evaluate(
      '(async()=>{await Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,3000))]);document.querySelectorAll("img[loading=lazy]").forEach(i=>i.loading="eager");await Promise.race([Promise.all(Array.from(document.images,im=>im.decode().catch(()=>{}))),new Promise(r=>setTimeout(r,6000))]);document.querySelectorAll("[data-reveal]").forEach(i=>i.classList.add("is-visible"));window.scrollTo(0,0)})()',
    );
    const metrics = await evaluate(
      '({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,h1:document.querySelectorAll("h1").length,brokenImages:Array.from(document.images).filter(i=>i.complete&&i.naturalWidth===0).map(i=>i.src),overflow:Array.from(document.querySelectorAll("body *")).filter(el=>el.getBoundingClientRect().right>innerWidth+2&&!el.closest(".hero")).slice(0,8).map(el=>({name:el.className||el.tagName,parent:el.parentElement?.className,id:el.id,text:el.textContent?.trim().slice(0,80),left:Math.round(el.getBoundingClientRect().left),right:Math.round(el.getBoundingClientRect().right),width:Math.round(el.getBoundingClientRect().width)}))})',
    );
    results.push(metrics);
    if ([390, 768, 1280, 1440].includes(width)) {
      await wait(1200);
      const full = await send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
        clip: {
          x: 0,
          y: 0,
          width,
          height: Math.ceil(metrics.height),
          scale: 1,
        },
      });
      writeFileSync(
        join(out, `homepage-${width}.png`),
        Buffer.from(full.data, "base64"),
      );
      const heroHeight = Math.min(
        width <= 600 ? 1360 : width <= 900 ? 1190 : 1120,
        metrics.height,
      );
      const hero = await send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width, height: heroHeight, scale: 1 },
      });
      writeFileSync(
        join(out, `hero-${width}.png`),
        Buffer.from(hero.data, "base64"),
      );
    }
  }
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url: base + "/" });
  await wait(500);
  const menu = await evaluate(
    '(()=>{const b=document.querySelector("[data-menu-toggle]");b.click();const open=b.getAttribute("aria-expanded")==="true"&&!document.getElementById("public-mobile-menu").hidden;document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));return {open,closed:b.getAttribute("aria-expanded")==="false"&&document.getElementById("public-mobile-menu").hidden}})()',
  );
  const ctas = await evaluate(
    '({explore:document.querySelector(".hero-actions a:first-child")?.getAttribute("href"),business:document.querySelector(".hero-actions a:last-child")?.getAttribute("href"),download:document.querySelector(".download-actions a:first-child")?.getAttribute("href")})',
  );
  await evaluate("window.scrollTo(0,240)");
  await wait(100);
  const scrolledHeader = await evaluate(
    'document.getElementById("site-header").classList.contains("is-scrolled")',
  );
  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  const reducedMotion = await evaluate(
    '({aurora:getComputedStyle(document.querySelector(".hero-aurora")).animationName,header:getComputedStyle(document.querySelector(".site-header")).animationName,reveal:getComputedStyle(document.querySelector("[data-reveal]")).opacity})',
  );
  const routes = Object.fromEntries(
    await Promise.all(
      ["/", "/features", "/business", "/ads", "/download"].map(async (path) => [
        path,
        (await fetch(base + path)).status,
      ]),
    ),
  );
  console.log(
    JSON.stringify(
      { out, results, menu, ctas, scrolledHeader, reducedMotion, routes },
      null,
      2,
    ),
  );
  if (
    results.some(
      (item) =>
        item.scrollWidth > item.width ||
        item.h1 !== 1 ||
        item.brokenImages.length,
    ) ||
    !menu.open ||
    !menu.closed ||
    !scrolledHeader ||
    ctas.explore !== "#ecosystem" ||
    ctas.business !== "/business/home" ||
    ctas.download !== "/download" ||
    reducedMotion.aurora !== "none" ||
    reducedMotion.header !== "none" ||
    Object.values(routes).some((status) => status !== 200)
  )
    process.exitCode = 1;
} finally {
  socket?.close();
  browser.kill();
}
