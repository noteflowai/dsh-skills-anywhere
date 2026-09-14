// Exercise the packed CLI from an unrelated directory, with real process exits.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const entry = realpathSync(resolve(process.argv[2] ?? 'node_modules/dsh-skills-anywhere/lib/cli.js'))
const source = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'))
const version = JSON.parse(readFileSync(resolve(dirname(entry), '../package.json'), 'utf8')).version
assert.ok(!entry.startsWith(source + sep), 'Check an installed tarball outside the source checkout')
const cwd = mkdtempSync(join(tmpdir(), 'skills-installed-check-'))
try {
  writeFileSync(join(cwd, 'valid.md'), '---\nname: incident\ndescription: Inspect supplied evidence.\n---\nPRIVATE BODY\n')
  writeFileSync(join(cwd, 'repair.md'), 'Inspect supplied evidence.')
  function run(args, code) {
    const result = spawnSync(process.execPath, [entry, 'check', ...args, '--json'], { cwd, encoding: 'utf8', timeout: 15000 })
    assert.equal(result.status, code, result.stderr || result.error?.message)
    assert.equal(result.stderr, '')
    assert.ok(!result.stdout.includes('PRIVATE BODY'))
    const report = JSON.parse(result.stdout)
    assert.deepEqual(report.tool, { name: 'dsh-skills-anywhere', version })
    return report
  }
  assert.deepEqual(run(['valid.md'], 0).counts, { passed: 1, failed: 0, inputErrors: 0 })
  const repaired = run(['repair.md'], 1)
  assert.equal(repaired.files[0].report.lenient.name, 'repair')
  assert.equal(repaired.files[0].sha256.length, 64)
  run(['repair.md', '--lenient'], 0)
  run(['repair.md', '--lenient', '--fail-on-repair'], 1)
  assert.deepEqual(run(['repair.md', 'missing.md', 'valid.md'], 2).counts, { passed: 1, failed: 1, inputErrors: 1 })
  // Load the MCP library and its SDK from the installed package, not this repo.
  const installedRequire = createRequire(entry)
  const { Client } = await import(pathToFileURL(installedRequire.resolve('@modelcontextprotocol/sdk/client/index.js')).href)
  const { InMemoryTransport } = await import(pathToFileURL(installedRequire.resolve('@modelcontextprotocol/sdk/inMemory.js')).href)
  const { createSkillsAnywhereServer } = await import(pathToFileURL(join(dirname(entry), 'mcp.js')).href)
  const skillDirectory = join(cwd, '.claude', 'skills', 'incident')
  mkdirSync(skillDirectory, { recursive: true })
  const skillPath = join(skillDirectory, 'SKILL.md')
  writeFileSync(skillPath, readFileSync(join(cwd, 'valid.md')))
  const pinned = run([skillPath], 0).files[0].sha256
  const mcp = createSkillsAnywhereServer({
    cwd, cacheMs: 60_000, config: { home: cwd, dshHome: join(cwd, '.dsh'), sync: false },
  })
  const client = new Client({ name: 'installed-check', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  try {
    await mcp.server.connect(serverTransport)
    await client.connect(clientTransport)
    const arguments_ = { name: 'incident', expected_sha256: pinned }
    const opened = await client.callTool({ name: 'open_skill', arguments: arguments_ })
    assert.ok(!opened.isError)
    assert.equal(opened.structuredContent.sha256, pinned)
    writeFileSync(skillPath, readFileSync(skillPath, 'utf8') + '\nCHANGED INSTRUCTIONS')
    const changed = await client.callTool({ name: 'open_skill', arguments: arguments_ })
    assert.equal(changed.isError, true)
    assert.ok(!JSON.stringify(changed).includes('CHANGED INSTRUCTIONS'))
    writeFileSync(skillPath, '---\nname: incident\ndescription: Disabled.\ndisable-model-invocation: true\n---\nSECRET\n')
    const disabled = await client.callTool({ name: 'open_skill', arguments: { name: 'incident' } })
    assert.equal(disabled.isError, true)
    await assert.rejects(client.readResource({ uri: 'skill://incident' }), /disabled/)
  } finally {
    await client.close()
    await mcp.close()
  }
  console.log('Installed tarball: file checks, exact-byte MCP loads and fresh author opt-outs passed.')
} finally {
  rmSync(cwd, { recursive: true, force: true })
}
