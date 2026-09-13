import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkFiles } from '../src/check-files.ts'
import { main } from '../src/cli.ts'
import { MAX_SKILL_BYTES } from '../src/skill-check.ts'
import { tempDir } from './helpers.ts'

const valid = '---\nname: manual\ndescription: Describe observed facts.\ndisable-model-invocation: true\n---\nPrivate body: do not include in reports.\n'
afterEach(() => vi.restoreAllMocks())

describe('explicit file checks', () => {
  it('reads only named files, preserves input bytes and does not create state', async () => {
    const cwd = await tempDir('check')
    await writeFile(join(cwd, 'manual.md'), valid)
    await mkdir(join(cwd, '.claude'))
    await writeFile(join(cwd, '.claude', 'SKILL.md'), 'unrelated')
    const result = await checkFiles(['manual.md'], { cwd, lenient: false, failOnRepair: false })
    expect(result.exitCode).toBe(0)
    expect(result.files).toHaveLength(1)
    expect(result.files[0]).toMatchObject({
      path: 'manual.md', sha256: createHash('sha256').update(valid).digest('hex'),
      report: { strict: { invocation: { modelInvocable: false } } },
    })
    expect(JSON.stringify(result)).not.toContain('Private body')
    expect(await readFile(join(cwd, 'manual.md'), 'utf8')).toBe(valid)
    expect((await readdir(cwd)).toSorted()).toEqual(['.claude', 'manual.md'])
  })

  it('defaults to a strict CI gate, compares both modes and can reject repairs', async () => {
    const cwd = await tempDir('check-modes')
    await mkdir(join(cwd, 'Incident Notes'))
    await writeFile(join(cwd, 'Incident Notes', 'SKILL.md'), 'Summarize the supplied incident.')
    const out: string[] = []
    vi.spyOn(console, 'log').mockImplementation(text => { out.push(String(text)) })
    const args = ['check', 'Incident Notes/SKILL.md', '--cwd', cwd, '--json']
    expect(await main(args)).toBe(1)
    expect(JSON.parse(out.pop()!)).toMatchObject({
      mode: 'strict', counts: { passed: 0, failed: 1, inputErrors: 0 },
      files: [{ report: { lenient: { ok: true, name: 'incident-notes' } } }],
    })
    expect(await main([...args, '--lenient'])).toBe(0)
    expect(await main([...args, '--lenient', '--fail-on-repair'])).toBe(1)
  })

  it('keeps every result and distinguishes input errors from rejected Markdown', async () => {
    const cwd = await tempDir('check-errors')
    await writeFile(join(cwd, 'valid.md'), valid)
    await writeFile(join(cwd, 'invalid.md'), '---\nname: [broken\n---\nBody')
    const result = await checkFiles(['invalid.md', 'missing.md', 'valid.md'], { cwd, lenient: false, failOnRepair: false })
    expect(result.exitCode).toBe(2)
    expect(result.counts).toEqual({ passed: 1, failed: 1, inputErrors: 1 })
    expect(result.files.map(file => file.path)).toEqual(['invalid.md', 'missing.md', 'valid.md'])
  })

  it('rejects oversized bytes, invalid UTF-8 and non-file inputs', async () => {
    const cwd = await tempDir('check-limits')
    await writeFile(join(cwd, 'large.md'), '中'.repeat(Math.ceil(MAX_SKILL_BYTES / 3)))
    await writeFile(join(cwd, 'encoding.md'), Buffer.from([0xff, 0xfe, 0xff]))
    const result = await checkFiles(['large.md', 'encoding.md', '.'], { cwd, lenient: false, failOnRepair: false })
    expect(result.exitCode).toBe(2)
    expect(result.counts.inputErrors).toBe(3)
    expect(result.files[0]).toMatchObject({ error: expect.stringContaining('128 KiB') })
    expect(result.files[1]).toMatchObject({ error: 'Input is not valid UTF-8.' })
  })

  it.runIf(process.platform !== 'win32')('rejects a named pipe without waiting for a writer', async () => {
    const cwd = await tempDir('check-pipe')
    execFileSync('mkfifo', [join(cwd, 'pipe.md')])
    const result = await checkFiles(['pipe.md'], { cwd, lenient: false, failOnRepair: false })
    expect(result.files[0]).toMatchObject({ status: 'input_error', error: 'Choose a regular Markdown file.' })
  })

  it('requires explicit inputs and escapes control characters in terminal output', async () => {
    const cwd = await tempDir('check-terminal')
    await writeFile(join(cwd, 'control.md'), '---\nname: "\\u001b[31m"\ndescription: Test\n---\nBody')
    const out: string[] = []
    vi.spyOn(console, 'log').mockImplementation(text => { out.push(String(text)) })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await main(['check', '--cwd', cwd])).toBe(2)
    expect(await main(['agents', '--lenient'])).toBe(2)
    expect(await main(['check', 'control.md', '--cwd', cwd])).toBe(1)
    expect(out.join('\n')).not.toContain('\u001b')
  })
})
