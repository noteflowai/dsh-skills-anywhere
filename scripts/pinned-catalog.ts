/**
 * Offline checks for a commit-pinned skill catalog (schema
 * `skills-anywhere-pinned-catalog-1`) and the source config it describes.
 *
 * Shared by `tests/isaaclab-catalog.test.ts` (offline, CI) and
 * `scripts/verify-pinned-catalog.ts` (manual, network). dsh-skills-anywhere
 * never reads a catalog at runtime.
 */
import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type * as Dsh from '../src/index.ts'
import type { SourceSpec } from '../src/sources.ts'

/**
 * The dsh-skills-anywhere API these checks call. Tests pass the sources
 * (`../src/index.ts`); the manual script passes the built package
 * (`../lib/index.js`), because Node's type stripping cannot load every module
 * under `src/`.
 */
export type DshApi = Pick<typeof Dsh, 'resolveSource' | 'resolveConfig' | 'discover' | 'SkillsAnywhereProvider'>

export const CATALOG_SCHEMA = 'skills-anywhere-pinned-catalog-1'
export const BYPASS_IDS = ['isaaclab-project-agent-dirs', 'unpinned-isaaclab-source', 'non-allowlisted-on-disk'] as const

const FULL_SHA = /^[0-9a-f]{40}$/
const SHA256 = /^[0-9a-f]{64}$/

export interface FileIdentity {
  readonly sha256: string
  readonly bytes: number
}

export interface SkillLink {
  readonly directory: string
  readonly name: string
  readonly allowlisted: boolean
}

export interface CatalogSkill {
  readonly slug: string
  readonly directory: string
  readonly name: string
  readonly audience: string
  readonly status: string
  readonly license: { readonly spdx: string; readonly file: string; readonly basis: string }
  readonly files: Readonly<Record<string, FileIdentity>>
  readonly references: {
    readonly links: readonly string[]
    readonly mentioned_paths: readonly string[]
    readonly outside_checkout?: readonly { readonly path: string; readonly context: string }[]
    readonly skill_links: readonly SkillLink[]
    readonly mentioned_skills: readonly SkillLink[]
  }
}

export interface ExcludedSkill {
  readonly directory: string
  readonly name: string
  readonly audience: string
  readonly status: string
  readonly reason: string
  readonly note?: string
}

export interface Bypass {
  readonly id: string
  readonly description: string
  readonly check: string
  readonly mitigation: string
}

