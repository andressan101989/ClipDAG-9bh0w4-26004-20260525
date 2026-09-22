import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const home = source("../src/pages/index.astro");
const layout = source("../src/layouts/PublicLayout.astro");

test("homepage replaces the A3 shell with the approved ten-section narrative", () => {
  for (const id of [
    "hero",
    "ecosystem",
    "social",
    "creators",
    "live",
    "marketplace",
    "business-tools",
    "whats-new",
    "download",
  ]) {
    assert.match(home, new RegExp(`id="${id}"`), id);
  }
  assert.match(home, /Connect\.<br \/>Create\.<br \/><span>Go LIVE\./);
  assert.doesNotMatch(home, /Public Web foundation|se incorporará en NPW-B/);
  assert.doesNotMatch(
    home,
    /PROMOTIONAL CONCEPT|PRODUCT-FAITHFUL MOCKUP|HERO LOOP CONCEPT/,
  );
});

test("homepage preserves public navigation and uses no private product code", () => {
  assert.match(home, /href="#ecosystem"/);
  assert.match(home, /href=\{publicCtas\.businessHome\}/);
  assert.match(home, /href=\{publicCtas\.download\}/);
  for (const route of [
    "features", "business", "ads", "marketplace", "creators", "live", "whatsNew",
  ]) {
    assert.ok(layout.includes(`href={publicCtas.${route}}`), route);
  }
  assert.doesNotMatch(
    home + layout,
    /BusinessAuthProvider|@supabase|businessApi|sellerCenterApi|adsManagerApi|hls\.js/,
  );
});

test("semantic shell, accessible menu, reduced motion and optimized media are present", () => {
  assert.match(layout, /<header\b/);
  assert.match(layout, /<nav\b/);
  assert.match(layout, /<main\b/);
  assert.match(layout, /<footer\b/);
  assert.match(layout, /aria-expanded="false"/);
  assert.match(layout, /aria-controls="public-mobile-menu"/);
  assert.match(layout, /Escape/);
  assert.equal((home.match(/<h1\b/g) ?? []).length, 1);
  assert.match(home, /loading="lazy"/);
  assert.match(
    source("../src/styles/public.css") + source("../src/styles/home.css"),
    /prefers-reduced-motion:\s*reduce/,
  );
  const media = readdirSync(new URL("../public/media/home/", import.meta.url));
  assert.ok(media.some((file) => file.endsWith(".webp")));
  assert.ok(media.every((file) => !file.endsWith(".png")));
  assert.ok(
    existsSync(new URL("../public/media/home/feed-720.webp", import.meta.url)),
  );
});

test("premium homepage keeps the hero compact and contained from 320px upward", () => {
  const homeCss = source("../src/styles/home.css");
  const publicCss = source("../src/styles/public.css");

  assert.match(homeCss, /\.home-page\s*\{[^}]*overflow-x:\s*clip/s);
  assert.match(homeCss, /\.hero::before\s*\{/);
  assert.match(homeCss, /--home-section-space:/);
  assert.match(
    homeCss,
    /\.social-showcase,\s*\.creator-profile,\s*\.live-showcase,\s*\.product-grid,\s*\.business-preview\s*\{[^}]*border-radius:\s*var\(--home-card-radius\)/s,
  );
  assert.match(
    homeCss,
    /@media \(max-width: 600px\)[\s\S]*?\.hero-showcase\s*\{[^}]*width:\s*100%[^}]*margin:\s*[^;]*auto/s,
  );
  assert.doesNotMatch(homeCss, /width:\s*calc\(100% \+ 16px\)/);
  assert.match(publicCss, /\.site-header\s*\{[^}]*isolation:\s*isolate/s);
  assert.doesNotMatch(home + layout, /BusinessAuthProvider|@supabase|hls\.js/);
});
