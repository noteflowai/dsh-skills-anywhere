import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { afterEach, describe, expect, it } from 'vitest'
import { createSkillsAnywhereServer, modelSkills, renderSkill, type SkillsAnywhereMcp } from '../src/mcp.ts'
import { readBundle } from '../src/skill-bundle.ts'
import { quietLogger, tempDir, writeSkill } from './helpers.ts'

interface Harness {
  readonly home: string
  readonly project: string
  readonly client: Client
  readonly mcp: SkillsAnywhereMcp
}

const open: Harness[] = []

afterEach(async () => {
  for (const entry of open.splice(0)) {
    await entry.client.close()
    await entry.mcp.close()
  }
})

async function harness(options: { cacheMs?: number } = {}): Promise<Harness> {
  const home = await tempDir('mcp-home')
  const project = await tempDir('mcp-project')
  await mkdir(join(project, '.git'))
  await writeSkill(join(home, '.claude', 'skills'), 'pdf-forms', 'Fill and flatten PDF forms', { body: 'Use pdftk.\nSee scripts/fill.py.' })
  await writeSkill(join(home, '.codex', 'skills'), 'react-testing', 'Test React components with Vitest')
  await writeSkill(join(project, '.claude', 'skills'), 'deploy-notes', 'How this project ships releases')
  await writeSkill(join(home, '.claude', 'skills'), 'secret-ops', 'Operator only', { frontmatter: { 'disable-model-invocation': true } })

  const mcp = createSkillsAnywhereServer({
    cwd: project,
    config: { home, dshHome: join(home, '.dsh'), sync: false },
    log: quietLogger(),
    findLimit: 3,
    ...(options.cacheMs !== undefined ? { cacheMs: options.cacheMs } : {}),
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await mcp.server.connect(serverTransport)
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  await client.connect(clientTransport)
  const result = { home, project, client, mcp }
  open.push(result)
  return result
}

function textOf(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? []
  return content.map(block => block.text ?? '').join('\n')
}

describe('MCP server', () => {
  it('pins all skill files and rejects a changed resource without returning instructions', async () => {
    const { client, home } = await harness({ cacheMs: 60_000 })
    const directory = join(home, '.claude', 'skills', 'pdf-forms')
    await mkdir(join(directory, 'scripts'))
    await writeFile(join(directory, 'scripts/fill.py'), 'print("reviewed")')
    const reviewed = (await readBundle(directory)).manifest
    const args = { name: 'pdf-forms', expected_bundle_sha256: reviewed.sha256 }
    const opened = await client.callTool({ name: 'open_skill', arguments: args })
    expect(opened.isError).toBeFalsy()
    expect(opened.structuredContent).toMatchObject({ bundle: reviewed })
    await writeFile(join(directory, 'scripts/fill.py'), 'print("changed")')
    const rejected = await client.callTool({ name: 'open_skill', arguments: args })
    expect(rejected.isError).toBe(true)
    expect(textOf(rejected)).toContain('expected_bundle_sha256 does not match')
    expect(textOf(rejected)).not.toContain('Use pdftk')
    const fresh = await client.callTool({ name: 'open_skill', arguments: { name: 'pdf-forms', include_bundle: true } })
    expect(fresh.isError).toBeFalsy()
    expect((fresh.structuredContent as { bundle: { sha256: string } }).bundle.sha256).not.toBe(reviewed.sha256)
    const legacy = await client.callTool({ name: 'open_skill', arguments: { name: 'pdf-forms' } })
    expect(legacy.isError).toBeFalsy()
    expect(legacy.structuredContent).not.toHaveProperty('bundle')
  })

  it('applies current author opt-outs even when the entire directory hash matches', async () => {
    const { client, home } = await harness({ cacheMs: 60_000 })
    await client.listTools()
    const directory = join(home, '.claude', 'skills', 'pdf-forms')
    await client.callTool({ name: 'open_skill', arguments: { name: 'pdf-forms' } })
    await writeFile(join(directory, 'SKILL.md'), '---\nname: pdf-forms\ndescription: Disabled\ndisable-model-invocation: true\n---\nPRIVATE')
    const { manifest } = await readBundle(directory)
    const result = await client.callTool({ name: 'open_skill', arguments: { name: 'pdf-forms', expected_bundle_sha256: manifest.sha256 } })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('disabled')
    expect(textOf(result)).not.toContain('PRIVATE')
  })

  it('advertises the three tools, instructions and the package version', async () => {
    const { client } = await harness()
    const tools = (await client.listTools()).tools.map(tool => tool.name).toSorted()
    expect(tools).toEqual(['find_skills', 'list_skills', 'open_skill'])
    expect(client.getInstructions()).toContain('find_skills')
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
    expect(client.getServerVersion()).toEqual({ name: 'dsh-skills-anywhere', version: pkg.version })
  })

  it('list_skills shows skills from every agent with their origin and hides author-disabled ones', async () => {
    const { client } = await harness()
    const result = await client.callTool({ name: 'list_skills', arguments: {} })
    const structured = result.structuredContent as { total: number; skills: { name: string; source: string }[] }
    expect(structured.total).toBe(3)
    expect(structured.skills.map(skill => skill.name).toSorted()).toEqual(['deploy-notes', 'pdf-forms', 'react-testing'])
    expect(structured.skills.find(skill => skill.name === 'deploy-notes')?.source).toBe('claude-code (project)')
    expect(structured.skills.find(skill => skill.name === 'react-testing')?.source).toBe('codex (user)')
    expect(textOf(result)).toContain('- pdf-forms — Fill and flatten PDF forms [claude-code (user)]')
    expect(textOf(result)).not.toContain('secret-ops')

    const page = await client.callTool({ name: 'list_skills', arguments: { limit: 1, offset: 1 } })
    expect((page.structuredContent as { skills: unknown[] }).skills).toHaveLength(1)
  })

  it('find_skills ranks keyword matches and rejects an empty query', async () => {
    const { client } = await harness()
    const result = await client.callTool({ name: 'find_skills', arguments: { query: 'pdf form filling' } })
    const structured = result.structuredContent as { total: number; matches: { name: string }[] }
    expect(structured.total).toBe(3)
    expect(structured.matches[0]?.name).toBe('pdf-forms')
    expect(textOf(result)).toContain('1 of 3 skills matched')

    const none = await client.callTool({ name: 'find_skills', arguments: { query: 'kubernetes' } })
    expect(textOf(none)).toContain('No skills matched')

    const empty = await client.callTool({ name: 'find_skills', arguments: { query: '   ' } })
    expect(empty.isError).toBe(true)
  })

  it('open_skill renders dsh-style skill content with the base directory', async () => {
    const { client, home } = await harness()
    const result = await client.callTool({ name: 'open_skill', arguments: { name: 'pdf-forms' } })
    expect(result.isError).toBeFalsy()
    const structured = result.structuredContent as { name: string; directory: string; path: string; content: string }
    expect(structured.name).toBe('pdf-forms')
    expect(structured.directory).toBe(join(home, '.claude', 'skills', 'pdf-forms'))
    expect(structured.path).toBe(join(structured.directory, 'SKILL.md'))
    expect(structured.content).toContain('Use pdftk.')
    const text = textOf(result)
    expect(text).toContain('<skill_content name="pdf-forms">')
    expect(text).toContain(`Base directory for this skill: ${structured.directory}`)
    expect(text).toContain('<skill_instructions>\nUse pdftk.')
  })

  it('open_skill refuses unknown, invalid and author-disabled skills', async () => {
    const { client } = await harness()
    const unknown = await client.callTool({ name: 'open_skill', arguments: { name: 'nope' } })
    expect(unknown.isError).toBe(true)
    expect(textOf(unknown)).toContain('unknown')
    const invalid = await client.callTool({ name: 'open_skill', arguments: { name: 'Not A Name!' } })
    expect(invalid.isError).toBe(true)
    expect(textOf(invalid)).toContain('invalid skill name')
    const disabled = await client.callTool({ name: 'open_skill', arguments: { name: 'secret-ops' } })
    expect(disabled.isError).toBe(true)
    expect(textOf(disabled)).toContain('disabled by its author')
  })

  it('open_skill sees a skill installed after the last scan', async () => {
    const { client, home } = await harness({ cacheMs: 60_000 })
    await client.callTool({ name: 'list_skills', arguments: {} })
    await writeSkill(join(home, '.gemini', 'skills'), 'late-arrival', 'Installed later')
    const result = await client.callTool({ name: 'open_skill', arguments: { name: 'late-arrival' } })
    expect(result.isError).toBeFalsy()
    expect((result.structuredContent as { name: string }).name).toBe('late-arrival')
  })

  it('rejects freshly disabled instructions through tools and resources even with cached discovery', async () => {
    const { client, home } = await harness({ cacheMs: 60_000 })
    await client.callTool({ name: 'list_skills', arguments: {} })
    await writeSkill(join(home, '.claude', 'skills'), 'pdf-forms', 'Disabled now', {
      frontmatter: { 'disable-model-invocation': true }, body: 'Do not expose these instructions.',
    })
    const result = await client.callTool({ name: 'open_skill', arguments: { name: 'pdf-forms' } })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('disabled by its author')
    expect(textOf(result)).not.toContain('Do not expose')
    await expect(client.readResource({ uri: 'skill://pdf-forms' })).rejects.toThrow(/disabled/)
  })

  it('pins exact original bytes and refuses changed instructions without returning their body', async () => {
    const { client, home } = await harness({ cacheMs: 60_000 })
    const path = join(home, '.claude', 'skills', 'pdf-forms', 'SKILL.md')
    const sha256 = createHash('sha256').update(await readFile(path)).digest('hex')
    const args = { name: 'pdf-forms', expected_sha256: sha256 }
    const first = await client.callTool({ name: 'open_skill', arguments: args })
    expect(first.isError).toBeFalsy()
    expect((first.structuredContent as { sha256: string }).sha256).toBe(sha256)
    await writeSkill(join(home, '.claude', 'skills'), 'pdf-forms', 'Changed', { body: 'Unexpected instructions.' })
    const changed = await client.callTool({ name: 'open_skill', arguments: args })
    expect(changed.isError).toBe(true)
    expect(textOf(changed)).toContain('expected_sha256 does not match')
    expect(textOf(changed)).not.toContain('Unexpected instructions')
    const fresh = await client.callTool({ name: 'open_skill', arguments: { name: 'pdf-forms' } })
    expect(fresh.isError).toBeFalsy()
    expect((fresh.structuredContent as { sha256: string }).sha256).not.toBe(sha256)
  })

  it.each(['encoding', 'size'])('rejects a cached file replaced with invalid %s', async kind => {
    const { client, home } = await harness({ cacheMs: 60_000 })
    await client.callTool({ name: 'list_skills', arguments: {} })
    const path = join(home, '.claude', 'skills', 'pdf-forms', 'SKILL.md')
    if (kind === 'encoding') await writeFile(path, Buffer.from([0xff, 0xfe]))
    else await writeFile(path, 'x'.repeat(128 * 1024 + 1))
    const result = await client.callTool({ name: 'open_skill', arguments: { name: 'pdf-forms' } })
    expect(result.isError).toBe(true)
    await expect(client.readResource({ uri: 'skill://pdf-forms' })).rejects.toThrow()
  })

  it('exposes skills as skill:// resources with completion', async () => {
    const { client } = await harness()
    const templates = await client.listResourceTemplates()
    expect(templates.resourceTemplates.map(template => template.uriTemplate)).toEqual(['skill://{name}'])
    const listed = await client.listResources()
    expect(listed.resources.map(resource => resource.uri).toSorted()).toEqual(['skill://deploy-notes', 'skill://pdf-forms', 'skill://react-testing'])
    const read = await client.readResource({ uri: 'skill://react-testing' })
    const content = read.contents[0] as { text: string; mimeType?: string }
    expect(content.mimeType).toBe('text/markdown')
    expect(content.text).toContain('<skill_content name="react-testing">')
    const completion = await client.complete({
      ref: { type: 'ref/resource', uri: 'skill://{name}' },
      argument: { name: 'name', value: 'pd' },
    })
    expect(completion.completion.values).toEqual(['pdf-forms'])
    await expect(client.readResource({ uri: 'skill://secret-ops' })).rejects.toThrow(/disabled/)
  })

  it('keeps collision-renamed skills loadable with hashes', async () => {
    const { client, home } = await harness()
    const market = join(home, '.claude', 'plugins', 'marketplaces', 'official', 'external_plugins')
    await writeSkill(join(market, 'discord', 'skills'), 'access', 'discord', { body: 'discord access' })
    await writeSkill(join(market, 'telegram', 'skills'), 'access', 'telegram', { body: 'telegram access' })
    const result = await client.callTool({ name: 'open_skill', arguments: { name: 'telegram-access' } })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toMatchObject({ name: 'telegram-access', content: 'telegram access' })
    expect((result.structuredContent as { sha256: string }).sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('refresh caches one discovery pass and exposes the report', async () => {
    const { mcp } = await harness({ cacheMs: 60_000 })
    const first = await mcp.refresh()
    expect(modelSkills(first).map(skill => skill.name).toSorted()).toEqual(['deploy-notes', 'pdf-forms', 'react-testing'])
    expect(first.skills).toHaveLength(4)
    expect(await mcp.refresh()).toBe(first)
    expect(await mcp.refresh(true)).not.toBe(first)
  })
})

describe('renderSkill', () => {
  it('escapes the name attribute and directory text', () => {
    const text = renderSkill({ name: 'a"b<c', directory: '/tmp/<dir>&x', content: 'body' })
    expect(text).toContain('<skill_content name="a&quot;b&lt;c">')
    expect(text).toContain('Base directory for this skill: /tmp/&lt;dir&gt;&amp;x')
    expect(text.endsWith('</skill_content>')).toBe(true)
  })
})
