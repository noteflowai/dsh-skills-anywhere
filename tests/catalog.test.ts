import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import * as Plugin from '../src/index.ts'
import * as Tools from '../src/tools.ts'
import { resolveConfig } from '../src/config.ts'
import { applyCatalogBudget, SkillsAnywhereProvider } from '../src/provider.ts'
import { searchSkills, queryTerms, isOpenable } from '../src/tools.ts'
import { quietLogger, tempDir, writeSkill } from './helpers.ts'

const signal = new AbortController().signal

async function fixture(): Promise<{ home: string; project: string }> {
  const home = await tempDir('cat-home')
  const project = await tempDir('cat-project')
  await mkdir(join(project, '.git'))
  return { home, project }
}

async function mount(home: string, config: Partial<Plugin.ConfigInput> = {}, tools: Tools.Config = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(Plugin, { home, dshHome: join(home, '.dsh'), watch: false, sync: false, ...config })
  await ctx.plugin(Tools, tools)
  return ctx
}

function agentFor(cwd: string): Agent {
  return { session: { header: { cwd } } } as unknown as Agent
}

async function call(ctx: Context, name: string, args: unknown, cwd: string) {
  return ctx.tools.execute({ callId: ToolCallId(`call-${name}-${Math.random()}`), name, arguments: args, agent: agentFor(cwd), signal })
}

function textOf(result: { content: unknown }): string {
  return (result.content as { type: string; text?: string }[]).map(block => block.text ?? '').join('\n')
}

const budgetSkill = (name: string, modelInvocable = true) => ({
  name, invocation: { modelInvocable, userInvocable: true },
}) as unknown as Parameters<typeof applyCatalogBudget>[0][number]

const summary = (name: string, description: string, modelInvocable = true) => ({
  name, description, invocation: { modelInvocable, userInvocable: true }, source: 'anywhere-user', provider: 'skills-anywhere',
}) as unknown as import('@deepseek-ai/dsh-skill').SkillSummary

describe('applyCatalogBudget', () => {
  const skill = budgetSkill

  it('keeps the first `limit` eligible skills visible and hides the rest', () => {
    const states = applyCatalogBudget([skill('a'), skill('b'), skill('c')], { limit: 2, pin: new Set(), hide: new Set() })
    expect([...states]).toEqual([['a', 'visible'], ['b', 'visible'], ['c', 'hidden']])
  })

  it('pins jump the queue, hides never show, author-disabled never count', () => {
    const states = applyCatalogBudget(
      [skill('off', false), skill('a'), skill('b'), skill('c'), skill('d')],
      { limit: 2, pin: new Set(['d']), hide: new Set(['a']) },
    )
    expect(states.get('off')).toBe('disabled')
    expect(states.get('a')).toBe('hidden')
    expect(states.get('d')).toBe('visible')
    expect(states.get('b')).toBe('visible')
    expect(states.get('c')).toBe('hidden')
  })

  it('limit 0 means unlimited', () => {
    const states = applyCatalogBudget([skill('a'), skill('b')], { limit: 0, pin: new Set(), hide: new Set() })
    expect([...states.values()]).toEqual(['visible', 'visible'])
  })
})

describe('provider catalog budget', () => {
  it('publishes hidden skills as not model-invocable but still user-invocable, with catalog metadata', async () => {
    const { home, project } = await fixture()
    const root = join(home, '.codex', 'skills')
    for (const name of ['alpha', 'beta', 'gamma']) await writeSkill(root, name)
    await writeSkill(root, 'author-off', 'off', { frontmatter: { 'disable-model-invocation': 'true' } })
    const provider = new SkillsAnywhereProvider(resolveConfig({ home, watch: false, sync: false, catalog: { limit: 2 } }), quietLogger())
    const result = await provider.list({ cwd: project })
    const list = Array.isArray(result) ? result : result.candidates
    expect(list.map(skill => [skill.name, skill.invocation.modelInvocable, skill.invocation.userInvocable])).toEqual([
      ['alpha', true, true], ['author-off', false, true], ['beta', true, true], ['gamma', false, true],
    ])
    const gamma = list.find(skill => skill.name === 'gamma')!
    expect((gamma.metadata!.skillsAnywhere as { catalog: string; authorInvocation: unknown }).catalog).toBe('hidden')
    expect((gamma.metadata!.skillsAnywhere as { authorInvocation: { modelInvocable: boolean } }).authorInvocation.modelInvocable).toBe(true)
    expect(await provider.catalogState('gamma', project)).toBe('hidden')
    expect(await provider.catalogState('author-off', project)).toBe('disabled')
    expect(await provider.catalogState('alpha', project)).toBe('visible')
    const definition = await provider.get(gamma, {})
    expect(definition?.invocation.modelInvocable).toBe(false)
    expect(isOpenable(definition!)).toBe(true)
    await provider.dispose()
  })
})

