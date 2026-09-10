import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { discover, findProjectRoot, type SkillRoot } from '../src/discover.ts'
import { skillMarkdown, tempDir, writeFlatSkill, writeSkill } from './helpers.ts'

function flatRoot(path: string, rank = 100, label = 'flat'): SkillRoot {
  return { path, source: 'test-flat', rank, mode: 'flat', origin: { kind: 'agent', agent: label, scope: 'user' }, label }
}

function nestedRoot(path: string, rank = 100, maxDepth = 5): SkillRoot {
  return { path, source: 'test-nested', rank, mode: 'nested', maxDepth, origin: { kind: 'source', repo: 'repo' }, label: 'nested' }
}

describe('discover (flat roots)', () => {
  it('finds directory bundles and flat files, ignores dotfiles and READMEs', async () => {
    const root = await tempDir()
    await writeSkill(root, 'alpha')
    await writeFlatSkill(root, 'beta')
    await writeFile(join(root, 'README.md'), '# not a skill\n')
    await mkdir(join(root, '.hidden'))
    await writeFile(join(root, '.hidden', 'SKILL.md'), skillMarkdown('hidden', 'nope'))
    await mkdir(join(root, 'no-skill-here'))
    const report = await discover([flatRoot(root)])
    expect(report.skills.map(skill => skill.name)).toEqual(['alpha', 'beta'])
    expect(report.invalid).toEqual([])
    expect(report.complete).toBe(true)
    const alpha = report.skills[0]!
    expect(alpha.directory).toBe(join(root, 'alpha'))
    expect(alpha.path).toBe(join(root, 'alpha', 'SKILL.md'))
    expect(report.skills[1]!.directory).toBe(root)
  })

  it('does not descend into nested directories for flat roots', async () => {
    const root = await tempDir()
    await writeSkill(join(root, 'group'), 'deep')
    const report = await discover([flatRoot(root)])
    expect(report.skills).toEqual([])
  })

  it('reports absent roots as non-existent without failing', async () => {
    const root = await tempDir()
    const report = await discover([flatRoot(join(root, 'missing'))])
    expect(report.roots).toEqual([{ root: expect.anything(), exists: false, count: 0 }])
    expect(report.complete).toBe(true)
  })

  it('records invalid files with a reason and keeps going', async () => {
    const root = await tempDir()
    await writeSkill(root, 'good')
    await mkdir(join(root, 'bad'))
    await writeFile(join(root, 'bad', 'SKILL.md'), '---\nname: [\n---\n')
    const report = await discover([flatRoot(root)])
    expect(report.skills.map(skill => skill.name)).toEqual(['good'])
    expect(report.invalid).toHaveLength(1)
    expect(report.invalid[0]!.reason).toMatch(/invalid YAML/)
  })

  it('attaches origin, root and relative path to metadata', async () => {
    const root = await tempDir()
    await writeSkill(root, 'alpha', 'A', { frontmatter: { license: 'MIT' } })
    const report = await discover([flatRoot(root, 100, 'claude-code')])
    expect(report.skills[0]!.metadata).toEqual({
      license: 'MIT',
      skillsAnywhere: {
        origin: { kind: 'agent', agent: 'claude-code', scope: 'user' },
        root,
        relativePath: 'alpha/SKILL.md',
      },
    })
  })

  it('records repair warnings in metadata', async () => {
    const root = await tempDir()
    await mkdir(join(root, 'Needs Fix'))
    await writeFile(join(root, 'Needs Fix', 'SKILL.md'), '---\ndescription: d\n---\nbody')
    const report = await discover([flatRoot(root)])
    expect(report.skills[0]!.name).toBe('needs-fix')
    expect((report.skills[0]!.metadata.skillsAnywhere as { warnings: string[] }).warnings).toHaveLength(1)
  })

  it('applies strict parsing when lenient is false', async () => {
    const root = await tempDir()
    await mkdir(join(root, 'nameless'))
    await writeFile(join(root, 'nameless', 'SKILL.md'), '---\ndescription: d\n---\nbody')
    const report = await discover([flatRoot(root)], { lenient: false })
    expect(report.skills).toEqual([])
    expect(report.invalid[0]!.reason).toBe('frontmatter requires name')
  })
})

