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

export interface SourceCommitSkill {
  readonly name: string
  readonly directory: string
  readonly origin: SkillOrigin
}

export interface SourceCommitLogger {
  warn(message: string): void
}

type Probe = { readonly ok: true; readonly sha: string } | { readonly ok: false; readonly reason: string }

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
  return { ok: true, sha }
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
