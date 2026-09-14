// Exercise the packed CLI from an unrelated directory, with real process exits.
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport as LegacyTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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
  // Independent SDK clients drive the installed server over real stdio.
  // No source-side server code or in-memory transport enters the check.
  const skillDirectory = join(cwd, '.claude', 'skills', 'incident')
  mkdirSync(skillDirectory, { recursive: true })
  const skillPath = join(skillDirectory, 'SKILL.md')
  const wrapper = join(cwd, 'server.mjs')
  writeFileSync(wrapper, [
    `import { runStdio } from ${JSON.stringify(pathToFileURL(join(dirname(entry), 'mcp.js')).href)};`,
    `await runStdio(${JSON.stringify({ cwd, cacheMs: 60_000, config: { home: cwd, dshHome: join(cwd, '.dsh'), sync: false } })});`,
  ].join('\n'))
  for (const mode of ['legacy', 'modern']) {
    writeFileSync(skillPath, readFileSync(join(cwd, 'valid.md')))
    const pinned = run([skillPath], 0).files[0].sha256
    const client = mode === 'legacy'
      ? new LegacyClient({ name: 'installed-check-v1', version: '1.0.0' })
      : new Client({ name: 'installed-check-v2', version: '1.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } })
    const params = { command: process.execPath, args: [wrapper], cwd }
    const transport = mode === 'legacy' ? new LegacyTransport(params) : new StdioClientTransport(params)
    try {
      await client.connect(transport)
      if (mode === 'modern') assert.equal(client.getProtocolEra(), 'modern')
      assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), ['find_skills', 'list_skills', 'open_skill'])
      assert.ok((await client.listResources()).resources.some(resource => resource.uri === 'skill://incident'))
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
      await transport.close()
    }
  }
  console.log('Installed tarball: file checks, legacy + 2026-07-28 MCP, exact-byte loads and fresh author opt-outs passed.')
} finally {
  rmSync(cwd, { recursive: true, force: true })
}
