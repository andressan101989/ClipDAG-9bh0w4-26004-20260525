const { createRunOncePlugin, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = '# withDeepARFabricView: DEFINES_MODULE for react-native-deepar';

// Unique terminal sequence in the Expo-generated Podfile:
//   6-space end  → closes config.each inside the folly-fix block
//   4-space end  → closes installer.pods_project.targets.each (folly-fix)
//   2-space end  → closes post_install
//   0-space end  → closes target 'onspaceapp'
const ANCHOR = '      end\n    end\n  end\nend\n';

const PATCH_BLOCK =
  '\n' +
  `    ${MARKER}\n` +
  '    installer.pods_project.targets.each do |target|\n' +
  "      if target.name == 'react-native-deepar'\n" +
  '        target.build_configurations.each do |config|\n' +
  "          config.build_settings['DEFINES_MODULE'] = 'YES'\n" +
  '        end\n' +
  '      end\n' +
  '    end\n';

const REPLACEMENT = '      end\n    end\n' + PATCH_BLOCK + '  end\nend\n';

function withDeepARModularHeaders(config) {
  return withDangerousMod(config, [
    'ios',
    (modConfig) => {
      const podfilePath = path.join(modConfig.modRequest.platformProjectRoot, 'Podfile');

      if (!fs.existsSync(podfilePath)) {
        console.log('[withDeepARFabricView] Podfile not found — skipping DEFINES_MODULE patch');
        return modConfig;
      }

      let podfile = fs.readFileSync(podfilePath, 'utf8');

      if (podfile.includes(MARKER)) {
        console.log('[withDeepARFabricView] DEFINES_MODULE patch already present');
        return modConfig;
      }

      if (!podfile.includes(ANCHOR)) {
        console.warn('[withDeepARFabricView] Could not find post_install anchor — skipping patch');
        return modConfig;
      }

      podfile = podfile.replace(ANCHOR, REPLACEMENT);
      fs.writeFileSync(podfilePath, podfile, 'utf8');
      console.log('[withDeepARFabricView] Applied DEFINES_MODULE=YES for react-native-deepar');
      return modConfig;
    },
  ]);
}

function withDeepARFabricView(config) {
  return withDeepARModularHeaders(config);
}

module.exports = createRunOncePlugin(
  withDeepARFabricView,
  'deepar-fabric-view',
  '0.1.0'
);
