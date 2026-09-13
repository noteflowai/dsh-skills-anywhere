/**
 * dsh-skills-anywhere — browser half.
 *
 * Registers one card into the web Settings → Plugins → *Plugin configuration*
 * tab (`settings.plugin.item`, keyed by the `skills-anywhere` settings
 * namespace). The card lists every skill the provider found, grouped by where
 * it lives, shows whether the model catalog lists it, and lets the user pin,
 * hide or exclude skills. Edits write through the dsh settings scope, so they
 * persist in the profile's settings document and take effect immediately: the
 * host provider re-applies the namespace on every commit.
 *
 * Runtime services (Cordis `inject`): `slots`, `locale`, `settingsScope`. The
 * report is fetched from the host's exact `/api` route with the page's own
 * credentials. Bundled as a lazy-CJS factory for the dsh client module system.
 *
 * @module dsh-skills-anywhere/client
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactElement } from 'react'
import { REPORT_PATH, SETTINGS_NAMESPACE, type CatalogSettings, type ReportView, type SkillView } from '../web-protocol.ts'
import { LOCALE_NS, en, fill, zh, type DictKey } from './locale.ts'
import { styles } from './styles.ts'

// --- minimal structural views of the dsh client services this plugin uses ---

type RpcResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

interface ScopeSnapshot<T> {
  readonly status: 'loading' | 'ready' | 'unavailable'
  readonly value: T | undefined
  readonly user: unknown
  readonly revision: number | undefined
  readonly writable: boolean
}

interface SettingsScope<T> {
  getSnapshot(): ScopeSnapshot<T>
  subscribe(listener: () => void): () => void
  mutate(ops: readonly ({ op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] })[], expectedRevision?: number): Promise<void>
}

interface ClientContext {
  effect(callback: () => () => void, label?: string): void
  slots: {
    inject(name: string, callback: () => () => void): void
    register(options: { name: string; key: string; locale?: string; inject?: () => Record<string, unknown> }, component: (props: never) => ReactElement | null): () => void
  }
  locale: {
    register(ns: string, dicts: Record<string, Record<string, string>>): () => void
  }
  settingsScope: {
    bind<T>(spec: { namespace: string }): SettingsScope<T>
  }
}

/** Client services the bundle needs before `apply` runs. */
export const inject = ['slots', 'locale', 'settingsScope']

