/**
 * Git skill sources: parse `owner/repo`-style specs, keep a shallow clone per
 * repository in a local cache, and record what was synced in a lock file.
 *
 * Network work happens only here. Discovery reads the cached checkout, so a
 * failed sync degrades to "yesterday's skills" instead of an empty catalog.
 *
 * @module
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** One source as written in configuration or a sources file. */
export interface SourceSpec {
  /** `owner/repo`, `owner/repo/sub/dir`, `github:owner/repo`, a git URL, a GitHub tree URL, or a local path. */
  readonly repo: string
  /** Branch, tag, or commit SHA. Defaults to the repository's default branch. */
  readonly ref?: string
  /** Sub-directory to scan inside the repository. */
  readonly path?: string
  /** Precedence rank inside dsh (lower wins). */
  readonly rank?: number
}

export interface ResolvedSource extends SourceSpec {
  /** Stable repository identifier (`github.com/owner/repo`); shared by every ref. */
  readonly id: string
  /** `id` plus the ref when one is set; keys the cache directory and lock entry. */
  readonly key: string
  /** Clone URL handed to git. */
  readonly url: string
  /** Absolute cache directory holding the checkout. */
  readonly dir: string
  /** Absolute directory to scan (`dir` plus `path`). */
  readonly scanDir: string
  /** Short display name (for example `anthropics/skills`). */
  readonly display: string
}

export type SyncStatus = 'cloned' | 'updated' | 'unchanged' | 'failed' | 'skipped'

export interface SyncResult {
  readonly source: ResolvedSource
  readonly status: SyncStatus
  readonly sha?: string
  readonly error?: string
}

export interface LockEntry {
  readonly url: string
  readonly ref?: string
  readonly sha: string
  readonly syncedAt: string
}

export type LockFile = Record<string, LockEntry>

export interface SourcesFile {
  readonly sources: readonly SourceSpec[]
}

