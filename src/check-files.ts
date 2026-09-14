/** Read only explicitly named files; do not discover, sync or execute skills. */
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { basename, dirname, extname, resolve } from 'node:path'
import { checkSkill } from './skill-check.ts'
import { readSkillBytes } from './skill-input.ts'

export interface CheckOptions {
  readonly cwd: string
  readonly lenient: boolean
  readonly failOnRepair: boolean
  /**
   * Fail a file that reaches an external source it does not pin.
   *
   * Off by default, because whether a given host is acceptable is a policy
   * decision this tool has no standing to make. On, it requires recognized
   * full-commit source addresses. It does not fetch or verify remote bytes.
   */
  readonly requirePinnedSources: boolean
}

export async function checkFiles(paths: readonly string[], options: CheckOptions) {
  const pkg = createRequire(import.meta.url)('../package.json') as { version: string }
  const mode = options.lenient ? 'lenient' as const : 'strict' as const
  const files = []
  for (const input of paths) {
    try {
      const path = resolve(options.cwd, input)
      const bytes = await readSkillBytes(path)
      // An invalid encoding must not be silently repaired before the check.
      const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
      const fallback = basename(path) === 'SKILL.md' ? basename(dirname(path)) : basename(path, extname(path))
      const report = checkSkill(raw, fallback)
      const selected = report[mode]
      const unpinned = report.surface.externalSources.filter(source => !source.pinned).map(source => source.host)
      const passed = selected.ok
        && (!options.failOnRepair || selected.warnings.length === 0)
        && (!options.requirePinnedSources || unpinned.length === 0)
      files.push({
        path: input, status: passed ? 'passed' as const : 'failed' as const,
        sha256: createHash('sha256').update(bytes).digest('hex'), report,
        ...(options.requirePinnedSources && unpinned.length > 0 ? { unpinnedSources: unpinned } : {}),
      })
    } catch (error) {
      const message = error instanceof TypeError && 'code' in error && error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA'
        ? 'Input is not valid UTF-8.'
        : error instanceof Error ? error.message : String(error)
      files.push({ path: input, status: 'input_error' as const, error: message })
    }
  }
  const counts = {
    passed: files.filter(file => file.status === 'passed').length,
    failed: files.filter(file => file.status === 'failed').length,
    inputErrors: files.filter(file => file.status === 'input_error').length,
  }
  return {
    schema: 'skills-anywhere-file-check-1' as const,
    tool: { name: 'dsh-skills-anywhere', version: pkg.version },
    mode, failOnRepair: options.failOnRepair, requirePinnedSources: options.requirePinnedSources, files, counts,
    exitCode: counts.inputErrors > 0 ? 2 : counts.failed > 0 ? 1 : 0,
    scope: 'Provider parsing, plus an enumeration of external sources and declared tools. No verdict on intent, no payload scanning, no script or client compatibility verification.',
  }
}
