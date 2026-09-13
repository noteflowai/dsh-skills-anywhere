import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { describe, expect, it } from 'vitest'
import * as Plugin from '../src/index.ts'
import { resolveConfig } from '../src/config.ts'
import { SkillsAnywhereProvider } from '../src/provider.ts'
import { handleReport, settingsEntry, SettingsSchema } from '../src/web.ts'
import { REPORT_PATH, SETTINGS_NAMESPACE, type CatalogSettings, type ReportView } from '../src/web-protocol.ts'
import { quietLogger, tempDir, writeSkill } from './helpers.ts'

/** Stand-in for `@deepseek-ai/dsh-settings`: one namespace, in-memory user layer, `installSection` semantics. */
class FakeSettings extends Service {
  readonly sections = new Map<string, { entry: unknown; hooks: { setSource(current: () => unknown): void; onChange(): void }; user: Record<string, unknown> }>()
  constructor(ctx: Context) {
    super(ctx, 'settings')
  }

  installSection<T>(_owner: Context, ns: string, _schema: unknown, entry: T, hooks: { setSource(current: () => T): void; onChange(): void }): void {
    const section = { entry, hooks: hooks as { setSource(current: () => unknown): void; onChange(): void }, user: {} as Record<string, unknown> }
    this.sections.set(ns, section)
    hooks.setSource(() => merge(entry, section.user) as T)
    hooks.onChange()
  }

  /** Simulate a committed user edit. */
  update(ns: string, patch: Record<string, unknown>): void {
    const section = this.sections.get(ns)
    if (section === undefined) throw new Error(`unknown namespace ${ns}`)
    section.user = merge(section.user, patch) as Record<string, unknown>
    section.hooks.onChange()
  }
}

function merge(base: unknown, patch: unknown): unknown {
  if (typeof base !== 'object' || base === null || Array.isArray(base) || typeof patch !== 'object' || patch === null || Array.isArray(patch)) return patch
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) out[key] = key in out ? merge(out[key], value) : value
  return out
}

interface FetchRoute {
  readonly path: string
  readonly methods: readonly string[]
  readonly requestBody: string
  readonly fetch: (request: Request) => Promise<Response>
}

/** Stand-in for `ctx.connection`: records exact Fetch routes registered below `/api`. */
class FakeConnection extends Service {
  readonly routes = new Map<string, FetchRoute>()
  constructor(ctx: Context) {
    super(ctx, 'connection')
  }

  get fetch() {
    return {
      register: (route: FetchRoute) => {
        if (this.routes.has(route.path)) throw new Error(`route ${route.path} already registered`)
        this.routes.set(route.path, route)
        return async () => { this.routes.delete(route.path) }
      },
    }
  }

  async post(path: string, body: unknown): Promise<unknown> {
    const route = this.routes.get(path)
    if (route === undefined) throw new Error(`no route ${path}`)
    const response = await route.fetch(new Request(`http://127.0.0.1${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
    return response.json()
  }
}

async function fixture(): Promise<{ home: string; project: string }> {
  const home = await tempDir('home')
  const project = await tempDir('project')
  return { home, project }
}

describe('web integration', () => {
  it('SettingsSchema fills defaults and settingsEntry mirrors the resolved config', () => {
    const parsed = (SettingsSchema as unknown as (value: unknown) => CatalogSettings)({})
    expect(parsed).toEqual({ catalog: { limit: 50, pin: [], hide: [] }, excludeSkills: [] })
    const entry = settingsEntry(resolveConfig({ catalog: { limit: 3, pin: ['a'], hide: ['b'] }, excludeSkills: ['c'] }))
    expect(entry).toEqual({ catalog: { limit: 3, pin: ['a'], hide: ['b'] }, excludeSkills: ['c'] })
  })

  it('handleReport serves the provider snapshot and reports a missing provider as a failure', async () => {
    const { home, project } = await fixture()
    await writeSkill(join(home, '.codex', 'skills'), 'alpha', 'Alpha')
    const provider = new SkillsAnywhereProvider(resolveConfig({ home, dshHome: join(home, '.dsh'), watch: false, sync: false }), quietLogger())
    const ok = await handleReport(provider, { cwd: project })
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.value.skills.map(skill => skill.name)).toEqual(['alpha'])
    const junk = await handleReport(provider, 'not an object')
    expect(junk.ok).toBe(true)
    const missing = await handleReport(undefined, {})
    expect(missing).toMatchObject({ ok: false, error: { code: 'skills-anywhere/not-ready' } })
    await provider.dispose()
  })

  it('registers the settings namespace and the report endpoint when the services exist, and applies edits live', async () => {
    const { home, project } = await fixture()
    const root = join(home, '.codex', 'skills')
    await writeSkill(root, 'alpha', 'Alpha')
    await writeSkill(root, 'beta', 'Beta')
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(FakeSettings)
    await ctx.plugin(FakeConnection)
    await ctx.plugin(Plugin, { home, dshHome: join(home, '.dsh'), watch: false, sync: false, catalog: { limit: 1 } })
    const settings = ctx.get('settings') as FakeSettings
    const connection = ctx.get('connection') as FakeConnection

    expect([...settings.sections.keys()]).toEqual([SETTINGS_NAMESPACE])
    expect(settings.sections.get(SETTINGS_NAMESPACE)?.entry).toEqual({ catalog: { limit: 1, pin: [], hide: [] }, excludeSkills: [] })
    expect([...connection.routes.keys()]).toEqual([REPORT_PATH])
    expect(connection.routes.get(REPORT_PATH)).toMatchObject({ methods: ['POST'], requestBody: 'buffered' })

    // The first catalog: limit 1 from the composition entry.
    const first = await connection.post(REPORT_PATH, { cwd: project }) as { ok: true; value: ReportView }
    expect(first.ok).toBe(true)
    expect(first.value.skills.map(skill => [skill.name, skill.state])).toEqual([['alpha', 'visible'], ['beta', 'hidden']])
    expect(first.value.catalog.limit).toBe(1)

    // A user edit through settings: pin beta, and the model catalog follows.
    settings.update(SETTINGS_NAMESPACE, { catalog: { pin: ['beta'] } })
    const second = await connection.post(REPORT_PATH, { cwd: project }) as { ok: true; value: ReportView }
    expect(second.value.skills.map(skill => [skill.name, skill.state, skill.pinned])).toEqual([['alpha', 'hidden', false], ['beta', 'visible', true]])
    const catalog = await ctx.skills.list({ cwd: project })
    expect(catalog.filter(skill => skill.invocation.modelInvocable).map(skill => skill.name)).toEqual(['beta'])

    // Excluding through settings drops the skill from the registry altogether.
    settings.update(SETTINGS_NAMESPACE, { excludeSkills: ['alpha'] })
    expect((await ctx.skills.list({ cwd: project })).map(skill => skill.name)).toEqual(['beta'])

    await ctx.fiber.dispose()
    expect(connection.routes.size).toBe(0)
  })

  it('works without the settings and connection services', async () => {
    const { home, project } = await fixture()
    await writeSkill(join(home, '.codex', 'skills'), 'alpha', 'Alpha')
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(Plugin, { home, dshHome: join(home, '.dsh'), watch: false, sync: false })
    expect((await ctx.skills.list({ cwd: project })).map(skill => skill.name)).toEqual(['alpha'])
    await ctx.fiber.dispose()
  })
})