/** Register the dictionaries and the settings card. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(LOCALE_NS, { en, zh }), 'skills-anywhere: dictionaries')
  const scope = ctx.settingsScope.bind<CatalogSettings>({ namespace: SETTINGS_NAMESPACE })
  const face: CardFace = {
    scope,
    fetchReport: async (signal) => {
      const response = await fetch(new URL(REPORT_PATH, location.href), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        credentials: 'same-origin',
        signal,
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const result = await response.json() as RpcResult<ReportView>
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
      return result.value
    },
  }
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: SETTINGS_NAMESPACE,
    locale: LOCALE_NS,
    inject: () => ({ ...face }),
  }, SkillsAnywhereCard as unknown as (props: never) => ReactElement | null))
}

// --- the card -----------------------------------------------------------------

interface CardFace {
  readonly scope: SettingsScope<CatalogSettings>
  readonly fetchReport: (signal: AbortSignal) => Promise<ReportView>
}

type Translate = (key: DictKey) => string

interface CardProps extends CardFace {
  readonly t: Translate
}

type ReportState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly report: ReportView }
  | { readonly kind: 'failed'; readonly message: string }

/** Settings card for the skills-anywhere provider. Exported for tests. */
export function SkillsAnywhereCard(props: CardProps): ReactElement | null {
  const { t, scope, fetchReport } = props
  // Keep the scope's methods bound: dsh's scope reads `this` inside them.
  const subscribe = useCallback((listener: () => void) => scope.subscribe(listener), [scope])
  const getSnapshot = useCallback(() => scope.getSnapshot(), [scope])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const [open, setOpen] = useState(false)
  const [report, setReport] = useState<ReportState>({ kind: 'loading' })
  const [reloadTick, setReloadTick] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | undefined>(undefined)
  const [query, setQuery] = useState('')

  // Re-read the report whenever the card is open and the settings revision moved.
  useEffect(() => {
    if (!open) return
    const abort = new AbortController()
    setReport(current => (current.kind === 'ready' ? current : { kind: 'loading' }))
    fetchReport(abort.signal)
      .then(value => { if (!abort.signal.aborted) setReport({ kind: 'ready', report: value }) })
      .catch((error: unknown) => { if (!abort.signal.aborted) setReport({ kind: 'failed', message: error instanceof Error ? error.message : String(error) }) })
    return () => abort.abort()
  }, [open, fetchReport, snapshot.revision, reloadTick])

  const settings = snapshot.value
  const writable = snapshot.writable && !saving

  const write = useCallback(async (next: Partial<CatalogSettings>) => {
    setSaving(true)
    setSaveError(undefined)
    const ops: { op: 'set'; path: string[]; value: unknown }[] = []
    if (next.catalog !== undefined) {
      for (const [key, value] of Object.entries(next.catalog)) ops.push({ op: 'set', path: ['catalog', key], value })
    }
    if (next.excludeSkills !== undefined) ops.push({ op: 'set', path: ['excludeSkills'], value: next.excludeSkills })
    try {
      await scope.mutate(ops)
      setReloadTick(tick => tick + 1)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }, [scope])

  const toggleList = useCallback((list: 'pin' | 'hide', name: string) => {
    if (settings === undefined) return
    const current = new Set(settings.catalog[list])
    if (current.has(name)) current.delete(name)
    else current.add(name)
    // A skill is either pinned or hidden, never both.
    const pin = new Set(list === 'pin' ? current : settings.catalog.pin)
    const hide = new Set(list === 'hide' ? current : settings.catalog.hide)
    if (list === 'pin' && current.has(name)) hide.delete(name)
    if (list === 'hide' && current.has(name)) pin.delete(name)
    void write({ catalog: { limit: settings.catalog.limit, pin: [...pin].toSorted(), hide: [...hide].toSorted() } })
  }, [settings, write])

  const setExcluded = useCallback((name: string, excluded: boolean) => {
    if (settings === undefined) return
    const current = new Set(settings.excludeSkills)
    if (excluded) current.add(name)
    else current.delete(name)
    void write({ excludeSkills: [...current].toSorted() })
  }, [settings, write])

  const setLimit = useCallback((text: string) => {
    if (settings === undefined) return
    const limit = text.trim() === '' ? 0 : Number(text)
    if (!Number.isInteger(limit) || limit < 0 || limit === settings.catalog.limit) return
    void write({ catalog: { ...settings.catalog, limit } })
  }, [settings, write])

  const groups = useMemo(() => {
    if (report.kind !== 'ready') return []
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const matches = (skill: SkillView): boolean => terms.every(term =>
      skill.name.toLowerCase().includes(term) || skill.description.toLowerCase().includes(term) || skill.origin.toLowerCase().includes(term))
    const byGroup = new Map<string, SkillView[]>()
    for (const skill of report.report.skills) {
      if (!matches(skill)) continue
      const list = byGroup.get(skill.group)
      if (list === undefined) byGroup.set(skill.group, [skill])
      else list.push(skill)
    }
    return [...byGroup.entries()]
  }, [report, query])

  if (snapshot.status !== 'ready' || settings === undefined) return null

  const title = t('title')
  return (
    <li style={styles.card}>
      <button
        type="button"
        style={styles.header}
        aria-expanded={open}
        aria-label={`${t(open ? 'collapse' : 'expand')}: ${title}`}
        onClick={() => setOpen(!open)}
      >
        <span style={styles.headText}>
          <span style={styles.name}>{title}</span>
          <span style={styles.description}>{t('description')}</span>
        </span>
        <span style={{ ...styles.chevron, transform: open ? 'rotate(180deg)' : undefined }} aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div style={styles.body}>
          {!snapshot.writable ? <p style={styles.status} role="status">{t('readOnly')}</p> : null}
          <div style={styles.row}>
            <label style={styles.hint} htmlFor="skills-anywhere-limit">{t('limitLabel')}</label>
            <input
              id="skills-anywhere-limit"
              style={{ ...styles.input, ...styles.limitInput }}
              type="number"
              min={0}
              step={1}
              defaultValue={settings.catalog.limit}
              key={`limit-${settings.catalog.limit}`}
              disabled={!writable}
              onBlur={event => setLimit(event.currentTarget.value)}
              onKeyDown={event => { if (event.key === 'Enter') setLimit(event.currentTarget.value) }}
              aria-describedby="skills-anywhere-limit-hint"
            />
            <span id="skills-anywhere-limit-hint" style={styles.hint}>{settings.catalog.limit === 0 ? t('unlimited') : ''} {t('limitHint')}</span>
          </div>
          {report.kind === 'loading' ? <p style={styles.status} role="status">{t('loading')}</p> : null}
          {report.kind === 'failed' ? (
            <p style={styles.errorText} role="alert">
              {t('loadFailed')}: {report.message}{' '}
              <button type="button" style={styles.button} onClick={() => setReloadTick(tick => tick + 1)}>{t('retry')}</button>
            </p>
          ) : null}
          {report.kind === 'ready' ? (
            <>
              <div style={styles.row}>
                <span style={styles.hint}>{fill(t('summary'), { listed: report.report.listed, total: report.report.skills.length })}</span>
                {!report.report.complete ? <span style={styles.errorText}>{t('incomplete')}</span> : null}
                <span style={{ flex: 1 }} />
                <button type="button" style={styles.button} onClick={() => setReloadTick(tick => tick + 1)}>{t('refresh')}</button>
              </div>
              <input
                style={{ ...styles.input, ...styles.search }}
                type="search"
                placeholder={t('search')}
                value={query}
                onChange={event => setQuery(event.currentTarget.value)}
                aria-label={t('search')}
              />
              {saving ? <p style={styles.status} role="status">{t('saving')}</p> : null}
              {saveError !== undefined ? <p style={styles.errorText} role="alert">{t('saveFailed')} ({saveError})</p> : null}
              {groups.length === 0 ? <p style={styles.status}>{t('noMatches')}</p> : null}
              {groups.map(([group, skills]) => (
                <div key={group}>
                  <h4 style={styles.groupTitle}>{group}</h4>
                  <ul style={styles.group}>
                    {skills.map(skill => (
                      <SkillRow
                        key={skill.name}
                        skill={skill}
                        t={t}
                        writable={writable}
                        onPin={() => toggleList('pin', skill.name)}
                        onHide={() => toggleList('hide', skill.name)}
                        onExclude={() => setExcluded(skill.name, true)}
                      />
                    ))}
                  </ul>
                </div>
              ))}
              {settings.excludeSkills.length > 0 ? (
                <div>
                  <h4 style={styles.groupTitle}>{t('excluded')}</h4>
                  <ul style={styles.group}>
                    {settings.excludeSkills.map(name => (
                      <li key={name} style={styles.skill}>
                        <span style={styles.skillName}>{name}</span>
                        <span style={styles.actions}>
                          <button type="button" style={{ ...styles.button, ...(writable ? {} : styles.buttonDisabled) }} disabled={!writable} onClick={() => setExcluded(name, false)}>{t('restore')}</button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <details style={styles.details}>
                <summary>
                  {fill(t('rootsSummary'), { present: report.report.roots.filter(root => root.exists).length, total: report.report.roots.length })}
                  {report.report.dropped.length > 0 ? ` · ${fill(t('droppedSummary'), { count: report.report.dropped.length })}` : ''}
                  {report.report.invalid.length > 0 ? ` · ${fill(t('invalidSummary'), { count: report.report.invalid.length })}` : ''}
                </summary>
                <ul style={styles.group}>
                  {report.report.roots.filter(root => root.exists).map(root => (
                    <li key={root.path} style={styles.mono}>{root.label} — {root.path} ({root.count})</li>
                  ))}
                  {report.report.invalid.map(entry => (
                    <li key={entry.path} style={styles.mono}>{entry.path}: {entry.reason}</li>
                  ))}
                </ul>
              </details>
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

interface SkillRowProps {
  readonly skill: SkillView
  readonly t: Translate
  readonly writable: boolean
  readonly onPin: () => void
  readonly onHide: () => void
  readonly onExclude: () => void
}

function SkillRow({ skill, t, writable, onPin, onHide, onExclude }: SkillRowProps): ReactElement {
  const stateKey: DictKey = skill.state === 'visible' ? 'stateVisible' : skill.state === 'hidden' ? 'stateHidden' : 'stateDisabled'
  const stateStyle = skill.state === 'visible' ? styles.tagOn : styles.tagOff
  const disabledButton = writable && !skill.authorDisabled ? {} : styles.buttonDisabled
  return (
    <li style={{ ...styles.skill, ...(skill.state === 'visible' ? {} : styles.skillHidden) }}>
      <span style={styles.skillName}>
        {skill.name}
        <span style={{ ...styles.tag, ...stateStyle }}>{t(stateKey)}</span>
        {skill.pinned ? <span style={{ ...styles.tag, ...styles.tagOn }}>{t('pinned')}</span> : null}
        {skill.renamedFrom !== undefined ? <span style={styles.tag}>{fill(t('renamedFrom'), { name: skill.renamedFrom })}</span> : null}
      </span>
      <span style={styles.skillMeta} title={`${skill.path}\n${skill.description}`}>{skill.origin} · {skill.description}</span>
      <span style={styles.actions}>
        <button type="button" style={{ ...styles.button, ...(skill.pinned ? styles.buttonActive : {}), ...disabledButton }} disabled={!writable || skill.authorDisabled} title={t('pinHint')} onClick={onPin}>{t(skill.pinned ? 'unpin' : 'pin')}</button>
        <button type="button" style={{ ...styles.button, ...(skill.hidden ? styles.buttonActive : {}), ...disabledButton }} disabled={!writable || skill.authorDisabled} title={t('hideHint')} onClick={onHide}>{t(skill.hidden ? 'unhide' : 'hide')}</button>
        <button type="button" style={{ ...styles.button, ...(writable ? {} : styles.buttonDisabled) }} disabled={!writable} title={t('excludeHint')} onClick={onExclude}>{t('exclude')}</button>
      </span>
    </li>
  )
}
