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
import { readFile } from 'node:fs/promises'
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
  private readonly syncedProjects = new Set<string>()
  private disposed = false
  private invalidateTimer: NodeJS.Timeout | undefined
  private lastReport: DiscoveryReport | undefined
  private lastSync: SyncResult[] = []

  constructor(
    private readonly config: ResolvedConfig,
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
    const candidates = report.skills.map(skill => toCandidate(skill, this.name))
    return report.complete ? candidates : { candidates, complete: false }
  }

  /** Re-read the winning file so edits are always reflected. */
  async get(candidate: SkillCandidate, options: SkillLookupOptions = {}): Promise<SkillDefinition | undefined> {
    const locator = candidate.locator as Locator
    let raw: string
    try {
      raw = await readFile(locator.path, { encoding: 'utf8', ...(options.signal !== undefined ? { signal: options.signal } : {}) })
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
      invocation: parsed.skill.invocation,
      source: candidate.source,
      provider: this.name,
      resourceBase: { kind: 'directory', path: locator.directory },
      path: locator.path,
      metadata: { ...parsed.skill.metadata, ...candidate.metadata },
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
    const specs: (string | SourceSpec)[] = [...this.config.sources]
    if (this.config.sourcesFiles) {
      specs.push(...await this.readSources(this.config.userSourcesFile))
      if (cwd !== undefined) {
        const projectRoot = await findProjectRoot(cwd)
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

  /** Clone or refresh every source; concurrent calls share one run. */
  syncAll(cwd?: string, options: { force?: boolean } = {}): Promise<SyncResult[]> {
    if (this.syncing !== undefined) return this.syncing
    this.syncing = this.runSync(cwd, options).finally(() => { this.syncing = undefined })
    return this.syncing
  }

  private async runSync(cwd: string | undefined, options: { force?: boolean }): Promise<SyncResult[]> {
    if (this.disposed) return []
    const sources = await this.sources(cwd)
    if (sources.length === 0) return []
    const lock: LockFile = await readLock(this.config.lockFile)
    const results: SyncResult[] = []
    let changed = false
    for (const source of sources) {
      if (this.disposed) break
      const result = await syncSource(source, {
        ...(options.force !== undefined ? { force: options.force } : {}),
        timeoutMs: this.config.syncTimeoutMs,
        ...(this.control?.signal !== undefined ? { signal: this.control.signal } : {}),
        log: message => this.log.info(message),
      })
      results.push(result)
      if (result.status === 'cloned' || result.status === 'updated') changed = true
      if (result.sha !== undefined) {
        lock[source.id] = {
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
    await Promise.all(closing)
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

  private invalidate(): void {
    if (this.disposed || this.control === undefined) return
    if (this.invalidateTimer !== undefined) clearTimeout(this.invalidateTimer)
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
      if (root.origin.scope === 'project' && !this.admitProject(root.path)) continue
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

  private admitProject(path: string): boolean {
    if (this.watchedProjects.includes(path)) return true
    if (this.watchedProjects.length >= MAX_WATCHED_PROJECTS) return false
    this.watchedProjects.push(path)
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

function toCandidate(skill: DiscoveredSkill, provider: string): SkillCandidate {
  const locator: Locator = { path: skill.path, directory: skill.directory }
  return {
    name: skill.name,
    description: skill.description,
    ...(skill.whenToUse !== undefined ? { whenToUse: skill.whenToUse } : {}),
    invocation: skill.invocation,
    provider,
    source: skill.source,
    rank: skill.rank,
    locator,
    path: skill.path,
    resourceBase: { kind: 'directory', path: skill.directory },
    metadata: skill.metadata,
  }
}

function isAbsent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && ((error as { code: unknown }).code === 'ENOENT' || (error as { code: unknown }).code === 'ENOTDIR')
}
