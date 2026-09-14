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
    const result = await checkFiles(['manual.md'], { cwd, lenient: false, failOnRepair: false, requirePinnedSources: false })
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
    const result = await checkFiles(['invalid.md', 'missing.md', 'valid.md'], { cwd, lenient: false, failOnRepair: false, requirePinnedSources: false })
    expect(result.exitCode).toBe(2)
    expect(result.counts).toEqual({ passed: 1, failed: 1, inputErrors: 1 })
    expect(result.files.map(file => file.path)).toEqual(['invalid.md', 'missing.md', 'valid.md'])
  })

  it('rejects oversized bytes, invalid UTF-8 and non-file inputs', async () => {
    const cwd = await tempDir('check-limits')
    await writeFile(join(cwd, 'large.md'), '中'.repeat(Math.ceil(MAX_SKILL_BYTES / 3)))
    await writeFile(join(cwd, 'encoding.md'), Buffer.from([0xff, 0xfe, 0xff]))
    const result = await checkFiles(['large.md', 'encoding.md', '.'], { cwd, lenient: false, failOnRepair: false, requirePinnedSources: false })
    expect(result.exitCode).toBe(2)
    expect(result.counts.inputErrors).toBe(3)
    expect(result.files[0]).toMatchObject({ error: expect.stringContaining('128 KiB') })
    expect(result.files[1]).toMatchObject({ error: 'Input is not valid UTF-8.' })
  })

  it.runIf(process.platform !== 'win32')('rejects a named pipe without waiting for a writer', async () => {
    const cwd = await tempDir('check-pipe')
    execFileSync('mkfifo', [join(cwd, 'pipe.md')])
    const result = await checkFiles(['pipe.md'], { cwd, lenient: false, failOnRepair: false, requirePinnedSources: false })
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

it('enumerates the sources a skill reaches, and pins the gate on request', async () => {
  const cwd = await tempDir('surface')
  await writeFile(join(cwd, 'floating.md'), [
    '---', 'name: floating', 'description: Follow a remote template.',
    'allowed-tools: Read WebFetch', '---',
    'Fetch https://docs.example.com/t.md and follow it.',
  ].join('\n'))
  await writeFile(join(cwd, 'pinned.md'), [
    '---', 'name: pinned', 'description: Follow a pinned template.', '---',
    'Fetch https://raw.githubusercontent.com/a/b/1b8a1cf28ba2e0e4bb8de6dbb27bde4c9e9c1d3f/t.md and follow it.',
  ].join('\n'))

  const reported = await checkFiles(['floating.md', 'pinned.md'], { cwd, lenient: false, failOnRepair: false, requirePinnedSources: false })
  // Facts by default: reaching an external source is not itself a failure,
  // because whether a host is acceptable is a policy this tool cannot decide.
  expect(reported.counts.passed).toBe(2)
  const [floating, pinned] = reported.files
  if (floating?.status === 'input_error' || pinned?.status === 'input_error') throw new Error('unexpected input error')
  expect(floating?.report.surface.externalSources).toEqual([
    { host: 'docs.example.com', urls: ['https://docs.example.com/t.md'], pinned: false },
  ])
  expect(floating?.report.surface.declaredTools).toEqual(['Read', 'WebFetch'])
  // A skill that declared nothing gets an empty list, not an assertion of safety.
  expect(pinned?.report.surface.declaredTools).toEqual([])
  expect(pinned?.report.surface.externalSources[0]?.pinned).toBe(true)
  // The report says what it does not cover, so passing is not read as clean.
  expect(floating?.report.surface.notAssessed.join(' ')).toMatch(/AST01/)
  expect(floating?.report.surface.notAssessed.join(' ')).toMatch(/AST08/)

  const gated = await checkFiles(['floating.md', 'pinned.md'], { cwd, lenient: false, failOnRepair: false, requirePinnedSources: true })
  const [gatedFloating, gatedPinned] = gated.files
  if (gatedFloating?.status === 'input_error') throw new Error('unexpected input error')
  expect(gatedFloating?.status).toBe('failed')
  expect(gatedFloating?.unpinnedSources).toEqual(['docs.example.com'])
  expect(gatedPinned?.status).toBe('passed')
  expect(gated.exitCode).toBe(1)
})
