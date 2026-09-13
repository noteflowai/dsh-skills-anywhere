import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SkillsAnywhereCard, apply, inject } from '../src/client/index.tsx'
import { en, fill, zh, type DictKey } from '../src/client/locale.ts'
import { SETTINGS_NAMESPACE, type CatalogSettings, type ReportView } from '../src/web-protocol.ts'

const t = (key: DictKey): string => en[key]

function scopeWith(status: 'loading' | 'ready' | 'unavailable', value?: CatalogSettings, writable = true) {
  const snapshot = { status, value, user: {}, revision: 3, writable }
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    mutate: async () => {},
  }
}

const report: ReportView = {
  skills: [],
  dropped: [],
  invalid: [],
  roots: [],
  complete: true,
  catalog: { limit: 50, pin: [], hide: [] },
  excludeSkills: [],
  listed: 0,
}

describe('client plugin', () => {
  it('declares the client services it needs and registers one settings card keyed by the namespace', () => {
    expect(inject).toEqual(['slots', 'locale', 'settingsScope'])
    const registered: { name: string; key: string; locale?: string; face?: Record<string, unknown> }[] = []
    const dictionaries: string[] = []
    const effects: (() => void)[] = []
    const ctx = {
      effect: (callback: () => () => void) => { effects.push(callback()) },
      slots: {
        inject: (_name: string, callback: () => () => void) => { effects.push(callback()) },
        register: (options: { name: string; key: string; locale?: string; inject?: () => Record<string, unknown> }) => {
          registered.push({ name: options.name, key: options.key, ...(options.locale !== undefined ? { locale: options.locale } : {}), ...(options.inject !== undefined ? { face: options.inject() } : {}) })
          return () => {}
        },
      },
      locale: { register: (ns: string) => { dictionaries.push(ns); return () => {} } },
      settingsScope: { bind: (spec: { namespace: string }) => { expect(spec.namespace).toBe(SETTINGS_NAMESPACE); return scopeWith('ready') } },
    }
    apply(ctx as unknown as Parameters<typeof apply>[0])
    expect(dictionaries).toEqual(['skills-anywhere'])
    expect(registered).toHaveLength(1)
    expect(registered[0]).toMatchObject({ name: 'settings.plugin.item', key: SETTINGS_NAMESPACE, locale: 'skills-anywhere' })
    expect(typeof registered[0]!.face?.fetchReport).toBe('function')
    expect(registered[0]!.face?.scope).toBeDefined()
  })

  it('renders nothing until the namespace is ready, then a collapsed card with the title', () => {
    const fetchReport = async () => report
    expect(renderToStaticMarkup(<SkillsAnywhereCard t={t} scope={scopeWith('loading')} fetchReport={fetchReport} />)).toBe('')
    expect(renderToStaticMarkup(<SkillsAnywhereCard t={t} scope={scopeWith('unavailable')} fetchReport={fetchReport} />)).toBe('')
    const html = renderToStaticMarkup(<SkillsAnywhereCard t={t} scope={scopeWith('ready', { catalog: { limit: 50, pin: [], hide: [] }, excludeSkills: [] })} fetchReport={fetchReport} />)
    expect(html).toContain('<li')
    expect(html).toContain('Skills Anywhere')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('Catalog budget')
  })

  it('ships complete English and Chinese dictionaries', () => {
    expect(Object.keys(zh).toSorted()).toEqual(Object.keys(en).toSorted())
    expect(fill(en.summary, { listed: 3, total: 10 })).toBe('3 of 10 skills listed for the model')
    expect(fill(zh.renamedFrom, { name: 'access' })).toBe('原名 access')
  })
})
