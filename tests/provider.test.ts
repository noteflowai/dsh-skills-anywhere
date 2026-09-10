import { mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { describe, expect, it } from 'vitest'
import * as Plugin from '../src/index.ts'
import { resolveConfig } from '../src/config.ts'
import { SkillsAnywhereProvider } from '../src/provider.ts'
import { writeSourcesFile } from '../src/sources.ts'
import { makeSkillRepo, quietLogger, skillMarkdown, tempDir, waitFor, writeSkill } from './helpers.ts'

interface Fixture {
  home: string
  project: string
}

async function fixture(): Promise<Fixture> {
  const home = await tempDir('home')
  const project = await tempDir('project')
  await mkdir(join(project, '.git'))
  return { home, project }
}

async function mount(home: string, config: Partial<Plugin.ConfigInput> = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(Plugin, {
    home,
    dshHome: join(home, '.dsh'),
    watch: false,
    sync: false,
    ...config,
  })
  return ctx
}

describe('plugin exports', () => {
  it('declares stable plugin metadata', () => {
    expect(Plugin.name).toBe('skills-anywhere')
    expect(Plugin.inject).toEqual(['skills'])
    expect(typeof Plugin.apply).toBe('function')
    expect(Plugin.Config).toBeDefined()
  })

  it('validates configuration through the schema and fills defaults', () => {
    const parsed = (Plugin.Config as unknown as (value: unknown) => Plugin.ConfigInput)({ sources: ['a/b', { repo: 'c/d', ref: 'x' }] })
    expect(parsed.providerName).toBe('skills-anywhere')
    expect(parsed.agents).toBe(true)
    expect(parsed.sources).toEqual(['a/b', { repo: 'c/d', ref: 'x' }])
    expect(parsed.ranks).toEqual({ project: 250, user: 550, claudePlugins: 580, sources: 700 })
    expect(() => (Plugin.Config as unknown as (value: unknown) => unknown)({ agents: 'yes' })).toThrow()
  })
})

describe('resolveConfig', () => {
  it('derives every path from home and expands ~', () => {
    const h = resolve('/h')
    const resolved = resolveConfig({ home: h, extraUserDirs: ['~/x/skills', resolve('/abs')], ranks: { user: 5 } }, {})
    expect(resolved.dshHome).toBe(join(h, '.dsh'))
    expect(resolved.stateDir).toBe(join(h, '.dsh', 'skills-anywhere'))
    expect(resolved.cacheDir).toBe(join(h, '.dsh', 'skills-anywhere', 'cache'))
    expect(resolved.userSourcesFile).toBe(join(h, '.dsh', 'skills-anywhere', 'sources.json'))
    expect(resolved.extraUserDirs).toEqual([join(h, 'x', 'skills'), resolve('/abs')])
    expect(resolved.ranks).toEqual({ project: 250, user: 5, claudePlugins: 580, sources: 700 })
  })
  it('honours DSH_HOME and HOME from the environment', () => {
    const resolved = resolveConfig({}, { HOME: resolve('/home/u'), DSH_HOME: resolve('/opt/dsh') })
    expect(resolved.home).toBe(resolve('/home/u'))
    expect(resolved.dshHome).toBe(resolve('/opt/dsh'))
  })
})

describe('SkillsAnywhereProvider inside the dsh registry', () => {
  it('publishes skills from other agents\' user and project directories with the right ranks', async () => {
    const { home, project } = await fixture()
    await writeSkill(join(home, '.claude', 'skills'), 'from-claude-user')
    await writeSkill(join(home, '.codex', 'skills'), 'from-codex')
    await writeSkill(join(project, '.claude', 'skills'), 'from-claude-project')
    await writeSkill(join(project, '.cursor', 'skills'), 'not-a-cursor-project-dir') // cursor has no project dir in the table
    const ctx = await mount(home)

    const summaries = await ctx.skills.list({ cwd: project })
    expect(summaries.map(skill => skill.name)).toEqual(['from-claude-project', 'from-claude-user', 'from-codex'])
    expect(summaries.map(skill => skill.source)).toEqual(['anywhere-project', 'anywhere-user', 'anywhere-user'])
    expect(summaries.every(skill => skill.provider === 'skills-anywhere')).toBe(true)

    const loaded = await ctx.skills.get('from-codex', { cwd: project })
    expect(loaded).toMatchObject({
      name: 'from-codex',
      content: 'Instructions for from-codex.',
      resourceBase: { kind: 'directory', path: join(home, '.codex', 'skills', 'from-codex') },
      path: join(home, '.codex', 'skills', 'from-codex', 'SKILL.md'),
    })
    expect((loaded!.metadata!.skillsAnywhere as { origin: unknown }).origin).toEqual({ kind: 'agent', agent: 'codex', scope: 'user' })
    await ctx.fiber.dispose()
  })

  it('finds skills nested in Claude Code plugin marketplaces', async () => {
    const { home, project } = await fixture()
    const market = join(home, '.claude', 'plugins', 'marketplaces', 'claude-plugins-official')
    await writeSkill(join(market, 'plugins', 'hookify', 'skills'), 'writing-rules')
    await writeSkill(join(market, 'external_plugins', 'imessage', 'skills'), 'configure')
    await writeFile(join(market, 'plugins', 'hookify', 'README.md'), '# hookify\n')
    const ctx = await mount(home)
    const summaries = await ctx.skills.list({ cwd: project })
    expect(summaries.map(skill => skill.name)).toEqual(['configure', 'writing-rules'])
    expect(summaries[0]!.source).toBe('anywhere-claude-plugins')
    const loaded = await ctx.skills.get('writing-rules', { cwd: project })
    expect((loaded!.metadata!.skillsAnywhere as { origin: unknown }).origin).toEqual({ kind: 'claude-plugins', marketplace: 'claude-plugins-official', plugin: 'hookify' })
    await ctx.fiber.dispose()
  })

  it('publishes colliding plugin skill names under distinct, loadable names', async () => {
    const { home, project } = await fixture()
    const market = join(home, '.claude', 'plugins', 'marketplaces', 'official', 'external_plugins')
    await writeSkill(join(market, 'discord', 'skills'), 'access', 'discord', { body: 'discord access' })
    await writeSkill(join(market, 'telegram', 'skills'), 'access', 'telegram', { body: 'telegram access' })
    const ctx = await mount(home)
    const summaries = await ctx.skills.list({ cwd: project })
    expect(summaries.map(skill => skill.name)).toEqual(['discord-access', 'telegram-access'])
    const loaded = await ctx.skills.get('telegram-access', { cwd: project })
    expect(loaded?.name).toBe('telegram-access')
    expect(loaded?.content).toBe('telegram access')
    await ctx.fiber.dispose()
  })

  it('respects excludeAgents, excludeSkills and claudePlugins=false', async () => {
    const { home, project } = await fixture()
    await writeSkill(join(home, '.claude', 'skills'), 'claude-one')
    await writeSkill(join(home, '.codex', 'skills'), 'codex-one')
    await writeSkill(join(home, '.codex', 'skills'), 'codex-hidden')
    await writeSkill(join(home, '.claude', 'plugins', 'marketplaces', 'm', 'plugins', 'p', 'skills'), 'plugin-skill')
    const ctx = await mount(home, { excludeAgents: ['claude-code'], excludeSkills: ['codex-hidden'], claudePlugins: false })
    const summaries = await ctx.skills.list({ cwd: project })
    expect(summaries.map(skill => skill.name)).toEqual(['codex-one'])
    await ctx.fiber.dispose()
  })

  it('lets the built-in dsh roots win duplicate names (lower rank) and deduplicates symlinked installs', async () => {
    const { home, project } = await fixture()
    // A "skills CLI"-style install: canonical copy in ~/.agents/skills, symlinks in other agents.
    const canonical = join(home, '.agents', 'skills', 'shared')
    await writeSkill(join(home, '.agents', 'skills'), 'shared', 'canonical')
    await mkdir(join(home, '.claude', 'skills'), { recursive: true })
    await mkdir(join(home, '.cursor', 'skills'), { recursive: true })
    await symlink(canonical, join(home, '.claude', 'skills', 'shared'))
    await symlink(canonical, join(home, '.cursor', 'skills', 'shared'))

    const ctx = await mount(home)
    const provider = new SkillsAnywhereProvider(resolveConfig({ home, watch: false, sync: false }), quietLogger())
    await provider.list({ cwd: project })
    const report = provider.report()!
    expect(report.skills.map(skill => skill.name)).toEqual(['shared'])
    expect(report.dropped).toHaveLength(1)
    expect(report.dropped[0]!.reason).toBe('same-file')
    await provider.dispose()

    // Through the registry the name still resolves to exactly one skill.
    const summaries = await ctx.skills.list({ cwd: project })
    expect(summaries.filter(skill => skill.name === 'shared')).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('serves skills from git sources declared in config and in sources files', async () => {
    const { home, project } = await fixture()
    const repoA = await makeSkillRepo([{ path: 'skills/alpha', name: 'alpha' }, { path: 'skills/beta', name: 'beta' }])
    const repoB = await makeSkillRepo([{ path: 'gamma', name: 'gamma' }])
    const repoC = await makeSkillRepo([{ path: 'delta', name: 'delta' }])
    const dshHome = join(home, '.dsh')
    await writeSourcesFile(join(dshHome, 'skills-anywhere', 'sources.json'), [repoB])
    await writeSourcesFile(join(project, '.dsh', 'skills-anywhere.json'), [{ repo: repoC, rank: 10 }])

    const log = quietLogger()
    const provider = new SkillsAnywhereProvider(resolveConfig({ home, dshHome, watch: false, sync: true, syncOnStart: false, sources: [{ repo: repoA, path: 'skills' }] }), log)
    const sources = await provider.sources(project)
    expect(sources.map(source => source.url)).toEqual([repoA, repoB, repoC])

    const results = await provider.syncAll(project)
    expect(results.map(result => result.status)).toEqual(['cloned', 'cloned', 'cloned'])

    const candidates = await provider.list({ cwd: project })
    const list = Array.isArray(candidates) ? candidates : candidates.candidates
    expect(list.map(skill => [skill.name, skill.rank])).toEqual([['delta', 10], ['alpha', 700], ['beta', 700], ['gamma', 700]])
    expect(list.every(skill => skill.source === 'anywhere-source')).toBe(true)
    const alpha = list.find(skill => skill.name === 'alpha')!
    expect(alpha.path!.startsWith(join(dshHome, 'skills-anywhere', 'cache'))).toBe(true)
    expect((alpha.metadata!.skillsAnywhere as { origin: { repo: string } }).origin.repo).toBe(`${repoA}/skills`)

    const definition = await provider.get(alpha, {})
    expect(definition?.content).toBe('Instructions for alpha.')
    await provider.dispose()
  })

  it('invalidates the registry when a background sync brings new skills', async () => {
    const { home, project } = await fixture()
    const repo = await makeSkillRepo([{ path: 'skills/alpha', name: 'alpha' }])
    const ctx = await mount(home, { sync: true, syncOnStart: true, syncIntervalMs: 0, sources: [repo] })

    // The first list triggers the clone in the background (the cache is empty);
    // once the clone lands the provider invalidates and the skill appears.
    await ctx.skills.list({ cwd: project })
    const after = await waitFor(() => ctx.skills.list({ cwd: project }), skills => skills.length === 1)
    expect(after[0]!.name).toBe('alpha')
    await ctx.fiber.dispose()
  })

  it('returns undefined from get() when the file disappeared and re-reads edits', async () => {
    const { home, project } = await fixture()
    const file = await writeSkill(join(home, '.codex', 'skills'), 'volatile', 'v1', { body: 'first' })
    const ctx = await mount(home)
    expect((await ctx.skills.get('volatile', { cwd: project }))?.content).toBe('first')
    await writeFile(file, skillMarkdown('volatile', 'v2', { body: 'second' }))
    expect((await ctx.skills.get('volatile', { cwd: project }))?.content).toBe('second')
    await rm(file)
    expect(await ctx.skills.get('volatile', { cwd: project })).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('refreshes the catalog when a watched directory changes', async () => {
    const { home, project } = await fixture()
    const root = join(home, '.codex', 'skills')
    await writeSkill(root, 'first')
    const ctx = await mount(home, { watch: true })
    expect((await ctx.skills.list({ cwd: project })).map(skill => skill.name)).toEqual(['first'])
    await writeSkill(root, 'second')
    const names = await waitFor(async () => (await ctx.skills.list({ cwd: project })).map(skill => skill.name), list => list.length === 2)
    expect(names).toEqual(['first', 'second'])
    await ctx.fiber.dispose()
  })

  it('reports incomplete discovery when a root is unreadable', async () => {
    const { home, project } = await fixture()
    const root = join(home, '.codex', 'skills')
    await mkdir(root, { recursive: true })
    await writeFile(join(home, '.claude'), 'not a directory') // ~/.claude/skills -> ENOTDIR is treated as absent
    const provider = new SkillsAnywhereProvider(resolveConfig({ home, watch: false, sync: false }), quietLogger())
    const result = await provider.list({ cwd: project })
    expect(Array.isArray(result)).toBe(true)
    await provider.dispose()
  })

  it('disposes cleanly when the plugin is unloaded', async () => {
    const { home, project } = await fixture()
    await writeSkill(join(home, '.codex', 'skills'), 'one')
    const ctx = await mount(home, { watch: true })
    await ctx.skills.list({ cwd: project })
    await ctx.fiber.dispose()
    // A second stop must not throw.
    await ctx.fiber.dispose()
  })
})