describe('discover (nested roots)', () => {
  it('walks to the depth limit, treats skill directories as leaves, and skips node_modules/.git', async () => {
    const root = await tempDir()
    await writeSkill(join(root, 'skills'), 'one')
    await writeSkill(join(root, 'plugins', 'p1', 'skills'), 'two')
    await writeSkill(join(root, 'skills', 'one', 'nested-inside-skill'), 'never')
    await writeSkill(join(root, 'node_modules', 'pkg', 'skills'), 'ignored')
    await writeSkill(join(root, '.git', 'skills'), 'ignored-too')
    await writeSkill(join(root, 'a', 'b', 'c', 'd', 'e', 'f'), 'too-deep')
    const report = await discover([nestedRoot(root, 100, 5)])
    expect(report.skills.map(skill => skill.name).toSorted()).toEqual(['one', 'two'])
  })

  it('treats a SKILL.md at the root itself as a skill only when depth allows', async () => {
    const root = await tempDir()
    await writeFile(join(root, 'SKILL.md'), skillMarkdown('root-skill', 'x'))
    const report = await discover([nestedRoot(root)])
    // depth 0 is the root: a repository that *is* a single skill is not a skill collection
    expect(report.skills).toEqual([])
  })

  it('fills marketplace and plugin names for Claude Code plugin roots', async () => {
    const root = await tempDir()
    await writeSkill(join(root, 'official', 'plugins', 'hookify', 'skills'), 'writing-rules')
    await writeSkill(join(root, 'official', 'external_plugins', 'imessage', 'skills'), 'configure')
    await writeSkill(join(root, 'cache-market', 'my-plugin', '1.2.3', 'skills'), 'from-cache')
    const claudeRoot: SkillRoot = { path: root, source: 'anywhere-claude-plugins', rank: 580, mode: 'nested', maxDepth: 7, origin: { kind: 'claude-plugins' }, label: 'claude' }
    const report = await discover([claudeRoot])
    const byName = Object.fromEntries(report.skills.map(skill => [skill.name, skill.origin]))
    expect(byName['writing-rules']).toEqual({ kind: 'claude-plugins', marketplace: 'official', plugin: 'hookify' })
    expect(byName.configure).toEqual({ kind: 'claude-plugins', marketplace: 'official', plugin: 'imessage' })
    expect(byName['from-cache']).toEqual({ kind: 'claude-plugins', marketplace: 'cache-market', plugin: 'my-plugin' })
  })

  it('does not loop on symlink cycles', async () => {
    const root = await tempDir()
    await writeSkill(join(root, 'skills'), 'one')
    await symlink(root, join(root, 'loop'))
    const report = await discover([nestedRoot(root, 100, 6)])
    expect(report.skills.map(skill => skill.name)).toEqual(['one'])
  })
})

describe('discover (precedence and deduplication)', () => {
  it('lower rank wins the same file reached through a symlink', async () => {
    const canonical = await tempDir('canonical')
    const linked = await tempDir('linked')
    await writeSkill(canonical, 'shared')
    await symlink(join(canonical, 'shared'), join(linked, 'shared'))
    const report = await discover([flatRoot(linked, 200, 'cursor'), flatRoot(canonical, 100, 'claude-code')])
    expect(report.skills).toHaveLength(1)
    expect(report.skills[0]!.origin.agent).toBe('claude-code')
    expect(report.dropped).toHaveLength(1)
    expect(report.dropped[0]!.reason).toBe('same-file')
    expect(report.dropped[0]!.skill.origin.agent).toBe('cursor')
  })

  it('collapses byte-identical copies under the same name but keeps different content', async () => {
    const a = await tempDir('a')
    const b = await tempDir('b')
    await writeSkill(a, 'copy', 'same', { body: 'same body' })
    await writeSkill(b, 'copy', 'same', { body: 'same body' })
    await writeSkill(a, 'diff', 'one', { body: 'body one' })
    await writeSkill(b, 'diff', 'two', { body: 'body two' })
    const report = await discover([flatRoot(a, 100), flatRoot(b, 200)])
    expect(report.skills.map(skill => [skill.name, skill.rank])).toEqual([['copy', 100], ['diff', 100], ['flat-diff', 200]])
    expect(report.dropped.map(entry => entry.reason)).toEqual(['same-content'])
  })

  it('keeps every copy when dedupe is off', async () => {
    const a = await tempDir('a')
    const b = await tempDir('b')
    await writeSkill(a, 'copy', 'same', { body: 'same body' })
    await writeSkill(b, 'copy', 'same', { body: 'same body' })
    const report = await discover([flatRoot(a, 100), flatRoot(b, 200)], { dedupe: false })
    expect(report.skills).toHaveLength(2)
  })

  it('drops excluded names and reports them', async () => {
    const root = await tempDir()
    await writeSkill(root, 'keep')
    await writeSkill(root, 'hide')
    const report = await discover([flatRoot(root)], { excludeSkills: ['hide'] })
    expect(report.skills.map(skill => skill.name)).toEqual(['keep'])
    expect(report.dropped[0]).toMatchObject({ reason: 'excluded' })
  })

  it('orders by rank, then root order, then path', async () => {
    const a = await tempDir('a')
    const b = await tempDir('b')
    await writeSkill(a, 'zed', 'a')
    await writeSkill(b, 'alpha', 'b')
    const report = await discover([flatRoot(a, 100), flatRoot(b, 100)])
    expect(report.skills.map(skill => skill.name)).toEqual(['zed', 'alpha'])
  })

  it('stops when the signal aborts', async () => {
    const root = await tempDir()
    await writeSkill(root, 'one')
    const controller = new AbortController()
    controller.abort()
    await expect(discover([flatRoot(root)], { signal: controller.signal })).rejects.toThrow()
  })
})

