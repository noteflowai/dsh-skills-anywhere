import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { main } from '../src/cli.ts'
import { makeSkillRepo, tempDir, writeSkill } from './helpers.ts'

let home: string
let project: string
let out: string[]
let err: string[]
const savedEnv = { HOME: process.env.HOME, DSH_HOME: process.env.DSH_HOME }

beforeEach(async () => {
  home = await tempDir('cli-home')
  project = await tempDir('cli-project')
  await mkdir(join(project, '.git'))
  process.env.HOME = home
  process.env.DSH_HOME = join(home, '.dsh')
  out = []
  err = []
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { out.push(args.map(String).join(' ')) })
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { err.push(args.map(String).join(' ')) })
})

afterEach(() => {
  vi.restoreAllMocks()
  process.env.HOME = savedEnv.HOME
  if (savedEnv.DSH_HOME === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = savedEnv.DSH_HOME
})

function run(...args: string[]): Promise<number> {
  return main([...args, '--cwd', project])
}

function json<T = unknown>(): T {
  return JSON.parse(out.join('\n')) as T
}

describe('cli', () => {
  it('prints help and rejects unknown commands', async () => {
    expect(await main(['--help'])).toBe(0)
    expect(out.join('\n')).toContain('Usage: dsh-skills-anywhere')
    expect(out.join('\n')).toContain('mcp ')
    out.length = 0
    expect(await main(['bogus'])).toBe(2)
    expect(err.join('\n')).toContain('unknown command')
    expect(await main(['--not-an-option'])).toBe(2)
  })

  it('list shows skills from other agents with their origin', async () => {
    await writeSkill(join(home, '.claude', 'skills'), 'from-claude')
    await writeSkill(join(project, '.claude', 'skills'), 'from-project')
    expect(await run('list')).toBe(0)
    const text = out.join('\n')
    expect(text).toContain('from-claude')
    expect(text).toContain('claude-code (user)')
    expect(text).toContain('claude-code (project)')
    expect(text).toContain('2 skills')
  })

  it('list --json is machine readable and --all includes duplicates', async () => {
    await writeSkill(join(home, '.claude', 'skills'), 'dup', 'same', { body: 'same' })
    await writeSkill(join(home, '.codex', 'skills'), 'dup', 'same', { body: 'same' })
    expect(await run('list', '--json', '--all')).toBe(0)
    const result = json<{ skills: { name: string }[]; dropped: { reason: string }[]; complete: boolean }>()
    expect(result.skills.map(skill => skill.name)).toEqual(['dup'])
    expect(result.dropped).toEqual([expect.objectContaining({ reason: 'same-content' })])
    expect(result.complete).toBe(true)
  })

  it('list hints at adding a source when nothing is found', async () => {
    expect(await run('list')).toBe(0)
    expect(out.join('\n')).toContain('No skills found')
  })

  it('agents lists the table and marks directories present here', async () => {
    await mkdir(join(home, '.codex', 'skills'), { recursive: true })
    expect(await run('agents', '--json')).toBe(0)
    const rows = json<{ id: string; present: boolean }[]>()
    expect(rows.length).toBeGreaterThan(50)
    expect(rows.find(row => row.id === 'codex')?.present).toBe(true)
    expect(rows.find(row => row.id === 'cursor')?.present).toBe(false)
    out.length = 0
    expect(await run('agents')).toBe(0)
    expect(out.join('\n')).toContain('OpenAI Codex')
  })

  it('add / sources / sync / remove manage the user sources file', async () => {
    const repo = await makeSkillRepo([{ path: 'skills/alpha', name: 'alpha' }, { path: 'skills/beta', name: 'beta' }])
    expect(await run('sources')).toBe(0)
    expect(out.join('\n')).toContain('No git sources configured')
    out.length = 0

    expect(await run('add', repo)).toBe(0)
    const text = out.join('\n')
    expect(text).toContain('added')
    expect(text).toContain('cloned')
    expect(text).toContain('2 skills available')
    const sourcesFile = JSON.parse(await readFile(join(home, '.dsh', 'skills-anywhere', 'sources.json'), 'utf8')) as { sources: unknown[] }
    expect(sourcesFile.sources).toEqual([{ repo }])
    out.length = 0

    expect(await run('add', repo)).toBe(0)
    expect(out.join('\n')).toContain('already in')
    out.length = 0

    expect(await run('sources', '--json')).toBe(0)
    const sources = json<{ display: string; lock: { sha: string } | null }[]>()
    expect(sources).toHaveLength(1)
    expect(sources[0]!.lock?.sha).toMatch(/^[0-9a-f]{40}$/)
    out.length = 0

    expect(await run('sync')).toBe(0)
    expect(out.join('\n')).toContain('unchanged')
    out.length = 0

    expect(await run('list')).toBe(0)
    expect(out.join('\n')).toContain('alpha')
    expect(out.join('\n')).toContain(`source ${repo}`)
    // Skills inside a source checkout are shown repo-relative; the FROM column already names the repo.
    expect(out.join('\n')).not.toMatch(/skills-anywhere[\\/]cache[\\/]/)
    expect(out.join('\n')).toMatch(/^alpha\s+source .+?\s+skills[\\/]alpha[\\/]SKILL\.md$/m)
    out.length = 0

    expect(await run('remove', repo)).toBe(0)
    expect(out.join('\n')).toContain('removed')
    expect(await run('remove', repo)).toBe(1)
  })

  it('add --project writes the project file and rejects garbage', async () => {
    const repo = await makeSkillRepo([{ path: 'x', name: 'x' }])
    expect(await run('add', repo, '--project', '--rank', '5')).toBe(0)
    const file = JSON.parse(await readFile(join(project, '.dsh', 'skills-anywhere.json'), 'utf8')) as { sources: unknown[] }
    expect(file.sources).toEqual([{ repo, rank: 5 }])
    expect(await run('add')).toBe(2)
    expect(await run('add', 'not-a-source')).toBe(2)
    expect(await run('remove')).toBe(2)
  })

  it('sync reports failures with a non-zero exit', async () => {
    expect(await run('add', '/definitely/not/a/repo')).toBe(1)
    out.length = 0
    expect(await run('sync', '--json')).toBe(1)
    const results = json<{ status: string }[]>()
    expect(results[0]!.status).toBe('failed')
    out.length = 0
    expect(await run('sync')).toBe(1)
  })

  it('doctor explains repairs, skips and duplicates', async () => {
    const claude = join(home, '.claude', 'skills')
    await mkdir(join(claude, 'Needs Repair'), { recursive: true })
    await (await import('node:fs/promises')).writeFile(join(claude, 'Needs Repair', 'SKILL.md'), '---\ndescription: d\n---\nbody')
    await mkdir(join(claude, 'broken'), { recursive: true })
    await (await import('node:fs/promises')).writeFile(join(claude, 'broken', 'SKILL.md'), '---\nname: [\n---\n')
    await writeSkill(claude, 'dup', 'same', { body: 'same' })
    await writeSkill(join(home, '.codex', 'skills'), 'dup', 'same', { body: 'same' })

    expect(await run('doctor')).toBe(0)
    const text = out.join('\n')
    expect(text).toContain('git: available')
    expect(text).toContain('Repaired frontmatter (1)')
    expect(text).toContain('needs-repair')
    expect(text).toContain('Skipped (1)')
    expect(text).toContain('Hidden duplicates (1)')
    out.length = 0

    expect(await run('doctor', '--json')).toBe(0)
    const report = json<{ git: boolean; repaired: unknown[]; renamed: unknown[]; invalid: unknown[]; dropped: unknown[] }>()
    expect(report.git).toBe(true)
    expect(report.repaired).toHaveLength(1)
    expect(report.renamed).toHaveLength(0)
    expect(report.invalid).toHaveLength(1)
    expect(report.dropped).toHaveLength(1)
  })
})
