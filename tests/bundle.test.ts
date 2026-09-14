import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { compareManifests, makeManifest, validateManifest } from '../src/bundle-manifest.ts'
import { readBundle } from '../src/skill-bundle.ts'
import { main } from '../src/cli.ts'
import { tempDir } from './helpers.ts'

const markdown = '---\nname: review\ndescription: Review supplied evidence.\n---\nRead references/policy.txt.\n'
afterEach(() => vi.restoreAllMocks())

async function fixture() {
  const root = await tempDir('bundle')
  await fs.mkdir(join(root, 'references'))
  await fs.writeFile(join(root, 'SKILL.md'), markdown)
  await fs.writeFile(join(root, 'references/policy.txt'), 'Keep exact notes.')
  await fs.writeFile(join(root, '.settings'), Buffer.from([0, 255, 13, 10]))
  return root
}

describe('directory content identity', () => {
  it('preserves exact bytes, includes hidden/binary files, and survives relocation', async () => {
    const root = await fixture()
    const copy = join(await tempDir('bundle-copy'), 'relocated')
    await fs.cp(root, copy, { recursive: true })
    const first = await readBundle(root)
    const second = await readBundle(copy)
    expect(first.manifest).toEqual(second.manifest)
    expect(first.skillBytes.toString()).toBe(markdown)
    expect(first.manifest.files.map(file => file.path)).toEqual(['.settings', 'SKILL.md', 'references/policy.txt'])
    expect(first.manifest.files[0]!.sha256).toBe(createHash('sha256').update(Buffer.from([0, 255, 13, 10])).digest('hex'))
    expect(await validateManifest(JSON.parse(JSON.stringify(first.manifest)))).toEqual(first.manifest)
    expect(JSON.stringify(first.manifest)).not.toContain('Keep exact notes.')
  })

  it('distinguishes unchanged instructions from changed, added and removed resources', async () => {
    const root = await fixture()
    const before = (await readBundle(root)).manifest
    await fs.writeFile(join(root, 'references/policy.txt'), 'Skip exact notes.')
    await fs.unlink(join(root, '.settings'))
    await fs.writeFile(join(root, 'new.json'), '{}')
    const after = (await readBundle(root)).manifest
    expect(after.files.find(file => file.path === 'SKILL.md')).toEqual(before.files.find(file => file.path === 'SKILL.md'))
    expect(compareManifests(before, after)).toMatchObject({
      matches: false, added: ['new.json'], removed: ['.settings'], changed: ['references/policy.txt'],
    })
    expect(compareManifests(after, after).matches).toBe(true)
  })

  it('hashes a specified canonical tuple independently of JSON indentation and object key order', async () => {
    const files = [{ path: 'SKILL.md', bytes: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' }]
    const canonical = '["skills-anywhere-bundle-1",[["SKILL.md",0,"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"]]]'
    const manifest = await makeManifest(files)
    expect(manifest.sha256).toBe(createHash('sha256').update(canonical).digest('hex'))
    expect(await validateManifest({ files, total_bytes: 0, sha256: manifest.sha256, schema: manifest.schema })).toEqual(manifest)
  })

  it.each([
    ['digest', (value: any) => { value.sha256 = '0'.repeat(64) }],
    ['total', (value: any) => { value.total_bytes = true }],
    ['schema', (value: any) => { value.schema = 'unknown' }],
    ['extra field', (value: any) => { value.approved = true }],
    ['traversal', (value: any) => { value.files[0].path = '../outside' }],
    ['absolute path', (value: any) => { value.files[0].path = '/outside' }],
    ['backslash', (value: any) => { value.files[0].path = 'scripts\\run.js' }],
    ['duplicate path', (value: any) => { value.files.push(value.files[0]) }],
    ['negative bytes', (value: any) => { value.files[0].bytes = -1 }],
    ['boolean bytes', (value: any) => { value.files[0].bytes = true }],
    ['bad hash', (value: any) => { value.files[0].sha256 = 'BAD' }],
    ['null row', (value: any) => { value.files[0] = null }],
    ['missing SKILL.md', (value: any) => { value.files = value.files.filter((file: any) => file.path !== 'SKILL.md') }],
  ])('rejects a malformed manifest: %s', async (_, change) => {
    const root = await fixture()
    const document = structuredClone((await readBundle(root)).manifest)
    change(document)
    await expect(validateManifest(document)).rejects.toThrow()
  })

  it('rejects impossible file trees and byte/count limits in received manifests', async () => {
    const file = { path: 'SKILL.md', bytes: 1, sha256: 'a'.repeat(64) }
    await expect(makeManifest([file, { ...file, path: 'SKILL.md/child' }])).rejects.toThrow('also be a directory')
    await expect(makeManifest([{ ...file, bytes: 128 * 1024 + 1 }])).rejects.toThrow('128 KiB')
    await expect(makeManifest(Array.from({ length: 513 }, () => file))).rejects.toThrow('512')
    await expect(makeManifest([file, ...['a', 'b', 'c'].map(path => ({ ...file, path, bytes: 16 * 1024 * 1024 }))])).rejects.toThrow('32 MiB')
  })

  it('rejects missing instructions, invalid UTF-8 and oversized physical files', async () => {
    const root = await tempDir('bundle-invalid')
    await expect(readBundle(root)).rejects.toThrow('SKILL.md')
    await fs.writeFile(join(root, 'SKILL.md'), Buffer.from([0xff]))
    await expect(readBundle(root)).rejects.toThrow()
    await fs.truncate(join(root, 'SKILL.md'), 128 * 1024 + 1)
    await expect(readBundle(root)).rejects.toThrow('limit')
    await fs.writeFile(join(root, 'SKILL.md'), markdown)
    const asset = await fs.open(join(root, 'large.bin'), 'w')
    await asset.truncate(16 * 1024 * 1024 + 1)
    await asset.close()
    await expect(readBundle(root)).rejects.toThrow('limit')
    await expect(readBundle(join(root, 'SKILL.md'))).rejects.toThrow('directory')
  })

  it('bounds directory depth and the number of files before returning a digest', async () => {
    const root = await fixture()
    await fs.mkdir(join(root, ...Array.from({ length: 13 }, () => 'deep')), { recursive: true })
    await expect(readBundle(root)).rejects.toThrow('path levels')
    await fs.rm(join(root, 'deep'), { recursive: true })
    await Promise.all(Array.from({ length: 510 }, (_, i) => fs.writeFile(join(root, `file-${i}`), '')))
    await expect(readBundle(root)).rejects.toThrow('512')
  })

  it.runIf(process.platform !== 'win32')('supports a linked installation root and rejects nested links, pipes and ambiguous names', async () => {
    const root = await fixture()
    const parent = await tempDir('bundle-links')
    const alias = join(parent, 'installed')
    await fs.symlink(root, alias)
    expect((await readBundle(alias)).manifest).toEqual((await readBundle(root)).manifest)
    const link = join(root, 'external')
    await fs.symlink(parent, link)
    await expect(readBundle(root)).rejects.toThrow('links')
    await fs.unlink(link)
    execFileSync('mkfifo', [link])
    await expect(readBundle(root)).rejects.toThrow('regular files')
    await fs.unlink(link)
    // macOS rejects invalid UTF-8 during creation; the literal replacement
    // character exercises the same reader rejection on that filesystem.
    const ambiguous = process.platform === 'darwin' ? join(root, '\ufffd')
      : Buffer.concat([Buffer.from(root + '/'), Buffer.from([0xff])])
    await fs.writeFile(ambiguous, 'unread')
    await expect(readBundle(root)).rejects.toThrow('relative path')
  })

  it('detects a file that changes while its bytes are being read', async () => {
    const root = await tempDir('bundle-race')
    const path = join(root, 'SKILL.md')
    await fs.writeFile(path, markdown)
    const probe = await fs.open(path)
    const prototype = Object.getPrototypeOf(probe) as typeof probe
    const original = probe.read
    await probe.close()
    let changed = false
    vi.spyOn(prototype, 'read').mockImplementation((async function (this: typeof probe, ...params: any[]) {
      const result = await (original as any).apply(this, params)
      if (!changed) {
        changed = true
        await fs.appendFile(path, 'CHANGED')
      }
      return result
    }) as typeof probe.read)
    await expect(readBundle(root)).rejects.toThrow('changed during inspection')
  })
})

describe('bundle command', () => {
  it('exports a manifest, compares received reviews and uses distinct exit codes', async () => {
    const root = await fixture()
    const cwd = await tempDir('bundle-review')
    const messages: string[] = []
    vi.spyOn(console, 'log').mockImplementation(text => { messages.push(String(text)) })
    expect(await main(['bundle', root, '--json'])).toBe(0)
    const saved = messages.pop()!
    await fs.writeFile(join(cwd, 'review.json'), saved)
    const args = ['bundle', root, '--cwd', cwd, '--against', 'review.json', '--json']
    expect(await main(args)).toBe(0)
    expect(JSON.parse(messages.pop()!).matches).toBe(true)
    await fs.writeFile(join(root, 'references/policy.txt'), 'Changed resource')
    expect(await main(args)).toBe(1)
    expect(JSON.parse(messages.pop()!).changed).toEqual(['references/policy.txt'])
    await fs.writeFile(join(cwd, 'review.json'), '{invalid')
    expect(await main(args)).toBe(2)
    expect(JSON.parse(messages.pop()!).schema).toBe('skills-anywhere-bundle-error-1')
  })

  it('rejects manifests inside the directory, malformed input and misplaced flags', async () => {
    const root = await fixture()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await fs.writeFile(join(root, 'review.json'), '{}')
    expect(await main(['bundle', root, '--against', join(root, 'review.json')])).toBe(2)
    expect(await main(['bundle'])).toBe(2)
    expect(await main(['bundle', root, '--lenient'])).toBe(2)
    expect(await main(['check', 'SKILL.md', '--against', 'review.json'])).toBe(2)
  })

  it('bounds the review manifest read and rejects special inputs', async () => {
    const root = await fixture()
    const cwd = await tempDir('bundle-bad-review')
    const out: string[] = []
    vi.spyOn(console, 'log').mockImplementation(text => { out.push(String(text)) })
    const path = join(cwd, 'large.json')
    await fs.writeFile(path, ' '.repeat(1024 * 1024 + 1))
    expect(await main(['bundle', root, '--against', path, '--json'])).toBe(2)
    expect(JSON.parse(out.pop()!).error).toContain('1 MiB')
    expect(await main(['bundle', root, '--against', cwd, '--json'])).toBe(2)
  })
})
