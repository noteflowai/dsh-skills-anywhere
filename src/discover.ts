/**
 * Filesystem discovery: turn a list of roots into deduplicated skill entries.
 *
 * Two walk modes exist. `flat` mirrors the dsh convention (direct
 * `<name>/SKILL.md` bundles plus flat `<name>.md` files). `nested` walks a tree
 * to a bounded depth and treats every directory holding a `SKILL.md` as a
 * skill, which is what git repositories full of skills and Claude Code plugin
 * marketplaces need.
 *
 * @module
 */

import { createHash } from 'node:crypto'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { basename, dirname, join, relative, sep } from 'node:path'
import { MAX_NAME_LENGTH, normalizeSkillName, parseSkillMarkdown, type ParsedSkill } from './frontmatter.ts'

export type OriginKind = 'agent' | 'claude-plugins' | 'source' | 'custom'

export interface SkillOrigin {
  readonly kind: OriginKind
  /** Agent id from the agents table, when `kind` is `agent`. */
  readonly agent?: string
  /** `project` or `user` for agent and custom roots. */
  readonly scope?: 'project' | 'user'
  /** Git source display name (for example `anthropics/skills`), when `kind` is `source`. */
  readonly repo?: string
  /** Claude Code marketplace and plugin names, when `kind` is `claude-plugins`. */
  readonly marketplace?: string
  readonly plugin?: string
}

export interface SkillRoot {
  /** Absolute directory to scan. */
  readonly path: string
  /** Project root this root belongs to (project-scope roots only). */
  readonly project?: string
  /** `SkillSource` label reported to dsh. */
  readonly source: string
  /** Lower ranks win duplicate names inside the dsh registry layer. */
  readonly rank: number
  readonly mode: 'flat' | 'nested'
  /** Maximum directory depth below `path` for `nested` roots. */
  readonly maxDepth?: number
  readonly origin: SkillOrigin
  /** Short label for diagnostics (for example `claude-code (user)`). */
  readonly label: string
}

export interface DiscoveredSkill {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly invocation: ParsedSkill['invocation']
  readonly source: string
  readonly rank: number
  /** Absolute path of the Markdown file. */
  readonly path: string
  /** Directory whose files the skill may reference. */
  readonly directory: string
  readonly metadata: Record<string, unknown>
  readonly origin: SkillOrigin
  readonly root: SkillRoot
  readonly contentHash: string
  readonly warnings: readonly string[]
}

export interface DroppedSkill {
  readonly skill: DiscoveredSkill
  readonly winner: DiscoveredSkill
  readonly reason: 'same-file' | 'same-content' | 'excluded'
}

export interface InvalidSkill {
  readonly path: string
  readonly root: SkillRoot
  readonly reason: string
}

export interface RootReport {
  readonly root: SkillRoot
  readonly exists: boolean
  readonly count: number
}

export interface DiscoveryReport {
  readonly skills: readonly DiscoveredSkill[]
  readonly dropped: readonly DroppedSkill[]
  readonly invalid: readonly InvalidSkill[]
  readonly roots: readonly RootReport[]
  /** False when at least one root failed with a non-absence error. */
  readonly complete: boolean
}

export interface DiscoverOptions {
  /** Collapse identical files (symlinks) and identical content. Default `true`. */
  readonly dedupe?: boolean
  /** Repair recoverable frontmatter problems. Default `true`. */
  readonly lenient?: boolean
  /** Skill names to drop after discovery. */
  readonly excludeSkills?: readonly string[]
  readonly signal?: AbortSignal
  readonly warn?: (message: string) => void
}

const DEFAULT_NESTED_DEPTH = 5
const ROOT_CONCURRENCY = 8
const FILE_CONCURRENCY = 16

interface RootScan {
  readonly report: RootReport
  readonly skills: DiscoveredSkill[]
  readonly invalid: InvalidSkill[]
  readonly ok: boolean
}

