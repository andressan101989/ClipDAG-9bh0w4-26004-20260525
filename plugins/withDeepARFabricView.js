const { createRunOncePlugin, withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

// Tag used for idempotency check — must be unique enough not to appear elsewhere.
const PATCH_TAG = '# ─── deepar-provider-patch ───';

// Ruby snippet injected into the existing `post_install do |installer|` block.
// Runs AFTER `use_expo_modules!` has generated ExpoModulesProvider.swift so we
// can guarantee DeepARFabricViewModule is present even when local `file:` modules
// are not reliably included by expo-modules-autolinking@3.x during EAS cloud builds.
const RUBY_PATCH = `
    ${PATCH_TAG}
    begin
      provider_candidates = [
        File.join(__dir__, 'build', 'generated', 'ios', 'ExpoModulesProvider.swift'),
        File.join(__dir__, 'onspaceapp', 'ExpoModulesProvider.swift'),
      ] + Dir.glob(File.join(__dir__, '**', 'ExpoModulesProvider.swift'))

      provider = provider_candidates.find { |candidate| File.exist?(candidate) }
      if provider
        src = File.read(provider)
        unless src.include?('DeepARFabricViewModule')
          lines = src.lines
          # Insert import after the last existing import statement
          last_imp = lines.rindex { |l| l.start_with?('import ') }
          lines.insert(last_imp + 1, "import DeepARFabricView\\n") if last_imp
          # Insert module registration before the first standalone ] (closes the array)
          bracket_idx = lines.index { |l| l.strip == ']' }
          lines.insert(bracket_idx, "      DeepARFabricView.DeepARFabricViewModule.self,\\n") if bracket_idx
          File.write(provider, lines.join)
          puts '[deepar] Patched ExpoModulesProvider.swift: DeepARFabricViewModule registered'
        end
      else
        warn '[deepar] ExpoModulesProvider.swift not found in generated provider paths; module registration may be incomplete'
      end
    rescue => e
      warn "[deepar] Provider patch failed: #{e}"
    end
    # ─────────────────────────────────────────────────────────────────────────
`;

function withDeepARProviderPatch(config) {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let podfile = fs.readFileSync(podfilePath, 'utf8');

      // Idempotent: skip if the patch was already injected.
      if (podfile.includes(PATCH_TAG)) {
        return config;
      }

      if (!podfile.includes('post_install')) {
        console.warn(
          '[withDeepARFabricView] Could not find post_install block in Podfile — ' +
            'ExpoModulesProvider.swift will not be patched automatically.'
        );
        return config;
      }

      // Inject the Ruby snippet immediately after `post_install do |installer|`.
      podfile = podfile.replace(
        /(post_install\s+do\s+\|installer\|)/,
        (match) => `${match}\n${RUBY_PATCH}`
      );

      fs.writeFileSync(podfilePath, podfile, 'utf8');
      return config;
    },
  ]);
}

function withDeepARFabricView(config) {
  return withDeepARProviderPatch(config);
}

module.exports = createRunOncePlugin(withDeepARFabricView, 'deepar-fabric-view', '0.1.0');