const SHA_LIKE = /^[0-9a-f]{7,40}$/i
const GITHUB_TREE = /^https?:\/\/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?\/tree\/([^/#?]+)(?:\/(.*?))?\/?$/
const GITHUB_PLAIN = /^https?:\/\/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/
const GIT_URL = /^(?:https?|ssh|git):\/\/|^git@|^[\w.-]+@[\w.-]+:/

/** Normalise a string or object spec into a resolved source. */
export function resolveSource(input: string | SourceSpec, cacheDir: string): ResolvedSource {
  const spec: SourceSpec = typeof input === 'string' ? parseSourceString(input) : input
  let repo = spec.repo.trim()
  let ref = spec.ref
  let subpath = spec.path

  // Suffix forms: owner/repo@v1, owner/repo#main
  const suffix = /^(.*?)[@#]([^@#/]+)$/.exec(repo)
  if (suffix !== null && !GIT_URL.test(repo) && !repo.startsWith('file:') && !isAbsolute(repo)) {
    repo = suffix[1] as string
    ref ??= suffix[2] as string
  }

  let url: string
  let id: string
  let display: string

  const tree = GITHUB_TREE.exec(repo)
  const plain = GITHUB_PLAIN.exec(repo)
  if (tree !== null) {
    const [, owner, name, treeRef, treePath] = tree
    url = `https://github.com/${owner}/${name}.git`
    id = `github.com/${owner}/${name}`
    display = `${owner}/${name}`
    ref ??= treeRef
    if (treePath !== undefined && treePath.length > 0) subpath ??= treePath
  } else if (plain !== null) {
    const [, owner, name] = plain
    url = `https://github.com/${owner}/${name}.git`
    id = `github.com/${owner}/${name}`
    display = `${owner}/${name}`
  } else if (repo.startsWith('file:')) {
    const local = resolve(fileURLToPath(repo))
    url = local
    id = `local/${shortHash(local)}`
    display = local
  } else if (isAbsolute(repo) || repo.startsWith('./') || repo.startsWith('../')) {
    const local = resolve(repo)
    url = local
    id = `local/${shortHash(local)}`
    display = local
  } else if (GIT_URL.test(repo)) {
    url = repo
    const cleaned = repo.replace(/^[a-z+]+:\/\//i, '').replace(/^git@/, '').replace(/:/, '/').replace(/\.git$/, '')
    id = cleaned.toLowerCase()
    display = cleaned
  } else {
    // owner/repo[/sub/path] with optional github: / gh: prefix
    const bare = trimSlashes(repo.replace(/^(?:github|gh):/, ''))
    const parts = bare.split('/')
    if (parts.length < 2 || parts[0]?.length === 0 || parts[1]?.length === 0) {
      throw new Error(`skills-anywhere: cannot parse source "${spec.repo}" (expected owner/repo, a git URL, or a local path)`)
    }
    const owner = parts[0] as string
    const name = (parts[1] as string).replace(/\.git$/, '')
    url = `https://github.com/${owner}/${name}.git`
    id = `github.com/${owner}/${name}`
    display = `${owner}/${name}`
    if (parts.length > 2) subpath ??= parts.slice(2).join('/')
  }

  // The id becomes a directory path under the cache and `syncSource` deletes a
  // stale checkout before cloning, so every segment must be a plain name: no
  // empty, `.` or `..` segments and no separators smuggled in through a URL or
  // a project-level sources file.
  const segments = id.split('/')
  if (segments.some(segment => !isPlainSegment(segment))) {
    throw new Error(`skills-anywhere: cannot parse source "${spec.repo}" (invalid path segment in ${id})`)
  }
  // One checkout per (repository, ref): two refs of one repository must not
  // fight over a single working tree.
  if (ref !== undefined) segments[segments.length - 1] = `${segments[segments.length - 1]}@${ref.replace(/[^\w.-]+/g, '_')}`
  const dir = join(cacheDir, ...segments)
  if (!isInside(cacheDir, dir)) throw new Error(`skills-anywhere: source "${spec.repo}" resolves outside the cache directory`)
  const scanDir = subpath !== undefined && subpath.length > 0 ? join(dir, ...subpath.split('/')) : dir
  if (scanDir !== dir && !isInside(dir, scanDir)) throw new Error(`skills-anywhere: source path escapes the repository: ${subpath}`)
  const key = ref !== undefined ? `${id}@${ref}` : id
  return {
    repo: spec.repo,
    ...(ref !== undefined ? { ref } : {}),
    ...(subpath !== undefined ? { path: subpath } : {}),
    ...(spec.rank !== undefined ? { rank: spec.rank } : {}),
    id,
    key,
    url,
    dir,
    scanDir,
    display: subpath !== undefined ? `${display}/${subpath}` : display,
  }
}

/** Strip leading and trailing `/` in linear time (a regex alternation here is quadratic on long runs). */
function trimSlashes(value: string): string {
  let start = 0
  let end = value.length
  while (start < end && value.charCodeAt(start) === 47) start += 1
  while (end > start && value.charCodeAt(end - 1) === 47) end -= 1
  return value.slice(start, end)
}

function isPlainSegment(segment: string): boolean {
  return segment.length > 0 && segment !== '.' && segment !== '..' && !/[\\/\0]/.test(segment)
}

/** Whether `child` is strictly inside `parent` (both absolute), separator-aware. */
export function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel)
}

function parseSourceString(input: string): SourceSpec {
  return { repo: input.trim() }
}

function shortHash(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 12)
}

export interface SyncOptions {
  readonly force?: boolean
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
  readonly log?: (message: string) => void
}

let gitAvailable: Promise<boolean> | undefined

/** Whether a usable `git` executable is on PATH (memoised). */
export function hasGit(): Promise<boolean> {
  gitAvailable ??= execFileAsync('git', ['--version']).then(() => true, () => false)
  return gitAvailable
}

/** Reset the git availability memo (tests). */
export function resetGitProbe(): void {
  gitAvailable = undefined
}

/** Clone or update one source into its cache directory. */
export async function syncSource(source: ResolvedSource, options: SyncOptions = {}): Promise<SyncResult> {
  if (!(await hasGit())) {
    return { source, status: 'skipped', error: 'git is not installed or not on PATH' }
  }
  const timeout = options.timeoutMs ?? 120_000
  const git = async (args: readonly string[], cwd?: string): Promise<string> => {
    const { stdout } = await execFileAsync('git', [...args], {
      cwd,
      timeout,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' },
      maxBuffer: 4 * 1024 * 1024,
    })
    return stdout.trim()
  }

  try {
    const existing = await isGitCheckout(source.dir)
    if (!existing) {
      await rm(source.dir, { recursive: true, force: true })
      await mkdir(dirname(source.dir), { recursive: true })
      const staging = `${source.dir}.tmp-${process.pid}`
      await rm(staging, { recursive: true, force: true })
      if (source.ref !== undefined && SHA_LIKE.test(source.ref)) {
        await mkdir(staging, { recursive: true })
        await git(['init', '-q'], staging)
        await git(['remote', 'add', 'origin', source.url], staging)
        await git(['fetch', '-q', '--depth', '1', 'origin', source.ref], staging)
        await git(['checkout', '-q', 'FETCH_HEAD'], staging)
      } else {
        const args = ['clone', '-q', '--depth', '1', '--single-branch']
        if (source.ref !== undefined) args.push('--branch', source.ref)
        args.push(source.url, staging)
        await git(args)
      }
      await rename(staging, source.dir)
      const sha = await git(['rev-parse', 'HEAD'], source.dir)
      options.log?.(`skills-anywhere: cloned ${source.display} @ ${sha.slice(0, 12)}`)
      return { source, status: 'cloned', sha }
    }

    const before = await git(['rev-parse', 'HEAD'], source.dir)
    if (source.ref !== undefined && SHA_LIKE.test(source.ref)) {
      if (before.startsWith(source.ref.toLowerCase()) && !options.force) {
        return { source, status: 'unchanged', sha: before }
      }
      await git(['fetch', '-q', '--depth', '1', 'origin', source.ref], source.dir)
      await git(['checkout', '-q', '--detach', 'FETCH_HEAD'], source.dir)
    } else {
      const target = source.ref ?? (await defaultBranch(git, source.dir))
      await git(['fetch', '-q', '--depth', '1', 'origin', target], source.dir)
      await git(['checkout', '-q', '--detach', 'FETCH_HEAD'], source.dir)
    }
    const after = await git(['rev-parse', 'HEAD'], source.dir)
    if (after === before) return { source, status: 'unchanged', sha: after }
    options.log?.(`skills-anywhere: updated ${source.display} ${before.slice(0, 12)} -> ${after.slice(0, 12)}`)
    return { source, status: 'updated', sha: after }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    options.log?.(`skills-anywhere: sync of ${source.display} failed: ${firstLine(message)}`)
    return { source, status: 'failed', error: firstLine(message) }
  }
}

async function defaultBranch(git: (args: readonly string[], cwd?: string) => Promise<string>, dir: string): Promise<string> {
  try {
    const ref = await git(['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'], dir)
    const name = ref.replace(/^refs\/remotes\/origin\//, '')
    if (name.length > 0) return name
  } catch {
    // fall through
  }
  try {
    const remote = await git(['ls-remote', '--symref', 'origin', 'HEAD'], dir)
    const match = /^ref: refs\/heads\/(\S+)\s+HEAD/m.exec(remote)
    if (match?.[1] !== undefined) return match[1]
  } catch {
    // fall through
  }
  return 'HEAD'
}

async function isGitCheckout(dir: string): Promise<boolean> {
  try {
    return (await stat(join(dir, '.git'))).isDirectory()
  } catch {
    return false
  }
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).find(line => line.trim().length > 0)?.trim() ?? text
}

// --- lock file --------------------------------------------------------------

export async function readLock(path: string): Promise<LockFile> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed as LockFile : {}
  } catch {
    return {}
  }
}

