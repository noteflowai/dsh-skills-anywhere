/** Read only explicitly named files; do not discover, sync or execute skills. */
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, extname, resolve } from 'node:path'
import { checkSkill, MAX_SKILL_BYTES } from './skill-check.ts'

export interface CheckOptions {
  readonly cwd: string
  readonly lenient: boolean
  readonly failOnRepair: boolean
}

async function readInput(path: string): Promise<Buffer> {
  // NONBLOCK lets us reject named pipes on POSIX without waiting for a writer.
  const handle = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0))
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error('Choose a regular Markdown file.')
    if (stat.size > MAX_SKILL_BYTES) throw new Error('Choose a SKILL.md of 128 KiB or less.')
    // Bound the read as well as stat: the file can grow while being checked.
    const buffer = Buffer.alloc(MAX_SKILL_BYTES + 1)
    let size = 0
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null)
      if (bytesRead === 0) break
      size += bytesRead
    }
    if (size > MAX_SKILL_BYTES) throw new Error('Choose a SKILL.md of 128 KiB or less.')
    return buffer.subarray(0, size)
  } finally {
    await handle.close()
  }
}

export async function checkFiles(paths: readonly string[], options: CheckOptions) {
  const pkg = createRequire(import.meta.url)('../package.json') as { version: string }
  const mode = options.lenient ? 'lenient' as const : 'strict' as const
  const files = []
  for (const input of paths) {
    try {
      const path = resolve(options.cwd, input)
      const bytes = await readInput(path)
      // An invalid encoding must not be silently repaired before the check.
      const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
      const fallback = basename(path) === 'SKILL.md' ? basename(dirname(path)) : basename(path, extname(path))
      const report = checkSkill(raw, fallback)
      const selected = report[mode]
      const passed = selected.ok && (!options.failOnRepair || selected.warnings.length === 0)
      files.push({
        path: input, status: passed ? 'passed' as const : 'failed' as const,
        sha256: createHash('sha256').update(bytes).digest('hex'), report,
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
    mode, failOnRepair: options.failOnRepair, files, counts,
    exitCode: counts.inputErrors > 0 ? 2 : counts.failed > 0 ? 1 : 0,
    scope: 'Provider parsing only; no script, resource, security or client compatibility verification.',
  }
}
