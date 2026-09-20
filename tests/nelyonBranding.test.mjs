import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const pngDimensions = (path) => {
  const bytes = readFileSync(path);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
};
const pngColorType = path => readFileSync(path)[25];

test('Expo and native display metadata use Nelyon without changing app identity', () => {
  const app = JSON.parse(read('app.json')).expo;
  assert.equal(app.name, 'Nelyon');
  assert.equal(app.slug, 'onspace-app');
  assert.equal(app.scheme, 'onspaceapp');
  assert.equal(app.ios.bundleIdentifier, 'com.clipdag.onspaceapp');
  assert.ok(Number(app.ios.buildNumber) >= 25);
  assert.equal(app.android.package, 'com.clipdag.onspaceapp');
  assert.ok(app.android.versionCode >= 3);
  assert.match(read('ios/onspaceapp/Info.plist'), /<key>CFBundleDisplayName<\/key>\s*<string>Nelyon<\/string>/);
  assert.match(read('ios/onspaceapp/Info.plist'), new RegExp(`<key>CFBundleVersion<\\/key>\\s*<string>${app.ios.buildNumber}<\\/string>`));
  assert.equal((read('ios/onspaceapp.xcodeproj/project.pbxproj').match(new RegExp(`CURRENT_PROJECT_VERSION = ${app.ios.buildNumber};`, 'g')) ?? []).length, 2);
  assert.match(read('android/app/build.gradle'), new RegExp(`versionCode ${app.android.versionCode}\\b`));
  assert.match(read('android/app/src/main/res/values/strings.xml'), /<string name="app_name">Nelyon<\/string>/);
  assert.equal(JSON.parse(read('package.json')).name, 'onspace-app');
  assert.equal(JSON.parse(read('package-lock.json')).packages[''].name, 'onspace-app');
  assert.equal(JSON.parse(read('apps/admin-web/package.json')).name, '@onspace/admin-web');
  assert.equal(JSON.parse(read('apps/admin-web/package-lock.json')).packages[''].name, '@onspace/admin-web');
});

test('canonical Nelyon assets are present, valid, and wired to Expo', () => {
  const app = JSON.parse(read('app.json')).expo;
  const assets = [
    ['assets/branding/nelyon/v1/nelyon-logo-horizontal.png', [1672, 941], '2bb677e9c0584cd36d90a1c5cedb31cc61f91d127f79992b2c23bbb68c0f9d9d'],
    ['assets/branding/nelyon/v1/nelyon-logo-dark.png', [1672, 941], 'bd0c4cdae26bd7525e60916965a56f9781cb21c9dd52334315939730d65ff0df'],
    ['assets/branding/nelyon/v1/nelyon-app-icon.png', [1024, 1024], 'f8b6fa6a12277878f322c16650f156ddfe89af6087420f8fd4134bb08b80e2dd'],
    ['assets/branding/nelyon/v1/nelyon-transparent-assets.png', [1672, 941], '26e147fdc39831c6fa7aec1cd9a07a0c7f6fe76a5ca4cc8da43a350dc3bb867d'],
  ];
  for (const [path, dimensions, hash] of assets) {
    assert.deepEqual(pngDimensions(path), dimensions);
    assert.equal(sha256(path), hash);
  }
  assert.equal(app.icon, './assets/branding/nelyon/v1/nelyon-app-icon.png');
  assert.equal(app.android.adaptiveIcon.foregroundImage, './assets/branding/nelyon/v1/nelyon-adaptive-foreground.png');
  assert.equal(app.web.favicon, './assets/branding/nelyon/v1/nelyon-favicon.png');
  assert.equal(pngColorType('assets/branding/nelyon/v1/nelyon-app-icon.png'), 2, 'app icon must be opaque/full-bleed');
  assert.equal(pngColorType('assets/branding/nelyon/v1/nelyon-wordmark-on-dark.png'), 6, 'dark wordmark must preserve transparency');
  const generator = read('scripts/generate-nelyon-brand-assets.py');
  assert.match(generator, /create_full_bleed_app_icon/);
  assert.doesNotMatch(generator, /wordmark_on_dark\s*=\s*dark\.crop/);
});

