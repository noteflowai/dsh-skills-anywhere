/**
 * The `ctx.skills` provider: builds the root list for a cwd, runs discovery,
 * keeps git sources fresh in the background, and watches local roots so the
 * dsh catalog refreshes without a restart.
 *
 * The class has no hard dependency on Cordis so the CLI can drive it directly.
 *
 * @module
 */

import { watchFile, unwatchFile } from 'node:fs'
import { readSkillBytes } from './skill-input.ts'
import { join } from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import type {
  SkillCandidate,
  SkillDefinition,
  SkillLookupOptions,
  SkillProvider,
  SkillProviderControl,
  SkillProviderObservation,
} from '@deepseek-ai/dsh-skill'
import { AGENTS } from './agents.ts'
import { projectSourcesFile, type ResolvedConfig } from './config.ts'
import { discover, findProjectRoot, type DiscoveredSkill, type DiscoveryReport, type SkillRoot } from './discover.ts'
import { originGroup, originLabel } from './origin.ts'
import { applyCatalogBudget, type CatalogState } from './catalog.ts'
import type { CatalogSettings, ReportView, SkillView } from './web-protocol.ts'
import { parseSkillMarkdown } from './frontmatter.ts'
import {
  readLock,
  readSourcesFile,
  resolveSource,
  syncSource,
  writeLock,
  type LockFile,
  type ResolvedSource,
  type SourceSpec,
  type SyncResult,
} from './sources.ts'

export interface ProviderLogger {
  readonly info: (message: string) => void
  readonly warn: (message: string) => void
  readonly debug?: (message: string) => void
}

interface Locator {
  readonly path: string
  readonly directory: string
}

export { applyCatalogBudget, type CatalogState } from './catalog.ts'

const WATCH_DEBOUNCE_MS = 80
const MAX_WATCHED_PROJECTS = 32
const SOURCES_FILE_POLL_MS = 2000

/** Skills-anywhere provider for the dsh skill registry. */
export class SkillsAnywhereProvider implements SkillProvider {
  readonly name: string
  private readonly watchers = new Map<string, FSWatcher>()
  private readonly polledFiles = new Set<string>()
  private readonly watchedProjects: string[] = []
  private syncTimer: NodeJS.Timeout | undefined
  private syncing: Promise<SyncResult[]> | undefined
  private syncQueued: Promise<SyncResult[]> | undefined
  /** Project roots the most recent sync run read sources for. */
  private lastSyncProjects = new Set<string>()
  /** Aborts git processes of in-flight syncs on dispose (or when dsh aborts the provider). */
  private readonly abort = new AbortController()
  private readonly syncedProjects = new Set<string>()
  private disposed = false
  private invalidateTimer: NodeJS.Timeout | undefined
  private lastReport: DiscoveryReport | undefined
  private lastSync: SyncResult[] = []
  /** Catalog state per project root (`''` for no cwd) from the latest `list()`. */
  private readonly catalogStates = new Map<string, Map<string, CatalogState>>()

  constructor(
    private config: ResolvedConfig,
    private readonly log: ProviderLogger,
    private readonly control?: SkillProviderControl,
  ) {
    this.name = config.providerName
    control?.signal.addEventListener('abort', () => { void this.dispose() }, { once: true })
    if (config.sync && config.syncIntervalMs > 0) {
      this.syncTimer = setInterval(() => { void this.syncAll() }, config.syncIntervalMs)
      this.syncTimer.unref()
    }
    // Config- and user-level sources do not depend on a project, so start
    // fetching them immediately: by the time an agent asks for the catalog the
    // cache is usually warm. Project-level sources sync on the first lookup
    // for that project (see `list`).
    if (config.sync && config.syncOnStart) void this.syncAll()
  }

  /** dsh calls this for every catalog refresh; `cwd` selects the project. */
  async list(options: SkillLookupOptions = {}): Promise<SkillCandidate[] | SkillProviderObservation> {
    const roots = await this.roots(options.cwd)
    if (this.config.sync && this.config.syncOnStart && options.cwd !== undefined) {
      const projectRoot = await findProjectRoot(options.cwd)
      if (!this.syncedProjects.has(projectRoot)) {
        this.syncedProjects.add(projectRoot)
        // Never block a catalog on the network: cached checkouts (if any) are
        // scanned now and a completed sync invalidates the catalog.
        void this.syncAll(options.cwd)
      }
    }
    if (this.config.watch) await this.watch(roots)
    const report = await discover(roots, {
      dedupe: this.config.dedupe,
      lenient: this.config.lenient,
      excludeSkills: this.config.excludeSkills,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      warn: message => this.log.warn(message),
    })
    this.lastReport = report
    const states = applyCatalogBudget(report.skills, this.config.catalog)
    this.catalogStates.set(options.cwd === undefined ? '' : await findProjectRoot(options.cwd), states)
    const candidates = report.skills.map(skill => toCandidate(skill, this.name, states.get(skill.name) ?? 'visible'))
    return report.complete ? candidates : { candidates, complete: false }
  }