/** Map with at most `limit` calls in flight; results keep input order. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length })
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
const SKIP_DIRS = new Set(['.git', 'node_modules', '.hg', '.svn', '__pycache__', '.venv', 'venv', 'dist', 'build'])
const FLAT_IGNORED_FILES = new Set(['README.md', 'README.zh.md', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'LICENSE.md', 'CHANGELOG.md', 'CONTRIBUTING.md'])

/** Discover skills under every root, then deduplicate across roots. */
export async function discover(roots: readonly SkillRoot[], options: DiscoverOptions = {}): Promise<DiscoveryReport> {
  const dedupe = options.dedupe ?? true
  const lenient = options.lenient ?? true
  const excluded = new Set(options.excludeSkills ?? [])
  const found: DiscoveredSkill[] = []
  const invalid: InvalidSkill[] = []
  const rootReports: RootReport[] = []
  let complete = true

  // Roots are independent, so scan them concurrently (most are absent agent
  // directories that cost one stat each), and read the SKILL.md files of one
  // root with bounded concurrency. Reports keep root order.
  const scans = await mapLimit(roots, ROOT_CONCURRENCY, async (root): Promise<RootScan> => {
    options.signal?.throwIfAborted()
    let exists = true
    let count = 0
    const skills: DiscoveredSkill[] = []
    const rejected: InvalidSkill[] = []
    let ok = true
    try {
      const info = await stat(root.path)
      if (!info.isDirectory()) exists = false
    } catch (error) {
      if (!isAbsent(error)) {
        ok = false
        options.warn?.(`skills-anywhere: cannot access ${root.path}: ${String(error)}`)
      }
      exists = false
    }
    if (exists) {
      try {
        const files = root.mode === 'flat'
          ? await listFlat(root.path)
          : await listNested(root.path, root.maxDepth ?? DEFAULT_NESTED_DEPTH, options.signal)
        const entries = await mapLimit(files, FILE_CONCURRENCY, async (file) => {
          options.signal?.throwIfAborted()
          return readSkill(file, root, lenient)
        })
        for (const [index, entry] of entries.entries()) {
          if (entry.ok) {
            skills.push(entry.skill)
            count += 1
          } else {
            rejected.push({ path: files[index]!.path, root, reason: entry.reason })
          }
        }
      } catch (error) {
        if (options.signal?.aborted) throw error
        ok = false
        options.warn?.(`skills-anywhere: discovery under ${root.path} failed: ${String(error)}`)
      }
    }
    return { report: { root, exists, count }, skills, invalid: rejected, ok }
  })
  for (const scan of scans) {
    found.push(...scan.skills)
    invalid.push(...scan.invalid)
    rootReports.push(scan.report)
    if (!scan.ok) complete = false
  }

  // Stable precedence: rank, then root order, then path.
  const rootOrder = new Map(roots.map((root, index) => [root, index]))
  found.sort((left, right) =>
    left.rank - right.rank
    || (rootOrder.get(left.root) ?? 0) - (rootOrder.get(right.root) ?? 0)
    || left.path.localeCompare(right.path))

  const dropped: DroppedSkill[] = []
  const skills: DiscoveredSkill[] = []
  // Two paths to one file necessarily carry the same content hash, so realpath
  // is only resolved once a hash has been seen before; in the common case of
  // no duplicates the loop makes no filesystem calls at all.
  const keptByHash = new Map<string, DiscoveredSkill[]>()
  const seenContent = new Map<string, DiscoveredSkill>()
  const realPaths = new Map<string, Promise<string>>()
  const real = (path: string): Promise<string> => {
    let resolved = realPaths.get(path)
    if (resolved === undefined) {
      resolved = realKey(path)
      realPaths.set(path, resolved)
    }
    return resolved
  }
  for (const skill of found) {
    if (excluded.has(skill.name)) {
      dropped.push({ skill, winner: skill, reason: 'excluded' })
      continue
    }
    if (dedupe) {
      const sameHash = keptByHash.get(skill.contentHash)
      if (sameHash !== undefined) {
        const fileKey = await real(skill.path)
        let fileWinner: DiscoveredSkill | undefined
        for (const other of sameHash) {
          if (await real(other.path) === fileKey) {
            fileWinner = other
            break
          }
        }
        if (fileWinner !== undefined) {
          dropped.push({ skill, winner: fileWinner, reason: 'same-file' })
          continue
        }
        const contentWinner = seenContent.get(`${skill.name}\0${skill.contentHash}`)
        if (contentWinner !== undefined) {
          dropped.push({ skill, winner: contentWinner, reason: 'same-content' })
          continue
        }
        sameHash.push(skill)
      } else {
        keptByHash.set(skill.contentHash, [skill])
      }
      seenContent.set(`${skill.name}\0${skill.contentHash}`, skill)
    }
    skills.push(skill)
  }

  // `excludeSkills` matches the raw frontmatter name above and the published
  // name here, so the names shown by `list` are always valid exclusions.
  const published: DiscoveredSkill[] = []
  for (const skill of disambiguate(skills)) {
    if (excluded.has(skill.name)) dropped.push({ skill, winner: skill, reason: 'excluded' })
    else published.push(skill)
  }
  return { skills: published, dropped, invalid, roots: rootReports, complete }
}

