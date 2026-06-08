const { createRunOncePlugin, withDangerousMod } = require('@expo/config-plugins');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PHASE_NAME = '[DeepAR] Patch ExpoModulesProvider';
const EXPO_PHASE_NAME = '[Expo] Configure project';
const SOURCES_PHASE_NAME = 'Sources';

const PATCH_SCRIPT = String.raw`set -e

PROVIDER="\${SRCROOT}/Pods/Target Support Files/Pods-onspaceapp/ExpoModulesProvider.swift"

if [ ! -f "$PROVIDER" ]; then
  echo "[deepar] provider not found"
  exit 0
fi

if grep -q "DeepARFabricViewModule" "$PROVIDER"; then
  echo "[deepar] already patched"
  exit 0
fi

python3 - "$PROVIDER" <<'PY'
import sys

path = sys.argv[1]

with open(path, "r", encoding="utf-8") as f:
    lines = f.readlines()

text = "".join(lines)

if "import DeepARFabricView" not in text:
    last_import = -1
    for index, line in enumerate(lines):
        if line.startswith("import "):
            last_import = index

    if last_import >= 0:
        lines.insert(last_import + 1, "import DeepARFabricView\n")
    else:
        lines.insert(0, "import DeepARFabricView\n")

closing_index = None
for index, line in enumerate(lines):
    if line.strip() == "]":
        closing_index = index
        break

if closing_index is None:
    sys.exit("ExpoModulesProvider modules array closing bracket not found")

lines.insert(closing_index, "      DeepARFabricViewModule.self,\n")

with open(path, "w", encoding="utf-8") as f:
    f.writelines(lines)

with open(path, "r", encoding="utf-8") as f:
    patched = f.read()

if "DeepARFabricViewModule" not in patched:
    sys.exit(1)
PY

if ! grep -q "DeepARFabricViewModule" "$PROVIDER"; then
  exit 1
fi

echo "[deepar] provider patched"
`;

function createUuid(seed) {
  return crypto.createHash('sha1').update(seed).digest('hex').slice(0, 24).toUpperCase();
}

function escapePbxString(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

function getPhaseUuid(project, phaseName) {
  const escapedName = phaseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = project.match(new RegExp(`([A-F0-9]{24}) /\\* ${escapedName} \\*/ = \\{`));
  return match ? match[1] : null;
}

function addShellScriptPhase(project, uuid) {
  if (getPhaseUuid(project, PHASE_NAME)) {
    return project;
  }

  const expoUuid = getPhaseUuid(project, EXPO_PHASE_NAME);
  const phase = `\t\t${uuid} /* ${PHASE_NAME} */ = {
\t\t\tisa = PBXShellScriptBuildPhase;
\t\t\tbuildActionMask = 2147483647;
\t\t\tfiles = (
\t\t\t);
\t\t\tinputFileListPaths = (
\t\t\t);
\t\t\tinputPaths = (
\t\t\t);
\t\t\tname = "${PHASE_NAME}";
\t\t\toutputFileListPaths = (
\t\t\t);
\t\t\toutputPaths = (
\t\t\t);
\t\t\trunOnlyForDeploymentPostprocessing = 0;
\t\t\tshellPath = /bin/sh;
\t\t\tshellScript = "${escapePbxString(PATCH_SCRIPT)}";
\t\t};
`;

  if (expoUuid) {
    const expoObject = new RegExp(`(\\t\\t${expoUuid} /\\* ${EXPO_PHASE_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\*/ = \\{[\\s\\S]*?\\n\\t\\t\\};\\n)`);
    if (expoObject.test(project)) {
      return project.replace(expoObject, `$1${phase}`);
    }
  }

  return project.replace('/* End PBXShellScriptBuildPhase section */', `${phase}/* End PBXShellScriptBuildPhase section */`);
}

function ensureBuildPhaseOrder(project, uuid) {
  const nativeTargetRegex = /(\t\t[A-F0-9]{24} \/\* onspaceapp \*\/ = \{\n\t\t\tisa = PBXNativeTarget;[\s\S]*?\n\t\t\tbuildPhases = \(\n)([\s\S]*?)(\t\t\t\);[\s\S]*?\n\t\t\};)/;
  const match = project.match(nativeTargetRegex);

  if (!match) {
    throw new Error('[withDeepARFabricView] Unable to find onspaceapp PBXNativeTarget build phases');
  }

  const phaseLine = `\t\t\t\t${uuid} /* ${PHASE_NAME} */,\n`;
  let phases = match[2]
    .split('\n')
    .filter((line) => !line.includes(`/* ${PHASE_NAME} */`))
    .filter((line) => line.length > 0)
    .map((line) => `${line}\n`);

  const expoIndex = phases.findIndex((line) => line.includes(`/* ${EXPO_PHASE_NAME} */`));
  const sourcesIndex = phases.findIndex((line) => line.includes(`/* ${SOURCES_PHASE_NAME} */`));

  if (expoIndex >= 0) {
    phases.splice(expoIndex + 1, 0, phaseLine);
  } else if (sourcesIndex >= 0) {
    phases.splice(sourcesIndex, 0, phaseLine);
  } else {
    phases.push(phaseLine);
  }

  return project.replace(nativeTargetRegex, `${match[1]}${phases.join('')}${match[3]}`);
}

function withDeepARFabricView(config) {
  return withDangerousMod(config, [
    'ios',
    (modConfig) => {
      const iosRoot = modConfig.modRequest.platformProjectRoot;
      const projectPath = path.join(iosRoot, 'onspaceapp.xcodeproj', 'project.pbxproj');

      if (!fs.existsSync(projectPath)) {
        console.log('[withDeepARFabricView] project.pbxproj not found; skipping');
        return modConfig;
      }

      const uuid = getPhaseUuid(fs.readFileSync(projectPath, 'utf8'), PHASE_NAME) || createUuid(PHASE_NAME);
      let project = fs.readFileSync(projectPath, 'utf8');
      project = addShellScriptPhase(project, uuid);
      project = ensureBuildPhaseOrder(project, uuid);
      fs.writeFileSync(projectPath, project, 'utf8');

      return modConfig;
    },
  ]);
}

module.exports = createRunOncePlugin(withDeepARFabricView, 'deepar-fabric-view', '0.1.0');