  /** The configuration currently in force (runtime settings applied). */
  get currentConfig(): ResolvedConfig {
    return this.config
  }

  /**
   * Replace the runtime-editable part of the configuration (catalog budget,
   * pins, hides, exclusions) and invalidate the catalog so the next `list()`
   * applies it. Everything else (roots, sync, watchers) stays as composed.
   */
  reconfigure(settings: CatalogSettings): void {
    this.config = {
      ...this.config,
      excludeSkills: [...settings.excludeSkills],
      catalog: {
        limit: Math.max(0, Math.floor(settings.catalog.limit)),
        pin: new Set(settings.catalog.pin),
        hide: new Set(settings.catalog.hide),
      },
    }
    // Catalog states were computed under the old settings; `snapshot()` and
    // `catalogState()` must not serve them until the next `list()`.
    this.catalogStates.clear()
    // An explicit settings change is not a burst of file events: invalidate now.
    this.invalidate(true)
  }

  /**
   * Everything the web card shows: the latest discovery report for the
   * project containing `cwd` (running one when none exists yet) with the
   * catalog state of every skill and the runtime settings in force.
   */
  async snapshot(cwd?: string): Promise<ReportView> {
    const key = cwd === undefined ? '' : await findProjectRoot(cwd)
    if (this.lastReport === undefined || !this.catalogStates.has(key)) await this.list(cwd === undefined ? {} : { cwd })
    const report = this.lastReport
    const states = this.catalogStates.get(key) ?? this.catalogStates.get('') ?? new Map<string, CatalogState>()
    const { catalog, excludeSkills } = this.config
    const skills: SkillView[] = (report?.skills ?? []).map((skill) => {
      const extra = skill.metadata.skillsAnywhere as { renamedFrom?: string } | undefined
      return {
        name: skill.name,
        description: skill.description,
        origin: originLabel(skill.origin),
        group: originGroup(skill.origin),
        path: skill.path,
        state: states.get(skill.name) ?? 'visible',
        authorDisabled: !skill.invocation.modelInvocable,
        ...(extra?.renamedFrom !== undefined ? { renamedFrom: extra.renamedFrom } : {}),
        pinned: catalog.pin.has(skill.name),
        hidden: catalog.hide.has(skill.name),
        warnings: skill.warnings,
      }
    })
    return {
      skills,
      dropped: (report?.dropped ?? []).map(entry => ({ name: entry.skill.name, path: entry.skill.path, reason: entry.reason, winner: entry.winner.name })),
      invalid: (report?.invalid ?? []).map(entry => ({ path: entry.path, reason: entry.reason })),
      roots: (report?.roots ?? []).map(entry => ({ label: entry.root.label, path: entry.root.path, exists: entry.exists, count: entry.count })),
      complete: report?.complete ?? true,
      catalog: { limit: catalog.limit, pin: [...catalog.pin], hide: [...catalog.hide] },
      excludeSkills: [...excludeSkills],
      listed: skills.filter(skill => skill.state === 'visible').length,
    }
  }

  /**
   * Catalog state of one published skill as of the latest `list()` for the
   * project containing `cwd`. `hidden` means the budget kept it out of the
   * model catalog; `disabled` means the skill's own frontmatter did.
   */
  async catalogState(name: string, cwd?: string): Promise<CatalogState | undefined> {
    const key = cwd === undefined ? '' : await findProjectRoot(cwd)
    return (this.catalogStates.get(key) ?? this.catalogStates.get(''))?.get(name)
  }

