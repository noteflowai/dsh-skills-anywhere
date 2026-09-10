/**
 * Plugin configuration: the Schemastery schema Cordis validates, and the
 * resolved shape the provider consumes.
 *
 * @module
 */

import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import type { SourceSpec } from './sources.ts'

export interface RankConfig {
  /** Skills found in another agent's project directory (`.claude/skills`, ...). */
  readonly project?: number
  /** Skills found in another agent's user directory (`~/.codex/skills`, ...). */
  readonly user?: number
  /** Skills found inside Claude Code plugin marketplaces. */
  readonly claudePlugins?: number
  /** Default rank for git sources without an explicit `rank`. */
  readonly sources?: number
}

export interface CatalogConfig {
  /** Maximum skills this provider exposes to the model catalog; `0` means unlimited. Default 50. */
  readonly limit?: number
  /** Skill names always kept in the model catalog. */
  readonly pin?: readonly string[]
  /** Skill names never shown to the model catalog (still user-invocable and searchable). */
  readonly hide?: readonly string[]
}

export interface Config {
  /** Unique provider name on `ctx.skills`. */
  readonly providerName?: string
  /** Scan the skill directories of other coding agents. */
  readonly agents?: boolean
  /** Agent ids (see `AGENTS`) to leave out. */
  readonly excludeAgents?: readonly string[]
  /** Extra project-relative skill directories scanned like an agent's. */
  readonly extraProjectDirs?: readonly string[]
  /** Extra absolute (or `~/`) skill directories scanned like an agent's user root. */
  readonly extraUserDirs?: readonly string[]
  /** Scan Claude Code plugin marketplaces and installed plugin caches. */
  readonly claudePlugins?: boolean
  /** Git repositories full of skills. */
  readonly sources?: readonly (string | SourceSpec)[]
  /** Also read `<dshHome>/skills-anywhere/sources.json` and `<project>/.dsh/skills-anywhere.json`. */
  readonly sourcesFiles?: boolean
  /** Where git sources are checked out. Defaults to `<dshHome>/skills-anywhere/cache`. */
  readonly cacheDir?: string
  /** dsh home. Defaults to `$DSH_HOME` or `~/.dsh`. */
  readonly dshHome?: string
  /** Home directory used to expand `~` and locate agent roots. Defaults to the OS home. */
  readonly home?: string
  /** Clone and refresh git sources at all. */
  readonly sync?: boolean
  /** Refresh sources when the plugin starts. */
  readonly syncOnStart?: boolean
  /** Interval between background refreshes; `0` disables the timer. */
  readonly syncIntervalMs?: number
  /** Per-git-command timeout. */
  readonly syncTimeoutMs?: number
  /** Directory depth walked inside sources and marketplaces. */
  readonly maxDepth?: number
  /** Collapse symlinked and byte-identical duplicates. */
  readonly dedupe?: boolean
  /** Repair recoverable frontmatter problems instead of skipping the skill. */
  readonly lenient?: boolean
  /** Watch local roots and refresh the catalog on changes. */
  readonly watch?: boolean
  /** Skill names to hide. */
  readonly excludeSkills?: readonly string[]
  readonly ranks?: RankConfig
  /** Model-catalog budget: which skills are listed for the model versus reachable through `find_skills`. */
  readonly catalog?: CatalogConfig
}

export const DEFAULT_RANKS = { project: 250, user: 550, claudePlugins: 580, sources: 700 } as const
export const DEFAULT_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000
export const DEFAULT_SYNC_TIMEOUT_MS = 120_000
export const DEFAULT_MAX_DEPTH = 5
export const DEFAULT_CATALOG_LIMIT = 50

const SourceSchema = z.union([
  z.string(),
  z.object({
    repo: z.string().required(),
    ref: z.string(),
    path: z.string(),
    rank: z.number(),
  }),
])

export const Config: Schema<Config> = z.object({
  providerName: z.string().default('skills-anywhere'),
  agents: z.boolean().default(true),
  excludeAgents: z.array(z.string()).default([]),
  extraProjectDirs: z.array(z.string()).default([]),
  extraUserDirs: z.array(z.string()).default([]),
  claudePlugins: z.boolean().default(true),
  sources: z.array(SourceSchema).default([]),
  sourcesFiles: z.boolean().default(true),
  cacheDir: z.string(),
  dshHome: z.string(),
  home: z.string(),
  sync: z.boolean().default(true),
  syncOnStart: z.boolean().default(true),
  syncIntervalMs: z.number().default(DEFAULT_SYNC_INTERVAL_MS),
  syncTimeoutMs: z.number().default(DEFAULT_SYNC_TIMEOUT_MS),
  maxDepth: z.number().default(DEFAULT_MAX_DEPTH),
  dedupe: z.boolean().default(true),
  lenient: z.boolean().default(true),
  watch: z.boolean().default(true),
  excludeSkills: z.array(z.string()).default([]),
  ranks: z.object({
    project: z.number().default(DEFAULT_RANKS.project),
    user: z.number().default(DEFAULT_RANKS.user),
    claudePlugins: z.number().default(DEFAULT_RANKS.claudePlugins),
    sources: z.number().default(DEFAULT_RANKS.sources),
  }).default({ ...DEFAULT_RANKS }),
  catalog: z.object({
    limit: z.number().default(DEFAULT_CATALOG_LIMIT),
    pin: z.array(z.string()).default([]),
    hide: z.array(z.string()).default([]),
  }).default({ limit: DEFAULT_CATALOG_LIMIT, pin: [], hide: [] }),
}) as unknown as Schema<Config>