export interface PinnedCatalog {
  readonly schema: string
  readonly recorded_on: string
  readonly description: string
  readonly config: string
  readonly source: {
    readonly repository: string
    readonly url: string
    readonly tag: string
    readonly tag_kind: string
    readonly commit: string
    readonly committed_at: string
    readonly version_file: string
  }
  readonly license_files: Readonly<Record<string, FileIdentity & { readonly spdx: string; readonly spdx_line: number }>>
  readonly skills: readonly CatalogSkill[]
  readonly excluded: readonly ExcludedSkill[]
  readonly bypasses: readonly Bypass[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isIdentity(value: unknown): value is FileIdentity {
  return isRecord(value) && typeof value.sha256 === 'string' && SHA256.test(value.sha256)
    && typeof value.bytes === 'number' && Number.isInteger(value.bytes) && value.bytes > 0
}

function isRepoPath(value: unknown): value is string {
  return nonEmpty(value) && !value.startsWith('/') && !value.endsWith('/') && !value.split('/').some(part => part === '' || part === '.' || part === '..')
}

/**
 * Validate the catalog shape and its agreement with a source list (the
 * `sources` of `skills-anywhere.json`). Returns every problem found; an empty
 * array means the pair is consistent.
 */
export function validatePinnedCatalog(dsh: DshApi, input: unknown, sources: readonly (string | SourceSpec)[]): string[] {
  const errors: string[] = []
  if (!isRecord(input)) return ['catalog: not a JSON object']
  const catalog = input as unknown as PinnedCatalog
  if (catalog.schema !== CATALOG_SCHEMA) errors.push(`catalog: schema must be ${CATALOG_SCHEMA}`)
  const source = isRecord(catalog.source) ? catalog.source : undefined
  if (source === undefined) return [...errors, 'catalog: missing source']
  if (!nonEmpty(source.repository)) errors.push('source: missing repository')
  if (!FULL_SHA.test(String(source.commit))) errors.push('source: commit must be a full 40-character lowercase SHA')
  if (!nonEmpty(source.tag)) errors.push('source: missing tag')

  const licenseFiles = isRecord(catalog.license_files) ? catalog.license_files : {}
  if (Object.keys(licenseFiles).length === 0) errors.push('catalog: missing license_files')
  for (const [file, entry] of Object.entries(licenseFiles)) {
    if (!isIdentity(entry) || !nonEmpty(entry.spdx)) errors.push(`license_files.${file}: needs spdx, sha256 and bytes`)
  }

  const skills = Array.isArray(catalog.skills) ? catalog.skills : []
  if (skills.length === 0) errors.push('catalog: no skills')
  const excluded = Array.isArray(catalog.excluded) ? catalog.excluded : []
  const excludedDirs = new Set(excluded.map(entry => entry.directory))
  const slugs = new Set<string>()
  const names = new Set<string>()
  const directories = new Set<string>()
  for (const [index, skill] of skills.entries()) {
    const label = isRecord(skill) && nonEmpty(skill.slug) ? skill.slug : `skills[${index}]`
    if (!isRecord(skill)) {
      errors.push(`${label}: not an object`)
      continue
    }
    if (!nonEmpty(skill.slug) || slugs.has(skill.slug)) errors.push(`${label}: slug missing or duplicated`)
    if (!nonEmpty(skill.name) || names.has(skill.name)) errors.push(`${label}: published name missing or duplicated`)
    if (!isRepoPath(skill.directory) || !skill.directory.endsWith(`/${skill.slug}`) || directories.has(skill.directory)) {
      errors.push(`${label}: directory must be a unique repository path ending in the slug`)
    }
    if (excludedDirs.has(skill.directory)) errors.push(`${label}: ${skill.directory} is listed as excluded`)
    slugs.add(String(skill.slug))
    names.add(String(skill.name))
    directories.add(String(skill.directory))
    if (!nonEmpty(skill.audience)) errors.push(`${label}: missing audience`)
    if (!nonEmpty(skill.status)) errors.push(`${label}: missing status`)
    const license = isRecord(skill.license) ? skill.license : undefined
    if (license === undefined) {
      errors.push(`${label}: missing license`)
    } else {
      if (!nonEmpty(license.spdx)) errors.push(`${label}: missing license.spdx`)
      if (!nonEmpty(license.basis)) errors.push(`${label}: missing license.basis`)
      const file = nonEmpty(license.file) ? licenseFiles[license.file] : undefined
      if (file === undefined) errors.push(`${label}: license.file must name an entry of license_files`)
      else if (file.spdx !== license.spdx) errors.push(`${label}: license.spdx differs from license_files.${license.file}`)
    }
    const files = isRecord(skill.files) ? skill.files : {}
    if (!isIdentity(files['SKILL.md'])) errors.push(`${label}: files must record SKILL.md`)
    for (const [file, identity] of Object.entries(files)) {
      if (!isRepoPath(file) || !isIdentity(identity)) errors.push(`${label}: files.${file} needs a relative path, sha256 and bytes`)
    }
    const references = isRecord(skill.references) ? skill.references : undefined
    if (references === undefined || !Array.isArray(references.links) || !Array.isArray(references.mentioned_paths)
      || !Array.isArray(references.skill_links) || !Array.isArray(references.mentioned_skills)) {
      errors.push(`${label}: references needs links, mentioned_paths, skill_links and mentioned_skills`)
    } else {
      for (const path of [...references.links, ...references.mentioned_paths]) {
        if (!isRepoPath(path)) errors.push(`${label}: reference ${String(path)} is not a checkout-relative path`)
      }
    }
  }

  for (const entry of excluded) {
    if (!isRecord(entry) || !isRepoPath(entry.directory) || !nonEmpty(entry.reason)) errors.push(`excluded: ${JSON.stringify(entry)} needs directory and reason`)
  }
  if (excludedDirs.size !== excluded.length) errors.push('excluded: duplicated directory')

  const bypasses = Array.isArray(catalog.bypasses) ? catalog.bypasses : []
  for (const id of BYPASS_IDS) {
    const bypass = bypasses.find(entry => isRecord(entry) && entry.id === id)
    if (bypass === undefined || !nonEmpty(bypass.description) || !nonEmpty(bypass.check) || !nonEmpty(bypass.mitigation)) {
      errors.push(`bypasses: ${id} needs description, check and mitigation`)
    }
  }

  // The config must be exactly the catalogued allowlist, pinned to the catalogued commit.
  const seenPaths = new Set<string>()
  const repoId = nonEmpty(source.repository) ? safeId(dsh, source.repository) : undefined
  for (const [index, entry] of sources.entries()) {
    const label = `sources[${index}]`
    if (typeof entry === 'string' || !isRecord(entry)) {
      errors.push(`${label}: must be an object with repo, ref and path`)
      continue
    }
    if (repoId === undefined || safeId(dsh, entry.repo) !== repoId) errors.push(`${label}: repo must be ${source.repository}`)
    if (typeof entry.ref !== 'string' || !FULL_SHA.test(entry.ref)) errors.push(`${label}: ref must be a full 40-character lowercase commit SHA, not a tag, branch or short SHA`)
    else if (entry.ref !== source.commit) errors.push(`${label}: ref ${entry.ref} differs from the catalogued commit ${source.commit}`)
    if (typeof entry.path !== 'string' || !directories.has(entry.path)) errors.push(`${label}: path ${JSON.stringify(entry.path)} is not a catalogued skill directory`)
    else if (seenPaths.has(entry.path)) errors.push(`${label}: path ${entry.path} is duplicated`)
    if (typeof entry.path === 'string') seenPaths.add(entry.path)
  }
  for (const directory of directories) {
    if (!seenPaths.has(directory)) errors.push(`config: no source for catalogued skill ${directory}`)
  }
  return errors
}

function safeId(dsh: DshApi, repo: string): string | undefined {
  try {
    // The cache directory is irrelevant here; the id is derived from `repo` alone.
    return dsh.resolveSource(repo, '/').id.toLowerCase()
  } catch {
    return undefined
  }
}

/** One configured source that would be scanned in addition to the pinned allowlist. */
export interface SourceBypass {
  readonly origin: string
  readonly entry: string | SourceSpec
  readonly reason: string
}

/**
 * Find sources for the catalogued repository that are not one of the pinned,
 * allowlisted entries (bypass `unpinned-isaaclab-source`).
 */
export function unpinnedSourceBypasses(dsh: DshApi, catalog: PinnedCatalog, specs: readonly { origin: string; entry: string | SourceSpec }[]): SourceBypass[] {
  const repoId = safeId(dsh, catalog.source.repository)
  const allowed = new Set(catalog.skills.map(skill => skill.directory))
  const found: SourceBypass[] = []
  for (const { origin, entry } of specs) {
    let resolved
    try {
      resolved = dsh.resolveSource(entry, '/')
    } catch {
      continue
    }
    if (resolved.id.toLowerCase() !== repoId) continue
    const path = resolved.path ?? ''
    if (resolved.ref === undefined) found.push({ origin, entry, reason: 'no ref: follows the default branch' })
    else if (!FULL_SHA.test(resolved.ref)) found.push({ origin, entry, reason: `ref ${resolved.ref} is not a full commit SHA (tags, branches and short SHAs are resolved again on sync)` })
    else if (resolved.ref !== catalog.source.commit) found.push({ origin, entry, reason: `ref ${resolved.ref} is not the catalogued commit ${catalog.source.commit}` })
    else if (!allowed.has(path)) found.push({ origin, entry, reason: path.length === 0 ? 'no path: scans the whole repository, including .agents/skills' : `path ${path} is not an allowlisted skill directory` })
  }
  return found
}

/** A catalogued upstream skill discovered from a project's agent directories. */
export interface ProjectAgentSkill {
  readonly name: string
  readonly agent: string
  readonly path: string
  readonly allowlisted: boolean
}

/**
 * Discover the project-scope agent directories dsh would scan for `cwd` (shared
 * `.agents/skills` included, as the standalone MCP server does) and return the
 * skills whose names belong to the catalogued repository (bypass
 * `isaaclab-project-agent-dirs`). Uses dsh's own agent table and discovery.
 */
export async function projectAgentBypasses(dsh: DshApi, catalog: PinnedCatalog, cwd: string): Promise<ProjectAgentSkill[]> {
  const allowlisted = new Set(catalog.skills.map(skill => skill.name))
  const known = new Set([...allowlisted, ...catalog.excluded.map(entry => entry.name)])
  const config = dsh.resolveConfig({ home: cwd, dshHome: join(cwd, '.dsh'), sharedDirs: true, claudePlugins: false, sourcesFiles: false, sync: false, watch: false }, {})
  const provider = new dsh.SkillsAnywhereProvider(config, { info: () => undefined, warn: () => undefined })
  try {
    const roots = (await provider.roots(cwd)).filter(root => root.origin.kind === 'agent' && root.origin.scope === 'project')
    const found: ProjectAgentSkill[] = []
    // One root at a time: upstream's .claude/skills links to .agents/skills, and
    // a combined pass would collapse them, hiding the root the dsh plugin scans.
    for (const root of roots) {
      const report = await dsh.discover([root], { dedupe: false, lenient: true })
      for (const skill of report.skills) {
        if (known.has(skill.name)) found.push({ name: skill.name, agent: skill.origin.agent ?? 'unknown', path: skill.path, allowlisted: allowlisted.has(skill.name) })
      }
    }
    return found.toSorted((left, right) => left.agent.localeCompare(right.agent) || left.name.localeCompare(right.name))
  } finally {
    await provider.dispose()
  }
}

/**
 * List directories below `checkout` that hold a SKILL.md but are not catalogued
 * skills (bypass `non-allowlisted-on-disk`). Symlinks are not followed, so
 * upstream's `.agents/skills` aliases are not counted twice.
 */
export async function nonAllowlistedOnDisk(catalog: PinnedCatalog, checkout: string): Promise<string[]> {
  const allowed = new Set(catalog.skills.map(skill => skill.directory))
  const entries = await readdir(checkout, { recursive: true, withFileTypes: true })
  return entries
    .filter(entry => entry.isFile() && entry.name === 'SKILL.md')
    .map(entry => relative(checkout, entry.parentPath).split(sep).join('/'))
    .filter(directory => !directory.split('/').includes('.git') && !allowed.has(directory))
    .toSorted()
}