  /** Re-read the winning file so edits are always reflected. */
  async get(candidate: SkillCandidate, options: SkillLookupOptions = {}): Promise<SkillDefinition | undefined> {
    const locator = candidate.locator as Locator
    let raw: string
    try {
      options.signal?.throwIfAborted()
      const bytes = await readSkillBytes(locator.path)
      options.signal?.throwIfAborted()
      raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    } catch (error) {
      options.signal?.throwIfAborted()
      if (isAbsent(error)) return undefined
      throw error
    }
    const parsed = parseSkillMarkdown(raw, { fallbackName: candidate.name, lenient: this.config.lenient })
    if (!parsed.ok) {
      this.log.warn(`skills-anywhere: ${locator.path} became unreadable: ${parsed.reason}`)
      return undefined
    }
    return {
      // Keep the catalog's name even if the file's frontmatter drifted.
      name: candidate.name,
      description: parsed.skill.description,
      ...(parsed.skill.whenToUse !== undefined ? { whenToUse: parsed.skill.whenToUse } : {}),
      // Preserve catalog restrictions and apply the author's current policy.
      invocation: {
        modelInvocable: candidate.invocation.modelInvocable && parsed.skill.invocation.modelInvocable,
        userInvocable: candidate.invocation.userInvocable && parsed.skill.invocation.userInvocable,
      },
      source: candidate.source,
      provider: this.name,
      resourceBase: { kind: 'directory', path: locator.directory },
      path: locator.path,
      metadata: {
        ...parsed.skill.metadata, ...candidate.metadata,
        skillsAnywhere: {
          ...(candidate.metadata?.skillsAnywhere as Record<string, unknown> | undefined),
          authorInvocation: parsed.skill.invocation,
        },
      },
      content: parsed.skill.content,
    }
  }

  /** Report from the most recent `list()`; the CLI uses it for diagnostics. */
  report(): DiscoveryReport | undefined {
    return this.lastReport
  }

  /** Results of the most recent source sync. */
  syncResults(): readonly SyncResult[] {
    return this.lastSync
  }

  /** Every configured source (config + files) for a cwd. */
  async sources(cwd?: string): Promise<ResolvedSource[]> {
    return this.collectSources(cwd === undefined ? [] : [await findProjectRoot(cwd)])
  }

  /** Config- and user-level sources plus the project files of `projectRoots`. */
  private async collectSources(projectRoots: Iterable<string>): Promise<ResolvedSource[]> {
    const specs: (string | SourceSpec)[] = [...this.config.sources]
    if (this.config.sourcesFiles) {
      specs.push(...await this.readSources(this.config.userSourcesFile))
      for (const projectRoot of new Set(projectRoots)) {
        specs.push(...await this.readSources(projectSourcesFile(projectRoot)))
      }
    }
    const resolved: ResolvedSource[] = []
    const seen = new Set<string>()
    for (const spec of specs) {
      try {
        const source = resolveSource(spec, this.config.cacheDir)
        const key = `${source.id}\0${source.ref ?? ''}\0${source.path ?? ''}`
        if (seen.has(key)) continue
        seen.add(key)
        resolved.push(source)
      } catch (error) {
        this.log.warn(String(error instanceof Error ? error.message : error))
      }
    }
    return resolved
  }

  /**
   * Clone or refresh every source. Concurrent calls share one run; a call that
   * names a project (or forces) while a run is in flight queues one follow-up
   * run, because the in-flight run read its source list before this request.
   */
  syncAll(cwd?: string, options: { force?: boolean } = {}): Promise<SyncResult[]> {
    if (this.syncing !== undefined) {
      if (cwd === undefined && options.force !== true) return this.syncing
      this.syncQueued ??= this.syncing
        .catch((): SyncResult[] => [])
        .then(async (results) => {
          this.syncQueued = undefined
          if (this.disposed) return results
          // Only re-run when the in-flight run could not have covered this
          // request: a project the run did not know about, with sources of its own.
          if (cwd !== undefined && options.force !== true) {
            const projectRoot = await findProjectRoot(cwd)
            if (this.lastSyncProjects.has(projectRoot)) return results
            if ((await this.readSources(projectSourcesFile(projectRoot))).length === 0) return results
          }
          return this.syncAll(cwd, options)
        })
      return this.syncQueued
    }
    this.syncing = this.runSync(cwd, options).finally(() => { this.syncing = undefined })
    return this.syncing
  }

