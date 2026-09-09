import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';

const read = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const require = createRequire(import.meta.url);

const app = JSON.parse(read('app.json'));
const nativeConfig = require('../react-native.config.js');
const gradleProperties = read('android/gradle.properties');
const appBuild = read('android/app/build.gradle');
const rootBuild = read('android/build.gradle');

const buildProperties = app.expo.plugins.find(
  plugin => Array.isArray(plugin) && plugin[0] === 'expo-build-properties',
)?.[1]?.android;

const property = name => {
  const match = gradleProperties.match(new RegExp(`^${name}=(\\d+)$`, 'm'));
  assert.ok(match, `${name} must exist in android/gradle.properties`);
  return Number(match[1]);
};

const gitBlob = path => execFileSync('git', ['hash-object', path], {
  encoding: 'utf8',
}).trim();

test('compileSdk 36 is aligned across both canonical authorities', () => {
  assert.equal(buildProperties.compileSdkVersion, 36);
  assert.equal(property('android.compileSdkVersion'), 36);
});

test('targetSdk 35 and minSdk 24 remain unchanged', () => {
  assert.equal(buildProperties.targetSdkVersion, 35);
  assert.equal(property('android.targetSdkVersion'), 35);
  assert.equal(buildProperties.minSdkVersion, 24);
  assert.equal(property('android.minSdkVersion'), 24);
});

test('the app consumes the existing root project SDK authority', () => {
  assert.match(appBuild, /compileSdk\s+rootProject\.ext\.compileSdkVersion/);
  assert.match(appBuild, /minSdkVersion\s+rootProject\.ext\.minSdkVersion/);
  assert.match(appBuild, /targetSdkVersion\s+rootProject\.ext\.targetSdkVersion/);
  assert.doesNotMatch(appBuild, /compileSdk(?:Version)?\s*[=(]?\s*36/);
});

test('F2 introduces no AndroidX force or resolution workaround', () => {
  const androidAuthority = `${rootBuild}\n${appBuild}\n${gradleProperties}`;
  assert.doesNotMatch(androidAuthority, /resolutionStrategy[\s\S]*?force\s*\(?\s*['"]androidx\./i);
  assert.doesNotMatch(androidAuthority, /force\s*\(?\s*['"]androidx\./i);
  assert.doesNotMatch(androidAuthority, /dependencySubstitution[\s\S]*?androidx\./i);
  assert.doesNotMatch(androidAuthority, /subprojects[\s\S]*?compileSdk/i);
  assert.doesNotMatch(androidAuthority, /afterEvaluate[\s\S]*?compileSdk/i);
});

test('package manifests remain byte-identical to the F1 checkpoint', () => {
  assert.equal(gitBlob('package.json'), 'c0e14d640a390c19c3d4f7c7fba32e8c7bcb928b');
  assert.equal(gitBlob('package-lock.json'), 'f56f0e2caf4c17317acc67d39bb7ec52167e8771');
});

test('the F1 DeepAR Android exclusion remains canonical', () => {
  const deepAR = nativeConfig.dependencies['react-native-deepar'];
  assert.equal(deepAR.platforms.android, null);
  assert.equal(deepAR.platforms.ios, undefined);
  assert.equal(existsSync('plugins/withDeepARAndroidFix.js'), false);
  assert.equal(app.expo.plugins.includes('./plugins/withDeepARAndroidFix'), false);
});

test('no patch-package or postinstall patch authority is introduced', () => {
  const packageJson = JSON.parse(read('package.json'));
  assert.doesNotMatch(packageJson.scripts?.postinstall ?? '', /androidx|deepar|patch-package/i);
  assert.equal(packageJson.dependencies?.['patch-package'], undefined);
  assert.equal(packageJson.devDependencies?.['patch-package'], undefined);
});