describe('searchSkills', () => {
  it('tokenises queries', () => {
    expect(queryTerms('PDF forms, pdf!')).toEqual(['pdf', 'forms'])
    expect(queryTerms('a')).toEqual([])
  })

  it('ranks name matches above description matches and drops non-matches', () => {
    const skills = [
      summary('pdf-processing', 'Extract text from PDF files'),
      summary('docx', 'Work with Word documents, convert to pdf'),
      summary('unrelated', 'Nothing here'),
    ]
    const matches = searchSkills(skills, 'pdf', 10)
    expect(matches.map(match => match.name)).toEqual(['pdf-processing', 'docx'])
    expect(matches[0]!.score).toBeGreaterThan(matches[1]!.score)
  })

  it('rewards covering more query terms and respects the limit', () => {
    const skills = [summary('react-testing', 'Test React components'), summary('react', 'React basics'), summary('testing', 'General testing')]
    const matches = searchSkills(skills, 'react testing', 2)
    expect(matches.map(match => match.name)).toEqual(['react-testing', 'react'])
  })
})

describe('find_skills and open_skill tools', () => {
  it('registers both tools and lets the model reach skills outside the budget', async () => {
    const { home, project } = await fixture()
    const root = join(home, '.codex', 'skills')
    await writeSkill(root, 'alpha-pdf', 'Handle PDF files', { body: 'alpha body' })
    await writeSkill(root, 'beta-docx', 'Handle Word files', { body: 'beta body' })
    await writeSkill(root, 'gamma-pdf', 'Fill PDF forms', { body: 'gamma body' })
    await writeSkill(root, 'delta-off', 'Author disabled', { body: 'delta body', frontmatter: { 'disable-model-invocation': 'true' } })
    const ctx = await mount(home, { catalog: { limit: 1 } })
    expect(ctx.tools.schemas().map(tool => tool.name).toSorted()).toEqual(['find_skills', 'open_skill'])

    const found = await call(ctx, 'find_skills', { query: 'pdf forms' }, project)
    expect(found.isError).toBe(false)
    const text = textOf(found)
    expect(text).toContain('gamma-pdf')
    expect(text).toContain('alpha-pdf')
    expect(text).toContain('not in catalog')
    expect(text).not.toContain('beta-docx')

    const opened = await call(ctx, 'open_skill', { name: 'gamma-pdf' }, project)
    expect(opened.isError).toBe(false)
    expect(textOf(opened)).toContain('gamma body')
    expect(textOf(opened)).toContain('<skill_content name="gamma-pdf">')

    const listed = await call(ctx, 'open_skill', { name: 'alpha-pdf' }, project)
    expect(listed.isError).toBe(false)

    const refused = await call(ctx, 'open_skill', { name: 'delta-off' }, project)
    expect(refused.isError).toBe(true)
    expect(textOf(refused)).toContain('not available for model invocation')

    const unknown = await call(ctx, 'open_skill', { name: 'nope' }, project)
    expect(unknown.isError).toBe(true)
    const invalid = await call(ctx, 'open_skill', { name: 'Bad Name' }, project)
    expect(invalid.isError).toBe(true)
    const empty = await call(ctx, 'find_skills', { query: '   ' }, project)
    expect(empty.isError).toBe(true)
    const none = await call(ctx, 'find_skills', { query: 'zzzz' }, project)
    expect(none.isError).toBe(false)
    expect(textOf(none)).toContain('No skills matched')
    await ctx.fiber.dispose()
  })

  it('can register only one of the tools', async () => {
    const { home } = await fixture()
    const ctx = await mount(home, {}, { open: false })
    expect(ctx.tools.schemas().map(tool => tool.name)).toEqual(['find_skills'])
    await ctx.fiber.dispose()
  })
})