  private async runSync(cwd: string | undefined, options: { force?: boolean }): Promise<SyncResult[]> {
    if (this.disposed) return []
    // Every project seen so far stays in the sync set, so the interval timer
    // and the sources-file poller (which have no cwd) refresh project sources too.
    const projectRoots = new Set(this.syncedProjects)
    if (cwd !== undefined) projectRoots.add(await findProjectRoot(cwd))
    this.lastSyncProjects = projectRoots
    const sources = await this.collectSources(projectRoots)
    if (sources.length === 0) return []
    const lock: LockFile = await readLock(this.config.lockFile)
    const results: SyncResult[] = []
    let changed = false
    for (const source of sources) {
      if (this.disposed) break
      const result = await syncSource(source, {
        ...(options.force !== undefined ? { force: options.force } : {}),
        timeoutMs: this.config.syncTimeoutMs,
        signal: this.abort.signal,
        log: message => this.log.info(message),
      })
      results.push(result)
      if (result.status === 'cloned' || result.status === 'updated') changed = true
      if (result.sha !== undefined) {
        lock[source.key] = {
          url: source.url,
          ...(source.ref !== undefined ? { ref: source.ref } : {}),
          sha: result.sha,
          syncedAt: new Date().toISOString(),
        }
      }
    }
    this.lastSync = results
    try {
      await writeLock(this.config.lockFile, lock)
    } catch (error) {
      this.log.warn(`skills-anywhere: could not write ${this.config.lockFile}: ${String(error)}`)
    }
    if (changed) this.invalidate()
    return results
  }

  /** Build the ordered root list for one cwd. */
  async roots(cwd?: string): Promise<SkillRoot[]> {
    const { config } = this
    const roots: SkillRoot[] = []
    const projectRoot = cwd !== undefined ? await findProjectRoot(cwd) : undefined

    if (config.agents && projectRoot !== undefined) {
      for (const agent of AGENTS) {
        if (agent.project === undefined || config.excludeAgents.has(agent.id)) continue
        roots.push({
          path: join(projectRoot, agent.project),
          project: projectRoot,
          source: 'anywhere-project',
          rank: config.ranks.project,
          mode: 'flat',
          origin: { kind: 'agent', agent: agent.id, scope: 'project' },
          label: `${agent.id} (project)`,
        })
      }
    }
    if (projectRoot !== undefined) {
      for (const dir of config.extraProjectDirs) {
        roots.push({
          path: join(projectRoot, dir),
          project: projectRoot,
          source: 'anywhere-project',
          rank: config.ranks.project,
          mode: 'flat',
          origin: { kind: 'custom', scope: 'project' },
          label: `${dir} (project)`,
        })
      }
    }
    if (config.agents) {
      const seen = new Set<string>()
      for (const agent of AGENTS) {
        if (agent.user === undefined || config.excludeAgents.has(agent.id)) continue
        const path = join(config.home, agent.user)
        if (seen.has(path)) continue
        seen.add(path)
        roots.push({
          path,
          source: 'anywhere-user',
          rank: config.ranks.user,
          mode: 'flat',
          origin: { kind: 'agent', agent: agent.id, scope: 'user' },
          label: `${agent.id} (user)`,
        })
      }
    }
    for (const dir of config.extraUserDirs) {
      roots.push({
        path: dir,
        source: 'anywhere-user',
        rank: config.ranks.user,
        mode: 'flat',
        origin: { kind: 'custom', scope: 'user' },
        label: `${dir} (user)`,
      })
    }
    if (config.claudePlugins) {
      const base = join(config.home, '.claude', 'plugins')
      roots.push({
        path: join(base, 'marketplaces'),
        source: 'anywhere-claude-plugins',
        rank: config.ranks.claudePlugins,
        mode: 'nested',
        maxDepth: Math.max(config.maxDepth, 6),
        origin: { kind: 'claude-plugins' },
        label: 'claude-code marketplaces',
      })
      roots.push({
        path: join(base, 'cache'),
        source: 'anywhere-claude-plugins',
        rank: config.ranks.claudePlugins,
        mode: 'nested',
        maxDepth: Math.max(config.maxDepth, 7),
        origin: { kind: 'claude-plugins' },
        label: 'claude-code plugin cache',
      })
    }
    for (const source of await this.sources(cwd)) {
      roots.push({
        path: source.scanDir,
        source: 'anywhere-source',
        rank: source.rank ?? config.ranks.sources,
        mode: 'nested',
        maxDepth: config.maxDepth,
        origin: { kind: 'source', repo: source.display },
        label: `source ${source.display}`,
      })
    }
    return roots
  }

