/**
 * plugins/withVideoTrimAndroid.js
 *
 * Injects the Android FileProvider entry required by react-native-video-trim
 * into AndroidManifest.xml, and creates the required res/xml/file_paths.xml.
 *
 * react-native-video-trim uses FileProvider to share temp video files with
 * the Android system's media scanner and intent dispatch. Without this,
 * trim() and merge() will throw at runtime on Android.
 */

const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs   = require('fs');
const path = require('path');

const PROVIDER_NAME  = 'androidx.core.content.FileProvider';
const PROVIDER_PATHS = 'android.support.FILE_PROVIDER_PATHS';

const withVideoTrimAndroid = (config) => {
  // ── 1. Inject <provider> into AndroidManifest.xml ────────────────────────
  config = withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (!app) return cfg;

    if (!app.provider) app.provider = [];

    const alreadyPresent = app.provider.some(
      (p) =>
        p.$?.['android:name'] === PROVIDER_NAME &&
        (p.$?.['android:authorities'] ?? '').includes('.provider'),
    );

    if (alreadyPresent) {
      console.log('[withVideoTrimAndroid] FileProvider already present — skipping');
      return cfg;
    }

    app.provider.push({
      $: {
        'android:name':               PROVIDER_NAME,
        'android:authorities':        '${applicationId}.provider',
        'android:exported':           'false',
        'android:grantUriPermissions':'true',
      },
      'meta-data': [
        {
          $: {
            'android:name':     PROVIDER_PATHS,
            'android:resource': '@xml/file_paths',
          },
        },
      ],
    });

    console.log('[withVideoTrimAndroid] FileProvider injected into AndroidManifest.xml');
    return cfg;
  });

  // ── 2. Create res/xml/file_paths.xml ────────────────────────────────────
  config = withDangerousMod(config, [
    'android',
    (modConfig) => {
      const xmlDir = path.join(
        modConfig.modRequest.projectRoot,
        'android', 'app', 'src', 'main', 'res', 'xml',
      );

      if (!fs.existsSync(xmlDir)) {
        fs.mkdirSync(xmlDir, { recursive: true });
      }

      const filePath = path.join(xmlDir, 'file_paths.xml');
      if (fs.existsSync(filePath)) {
        console.log('[withVideoTrimAndroid] file_paths.xml already exists — skipping');
        return modConfig;
      }

      fs.writeFileSync(
        filePath,
        `<?xml version="1.0" encoding="utf-8"?>
<paths xmlns:android="http://schemas.android.com/apk/res/android">
  <files-path   name="internal_files"  path="." />
  <cache-path   name="cache_files"     path="." />
  <external-path name="external_files" path="." />
</paths>
`,
      );
      console.log('[withVideoTrimAndroid] file_paths.xml created');
      return modConfig;
    },
  ]);

  return config;
};

module.exports = withVideoTrimAndroid;