export interface ResolvedConfig {
  readonly providerName: string
  readonly agents: boolean
  readonly excludeAgents: ReadonlySet<string>
  readonly extraProjectDirs: readonly string[]
  readonly extraUserDirs: readonly string[]
  readonly claudePlugins: boolean
  readonly sources: readonly (string | SourceSpec)[]
  readonly sourcesFiles: boolean
  readonly cacheDir: string
  readonly dshHome: string
  readonly home: string
  readonly sync: boolean
  readonly syncOnStart: boolean
  readonly syncIntervalMs: number
  readonly syncTimeoutMs: number
  readonly maxDepth: number
  readonly dedupe: boolean
  readonly lenient: boolean
  readonly watch: boolean
  readonly excludeSkills: readonly string[]
  readonly ranks: Required<RankConfig>
  readonly catalog: { readonly limit: number; readonly pin: ReadonlySet<string>; readonly hide: ReadonlySet<string> }
  /** `<dshHome>/skills-anywhere` */
  readonly stateDir: string
  /** User-level sources file. */
  readonly userSourcesFile: string
  /** Lock file recording synced commits. */
  readonly lockFile: string
}

/** Expand a leading `~` against `home`. */
export function expandHome(path: string, home: string): string {
  if (path === '~') return home
  if (path.startsWith('~/')) return join(home, path.slice(2))
  return path
}

/** Apply defaults and resolve every path. */
export function resolveConfig(config: Config = {}, env: Record<string, string | undefined> = process.env): ResolvedConfig {
  const home = resolve(config.home ?? env.HOME ?? homedir())
  const dshHome = resolve(expandHome(config.dshHome ?? env.DSH_HOME ?? join(home, '.dsh'), home))
  const stateDir = join(dshHome, 'skills-anywhere')
  const cacheDir = resolve(expandHome(config.cacheDir ?? join(stateDir, 'cache'), home))
  const ranks = { ...DEFAULT_RANKS, ...stripUndefined(config.ranks ?? {}) }
  return {
    providerName: config.providerName ?? 'skills-anywhere',
    agents: config.agents ?? true,
    excludeAgents: new Set(config.excludeAgents ?? []),
    extraProjectDirs: (config.extraProjectDirs ?? []).map(dir => dir.replace(/^\.?\/+/, '')),
    extraUserDirs: (config.extraUserDirs ?? []).map(dir => resolve(expandHome(dir, home))),
    claudePlugins: config.claudePlugins ?? true,
    sources: config.sources ?? [],
    sourcesFiles: config.sourcesFiles ?? true,
    cacheDir,
    dshHome,
    home,
    sync: config.sync ?? true,
    syncOnStart: config.syncOnStart ?? true,
    syncIntervalMs: config.syncIntervalMs ?? DEFAULT_SYNC_INTERVAL_MS,
    syncTimeoutMs: config.syncTimeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS,
    maxDepth: config.maxDepth ?? DEFAULT_MAX_DEPTH,
    dedupe: config.dedupe ?? true,
    lenient: config.lenient ?? true,
    watch: config.watch ?? true,
    excludeSkills: config.excludeSkills ?? [],
    ranks,
    catalog: {
      limit: Math.max(0, Math.floor(config.catalog?.limit ?? DEFAULT_CATALOG_LIMIT)),
      pin: new Set(config.catalog?.pin ?? []),
      hide: new Set(config.catalog?.hide ?? []),
    },
    stateDir,
    userSourcesFile: join(stateDir, 'sources.json'),
    lockFile: join(stateDir, 'lock.json'),
  }
}

/** Project-level sources file for a project root. */
export function projectSourcesFile(projectRoot: string): string {
  return join(projectRoot, '.dsh', 'skills-anywhere.json')
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>
}

/** Whether a configured directory is absolute after `~` expansion. */
export function isAbsoluteAfterExpand(path: string, home: string): boolean {
  return isAbsolute(expandHome(path, home))
}