  /** Stop timers and watchers. Safe to call more than once. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    if (this.syncTimer !== undefined) clearInterval(this.syncTimer)
    if (this.invalidateTimer !== undefined) clearTimeout(this.invalidateTimer)
    for (const file of this.polledFiles) unwatchFile(file)
    this.polledFiles.clear()
    const closing = [...this.watchers.values()].map(watcher => watcher.close().catch(() => undefined))
    this.watchers.clear()
    // No git process may outlive the provider: kill in-flight syncs and wait
    // for them to settle, so callers can remove the cache right after dispose.
    this.abort.abort()
    await Promise.all([...closing, this.syncing?.catch(() => undefined), this.syncQueued?.catch(() => undefined)])
  }

  // --- internals ------------------------------------------------------------

  private async readSources(path: string): Promise<SourceSpec[]> {
    try {
      const sources = await readSourcesFile(path)
      if (this.config.watch) this.pollFile(path)
      return sources
    } catch (error) {
      this.log.warn(String(error instanceof Error ? error.message : error))
      return []
    }
  }

  private invalidate(immediately = false): void {
    if (this.disposed || this.control === undefined) return
    if (this.invalidateTimer !== undefined) clearTimeout(this.invalidateTimer)
    if (immediately) {
      this.invalidateTimer = undefined
      this.control.invalidate()
      return
    }
    this.invalidateTimer = setTimeout(() => {
      this.invalidateTimer = undefined
      this.control?.invalidate()
    }, WATCH_DEBOUNCE_MS)
    this.invalidateTimer.unref()
  }

  /** Watch existing flat roots (bounded per project) and the sources files. */
  private async watch(roots: readonly SkillRoot[]): Promise<void> {
    if (this.disposed) return
    for (const root of roots) {
      if (root.mode !== 'flat') continue
      if (this.watchers.has(root.path)) continue
      if (root.origin.scope === 'project' && !this.admitProject(root.project ?? root.path)) continue
      try {
        const watcher = chokidar.watch(root.path, {
          depth: 1,
          ignoreInitial: true,
          persistent: true,
          followSymlinks: true,
          awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
        })
        watcher.on('all', (_event, path) => {
          if (/(?:^|[\\/])(?:SKILL\.md|[^\\/]+\.md)$/.test(path) || !/\.[^\\/]+$/.test(path)) this.invalidate()
        })
        watcher.on('error', () => { /* a lost watcher only delays refreshes */ })
        this.watchers.set(root.path, watcher)
      } catch {
        // Watching is best-effort.
      }
    }
    if (this.config.claudePlugins) {
      this.pollFile(join(this.config.home, '.claude', 'plugins', 'known_marketplaces.json'))
      this.pollFile(join(this.config.home, '.claude', 'plugins', 'installed_plugins.json'))
    }
  }

  /** Bound the number of *projects* (not directories) whose roots are watched. */
  private admitProject(project: string): boolean {
    if (this.watchedProjects.includes(project)) return true
    if (this.watchedProjects.length >= MAX_WATCHED_PROJECTS) return false
    this.watchedProjects.push(project)
    return true
  }

  private pollFile(path: string): void {
    if (this.disposed || this.polledFiles.has(path)) return
    this.polledFiles.add(path)
    watchFile(path, { persistent: false, interval: SOURCES_FILE_POLL_MS }, (current, previous) => {
      if (current.mtimeMs !== previous.mtimeMs || current.size !== previous.size) {
        this.invalidate()
        if (path.endsWith('sources.json') || path.endsWith('skills-anywhere.json')) void this.syncAll()
      }
    })
  }
}

/** Preserve author invocation metadata when a catalog budget hides a candidate. */
function toCandidate(skill: DiscoveredSkill, provider: string, state: CatalogState): SkillCandidate {
  const locator: Locator = { path: skill.path, directory: skill.directory }
  const extra = skill.metadata.skillsAnywhere as Record<string, unknown> | undefined
  return {
    name: skill.name,
    description: skill.description,
    ...(skill.whenToUse !== undefined ? { whenToUse: skill.whenToUse } : {}),
    invocation: state === 'hidden'
      ? { modelInvocable: false, userInvocable: skill.invocation.userInvocable }
      : skill.invocation,
    provider,
    source: skill.source,
    rank: skill.rank,
    locator,
    path: skill.path,
    resourceBase: { kind: 'directory', path: skill.directory },
    metadata: {
      ...skill.metadata,
      skillsAnywhere: { ...extra, catalog: state, authorInvocation: skill.invocation },
    },
  }
}

function isAbsent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && ((error as { code: unknown }).code === 'ENOENT' || (error as { code: unknown }).code === 'ENOTDIR')
}
