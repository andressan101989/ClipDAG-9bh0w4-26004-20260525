import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const read = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const require = createRequire(import.meta.url);

const app = JSON.parse(read('app.json'));
const packageJson = JSON.parse(read('package.json'));
const packageLock = JSON.parse(read('package-lock.json'));
const nativeConfig = require('../react-native.config.js');
const nativeConfigSource = read('react-native.config.js');
const metro = read('metro.config.js');
const androidBuild = read('android/build.gradle');
const androidProperties = read('android/gradle.properties');

const deepARDependency = nativeConfig.dependencies['react-native-deepar'];
const buildProperties = app.expo.plugins.find(
  plugin => Array.isArray(plugin) && plugin[0] === 'expo-build-properties',
)?.[1]?.android;

test('react-native-deepar remains installed for the iOS authority', () => {
  assert.equal(packageJson.dependencies['react-native-deepar'], '^0.11.0');
  assert.ok(packageLock.packages['node_modules/react-native-deepar']);
});

test('Android native autolinking is disabled while iOS remains enabled', () => {
  assert.equal(deepARDependency.platforms.android, null);
  assert.equal(deepARDependency.platforms.ios, undefined);
  assert.match(
    nativeConfigSource,
    /'react-native-deepar'[\s\S]*?platforms:\s*\{[\s\S]*?android:\s*null/,
  );
});

test('Metro keeps react-native-deepar stubbed outside iOS', () => {
  assert.match(metro, /moduleName === 'react-native-deepar'/);
  assert.match(metro, /if \(platform !== 'ios'\)[\s\S]*?filePath: EMPTY_STUB/);
});

test('the obsolete Android node_modules patch plugin is fully removed', () => {
  assert.equal(existsSync('plugins/withDeepARAndroidFix.js'), false);
  assert.equal(app.expo.plugins.includes('./plugins/withDeepARAndroidFix'), false);
});

test('the iOS DeepAR config authority remains registered', () => {
  assert.equal(app.expo.plugins.includes('./plugins/withDeepARiOS'), true);
  assert.equal(existsSync('plugins/withDeepARiOS.js'), true);
  assert.equal(existsSync('plugins/withDeepARFabricView.js'), true);
});

test('Android SDK levels remain canonical without DeepAR ProGuard authority', () => {
  assert.equal(buildProperties.minSdkVersion, 24);
  assert.equal(buildProperties.compileSdkVersion, 35);
  assert.equal(buildProperties.targetSdkVersion, 35);
  assert.equal('extraProguardRules' in buildProperties, false);
});

test('no replacement Gradle or postinstall DeepAR patch is introduced', () => {
  assert.doesNotMatch(androidBuild, /Deepar_(?:compile|target|min|buildTools)SdkVersion|withDeepARAndroidFix/);
  assert.doesNotMatch(androidProperties, /Deepar_(?:compile|target|min|buildTools)SdkVersion/);
  assert.doesNotMatch(packageJson.scripts?.postinstall ?? '', /deepar|patch-package/i);
  assert.equal(packageJson.dependencies?.['patch-package'], undefined);
  assert.equal(packageJson.devDependencies?.['patch-package'], undefined);
});

test('local DeepAR view modules remain Apple-only', () => {
  for (const path of [
    'modules/deepar-fabric-view/expo-module.config.json',
    'modules/deepar-test-view/expo-module.config.json',
  ]) {
    const config = JSON.parse(read(path));
    assert.deepEqual(config.platforms, ['apple']);
    assert.equal(existsSync(path.replace('expo-module.config.json', 'android')), false);
  }
});
