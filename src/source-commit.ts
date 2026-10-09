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
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
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

type Probe = { readonly ok: true; readonly sha: string; readonly dir: string } | { readonly ok: false; readonly reason: string }

export interface SourceCleanOptions {
  /** Lower the per-probe output bound (positive integer); it can never be raised. */
  readonly maxOutputBytes?: number
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
  return paths.size === 0 ? { ok: true } : { ok: false, dirty: paths.size }
}

async function runBounded(args: readonly string[], cwd: string, env: NodeJS.ProcessEnv, maxBytes: number): Promise<Run> {
  try {
    const result = await execFileAsync('git', [...args], {
      cwd,
      env,
      timeout: CLEAN_CHECK_TIMEOUT_MS,
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
    if ((error as { killed?: boolean }).killed === true) return { ok: false, reason: 'git timed out after ' + CLEAN_CHECK_TIMEOUT_MS + ' ms' }
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
  return { ok: true, sha, dir }
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