describe('discover (name collisions)', () => {
  it('keeps the winner\'s name and prefixes colliding skills with their plugin, repo, or agent', async () => {
    const market = await tempDir('market')
    await writeSkill(join(market, 'official', 'external_plugins', 'discord', 'skills'), 'configure', 'discord', { body: 'discord body' })
    await writeSkill(join(market, 'official', 'external_plugins', 'imessage', 'skills'), 'configure', 'imessage', { body: 'imessage body' })
    await writeSkill(join(market, 'official', 'external_plugins', 'telegram', 'skills'), 'configure', 'telegram', { body: 'telegram body' })
    const repo = await tempDir('repo')
    await writeSkill(join(repo, 'skills'), 'configure', 'repo', { body: 'repo body' })
    const agent = await tempDir('agent')
    await writeSkill(agent, 'configure', 'agent', { body: 'agent body' })

    const claudeRoot: SkillRoot = { path: market, source: 's', rank: 580, mode: 'nested', maxDepth: 7, origin: { kind: 'claude-plugins' }, label: 'claude' }
    const repoRoot: SkillRoot = { path: repo, source: 's', rank: 700, mode: 'nested', origin: { kind: 'source', repo: 'anthropics/skills' }, label: 'repo' }
    const report = await discover([flatRoot(agent, 550, 'codex'), claudeRoot, repoRoot])
    expect(report.skills.map(skill => skill.name)).toEqual([
      'configure', 'discord-configure', 'imessage-configure', 'telegram-configure', 'skills-configure',
    ])
    expect(report.skills[0]!.origin.agent).toBe('codex')
    expect(report.skills[0]!.warnings).toEqual([])
    expect(report.skills[1]!.warnings[0]).toMatch(/published as "discord-configure"/)
    expect((report.skills[1]!.metadata.skillsAnywhere as { renamedFrom: string }).renamedFrom).toBe('configure')
    expect(report.dropped).toEqual([])
  })

  it('never renames onto an existing name', async () => {
    const a = await tempDir('a')
    const b = await tempDir('b')
    await writeSkill(a, 'build', 'one', { body: 'one' })
    await writeSkill(a, 'cursor-build', 'taken', { body: 'taken' })
    await writeSkill(b, 'build', 'two', { body: 'two' })
    const report = await discover([flatRoot(a, 100, 'claude-code'), flatRoot(b, 200, 'cursor')])
    expect(report.skills.map(skill => skill.name)).toEqual(['build', 'cursor-build', 'cursor-build-2'])
  })
})

describe('findProjectRoot', () => {
  it('returns the nearest ancestor with .git, else the cwd', async () => {
    const project = await tempDir('project')
    await mkdir(join(project, '.git'))
    const deep = join(project, 'src', 'lib')
    await mkdir(deep, { recursive: true })
    expect(await findProjectRoot(deep)).toBe(project)
    const loose = await tempDir('loose')
    expect(await findProjectRoot(loose)).toBe(loose)
  })
})
