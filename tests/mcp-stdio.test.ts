import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport as LegacyTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { expect, it } from 'vitest'
import { tempDir } from './helpers.ts'

async function fixture() {
  const directory = await tempDir('mcp-wire')
  const skill = join(directory, '.claude', 'skills', 'incident', 'SKILL.md')
  await mkdir(join(directory, '.git'))
  await mkdir(join(directory, '.claude', 'skills', 'incident'), { recursive: true })
  const content = '---\nname: incident\ndescription: Inspect incident records.\n---\nOriginal instructions.\n'
  await writeFile(skill, content)
  const entry = join(directory, 'server.mjs')
  await writeFile(entry, [
    `import { runStdio } from ${JSON.stringify(new URL('../src/mcp.ts', import.meta.url).href)};`,
    `await runStdio(${JSON.stringify({ cwd: directory, cacheMs: 60_000, config: { home: directory, dshHome: join(directory, '.dsh'), sync: false } })});`,
  ].join('\n'))
  return { directory, skill, entry, content }
}

it.each(['v1', 'v2-legacy', 'v2-auto', 'v2-modern'] as const)(
  '%s exchanges tools and resources over a real stdio process',
  async mode => {
    const { directory, entry, skill, content } = await fixture()
    const params = { command: process.execPath, args: ['--experimental-transform-types', entry], cwd: directory }
    const modern = mode === 'v2-modern' || mode === 'v2-auto'
    const client = mode === 'v1'
      ? new LegacyClient({ name: 'legacy-check', version: '1' })
      : new Client({ name: 'v2-check', version: '1' }, {
          versionNegotiation: {
            mode: mode === 'v2-modern' ? { pin: '2026-07-28' } : mode === 'v2-auto' ? 'auto' : 'legacy',
          },
        })
    const transport = mode === 'v1' ? new LegacyTransport(params) : new StdioClientTransport(params)
    try {
      await client.connect(transport)
      if (client instanceof Client) expect(client.getProtocolEra()).toBe(modern ? 'modern' : 'legacy')
      const tools = (await client.listTools()).tools.map(tool => tool.name).toSorted()
      expect(tools).toEqual(['find_skills', 'list_skills', 'open_skill'])
      const found = await client.callTool({ name: 'find_skills', arguments: { query: 'incident' } })
      expect(found.structuredContent).toMatchObject({ matches: [{ name: 'incident' }] })
      expect((await client.listResources()).resources.map(resource => resource.uri)).toEqual(['skill://incident'])
      expect((await client.readResource({ uri: 'skill://incident' })).contents).toHaveLength(1)
      const args = { name: 'incident', expected_sha256: createHash('sha256').update(content).digest('hex') }
      expect((await client.callTool({ name: 'open_skill', arguments: args })).isError).toBeFalsy()
      await writeFile(skill, content + 'CHANGED BODY')
      const changed = await client.callTool({ name: 'open_skill', arguments: args })
      expect(changed.isError).toBe(true)
      expect(JSON.stringify(changed)).not.toContain('CHANGED BODY')
      await writeFile(skill, '---\nname: incident\ndescription: Disabled.\ndisable-model-invocation: true\n---\nSECRET BODY\n')
      expect((await client.callTool({ name: 'open_skill', arguments: { name: 'incident' } })).isError).toBe(true)
      await expect(client.readResource({ uri: 'skill://incident' })).rejects.toThrow(/disabled/)
    } finally {
      await client.close()
      await transport.close()
    }
  },
)

it('exits on stdin EOF even before a protocol opening', async () => {
  const { entry, directory } = await fixture()
  const child = spawn(process.execPath, ['--experimental-transform-types', entry], { cwd: directory })
  let output = ''
  child.stdout.on('data', bytes => { output += String(bytes) })
  try {
    const ended = new Promise<number | null>((resolve, reject) => {
      child.once('exit', resolve)
      child.once('error', reject)
    })
    child.stdin.end()
    expect(await ended).toBe(0)
    expect(output).toBe('')
  } finally {
    if (child.exitCode === null) child.kill()
  }
})
