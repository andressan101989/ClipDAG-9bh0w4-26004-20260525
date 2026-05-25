/**
 * plugins/withDeepARAndroidFix.js  — v7 (diagnóstico completo)
 *
 * Cambios v7:
 *   - Búsqueda recursiva de TODOS los build.gradle dentro de react-native-deepar
 *   - Parchea CADA archivo encontrado (no solo android/build.gradle)
 *   - Dump completo del contenido DESPUÉS de writeFileSync para verificar en EAS logs
 *   - Log de ruta exacta, gradle.properties y variables ext
 *   - Log de todos los archivos .gradle encontrados en el módulo
 */

const { withDangerousMod } = require('@expo/config-plugins');
const fs   = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────────────────────

/** Busca recursivamente todos los archivos con la extensión dada */
function findFilesRecursive(dir, ext, results = []) {
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findFilesRecursive(fullPath, ext, results);
    } else if (entry.isFile() && entry.name.endsWith(ext)) {
      results.push(fullPath);
    }
  }
  return results;
}

/** Aplica todos los reemplazos de SDK al contenido de un build.gradle */
function applySDKPatches(content, filePath) {
  let out = content;

  // ── A. buildToolsVersion ──────────────────────────────────────────────────
  out = out.replace(
    /buildToolsVersion\s*[=]?\s*['"][\d.]+['"]/g,
    'buildToolsVersion "35.0.0"',
  );

  // ── B. compileSdkVersion / compileSdk — todas las formas ──────────────────
  out = out.replace(
    /compileSdkVersion\s+safeExtGet\s*\([^)]+\)/g,
    'compileSdkVersion 35',
  );
  out = out.replace(
    /compileSdkVersion\s+rootProject\.ext\.\w+/g,
    'compileSdkVersion 35',
  );
  out = out.replace(
    /compileSdkVersion\s+project\.ext\.\w+/g,
    'compileSdkVersion 35',
  );
  out = out.replace(
    /ext\.compileSdkVersion\s*=\s*\d+/g,
    'ext.compileSdkVersion = 35',
  );
  out = out.replace(
    /compileSdkVersion\s*=?\s*\d+/g,
    'compileSdkVersion 35',
  );
  out = out.replace(
    /compileSdk\s*=?\s*\d+/g,
    'compileSdk 35',
  );

  // ── C. targetSdkVersion / targetSdk ──────────────────────────────────────
  out = out.replace(
    /targetSdkVersion\s+safeExtGet\s*\([^)]+\)/g,
    'targetSdkVersion 35',
  );
  out = out.replace(
    /targetSdkVersion\s+rootProject\.ext\.\w+/g,
    'targetSdkVersion 35',
  );
  out = out.replace(
    /ext\.targetSdkVersion\s*=\s*\d+/g,
    'ext.targetSdkVersion = 35',
  );
  out = out.replace(
    /targetSdkVersion\s*=?\s*\d+/g,
    'targetSdkVersion 35',
  );
  out = out.replace(
    /targetSdk\s*=?\s*\d+/g,
    'targetSdk 35',
  );

  // ── D. minSdkVersion / minSdk ─────────────────────────────────────────────
  out = out.replace(
    /minSdkVersion\s+safeExtGet\s*\([^)]+\)/g,
    'minSdkVersion 24',
  );
  out = out.replace(
    /minSdkVersion\s+rootProject\.ext\.\w+/g,
    'minSdkVersion 24',
  );
  out = out.replace(
    /ext\.minSdkVersion\s*=\s*\d+/g,
    'ext.minSdkVersion = 24',
  );
  out = out.replace(
    /minSdkVersion\s*=?\s*\d+/g,
    'minSdkVersion 24',
  );
  out = out.replace(
    /minSdk\s*=?\s*\d+/g,
    'minSdk 24',
  );

  // ── E. sourceCompatibility / targetCompatibility ──────────────────────────
  out = out.replace(
    /sourceCompatibility\s*=?\s*JavaVersion\.VERSION_\w+/g,
    'sourceCompatibility JavaVersion.VERSION_17',
  );
  out = out.replace(
    /targetCompatibility\s*=?\s*JavaVersion\.VERSION_\w+/g,
    'targetCompatibility JavaVersion.VERSION_17',
  );
  out = out.replace(
    /sourceCompatibility\s*=?\s*["']?[\d.]+["']?/g,
    'sourceCompatibility JavaVersion.VERSION_17',
  );
  out = out.replace(
    /targetCompatibility\s*=?\s*["']?[\d.]+["']?/g,
    'targetCompatibility JavaVersion.VERSION_17',
  );

  // ── F. Kotlin jvmTarget ───────────────────────────────────────────────────
  out = out.replace(
    /jvmTarget\s*=\s*["'][\d.]+["']/g,
    "jvmTarget = '17'",
  );

  // ── G. Inyectar compileOptions si no existe ───────────────────────────────
  if (!out.includes('compileOptions')) {
    out = out.replace(
      /android\s*\{/,
      'android {\n    compileOptions {\n        sourceCompatibility JavaVersion.VERSION_17\n        targetCompatibility JavaVersion.VERSION_17\n    }',
    );
    console.log(`[withDeepARAndroidFix] compileOptions INJECTED into: ${filePath}`);
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Patch principal — busca y parchea TODOS los .gradle dentro del módulo
// ─────────────────────────────────────────────────────────────────────────────
function patchDeepARModule(projectRoot) {
  const moduleRoot = path.join(projectRoot, 'node_modules', 'react-native-deepar');

  if (!fs.existsSync(moduleRoot)) {
    console.warn(
      '[withDeepARAndroidFix] ⚠️  node_modules/react-native-deepar NOT FOUND.\n' +
      '  → Ejecuta: pnpm add react-native-deepar',
    );
    return;
  }

  // ── 1. Listar TODOS los archivos .gradle dentro del módulo ────────────────
  const allGradleFiles = findFilesRecursive(moduleRoot, '.gradle');
  const allPropsFiles  = findFilesRecursive(moduleRoot, '.properties');

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  [withDeepARAndroidFix] v7 — DIAGNÓSTICO COMPLETO            ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  moduleRoot: ${moduleRoot}`);
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Archivos .gradle encontrados (${allGradleFiles.length}):`);
  allGradleFiles.forEach(f => console.log(`║    → ${f}`));
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Archivos .properties encontrados (${allPropsFiles.length}):`);
  allPropsFiles.forEach(f => console.log(`║    → ${f}`));
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // ── 2. Dump de gradle.properties si existe ────────────────────────────────
  for (const propsFile of allPropsFiles) {
    const propsContent = fs.readFileSync(propsFile, 'utf8');
    console.log(`\n[withDeepARAndroidFix] 📄 CONTENIDO de ${path.relative(projectRoot, propsFile)}:`);
    console.log('─'.repeat(60));
    console.log(propsContent);
    console.log('─'.repeat(60));
  }

  // ── 3. Parchear CADA archivo .gradle encontrado ──────────────────────────
  for (const gradleFile of allGradleFiles) {
    const relPath = path.relative(projectRoot, gradleFile);
    const original = fs.readFileSync(gradleFile, 'utf8');

    console.log(`\n[withDeepARAndroidFix] 📄 ORIGINAL — ${relPath}:`);
    console.log('─'.repeat(60));
    console.log(original);
    console.log('─'.repeat(60));

    const patched = applySDKPatches(original, gradleFile);

    if (patched !== original) {
      fs.writeFileSync(gradleFile, patched, 'utf8');

      // ── DUMP COMPLETO POST-WRITE ─────────────────────────────────────────
      const verified = fs.readFileSync(gradleFile, 'utf8');
      console.log(`\n[withDeepARAndroidFix] ✅ PATCHED — ${relPath} — CONTENIDO FINAL (post-writeFileSync):`);
      console.log('═'.repeat(60));
      console.log(verified);  // <── dump completo solicitado
      console.log('═'.repeat(60));

      // ── Verificar que compileSdkVersion < 30 ya no aparece ───────────────
      const remaining = verified.match(/compileSdkVersion\s+[\w.("]+/g) || [];
      console.log(`[withDeepARAndroidFix] compileSdkVersion lines post-patch in ${relPath}:`);
      remaining.forEach(m => console.log(`  → ${m}`));

      const stillBadBuildTools = verified.match(/buildToolsVersion\s*['"]\d+\.\d+\.\d+['"]/g) || [];
      if (stillBadBuildTools.length > 0) {
        console.error(`[withDeepARAndroidFix] ❌ buildToolsVersion NOT fully patched in ${relPath}:`);
        stillBadBuildTools.forEach(m => console.error(`  → ${m}`));
      }
    } else {
      console.log(`[withDeepARAndroidFix] ℹ️  No changes needed in ${relPath} — ya estaba actualizado.`);
    }
  }

  console.log('\n[withDeepARAndroidFix] v7 — patch cycle complete.\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup — elimina bloques inyectados por v4/v5 en android/build.gradle raíz
// ─────────────────────────────────────────────────────────────────────────────
const OLD_MARKERS = [
  '// [withDeepARAndroidFix] subprojects override',
  '// [withDeepARAndroidFix] subprojects-v4',
  '// [withDeepARAndroidFix] subprojects-v5',
];

function cleanupRootAndroidBuildGradle(projectRoot) {
  const filePath = path.join(projectRoot, 'android', 'build.gradle');
  if (!fs.existsSync(filePath)) return;

  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  for (const marker of OLD_MARKERS) {
    if (!content.includes(marker)) continue;
    const markerIdx = content.indexOf(marker);
    let depth = 0, i = markerIdx, blockEnd = -1;
    while (i < content.length) {
      if (content[i] === '{') depth++;
      if (content[i] === '}') { depth--; if (depth === 0) { blockEnd = i + 1; break; } }
      i++;
    }
    if (blockEnd !== -1) {
      content = content.slice(0, markerIdx).trimEnd() + '\n' + content.slice(blockEnd).trimStart();
      modified = true;
      console.log(`[withDeepARAndroidFix] 🗑️  Cleaned old block: ${marker}`);
    }
  }

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('[withDeepARAndroidFix] ✅ Root android/build.gradle cleaned');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Expo config plugin entry point
// ─────────────────────────────────────────────────────────────────────────────
const withDeepARAndroidFix = (config) => {
  return withDangerousMod(config, [
    'android',
    (modConfig) => {
      const root = modConfig.modRequest.projectRoot;
      patchDeepARModule(root);
      cleanupRootAndroidBuildGradle(root);
      return modConfig;
    },
  ]);
};

module.exports = withDeepARAndroidFix;
