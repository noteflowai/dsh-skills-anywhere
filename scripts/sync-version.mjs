#!/usr/bin/env node
// Keep every copy of the release version in step with package.json.
//
//   node scripts/sync-version.mjs          rewrite the files below
//   node scripts/sync-version.mjs --check  exit 1 if any of them disagree
//
// package.json is the single source of truth. `pnpm version <bump>` runs this
// through the `version` lifecycle script, and CI runs `--check`.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const check = process.argv.includes('--check')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = pkg.version
const tarball = `https://github.com/noteflowai/dsh-skills-anywhere/releases/download/v${version}/dsh-skills-anywhere-${version}.tgz`
// The Claude Code plugin manifest pins the npm package to the released version.
const npmPin = `dsh-skills-anywhere@${version}`
const npmPinPattern = /dsh-skills-anywhere@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g
const tarballPattern = /https:\/\/github\.com\/noteflowai\/dsh-skills-anywhere\/releases\/download\/v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\/dsh-skills-anywhere-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.tgz/g

/** @type {{ file: string, apply: (text: string) => string }[]} */
const targets = [
  {
    file: '.claude-plugin/plugin.json',
    apply: text => {
      const json = JSON.parse(text)
      json.version = version
      return `${JSON.stringify(json, null, 2)}\n`.replace(tarballPattern, tarball).replace(npmPinPattern, npmPin)
    },
  },
  {
    file: '.claude-plugin/marketplace.json',
    apply: text => {
      const json = JSON.parse(text)
      for (const plugin of json.plugins ?? []) if (plugin.name === pkg.name) plugin.version = version
      return `${JSON.stringify(json, null, 2)}\n`
    },
  },
  {
    file: 'server.json',
    apply: text => {
      const json = JSON.parse(text)
      json.version = version
      for (const entry of json.packages ?? []) if (entry.identifier === pkg.name) entry.version = version
      return `${JSON.stringify(json, null, 2)}\n`
    },
  },
  { file: 'README.md', apply: text => text.replace(tarballPattern, tarball) },
  { file: 'README.zh.md', apply: text => text.replace(tarballPattern, tarball) },
]

let drift = 0
for (const { file, apply } of targets) {
  const path = join(root, file)
  const before = readFileSync(path, 'utf8')
  // Windows checkouts may carry CRLF; compare and write back in the file's own line endings.
  const eol = before.includes('\r\n') ? '\r\n' : '\n'
  const after = apply(before.replace(/\r\n/g, '\n')).replace(/\n/g, eol)
  if (before === after) continue
  drift++
  if (check) {
    console.error(`${relative(root, path)} is out of step with package.json (${version})`)
  } else {
    writeFileSync(path, after)
    console.log(`updated ${relative(root, path)} → ${version}`)
  }
}

if (check && drift > 0) {
  console.error('run `node scripts/sync-version.mjs` to fix')
  process.exit(1)
}
if (drift === 0) console.log(`all files agree on ${version}`)
