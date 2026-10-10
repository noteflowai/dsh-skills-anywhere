/**
 * Source revision for MCP `open_skill` load receipts: the HEAD commit of the
 * Git source checkout that supplied a skill, or `null` when this cannot be
 * proven.
 *
 * Git runs without a shell. Every `GIT_*` variable from the server environment
 * is removed so that `GIT_DIR` or `GIT_WORK_TREE` cannot redirect it. Upward
 * discovery also stops at the cache directory, so an enclosing repository (for
 * example a dotfiles-managed home) is never reported as the skill's source.
 *
 * @module
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { promisify } from 'node:util'
import { MAX_BUNDLE_BYTES, MAX_BUNDLE_FILES, MAX_BUNDLE_FILE_BYTES, validBundlePath, type BundleManifest } from './bundle-manifest.ts'
import type { SkillOrigin } from './discover.ts'
import { isInside } from './sources.ts'

const execFileAsync = promisify(execFile)
const SHA = /^[0-9a-f]{40}$/
const TIMEOUT_MS = 5000
const MAX_BUFFER = 64 * 1024
/** Per-probe output bound for the clean check; `ls-files` lists every tracked file. */
export const CLEAN_CHECK_MAX_OUTPUT_BYTES = 8 * 1024 * 1024
/** Per-probe time bound for the clean check. */
export const CLEAN_CHECK_TIMEOUT_MS = 15_000

export interface SourceCommitSkill {
  readonly name: string
  readonly directory: string
  readonly origin: SkillOrigin
}

export interface SourceCommitLogger {
  warn(message: string): void
}

type Probe = { readonly ok: true; readonly sha: string; readonly dir: string; readonly top: string } | { readonly ok: false; readonly reason: string }

export interface SourceCleanOptions {
  /** Lower the per-probe output bound (positive integer); it can never be raised. */
  readonly maxOutputBytes?: number
  /** Bind already-read delivery bytes to immutable objects in this exact commit. */
  readonly delivery?: {
    readonly commit: string
    readonly skillSha256: string
    readonly bundle?: BundleManifest
  }
}

/** Clean-check outcome: clean, `dirty` distinct changed paths, or an unprovable `reason`. */
export type SourceClean =
  | { readonly ok: true }
  | { readonly ok: false; readonly dirty: number }
  | { readonly ok: false; readonly reason: string }

type Run = { readonly ok: true; readonly stdout: string } | { readonly ok: false; readonly reason: string }

/**
 * HEAD commit of the Git source checkout holding `skill`.
 *
 * Returns `null` without running Git or logging for skills that do not come
 * from a Git source. For Git sources that cannot be proven, returns `null` and
 * logs exactly one warning. This function never throws.
 */
export async function sourceCommit(skill: SourceCommitSkill, cacheDir: string, log: SourceCommitLogger): Promise<string | null> {
  if (skill.origin.kind !== 'source') return null
  const result = await probe(skill.directory, cacheDir)
  if (result.ok) return result.sha
  log.warn(`skills-anywhere: source commit unavailable for ${skill.name}: ${result.reason}`)
  return null
}

/**
 * Whether the skill directory in its Git source checkout has no local changes:
 * no tracked edits or deletions, no untracked or ignored files, and no entries
 * hidden by the assume-unchanged or skip-worktree index flags.
 *
 * Both probes are read-only (`--no-optional-locks`, fsmonitor disabled), run
 * without a shell from the real skill directory, and are bounded by
 * {@link CLEAN_CHECK_MAX_OUTPUT_BYTES} and {@link CLEAN_CHECK_TIMEOUT_MS}.
 * Any failure resolves to `{ ok: false, reason }` and logs exactly one
 * warning. This function never throws.
 */
export async function sourceCommitClean(
  skill: SourceCommitSkill,
  cacheDir: string,
  log: SourceCommitLogger,
  options: SourceCleanOptions = {},
): Promise<SourceClean> {
  let result: SourceClean
  try {
    result = await cleanProbe(skill, cacheDir, options)
  } catch (error) {
    result = { ok: false, reason: 'unexpected error: ' + describe(error) }
  }
  if ('reason' in result) log.warn('skills-anywhere: source checkout not proven clean for ' + skill.name + ': ' + result.reason)
  return result
}