/**
 * Different skills that share a name (three Claude Code plugins each shipping
 * `configure`, say) would collapse to one entry in the dsh registry. When a
 * skill you authored (an agent directory) is involved, it keeps the bare name
 * and the others are prefixed with their plugin, repository, or agent. When
 * every member of the group comes from a plugin marketplace or a git source,
 * all of them are prefixed, because a bare `configure` would be meaningless.
 */
function disambiguate(skills: readonly DiscoveredSkill[]): DiscoveredSkill[] {
  const groups = new Map<string, DiscoveredSkill[]>()
  for (const skill of skills) {
    const group = groups.get(skill.name)
    if (group === undefined) groups.set(skill.name, [skill])
    else group.push(skill)
  }
  const taken = new Set(skills.map(skill => skill.name))
  const renamed = new Map<DiscoveredSkill, string>()
  for (const [name, group] of groups) {
    if (group.length < 2) continue
    const allThirdParty = group.every(skill => skill.origin.kind === 'claude-plugins' || skill.origin.kind === 'source')
    const toRename = allThirdParty ? group : group.slice(1)
    if (allThirdParty) taken.delete(name)
    for (const skill of toRename) {
      const prefix = collisionPrefix(skill)
      const stem = `${prefix}-${name}`
      let candidate = normalizeSkillName(stem) ?? name
      let counter = 2
      while (taken.has(candidate)) {
        // Make room for the suffix before normalising: a stem longer than
        // MAX_NAME_LENGTH would otherwise truncate the suffix away and loop.
        const suffix = `-${counter}`
        const base = stem.slice(0, Math.max(1, MAX_NAME_LENGTH - suffix.length))
        candidate = normalizeSkillName(`${base}${suffix}`) ?? `${name.slice(0, MAX_NAME_LENGTH - suffix.length)}${suffix}`
        counter += 1
      }
      taken.add(candidate)
      renamed.set(skill, candidate)
    }
  }
  return skills.map((skill) => {
    const candidate = renamed.get(skill)
    if (candidate === undefined) return skill
    const warning = `name "${skill.name}" collides with another skill; published as "${candidate}"`
    const extra = skill.metadata.skillsAnywhere as Record<string, unknown> | undefined
    return {
      ...skill,
      name: candidate,
      warnings: [...skill.warnings, warning],
      metadata: {
        ...skill.metadata,
        skillsAnywhere: {
          ...extra,
          renamedFrom: skill.name,
          warnings: [...((extra?.warnings as string[] | undefined) ?? []), warning],
        },
      },
    }
  })
}

function collisionPrefix(skill: DiscoveredSkill): string {
  const { origin } = skill
  if (origin.plugin !== undefined) return origin.plugin
  if (origin.repo !== undefined) {
    const segments = origin.repo.split('/').filter(segment => segment.length > 0)
    return segments[segments.length - 1] ?? 'source'
  }
  if (origin.agent !== undefined) return origin.agent
  return basename(skill.root.path)
}

interface SkillFile {
  readonly path: string
  readonly directory: string
  readonly fallbackName: string
}

async function listFlat(root: string): Promise<SkillFile[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const sorted = entries.toSorted((left, right) => left.name.localeCompare(right.name))
  // One stat per candidate directory; run them together, keep entry order.
  const candidates = await mapLimit(sorted, FILE_CONCURRENCY, async (entry): Promise<SkillFile | undefined> => {
    const path = join(root, entry.name)
    if (entry.name.startsWith('.')) return undefined
    if (entry.isDirectory() || entry.isSymbolicLink()) {
      const skillFile = join(path, 'SKILL.md')
      return await isFile(skillFile) ? { path: skillFile, directory: path, fallbackName: entry.name } : undefined
    }
    if (entry.isFile() && entry.name.endsWith('.md') && !FLAT_IGNORED_FILES.has(entry.name)) {
      return { path, directory: root, fallbackName: entry.name.slice(0, -3) }
    }
    return undefined
  })
  return candidates.filter((file): file is SkillFile => file !== undefined)
}