test('active customer-facing brand surfaces contain no legacy product name', () => {
  const activeSurfaces = [
    'app/login.tsx', 'app/(tabs)/index.tsx', 'app/settings.tsx', 'app/legal.tsx',
    'app/privacy-policy.tsx', 'app/terms-of-service.tsx', 'app/account-settings.tsx',
    'apps/admin-web/src/pages/LoginPage.tsx', 'apps/admin-web/src/layout/AdminShell.tsx',
    'apps/admin-web/index.html',
  ];
  const legacy = /ClipDAG|ClickDAG|ClickDAC|OnSpace|OnSpend/i;
  const technicalContacts = /(?:legal|privacy|copyright)@(?:onspace\.ai|clipdag\.io)/gi;
  for (const path of activeSurfaces) {
    assert.doesNotMatch(read(path).replace(technicalContacts, '<preserved-contact>'), legacy, path);
  }
  assert.match(read('components/feature/PushNotificationHandler.tsx'), /cuando Nelyon esté cerrada/);
  assert.match(read('components/feature/IosCallKitActionHandler.tsx'), />NELYON<\/Text>/);
});

test('shop and commerce surfaces contain no visible legacy branding literal', () => {
  const paths = [
    'app/(tabs)/shop.tsx',
    'components/live/shop/LiveHostShopManager.tsx',
    'components/live/shop/LiveShopHud.tsx',
    'components/live/shop/LiveProductBagSheet.tsx',
    'components/live/shop/LiveProductQuickView.tsx',
    'components/live/shop/LivePurchaseSuccess.tsx',
    'components/live/commerce/LiveViewerCommerce.tsx',
    'components/live/commerce/LiveFeaturedProductCard.tsx',
    'components/design/Commerce.tsx',
  ];
  const legacy = /clipdag|clickdag|clickdac|onspace|onspend|onspain/i;
  for (const path of paths) {
    const source = read(path);
    const jsxText = [...source.matchAll(/>([^<{]+)</g)].map(match => match[1]);
    const visibleProps = [...source.matchAll(/(?:accessibilityLabel|detail|eyebrow|label|placeholder|title)=["']([^"']+)["']/g)].map(match => match[1]);
    const visibleBranding = [...jsxText, ...visibleProps].join('\n').replace(/\s+/g, '');
    assert.doesNotMatch(visibleBranding, legacy, path);
  }

  const shop = read('app/(tabs)/shop.tsx');
  assert.match(shop, /import \{ NelyonLogo \} from "@\/components\/ui\/NelyonLogo";/);
  assert.match(shop, /<NelyonLogo onDark style=\{styles\.headerBrand\} \/>/);
});

test('legal copy preserves the baseline legal and financial meaning', () => {
  const legal = read('app/legal.tsx');
  const privacy = read('app/privacy-policy.tsx');
  const terms = read('app/terms-of-service.tsx');

  assert.match(legal, /Nelyon es una plataforma de contenido creativo basada en blockchain/);
  assert.match(legal, /monetizar contenido a traves de tokens \$DAG/);
  assert.match(legal, /contenido relacionado con blockchain, crypto, arte digital y creatividad/);
  assert.match(legal, /notificacion DMCA a copyright@clipdag\.io/);
  assert.match(legal, /comision del 10% en cada venta/);
  assert.match(legal, /Los pagos se procesan dentro de los 7 dias habiles/);
  assert.match(privacy, /privacy@onspace\.ai/);
  assert.match(privacy, /No constituyen moneda de curso legal/);
  assert.match(terms, /legal@onspace\.ai/);
  assert.match(terms, /No son moneda de curso legal, no tienen valor monetario garantizado/);
  for (const source of [legal, privacy, terms]) assert.doesNotMatch(source, /Centro de ayuda de Nelyon|Nelyon Help Center/);
});

test('legacy visual assets are removed after their callers are migrated', () => {
  for (const path of ['assets/images/logo.png', 'assets/images/favicon.ico', 'assets/images/design-reference.png']) {
    assert.equal(existsSync(path), false, path);
  }
});
