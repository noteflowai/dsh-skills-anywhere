/**
 * Behavioral tests for `route prepare` / `route apply`.
 *
 * Every decider response in this file is a hand-written SYNTHETIC fixture
 * (model: "synthetic-fixture"). They exercise parsing and policy only and say
 * nothing about the accuracy or calibration of any real model.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { main } from '../src/cli.ts'
import { isSkillName } from '../src/frontmatter.ts'
import { isOpenable, NO_MATCH } from '../src/route.ts'
import { tempDir, writeSkill } from './helpers.ts'

interface RouteRequestJson {
  schema: string
  task: string
  noMatch: string
  tool: { name: string; version: string | null }
  candidates: { id: string; description: string; origin: string; path: string; contentHash: string }[]
  question: { type: string; instructions: string; criteria: Record<string, string> }
}

interface RouteResultJson {
  schema: string
  outcome: string
  choice: string | null
  confidence: number | null
  threshold: number
  model: string | null
  skill: { name: string; origin: string; path: string } | null
  reason: string
  hint: string
}

let home: string
let project: string
let work: string
let out: string[]
let err: string[]
let counter = 0
const savedEnv = { HOME: process.env.HOME, DSH_HOME: process.env.DSH_HOME }

beforeEach(async () => {
  home = await tempDir('route-home')
  project = await tempDir('route-project')
  work = await tempDir('route-work')
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

async function prepare(task: string): Promise<{ file: string; request: RouteRequestJson }> {
  out.length = 0
  expect(await run('route', 'prepare', task, '--json')).toBe(0)
  const text = out.join('\n')
  out.length = 0
  const file = join(work, `request-${counter++}.json`)
  await writeFile(file, text)
  return { file, request: JSON.parse(text) as RouteRequestJson }
}

async function writeResponse(content: unknown, raw = false): Promise<string> {
  const file = join(work, `response-${counter++}.json`)
  await writeFile(file, raw ? String(content) : JSON.stringify(content))
  return file
}

async function apply(requestFile: string, responseFile: string, ...extra: string[]): Promise<{ code: number; result: RouteResultJson; text: string }> {
  out.length = 0
  const code = await run('route', 'apply', '--request', requestFile, '--response', responseFile, '--json', ...extra)
  const text = out.join('\n')
  out.length = 0
  return { code, result: JSON.parse(text) as RouteResultJson, text }
}

async function applyResponse(requestFile: string, content: unknown, ...extra: string[]): Promise<{ code: number; result: RouteResultJson; text: string }> {
  return apply(requestFile, await writeResponse(content), ...extra)
}

describe('route prepare', () => {
  it('shortlists up to 8 openable skills in rank order, filtering before the cap', async () => {
    const claude = join(home, '.claude', 'skills')
    // Best keyword match, but its author disabled model invocation.
    await writeSkill(claude, 'pdf-forms-filler', 'Fill pdf forms', { frontmatter: { 'disable-model-invocation': true } })
    for (const letter of 'abcdefghi') await writeSkill(claude, `pdf-tool-${letter}`, 'Pdf helper')
    await writeSkill(claude, 'chart-drawing', 'Draws charts')

    const { request } = await prepare('fill pdf forms')
    expect(request.schema).toBe('skills-anywhere-route-request-1')
    expect(request.task).toBe('fill pdf forms')
    expect(request.noMatch).toBe('_none')
    expect(request.tool.name).toBe('dsh-skills-anywhere')
    const ids = request.candidates.map(candidate => candidate.id)
    // 9 openable matches: cap-then-filter would leave 7; filter-then-cap keeps 8.
    expect(ids).toEqual(['pdf-tool-a', 'pdf-tool-b', 'pdf-tool-c', 'pdf-tool-d', 'pdf-tool-e', 'pdf-tool-f', 'pdf-tool-g', 'pdf-tool-h'])
    expect(ids).not.toContain('pdf-forms-filler')
    for (const candidate of request.candidates) {
      expect(candidate.description).toBe('Pdf helper')
      expect(candidate.origin).toBe('claude-code (user)')
      expect(candidate.path.endsWith(join(candidate.id, 'SKILL.md'))).toBe(true)
      expect(typeof candidate.contentHash).toBe('string')
      expect(candidate.contentHash.length).toBeGreaterThan(0)
    }
    expect(request.question.type).toBe('choice')
    expect(Object.keys(request.question.criteria)).toEqual([...ids, '_none'])
    expect(request.question.criteria._none).toBe('No listed skill fits this task')

    out.length = 0
    expect(await run('route', 'prepare', 'fill pdf forms')).toBe(0)
    const text = out.join('\n')
    expect(text).toContain('pdf-tool-a')
    expect(text).not.toContain('pdf-forms-filler')
    expect(text).toContain('route apply')
  })

  it('exits 2 with a hint for an empty task, no openable match, or an unknown option', async () => {
    const claude = join(home, '.claude', 'skills')
    await writeSkill(claude, 'pdf-forms-filler', 'Fill pdf forms', { frontmatter: { 'disable-model-invocation': true } })
    await writeSkill(claude, 'chart-drawing', 'Draws charts')

    expect(await run('route', 'prepare', '   ')).toBe(2)
    expect(err.join('\n')).toContain('keywords')
    err.length = 0
    expect(await run('route', 'prepare', 'quantum teleportation')).toBe(2)
    expect(err.join('\n')).toContain('other keywords')
    err.length = 0
    // Only the author-disabled skill matches.
    expect(await run('route', 'prepare', 'forms filler')).toBe(2)
    expect(err.join('\n')).toContain('other keywords')
    expect(await run('route', 'prepare', 'charts', '--limit', '3')).toBe(2)
    expect(await run('route', 'prepare', 'charts', '--min-confidence', '0.5')).toBe(2)
    expect(await run('route', 'bogus')).toBe(2)
    expect(out).toEqual([])
  })
})

describe('route apply', () => {
  it('reports selected, abstain and no_match with the documented exit codes', async () => {
    const claude = join(home, '.claude', 'skills')
    await writeSkill(claude, 'pdf-forms', 'Fill pdf forms')
    await writeSkill(claude, 'none', 'Pdf fallback when nothing else fits')
    const { file, request } = await prepare('pdf forms')
    const ids = request.candidates.map(candidate => candidate.id)
    expect(ids).toContain('pdf-forms')
    expect(ids).toContain('none')

    let r = await applyResponse(file, { choice: 'pdf-forms', confidence: 0.9, model: 'synthetic-fixture', secret: 'do-not-echo' })
    expect(r.code).toBe(0)
    expect(r.result).toMatchObject({
      schema: 'skills-anywhere-route-result-1', outcome: 'selected', choice: 'pdf-forms', confidence: 0.9, threshold: 0.7,
      model: 'synthetic-fixture', skill: { name: 'pdf-forms', origin: 'claude-code (user)' },
    })
    expect(r.result.skill?.path).toBe(request.candidates.find(candidate => candidate.id === 'pdf-forms')?.path)
    expect(r.text).not.toContain('do-not-echo')

    r = await applyResponse(file, { choice: 'pdf-forms', confidence: 0.55, model: 'synthetic-fixture' })
    expect(r.code).toBe(0)
    expect(r.result).toMatchObject({ outcome: 'abstain', confidence: 0.55, skill: null })

    r = await applyResponse(file, { choice: 'pdf-forms', model: 'synthetic-fixture' })
    expect(r.code).toBe(0)
    expect(r.result).toMatchObject({ outcome: 'abstain', confidence: null, skill: null })

    r = await applyResponse(file, { choice: '_none', confidence: 0.9, model: 'synthetic-fixture' })
    expect(r.code).toBe(0)
    expect(r.result).toMatchObject({ outcome: 'no_match', choice: '_none', skill: null })

    r = await applyResponse(file, { choice: '_none', confidence: 0.3, model: 'synthetic-fixture' })
    expect(r.result.outcome).toBe('abstain')

    // A real skill named "none" is an ordinary candidate.
    r = await applyResponse(file, { choice: 'none', confidence: 0.9, model: 'synthetic-fixture' })
    expect(r.code).toBe(0)
    expect(r.result).toMatchObject({ outcome: 'selected', skill: { name: 'none' } })

    r = await applyResponse(file, { choice: 'pdf-forms', confidence: 0.55 }, '--min-confidence', '0.5')
    expect(r.result).toMatchObject({ outcome: 'selected', threshold: 0.5 })

    const response = await writeResponse({ choice: 'pdf-forms', confidence: 0.9, model: 'synthetic-fixture' })
    out.length = 0
    expect(await run('route', 'apply', '--request', file, '--response', response)).toBe(0)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatch(/^SELECTED "pdf-forms" from "claude-code \(user\)" at ".*SKILL\.md" \(confidence 0\.9 meets the threshold 0\.7\) — /)
  })

  it('keeps the no-match id outside the skill grammar, the dsh runtime out of the module, and matches open_skill', async () => {
    expect(NO_MATCH).toBe('_none')
    expect(isSkillName('_none')).toBe(false)
    const source = await readFile(new URL('../src/route.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('@deepseek-ai')

    const tools = await import('../src/tools.ts') as Record<string, unknown>
    const reference = tools.isOpenable as ((skill: unknown) => boolean) | undefined
    expect(typeof reference).toBe('function')
    const cases = [
      { name: 'enabled', description: 'd', invocation: { modelInvocable: true, userInvocable: true }, metadata: {} },
      { name: 'author-off', description: 'd', invocation: { modelInvocable: false, userInvocable: true },
        metadata: { skillsAnywhere: { authorInvocation: { modelInvocable: false, userInvocable: true } } } },
      { name: 'budget-hidden', description: 'd', invocation: { modelInvocable: false, userInvocable: true },
        metadata: { skillsAnywhere: { catalog: 'hidden', authorInvocation: { modelInvocable: true, userInvocable: true } } } },
      { name: 'hidden-and-author-off', description: 'd', invocation: { modelInvocable: false, userInvocable: true },
        metadata: { skillsAnywhere: { catalog: 'hidden', authorInvocation: { modelInvocable: false, userInvocable: true } } } },
    ]
    expect(cases.map(skill => isOpenable(skill))).toEqual([true, false, true, false])
    for (const skill of cases) expect(isOpenable(skill)).toBe(reference!(skill))
  })

  it('exits 2 for invalid responses, requests and thresholds', async () => {
    await writeSkill(join(home, '.claude', 'skills'), 'pdf-forms', 'Fill pdf forms')
    const { file, request } = await prepare('pdf forms')

    const invalid: unknown[] = [
      { choice: 'not-listed', confidence: 0.9 },
      { choice: 42, confidence: 0.9 },
      { confidence: 0.9 },
      { choice: 'pdf-forms', confidence: 'high' },
      { choice: 'pdf-forms', confidence: 1.7 },
      { choice: 'pdf-forms', confidence: -1 },
      { choice: 'pdf-forms', confidence: null },
      ['pdf-forms'],
      'pdf-forms',
    ]
    for (const content of invalid) {
      const r = await applyResponse(file, content)
      expect(r.code, JSON.stringify(content)).toBe(2)
      expect(r.result.outcome).toBe('invalid_input')
      expect(r.result.skill).toBeNull()
    }

    let r = await apply(file, await writeResponse('{"choice": "pdf-forms",', true))
    expect(r.code).toBe(2)
    expect(r.result.outcome).toBe('invalid_input')

    const good = await writeResponse({ choice: 'pdf-forms', confidence: 0.9, model: 'synthetic-fixture' })
    const wrongSchema = join(work, 'wrong-schema.json')
    await writeFile(wrongSchema, JSON.stringify({ ...request, schema: 'skills-anywhere-route-request-0' }))
    r = await apply(wrongSchema, good)
    expect(r.code).toBe(2)
    expect(r.result.outcome).toBe('invalid_input')

    const notJson = join(work, 'not-json.json')
    await writeFile(notJson, 'not json')
    r = await apply(notJson, good)
    expect(r.code).toBe(2)
    expect(r.result.outcome).toBe('invalid_input')

    r = await apply(join(work, 'missing.json'), good)
    expect(r.code).toBe(2)
    expect(r.result.outcome).toBe('invalid_input')

    out.length = 0
    expect(await run('route', 'apply', '--request', file, '--response', await writeResponse({ choice: 'elsewhere', confidence: 0.9 }))).toBe(2)
    expect(out[0]).toMatch(/^INVALID_INPUT response choice "elsewhere" is not one of the request's options — /)

    // Usage errors: no result document is printed.
    out.length = 0
    expect(await main(['--cwd', project, 'route', 'apply', '--request', file, '--response', good, '--min-confidence'])).toBe(2)
    expect(out).toEqual([])
    for (const value of ['abc', '1.2', '']) {
      err.length = 0
      expect(await run('route', 'apply', '--request', file, '--response', good, '--min-confidence', value)).toBe(2)
      expect(out).toEqual([])
      expect(err.join('\n')).toContain('--min-confidence')
    }
    err.length = 0
    expect(await run('route', 'apply', '--request', file)).toBe(2)
    expect(await run('list', '--request', file)).toBe(2)
    expect(err.join('\n')).toContain('only available for route apply')
  })

  const staleCases: [string, () => Promise<unknown>, RegExp][] = [
    ['deleted', () => rm(join(home, '.codex', 'skills', 'pdf-forms'), { recursive: true, force: true }), /no longer discovered/],
    ['author-disabled', () => writeSkill(join(home, '.codex', 'skills'), 'pdf-forms', 'Fill pdf forms', {
      frontmatter: { 'disable-model-invocation': true }, body: 'Original instructions.',
    }), /no longer openable/],
    ['edited', () => writeSkill(join(home, '.codex', 'skills'), 'pdf-forms', 'Fill pdf forms', { body: 'Changed instructions.' }), /content changed/],
    ['shadowed by a higher-precedence origin', () => writeSkill(join(project, '.claude', 'skills'), 'pdf-forms', 'Fill pdf forms', {
      body: 'Project instructions.',
    }), /different SKILL\.md/],
  ]

  it.each(staleCases)('reports stale (exit 1) when the chosen skill was %s after prepare', async (_label, mutate, reason) => {
    await writeSkill(join(home, '.codex', 'skills'), 'pdf-forms', 'Fill pdf forms', { body: 'Original instructions.' })
    const { file } = await prepare('pdf forms')
    const response = await writeResponse({ choice: 'pdf-forms', confidence: 0.9, model: 'synthetic-fixture' })

    const before = await apply(file, response)
    expect(before.code).toBe(0)
    expect(before.result.outcome).toBe('selected')

    await mutate()
    const after = await apply(file, response)
    expect(after.code).toBe(1)
    expect(after.result.outcome).toBe('stale')
    expect(after.result.skill).toBeNull()
    expect(after.result.reason).toMatch(reason)

    out.length = 0
    expect(await run('route', 'apply', '--request', file, '--response', response)).toBe(1)
    expect(out[0]).toMatch(/^STALE "pdf-forms" /)
  })
})