async function cleanProbe(skill: SourceCommitSkill, cacheDir: string, options: SourceCleanOptions): Promise<SourceClean> {
  if (skill.origin.kind !== 'source') return { ok: false, reason: 'skill is not from a Git source' }
  const requested = options.maxOutputBytes
  if (requested !== undefined) {
    if (!Number.isSafeInteger(requested) || requested < 1) return { ok: false, reason: 'maxOutputBytes must be a positive integer' }
  }
  const limit = Math.min(CLEAN_CHECK_MAX_OUTPUT_BYTES, requested ?? CLEAN_CHECK_MAX_OUTPUT_BYTES)

  // Same realpath, inside-cache, own-.git and skill-inside-checkout checks as the HEAD probe.
  const located = await probe(skill.directory, cacheDir)
  if (!located.ok) return { ok: false, reason: located.reason }
  if (options.delivery !== undefined && located.sha !== options.delivery.commit) {
    return { ok: false, reason: 'source commit changed during delivery' }
  }
  const cache = await realpath(cacheDir).catch(() => undefined)
  if (cache === undefined) return { ok: false, reason: 'source cache directory is not readable' }
  const env = gitEnv(cache)
  const base = ['--no-optional-locks', '-c', 'core.fsmonitor=false']

  const status = await runBounded([...base, 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching', '--', '.'], located.dir, env, limit)
  if (!status.ok) return { ok: false, reason: 'git status: ' + status.reason }
  // --full-name keeps paths repository-relative, matching porcelain status paths.
  const listing = await runBounded([...base, 'ls-files', '-v', '-z', '--full-name', '--', '.'], located.dir, env, limit)
  if (!listing.ok) return { ok: false, reason: 'git ls-files: ' + listing.reason }

  const paths = new Set<string>()
  // Renames and copies carry their original path in the field that follows.
  let originalNext = false
  for (const entry of status.stdout.split('\0')) {
    if (originalNext) {
      originalNext = false
      if (entry.length > 0) paths.add(entry)
      continue
    }
    if (entry.length === 0) continue
    if (entry.length < 4 || entry[2] !== ' ') return { ok: false, reason: 'git status returned a malformed entry' }
    paths.add(entry.slice(3))
    const x = entry[0]
    if (x === 'R' || x === 'C') originalNext = true
  }
  for (const entry of listing.stdout.split('\0')) {
    if (entry.length === 0) continue
    if (entry.length < 3 || entry[1] !== ' ') return { ok: false, reason: 'git ls-files returned a malformed entry' }
    const tag = entry[0] ?? ''
    // Lowercase tags mark assume-unchanged; S/s mark skip-worktree. git status cannot see either.
    if (/^[a-z]$/.test(tag) || tag === 'S') paths.add(entry.slice(2))
  }
  if (paths.size !== 0) return { ok: false, dirty: paths.size }
  if (options.delivery !== undefined) {
    const bound = await bindDelivery(located, env, options.delivery, limit)
    if (!bound.ok) return bound
    const final = await probe(skill.directory, cacheDir)
    if (!final.ok || final.sha !== located.sha || final.dir !== located.dir || final.top !== located.top) {
      return { ok: false, reason: 'source checkout changed during delivery' }
    }
  }
  return { ok: true }
}

/** Compare delivered hashes with immutable Git blobs, never a later worktree read. */
async function bindDelivery(
  located: Extract<Probe, { ok: true }>,
  env: NodeJS.ProcessEnv,
  delivery: NonNullable<SourceCleanOptions['delivery']>,
  limit: number,
): Promise<SourceClean> {
  if (!SHA.test(delivery.commit) || !/^[0-9a-f]{64}$/.test(delivery.skillSha256)) {
    return { ok: false, reason: 'invalid delivery binding' }
  }
  const prefix = relative(located.top, located.dir).split(sep).join('/')
  const path = (name: string): string => prefix ? `${prefix}/${name}` : name
  const base = ['--no-replace-objects', '--no-optional-locks', '-c', 'core.fsmonitor=false']
  const deadline = Date.now() + CLEAN_CHECK_TIMEOUT_MS
  const remainingTime = (): number => {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error('delivery verification time bound exceeded')
    return remaining
  }
  const digest = async (name: string, maxBytes: number): Promise<{ sha256: string; bytes: number }> => {
    const { stdout } = await execFileAsync('git', [...base, 'show', `${delivery.commit}:${path(name)}`], {
      cwd: located.dir, env, encoding: 'buffer', windowsHide: true,
      timeout: remainingTime(), maxBuffer: maxBytes + 1,
    })
    remainingTime()
    if (stdout.length > maxBytes) throw new Error('committed blob exceeds delivery byte bound')
    return { sha256: createHash('sha256').update(stdout).digest('hex'), bytes: stdout.length }
  }
  const skill = await digest('SKILL.md', 128 * 1024)
  if (skill.sha256 !== delivery.skillSha256) return { ok: false, reason: 'delivered SKILL.md differs from the pinned commit' }
  if (delivery.bundle !== undefined) {
    const files = delivery.bundle.files
    if (files.length < 1 || files.length > MAX_BUNDLE_FILES) return { ok: false, reason: 'delivery bundle exceeds file bound' }
    const listing = await runBounded([...base, 'ls-tree', '-r', '-l', '-z', delivery.commit, '--', '.'], located.dir, env, limit, remainingTime())
    if (!listing.ok) return { ok: false, reason: 'committed bundle listing: ' + listing.reason }
    remainingTime()
    const committed = new Map<string, number>()
    for (const entry of listing.stdout.split('\0').filter(Boolean)) {
      const match = /^(100644|100755) blob [0-9a-f]{40} +(\d+)\t([\s\S]+)$/.exec(entry)
      if (!match || !validBundlePath(match[3]!) || committed.has(match[3]!)) {
        return { ok: false, reason: 'committed bundle contains unsupported entries' }
      }
      committed.set(match[3]!, Number(match[2]))
    }
    if (committed.size !== files.length) return { ok: false, reason: 'delivered bundle inventory differs from the pinned commit' }
    let total = 0
    for (const file of files) {
      if (!validBundlePath(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0
          || file.bytes > MAX_BUNDLE_FILE_BYTES || committed.get(file.path) !== file.bytes) {
        return { ok: false, reason: 'delivered bundle entry differs from the pinned commit' }
      }
      committed.delete(file.path)
      total += file.bytes
      if (total > MAX_BUNDLE_BYTES) return { ok: false, reason: 'delivery bundle exceeds byte bound' }
      const blob = await digest(file.path, file.bytes)
      if (blob.sha256 !== file.sha256 || blob.bytes !== file.bytes) {
        return { ok: false, reason: 'delivered bundle bytes differ from the pinned commit' }
      }
    }
  }
  return { ok: true }
}

async function runBounded(
  args: readonly string[], cwd: string, env: NodeJS.ProcessEnv, maxBytes: number,
  timeoutMs = CLEAN_CHECK_TIMEOUT_MS,
): Promise<Run> {
  try {
    const result = await execFileAsync('git', [...args], {
      cwd,
      env,
      timeout: timeoutMs,
      maxBuffer: maxBytes,
      windowsHide: true,
    })
    return { ok: true, stdout: String(result.stdout) }
  } catch (error) {
    const code = (error as { code?: unknown }).code
    const message = error instanceof Error ? error.message : ''
    if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || /maxBuffer/i.test(message)) {
      return { ok: false, reason: 'git output exceeded the ' + maxBytes + '-byte output bound' }
    }
    if ((error as { killed?: boolean }).killed === true) return { ok: false, reason: 'git timed out after ' + timeoutMs + ' ms' }
    return { ok: false, reason: 'git failed: ' + describe(error) }
  }
}

async function probe(directory: string, cacheDir: string): Promise<Probe> {
  const cache = await realpath(cacheDir).catch(() => undefined)
  if (cache === undefined) return fail('source cache directory is not readable')
  const dir = await realpath(directory).catch(() => undefined)
  if (dir === undefined) return fail('skill directory is not readable')

  let stdout: string
  try {
    const result = await execFileAsync('git', ['rev-parse', '--show-toplevel', 'HEAD'], {
      cwd: dir,
      env: gitEnv(cache),
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
    })
    stdout = String(result.stdout)
  } catch (error) {
    if ((error as { killed?: boolean }).killed === true) return fail(`git timed out after ${TIMEOUT_MS} ms`)
    return fail(`git failed: ${describe(error)}`)
  }

  const [rawTop = '', rawSha = ''] = stdout.split(/\r?\n/)
  const reportedTop = rawTop.trim()
  const sha = rawSha.trim()
  if (reportedTop.length === 0 || !isAbsolute(reportedTop)) return fail('git did not report a work tree')
  const top = await realpath(reportedTop).catch(() => undefined)
  if (top === undefined) return fail('git reported an unreadable work tree')
  if (!isInside(cache, top)) return fail('work tree is outside the source cache')
  const hasGitDir = await stat(join(top, '.git')).then(info => info.isDirectory(), () => false)
  if (!hasGitDir) return fail('checkout has no .git directory')
  if (dir !== top && !isInside(top, dir)) return fail('skill directory is outside the checkout')
  if (!SHA.test(sha)) return fail('git returned a malformed commit')
  return { ok: true, sha, dir, top }
}

/** Server environment without any GIT_* override, bounded to the cache. */
function gitEnv(ceiling: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.toUpperCase().startsWith('GIT_')) env[key] = value
  }
  env.GIT_TERMINAL_PROMPT = '0'
  env.GIT_CEILING_DIRECTORIES = ceiling
  return env
}

function describe(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr
  const text = typeof stderr === 'string' && stderr.trim().length > 0
    ? stderr
    : error instanceof Error ? error.message : String(error)
  return text.split(/\r?\n/).find(line => line.trim().length > 0)?.trim() ?? 'unknown error'
}

function fail(reason: string): Probe {
  return { ok: false, reason }
}
