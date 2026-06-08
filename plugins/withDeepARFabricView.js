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
      puts '[deepar] Provider patch starting'
      provider_candidates = [
        File.join(__dir__, 'build', 'generated', 'ios', 'ExpoModulesProvider.swift'),
        File.join(__dir__, 'onspaceapp', 'ExpoModulesProvider.swift'),
      ] + Dir.glob(File.join(__dir__, '**', 'ExpoModulesProvider.swift'))

      provider_candidates.uniq!
      provider_candidates.each_with_index do |candidate, index|
        puts "[deepar] provider_candidate[#{index}]: #{candidate} exists=#{File.exist?(candidate)}"
      end

      provider = provider_candidates.find { |candidate| File.exist?(candidate) }
      unless provider
        raise "[deepar] ExpoModulesProvider.swift not found. Checked: #{provider_candidates.join(', ')}"
      end

      puts "[deepar] Using ExpoModulesProvider.swift: #{provider}"
      src = File.read(provider)
      lines = src.lines
      module_entry = 'DeepARFabricView.DeepARFabricViewModule.self'
      before_has_import = src.include?('import DeepARFabricView')
      before_has_module = src.include?(module_entry)
      puts "[deepar] Before patch import DeepARFabricView exists: #{before_has_import}"
      puts "[deepar] Before patch #{module_entry} exists: #{before_has_module}"
      inserted_import = false
      inserted_module = false

      unless before_has_import
        last_imp = lines.rindex { |l| l.start_with?('import ') }
        raise '[deepar] Could not find import section in ExpoModulesProvider.swift' unless last_imp
        lines.insert(last_imp + 1, "import DeepARFabricView\\n")
        inserted_import = true
      end

      unless before_has_module
        bracket_idx = lines.index { |l| l.strip == ']' }
        raise '[deepar] Could not find module list closing bracket in ExpoModulesProvider.swift' unless bracket_idx
        lines.insert(bracket_idx, "      #{module_entry},\\n")
        inserted_module = true
      end

      File.write(provider, lines.join) if inserted_import || inserted_module
      puts "[deepar] Inserted import DeepARFabricView: #{inserted_import}"
      puts "[deepar] Inserted #{module_entry}: #{inserted_module}"
      after_src = File.read(provider)
      after_has_import = after_src.include?('import DeepARFabricView')
      after_has_module = after_src.include?(module_entry)
      puts "[deepar] After patch import DeepARFabricView exists: #{after_has_import}"
      puts "[deepar] After patch #{module_entry} exists: #{after_has_module}"
      raise '[deepar] import DeepARFabricView still missing after provider patch' unless after_has_import
      raise "[deepar] #{module_entry} still missing after provider patch" unless after_has_module
      puts '[deepar] Patched ExpoModulesProvider.swift: DeepARFabricViewModule registered'
    rescue => e
      warn "[deepar] Provider patch failed: #{e}"
      raise
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
