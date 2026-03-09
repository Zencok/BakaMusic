/**
 * Patch node-gyp to support Visual Studio 2026
 * Run: node scripts/patch-node-gyp.js
 * Or add to package.json: "postinstall": "node scripts/patch-node-gyp.js"
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

let patchedCount = 0;

// ============================================
// Patch 0: node_modules/node-abi/abi_registry.json
// Add Electron 40 ABI mapping for older @electron/rebuild chains
// ============================================
function patchNodeAbiRegistry() {
  const filePath = path.join(__dirname, '..', 'node_modules', 'node-abi', 'abi_registry.json');

  if (!fs.existsSync(filePath)) {
    console.log('[patch-node-gyp] node-abi registry not found, skipping abi patch');
    return;
  }

  const registry = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const hasElectron40 = registry.some((item) => {
    return item.runtime === 'electron' && /^40(\.|$)/.test(item.target);
  });

  if (hasElectron40) {
    console.log('[patch-node-gyp] node-abi registry already contains Electron 40');
    return;
  }

  registry.push({
    abi: '143',
    future: true,
    lts: false,
    runtime: 'electron',
    target: '40.0.0-alpha.2',
  });

  fs.writeFileSync(filePath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  console.log('[patch-node-gyp] Patched node-abi registry for Electron 40');
  patchedCount++;
}

// ============================================
// Patch 1: node_modules/node-gyp/lib/find-visualstudio.js
// ============================================
function patchFindVisualStudio() {
  const filePath = path.join(__dirname, '..', 'node_modules', 'node-gyp', 'lib', 'find-visualstudio.js');

  if (!fs.existsSync(filePath)) {
    console.log('[patch-node-gyp] node-gyp not found, skipping find-visualstudio.js patch');
    return;
  }

  let content = fs.readFileSync(filePath, 'utf8');

  // Check if already patched
  if (content.includes('versionYear = 2026')) {
    console.log('[patch-node-gyp] find-visualstudio.js already patched');
    return;
  }

  // Patch getVersionInfo: add VS2026 (version 18.x) support
  const versionInfoOld = `if (ret.versionMajor === 17) {
      ret.versionYear = 2022
      return ret
    }
    this.log.silly('- unsupported version:', ret.versionMajor)`;

  const versionInfoNew = `if (ret.versionMajor === 17) {
      ret.versionYear = 2022
      return ret
    }
    if (ret.versionMajor === 18) {
      ret.versionYear = 2026
      return ret
    }
    this.log.silly('- unsupported version:', ret.versionMajor)`;

  if (!content.includes(versionInfoOld)) {
    console.error('[patch-node-gyp] Could not find getVersionInfo pattern to patch');
    return;
  }

  content = content.replace(versionInfoOld, versionInfoNew);

  // Patch getToolset: add v145 toolset for VS2026
  const toolsetOld = `} else if (versionYear === 2022) {
      return 'v143'
    }
    this.log.silly('- invalid versionYear:', versionYear)`;

  const toolsetNew = `} else if (versionYear === 2022) {
      return 'v143'
    } else if (versionYear === 2026) {
      return 'v145'
    }
    this.log.silly('- invalid versionYear:', versionYear)`;

  if (!content.includes(toolsetOld)) {
    console.error('[patch-node-gyp] Could not find getToolset pattern to patch');
    return;
  }

  content = content.replace(toolsetOld, toolsetNew);

  fs.writeFileSync(filePath, content, 'utf8');
  console.log('[patch-node-gyp] Patched find-visualstudio.js for VS2026');
  patchedCount++;
}

// ============================================
// Patch 2: node-gyp cache common.gypi (replace ClangCL with v145)
// ============================================
function patchNodeGypCache() {
  // Find node-gyp cache directory
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const cacheDir = path.join(localAppData, 'node-gyp', 'Cache');

  if (!fs.existsSync(cacheDir)) {
    console.log('[patch-node-gyp] node-gyp cache not found, skipping common.gypi patch');
    return;
  }

  // Find all Node.js version directories
  const versions = fs.readdirSync(cacheDir).filter(v => /^\d+\.\d+\.\d+$/.test(v));

  for (const version of versions) {
    const commonGypiPath = path.join(cacheDir, version, 'include', 'node', 'common.gypi');

    if (!fs.existsSync(commonGypiPath)) {
      continue;
    }

    let content = fs.readFileSync(commonGypiPath, 'utf8');

    // Check if needs patching (contains ClangCL)
    if (!content.includes("'msbuild_toolset': 'ClangCL'")) {
      continue;
    }

    // Replace ClangCL with v145 (VS2026 MSVC toolset)
    content = content.replace(/'msbuild_toolset': 'ClangCL'/g, "'msbuild_toolset': 'v145'");

    fs.writeFileSync(commonGypiPath, content, 'utf8');
    console.log(`[patch-node-gyp] Patched common.gypi for Node.js ${version} (ClangCL -> v145)`);
    patchedCount++;
  }
}

// Run patches
patchNodeAbiRegistry();
patchFindVisualStudio();
patchNodeGypCache();

if (patchedCount === 0) {
  console.log('[patch-node-gyp] All patches already applied or not needed');
} else {
  console.log(`[patch-node-gyp] Successfully applied ${patchedCount} patch(es)`);
}