export async function writeLock(path: string, lock: LockFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(lock, null, 2)}\n`)
}

// --- sources files ----------------------------------------------------------

/** Read a `sources.json`; a missing file is an empty list, a malformed one throws. */
export async function readSourcesFile(path: string): Promise<SourceSpec[]> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'ENOENT') return []
    throw error
  }
  const parsed: unknown = JSON.parse(raw)
  const list = Array.isArray(parsed) ? parsed : (parsed as { sources?: unknown } | null)?.sources
  if (!Array.isArray(list)) throw new Error(`skills-anywhere: ${path} must be {"sources": [...]}`)
  return list.map((item: unknown) => {
    if (typeof item === 'string') return { repo: item }
    if (typeof item === 'object' && item !== null && typeof (item as { repo?: unknown }).repo === 'string') return item as SourceSpec
    throw new Error(`skills-anywhere: invalid source entry in ${path}: ${JSON.stringify(item)}`)
  })
}

export async function writeSourcesFile(path: string, sources: readonly (string | SourceSpec)[]): Promise<void> {
  const normalized = sources.map(source => (typeof source === 'string' ? { repo: source } : source))
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify({ sources: normalized }, null, 2)}\n`)
}

/** Whether two specs point at the same repository (ignoring ref/path/rank). */
export function sameRepository(left: string | SourceSpec, right: string | SourceSpec, cacheDir: string): boolean {
  try {
    return resolveSource(left, cacheDir).id === resolveSource(right, cacheDir).id
  } catch {
    return false
  }
}
