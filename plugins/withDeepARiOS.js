/**
 * plugins/withDeepARiOS.js — DeepAR iOS Native Config Plugin
 *
 * Configures react-native-deepar for iOS:
 *  1. Adds the DeepAR API key to Info.plist so the SDK can initialize
 *  2. Adds camera usage description (if not already present)
 *  3. No-op on Android (handled by withDeepARAndroidFix.js)
 *
 * CRITICAL: Without a valid API key in Info.plist, the DeepAR SDK
 * crashes the app at startup when the native module initializes.
 * This was the original root cause of "Failed to launch app".
 *
 * Usage in app.json:
 *   "plugins": ["./plugins/withDeepARiOS"]
 */

const { withInfoPlist, withDangerousMod } = require('@expo/config-plugins');
const fs   = require('fs');
const path = require('path');

// ── API Keys ──────────────────────────────────────────────────────────────────
// Keys are read ONLY from environment variables at EAS build time.
// Set them as EAS secrets:
//   eas secret:create --scope project --name DEEPAR_API_KEY_IOS     --value <key>
//   eas secret:create --scope project --name DEEPAR_API_KEY_ANDROID --value <key>
// Obtain keys at https://developer.deepar.ai/projects
//
// IMPORTANT: No fallback values — the build will use an empty string if the
// env var is absent, which will cause DeepAR to fail to initialize at runtime
// (visible as a warning in Xcode/Logcat). This is intentional: it forces the
// developer to configure the secret before shipping a production build.
const DEEPAR_API_KEY_IOS     = process.env.DEEPAR_API_KEY_IOS     ?? '';
const DEEPAR_API_KEY_ANDROID = process.env.DEEPAR_API_KEY_ANDROID ?? '';

if (!DEEPAR_API_KEY_IOS) {
  console.warn('[withDeepARiOS] ⚠️  DEEPAR_API_KEY_IOS env var not set — DeepAR will not initialize on iOS');
}
if (!DEEPAR_API_KEY_ANDROID) {
  console.warn('[withDeepARiOS] ⚠️  DEEPAR_API_KEY_ANDROID env var not set — DeepAR will not initialize on Android');
}

// ── iOS: Patch Info.plist ──────────────────────────────────────────────────────
const withDeepARInfoPlist = (config) => {
  return withInfoPlist(config, (cfg) => {
    const plist = cfg.modResults;

    // 1. DeepAR API Key — read by native SDK on startup
    plist['ar_key'] = DEEPAR_API_KEY_IOS;

    // 2. Camera usage (required for DeepAR, may already exist from expo-camera plugin)
    if (!plist['NSCameraUsageDescription']) {
      plist['NSCameraUsageDescription'] =
        'ClipDAG necesita la cámara para filtros AR en tiempo real';
    }

    // 3. Microphone usage (needed for video recording with AR)
    if (!plist['NSMicrophoneUsageDescription']) {
      plist['NSMicrophoneUsageDescription'] =
        'ClipDAG necesita el micrófono para grabar videos con filtros AR';
    }

    console.log('[withDeepARiOS] Info.plist patched:');
    console.log('  ar_key:', DEEPAR_API_KEY_IOS.slice(0, 20) + '...');
    console.log('  NSCameraUsageDescription:', plist['NSCameraUsageDescription']);

    return cfg;
  });
};

// ── iOS: Ensure Podfile includes DeepAR pod ───────────────────────────────────
// react-native.config.js was previously set to ios: null for react-native-deepar.
// Now that we re-enable it, CocoaPods autolinking will pick it up automatically.
// This modifier logs confirmation that the iOS native build will include DeepAR.
const withDeepARPodfile = (config) => {
  return withDangerousMod(config, [
    'ios',
    (modConfig) => {
      const root    = modConfig.modRequest.projectRoot;
      const podfile = path.join(root, 'ios', 'Podfile');

      if (!fs.existsSync(podfile)) {
        console.log('[withDeepARiOS] Podfile not found — skipping (prebuild will generate it)');
        return modConfig;
      }

      const content = fs.readFileSync(podfile, 'utf8');

      // Verify react-native-deepar appears in autolinking
      if (content.includes('react-native-deepar')) {
        console.log('[withDeepARiOS] ✅ react-native-deepar already present in Podfile');
      } else {
        console.log('[withDeepARiOS] ℹ️  react-native-deepar not yet in Podfile — will be added by autolinking');
      }

      // DeepAR SDK requires arm64 for device builds (no simulator support for AR processing)
      // Add excluded architectures for simulator if not present
      if (!content.includes("EXCLUDED_ARCHS[sdk=iphonesimulator*]")) {
        // This is normally handled by expo-build-properties plugin or
        // react-native-deepar's own podspec. Just log a reminder.
        console.log('[withDeepARiOS] ℹ️  Remember: DeepAR AR effects only work on physical devices (not simulator)');
      }

      console.log('[withDeepARiOS] iOS Podfile check complete');
      return modConfig;
    },
  ]);
};

// ── Android: set API key via strings.xml ──────────────────────────────────────
const withDeepARAndroidStrings = (config) => {
  return withDangerousMod(config, [
    'android',
    (modConfig) => {
      const root        = modConfig.modRequest.projectRoot;
      const stringsPath = path.join(root, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml');

      if (!fs.existsSync(stringsPath)) {
        console.log('[withDeepARiOS] android/app/.../strings.xml not found — skipping');
        return modConfig;
      }

      let content = fs.readFileSync(stringsPath, 'utf8');

      // Inject or update deepar_api_key string resource
      const keyEntry = `    <string name="deepar_api_key">${DEEPAR_API_KEY_ANDROID}</string>`;
      if (content.includes('name="deepar_api_key"')) {
        content = content.replace(
          /<string name="deepar_api_key">[^<]*<\/string>/,
          keyEntry.trim(),
        );
        console.log('[withDeepARiOS] Android strings.xml deepar_api_key updated');
      } else {
        content = content.replace('</resources>', `${keyEntry}\n</resources>`);
        console.log('[withDeepARiOS] Android strings.xml deepar_api_key injected');
      }

      fs.writeFileSync(stringsPath, content, 'utf8');
      return modConfig;
    },
  ]);
};

// ── Main plugin export ────────────────────────────────────────────────────────
const withDeepARiOS = (config) => {
  config = withDeepARInfoPlist(config);
  config = withDeepARPodfile(config);
  config = withDeepARAndroidStrings(config);
  return config;
};

module.exports = withDeepARiOS;
module.exports.DEEPAR_API_KEY_IOS     = DEEPAR_API_KEY_IOS;
module.exports.DEEPAR_API_KEY_ANDROID = DEEPAR_API_KEY_ANDROID;
