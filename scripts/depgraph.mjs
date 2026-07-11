#!/usr/bin/env node
// Scan npm workspaces, emit a mermaid dependency graph of internal
// (@winstonfassett/*) package deps + vite source aliases.
//
//   node scripts/depgraph.mjs            # print mermaid to stdout
//   node scripts/depgraph.mjs --write    # splice into docs/dependencies.md
//                                         (between the ```mermaid fences)
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const INTERNAL = /^@winstonfassett\//

function pkgsIn(rel) {
  const base = join(root, rel)
  if (!existsSync(base)) return []
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(rel, d.name, 'package.json'))
    .filter((p) => existsSync(join(root, p)))
}

const files = [...pkgsIn('packages'), ...pkgsIn('apps')]
const nodes = []
for (const rel of files) {
  const json = JSON.parse(readFileSync(join(root, rel), 'utf8'))
  const name = json.name ?? rel
  const deps = { ...json.dependencies, ...json.devDependencies, ...json.peerDependencies }
  const internal = Object.keys(deps).filter((d) => INTERNAL.test(d))
  nodes.push({ rel, name, short: name.replace(INTERNAL, ''), group: rel.startsWith('apps/') ? 'apps' : 'pkgs', internal })
}

const id = (name) => name.replace(INTERNAL, '').replace(/[^a-zA-Z0-9]/g, '_')
const byName = Object.fromEntries(nodes.map((n) => [n.name, n]))

// Pull vite source aliases from hotbook (dotted edges).
const aliasEdges = []
const viteCfg = join(root, 'apps/hotbook/vite.config.ts')
if (existsSync(viteCfg)) {
  const txt = readFileSync(viteCfg, 'utf8')
  for (const m of txt.matchAll(/'(@[\w-]+)':\s*path\.resolve\([^,]+,\s*'([^']+)'\)/g)) {
    const target = m[2].split('/apps/')[1]?.split('/')[0]
    if (target) aliasEdges.push({ from: 'hotbook', alias: m[1], dir: target })
  }
}

const lines = ['```mermaid', 'graph TD']
lines.push('  subgraph pkgs["packages/"]')
for (const n of nodes.filter((n) => n.group === 'pkgs')) lines.push(`    ${id(n.name)}["${n.short}"]`)
lines.push('  end')
lines.push('  subgraph apps["apps/"]')
for (const n of nodes.filter((n) => n.group === 'apps')) lines.push(`    ${id(n.name)}["${n.short}"]`)
lines.push('  end')
for (const n of nodes) for (const dep of n.internal) if (byName[dep]) lines.push(`  ${id(n.name)} --> ${id(dep)}`)
for (const e of aliasEdges) {
  const dirNode = nodes.find((n) => n.rel.startsWith(`apps/${e.dir}/`))
  if (dirNode) lines.push(`  ${id('hotbook')} -. "${e.alias}" .-> ${id(dirNode.name)}`)
}
lines.push('```')
const mermaid = lines.join('\n')

if (process.argv.includes('--write')) {
  const docPath = join(root, 'docs/dependencies.md')
  const doc = readFileSync(docPath, 'utf8')
  // Replace ONLY the first mermaid block (the one under "## Graph"). Use a
  // function replacer so `$` in the graph isn't treated as a backreference.
  const re = /```mermaid\n[\s\S]*?\n```/
  if (!re.test(doc)) { console.error('No ```mermaid block found in docs/dependencies.md'); process.exit(1) }
  const next = doc.replace(re, () => mermaid)
  writeFileSync(docPath, next)
  console.error('Updated docs/dependencies.md')
} else {
  console.log(mermaid)
}