async function listNested(root: string, maxDepth: number, signal?: AbortSignal): Promise<SkillFile[]> {
  const visited = new Set<string>()
  // `dir` has already been resolved and admitted to `visited` by the caller.
  const walk = async (dir: string, depth: number): Promise<SkillFile[]> => {
    signal?.throwIfAborted()
    const files: SkillFile[] = []
    const skillFile = join(dir, 'SKILL.md')
    if (await isFile(skillFile)) {
      files.push({ path: skillFile, directory: dir, fallbackName: basename(dir) })
      // A nested skill directory is a leaf. The root itself may be a single
      // skill (`add o/r/skills/pdf`) and still hold a collection below it.
      if (depth > 0) return files
    }
    if (depth >= maxDepth) return files
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return files
    }
    const sorted = entries.toSorted((left, right) => left.name.localeCompare(right.name))
    // Resolve every child together, then admit them in name order so a
    // directory reachable twice is walked once, and descend concurrently.
    const resolved = await mapLimit(sorted, FILE_CONCURRENCY, async (entry): Promise<string | undefined> => {
      if (SKIP_DIRS.has(entry.name)) return undefined
      if (!(entry.isDirectory() || entry.isSymbolicLink())) return undefined
      const child = join(dir, entry.name)
      if (entry.isSymbolicLink() && !(await isDirectory(child))) return undefined
      try {
        return await realpath(child)
      } catch {
        return undefined
      }
    })
    const admitted: string[] = []
    for (const [index, real] of resolved.entries()) {
      if (real === undefined || visited.has(real)) continue
      visited.add(real)
      admitted.push(join(dir, sorted[index]!.name))
    }
    const nested = await mapLimit(admitted, FILE_CONCURRENCY, child => walk(child, depth + 1))
    for (const list of nested) files.push(...list)
    return files
  }
  try {
    visited.add(await realpath(root))
  } catch {
    return []
  }
  return walk(root, 0)
}

async function readSkill(file: SkillFile, root: SkillRoot, lenient: boolean): Promise<{ ok: true; skill: DiscoveredSkill } | { ok: false; reason: string }> {
  let raw: string
  try {
    raw = await readFile(file.path, 'utf8')
  } catch (error) {
    return { ok: false, reason: `unreadable: ${String(error)}` }
  }
  if (raw.includes('�')) return { ok: false, reason: 'not UTF-8 text' }
  const parsed = parseSkillMarkdown(raw, { fallbackName: file.fallbackName, lenient })
  if (!parsed.ok) return parsed
  const origin = enrichOrigin(root, file.directory)
  const metadata: Record<string, unknown> = {
    ...parsed.skill.metadata,
    skillsAnywhere: {
      origin,
      root: root.path,
      relativePath: relative(root.path, file.path).split(sep).join('/'),
      ...(parsed.skill.warnings.length > 0 ? { warnings: parsed.skill.warnings } : {}),
    },
  }
  return {
    ok: true,
    skill: {
      name: parsed.skill.name,
      description: parsed.skill.description,
      ...(parsed.skill.whenToUse !== undefined ? { whenToUse: parsed.skill.whenToUse } : {}),
      invocation: parsed.skill.invocation,
      source: root.source,
      rank: root.rank,
      path: file.path,
      directory: file.directory,
      metadata,
      origin,
      root,
      contentHash: createHash('sha1').update(parsed.skill.content).digest('hex'),
      warnings: parsed.skill.warnings,
    },
  }
}

/** Fill marketplace/plugin names for Claude Code plugin roots from the path shape. */
function enrichOrigin(root: SkillRoot, directory: string): SkillOrigin {
  if (root.origin.kind !== 'claude-plugins') return root.origin
  // <root>/<marketplace>/<group>/<plugin>/skills/<skill>  (marketplace checkout)
  // <root>/<marketplace>/<plugin>/<version>/skills/<skill> (installed cache)
  const segments = relative(root.path, directory).split(sep)
  const skillsIndex = segments.lastIndexOf('skills')
  const marketplace = segments[0]
  const plugin = skillsIndex > 0 ? segments[skillsIndex - 1] : undefined
  return {
    ...root.origin,
    ...(marketplace !== undefined ? { marketplace } : {}),
    ...(plugin !== undefined && !/^\d+\.\d+/.test(plugin) ? { plugin } : (skillsIndex > 1 ? { plugin: segments[skillsIndex - 2] as string } : {})),
  }
}

async function realKey(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

function isAbsent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && ((error as { code: unknown }).code === 'ENOENT' || (error as { code: unknown }).code === 'ENOTDIR')
}

/** Nearest ancestor of `cwd` containing `.git`, else `cwd` itself (the dsh rule). */
export async function findProjectRoot(cwd: string): Promise<string> {
  let current = cwd
  while (true) {
    try {
      await stat(join(current, '.git'))
      return current
    } catch {
      // keep walking
    }
    const parent = dirname(current)
    if (parent === current) return cwd
    current = parent
  }
}
