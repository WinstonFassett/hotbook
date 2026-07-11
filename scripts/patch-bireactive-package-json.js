/**
 * Programmatically patch bireactive's package.json to add missing subpath exports.
 *
 * patch-package has trouble with package.json patches because npm can add
 * metadata noise to the installed package.json, causing context diffs to fail
 * (see ds300/patch-package#375). This script edits JSON directly instead.
 */
const fs = require('fs')
const path = require('path')

function findPackageJson() {
  try {
    return require.resolve('bireactive/package.json')
  } catch {
    // Fall back to a path relative to the repo root in case the package is
    // not resolvable from the postinstall cwd.
    return path.join(__dirname, '..', 'node_modules', 'bireactive', 'package.json')
  }
}

const pkgPath = findPackageJson()
if (!fs.existsSync(pkgPath)) {
  console.log('[patch-bireactive] bireactive not installed, skipping')
  process.exit(0)
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
if (!pkg.exports) {
  pkg.exports = {}
}

if (!pkg.exports['./constraints']) {
  pkg.exports['./constraints'] = {
    types: './dist/constraints/index.d.ts',
    import: './dist/constraints/index.js',
  }
}

if (!pkg.exports['./propagators']) {
  pkg.exports['./propagators'] = {
    types: './dist/propagators/index.d.ts',
    import: './dist/propagators/index.js',
  }
}

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
console.log('[patch-bireactive] added constraints/propagators exports to', pkgPath)
