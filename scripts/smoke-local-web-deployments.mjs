import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const timeoutMs = 90_000;

async function builtApp(name, distRelative, mountedPrefix = "") {
  const distDir = path.resolve(root, distRelative);
  let index;
  try {
    index = await readFile(path.join(distDir, "index.html"), "utf8");
  } catch {
    throw new Error(`${name}_dist_missing: run the deployment build first`);
  }
  const match = index.match(/(?:src|href)="([^"]*\/assets\/[^"]+)"/i);
  assert.ok(match, `${name}_built_asset_missing`);
  const requestPath = match[1];
  const relativePath = mountedPrefix
    ? requestPath.slice(`${mountedPrefix}/`.length)
    : requestPath.replace(/^\//, "");
  assert.ok(!relativePath.startsWith(".."), `${name}_asset_path_escape`);
  return {
    distDir,
    index,
    requestPath,
    assetBytes: await readFile(path.join(distDir, relativePath)),
  };
}

function startWrangler(label, port, config) {
  const child = spawn(process.env.ComSpec, [
    "/d",
    "/c",
    "npx.cmd",
    "--yes", "wrangler@4.135.0", "dev", "--local",
    "--ip", "127.0.0.1", "--port", String(port),
    "--config", config,
  ], {
    cwd: root,
    env: { ...process.env, NO_COLOR: "1" },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const runtime = { child, output: () => output, stopping: false };
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  child.once("exit", (code) => {
    if (!runtime.stopping && code && output) {
      process.stderr.write(`${label} Wrangler exited ${code}\n${output.slice(-4000)}\n`);
    }
  });
  return runtime;
}

async function stopWrangler(runtime) {
  if (!runtime?.child?.pid || runtime.child.exitCode !== null) return;
  runtime.stopping = true;
  spawnSync("taskkill.exe", ["/PID", String(runtime.child.pid), "/T", "/F"], {
    windowsHide: true,
    stdio: "ignore",
  });
  await Promise.race([
    new Promise((resolve) => runtime.child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
}

async function waitUntilReady(url, runtime) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (runtime.child.exitCode !== null) {
      throw new Error(`wrangler_exited_before_ready:${runtime.output().slice(-4000)}`);
    }
    try {
      const response = await fetch(url, { headers: { "Sec-Fetch-Dest": "document" } });
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`wrangler_ready_timeout:${runtime.output().slice(-4000)}`);
}

async function request(base, pathname, headers = {}) {
  const response = await fetch(`${base}${pathname}`, { redirect: "manual", headers });
  const body = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    body,
  };
}

function assertShell(result, marker, label) {
  assert.equal(result.status, 200, `${label}_status`);
  assert.match(result.contentType, /text\/html/i, `${label}_content_type`);
  assert.match(result.body.toString("utf8"), marker, `${label}_shell_marker`);
}

function assertNotFound(result, label) {
  assert.equal(result.status, 404, `${label}_status`);
}

function assertMissingAsset(result, label) {
  assertNotFound(result, label);
  assert.doesNotMatch(result.contentType, /text\/html/i, `${label}_must_not_be_html`);
}

async function businessMatrix(base, app) {
  const documentHeaders = { "Sec-Fetch-Dest": "document", Accept: "text/html" };
  const results = {};
  for (const pathname of ["/business/", "/business/ads", "/business/ads/campaigns"]) {
    const result = await request(base, pathname, documentHeaders);
    assertShell(result, /<title>Nelyon Business<\/title>/, `business${pathname}`);
    results[pathname] = result.status;
  }
  for (const pathname of ["/business", "/businessx", "/"]) {
    const result = await request(base, pathname, documentHeaders);
    assertNotFound(result, `business${pathname}`);
    results[pathname] = result.status;
  }
  const asset = await request(base, app.requestPath, { "Sec-Fetch-Dest": "script" });
  assert.equal(asset.status, 200, "business_asset_status");
  assert.deepEqual(asset.body, app.assetBytes, "business_asset_bytes");
  results[app.requestPath] = "200 exact-bytes";
  const missing = await request(base, "/business/assets/does-not-exist.js", documentHeaders);
  assertMissingAsset(missing, "business_missing_asset");
  results["/business/assets/does-not-exist.js"] = `404 ${missing.contentType || "no-content-type"}`;
  const nonDocument = await request(base, "/business/ads", {
    "Sec-Fetch-Dest": "script",
    Accept: "text/html",
  });
  assertNotFound(nonDocument, "business_non_document_precedence");
  results["/business/ads [script]"] = nonDocument.status;
  const heuristic = await request(base, "/business/ads", { Accept: "text/html" });
  assertShell(heuristic, /<title>Nelyon Business<\/title>/, "business_html_heuristic");
  results["/business/ads [accept-html]"] = heuristic.status;
  return results;
}

async function adminMatrix(base, app) {
  const documentHeaders = { "Sec-Fetch-Dest": "document", Accept: "text/html" };
  const results = {};
  for (const pathname of ["/", "/advertising", "/advertising/health"]) {
    const result = await request(base, pathname, documentHeaders);
    assertShell(result, /<title>Nelyon Admin<\/title>/, `admin${pathname}`);
    results[pathname] = result.status;
  }
  const asset = await request(base, app.requestPath, { "Sec-Fetch-Dest": "script" });
  assert.equal(asset.status, 200, "admin_asset_status");
  assert.deepEqual(asset.body, app.assetBytes, "admin_asset_bytes");
  results[app.requestPath] = "200 exact-bytes";
  const missing = await request(base, "/assets/does-not-exist.js", documentHeaders);
  assertMissingAsset(missing, "admin_missing_asset");
  results["/assets/does-not-exist.js"] = `404 ${missing.contentType || "no-content-type"}`;
  const nonDocument = await request(base, "/advertising", {
    "Sec-Fetch-Dest": "script",
    Accept: "text/html",
  });
  assertNotFound(nonDocument, "admin_non_document_precedence");
  results["/advertising [script]"] = nonDocument.status;
  const heuristic = await request(base, "/advertising", { Accept: "text/html" });
  assertShell(heuristic, /<title>Nelyon Admin<\/title>/, "admin_html_heuristic");
  results["/advertising [accept-html]"] = heuristic.status;
  return results;
}

const business = await builtApp("business", "apps/business-web/dist", "/business");
const admin = await builtApp("admin", "apps/admin-web/dist");
let businessRuntime;
let adminRuntime;
try {
  businessRuntime = startWrangler(
    "Business",
    8788,
    "apps/business-web/deployment/wrangler.unbound.jsonc",
  );
  await waitUntilReady("http://127.0.0.1:8788/business/", businessRuntime);
  adminRuntime = startWrangler(
    "Admin",
    8789,
    "apps/admin-web/deployment/wrangler.unbound.jsonc",
  );
  await waitUntilReady("http://127.0.0.1:8789/", adminRuntime);
  const businessResults = await businessMatrix("http://127.0.0.1:8788", business);
  const adminResults = await adminMatrix("http://127.0.0.1:8789", admin);
  console.log(JSON.stringify({
    ok: true,
    business: {
      baseUrl: "http://127.0.0.1:8788",
      asset: business.requestPath,
      matrix: businessResults,
    },
    admin: {
      baseUrl: "http://127.0.0.1:8789",
      asset: admin.requestPath,
      matrix: adminResults,
    },
    cleanup: "process trees terminated",
  }));
} finally {
  await stopWrangler(adminRuntime);
  await stopWrangler(businessRuntime);
}
