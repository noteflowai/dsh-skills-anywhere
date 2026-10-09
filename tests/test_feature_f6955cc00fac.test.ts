import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { afterEach, describe, expect, it } from 'vitest'
import { createSkillsAnywhereServer, type SkillsAnywhereMcp } from '../src/mcp.ts'
import { CLEAN_CHECK_MAX_OUTPUT_BYTES, sourceCommitClean } from '../src/source-commit.ts'
import { resolveSource, syncSource } from '../src/sources.ts'

// Synthetic local fixtures only: a throwaway Git repository configured as a
// source and cloned into the managed cache. No network, no real accounts.

const run = promisify(execFile)
const NAME = 'robot-reel-review'
const BODY = 'Step through the reel and confirm each joint fact before writing.'
const GUIDE = 'Reviewed guide text.\n'
const BULK_FILES = 2500
const SLOW = 120_000
const EXISTING_FIELDS = [
  'schema', 'load_id', 'loaded_at', 'provider', 'provider_version', 'name',
  'skill_sha256', 'content_sha256', 'bundle_sha256', 'declared_tools', 'permissions_enforced', 'source_commit',
]

function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.toUpperCase().startsWith('GIT_')) env[key] = value
  }
  env.GIT_TERMINAL_PROMPT = '0'
  return env
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd, env: gitEnv(), maxBuffer: 16 * 1024 * 1024 })
  return String(stdout).trim()
}

interface Fixture {
  readonly root: string
  readonly cacheDir: string
  readonly checkout: string
  readonly skillDir: string
  readonly head: string
  readonly client: Client
  readonly mcp: SkillsAnywhereMcp
  readonly warnings: string[]
}

const cleanups: (() => Promise<unknown>)[] = []

// Removing the 2,500-file fixtures (source repo plus cache clone) can exceed the
// default 10 s hook timeout on slow runners, so cleanup gets the same budget as the tests.
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
}, SLOW)

function bulkName(index: number): string {
  return 'item-' + String(index).padStart(4, '0') + '.md'
}

async function fixture(bulk: boolean): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'sa-clean-pin-'))
  cleanups.push(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }))
  const home = join(root, 'home')
  const project = join(root, 'project')
  const repo = join(root, 'repo')
  const cacheDir = join(root, 'cache')
  await mkdir(join(project, '.git'), { recursive: true })
  await mkdir(cacheDir, { recursive: true })

  const source = join(repo, NAME)
  await mkdir(join(source, 'references'), { recursive: true })
  await writeFile(join(source, 'SKILL.md'), '---\nname: ' + NAME + '\ndescription: Review recorded robot reel evidence\n---\n\n' + BODY + '\n')
  await writeFile(join(source, 'references', 'guide.md'), GUIDE)
  if (bulk) {
    const bulkDir = join(source, 'references', 'bulk')
    await mkdir(bulkDir, { recursive: true })
    for (let start = 0; start < BULK_FILES; start += 250) {
      const batch: Promise<void>[] = []
      for (let index = start; index < Math.min(BULK_FILES, start + 250); index += 1) {
        batch.push(writeFile(join(bulkDir, bulkName(index)), 'synthetic bulk asset ' + index + '\n'))
      }
      await Promise.all(batch)
    }
  }
  await writeFile(join(repo, 'README.md'), '# synthetic skills\n')
  await git(repo, 'init', '-q')
  await git(repo, 'add', '-A')
  await git(repo, 'commit', '-qm', 'reviewed revision')
  const cached = resolveSource(repo, cacheDir)
  // The product's own sync path creates the cache checkout, exactly as in real use,
  // so discovery and the source-commit probes see a genuine managed clone.
  const synced = await syncSource(cached)
  expect(synced).toMatchObject({ status: 'cloned' })
  const checkout = cached.dir
  const head = await git(checkout, 'rev-parse', 'HEAD')
  expect(head).toBe(await git(repo, 'rev-parse', 'HEAD'))

  const warnings: string[] = []
  const mcp = createSkillsAnywhereServer({
    cwd: project,
    config: { home, dshHome: join(home, '.dsh'), cacheDir, sources: [repo], sourcesFiles: false, sync: false, watch: false },
    log: { info: () => undefined, warn: (message: string) => { warnings.push(message) } },
    cacheMs: 0,
  })
  cleanups.push(() => mcp.close())
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await mcp.server.connect(serverTransport)
  const client = new Client({ name: 'clean-pin-test', version: '0.0.0' })
  await client.connect(clientTransport)
  cleanups.push(() => client.close())
  return { root, cacheDir, checkout, skillDir: join(checkout, NAME), head, client, mcp, warnings }
}

interface Outcome {
  readonly isError: boolean
  readonly text: string
  readonly structured: Record<string, unknown> | undefined
}

async function call(client: Client, args: Record<string, unknown>): Promise<Outcome> {
  const result = await client.callTool({ name: 'open_skill', arguments: args }) as {
    isError?: boolean
    content?: { type: string; text?: string }[]
    structuredContent?: Record<string, unknown>
  }
  const text = (result.content ?? []).map(block => block.text ?? '').join('\n')
  return { isError: result.isError === true, text, structured: result.structuredContent }
}

function pinned(f: Fixture): Promise<Outcome> {
  return call(f.client, { name: NAME, expected_source_commit: f.head })
}

async function expectDelivered(f: Fixture): Promise<void> {
  const result = await pinned(f)
  expect(result.isError).toBe(false)
  expect(result.text).toContain(BODY)
  const receipt = result.structured?.receipt as Record<string, unknown> | undefined
  expect(receipt).toBeDefined()
  for (const field of EXISTING_FIELDS) expect(receipt).toHaveProperty(field)
  expect(receipt?.schema).toBe('skills-anywhere-load-1')
  expect(receipt?.source_commit).toBe(f.head)
}

async function expectRefused(f: Fixture): Promise<Outcome> {
  const result = await pinned(f)
  expect(result.isError).toBe(true)
  expect(result.text).toContain('uncommitted change')
  expect(result.text).toContain('"' + NAME + '"')
  expect(result.text).not.toContain(BODY)
  expect(result.text).not.toContain('skill_content')
  expect(result.text).not.toContain(f.root)
  expect(result.text).not.toContain('guide.md')
  expect(result.text).not.toContain('item-')
  expect(result.structured ?? {}).not.toHaveProperty('receipt')
  return result
}

function cleanWarnings(f: Fixture): string[] {
  return f.warnings.filter(message => message.includes('source checkout not proven clean'))
}

describe('open_skill expected_source_commit requires a clean skill directory', () => {
  it('delivers a clean pinned skill with a large listing and refuses every kind of local change until restored', async () => {
    const f = await fixture(true)
    const listing = await git(f.checkout, 'ls-files', '-v', '-z', '--', NAME)
    expect(Buffer.byteLength(listing)).toBeGreaterThan(64 * 1024)

    await expectDelivered(f)
    // Source-probe warnings only; unrelated provider diagnostics are not part of this contract.
    expect(f.warnings.filter(message => message.includes('source checkout not proven clean') || message.includes('source commit unavailable'))).toEqual([])

    // Tracked edit.
    await writeFile(join(f.skillDir, 'references', 'guide.md'), 'Unreviewed guide text.\n')
    const edited = await expectRefused(f)
    expect(edited.text).toMatch(/has 1 uncommitted change/)
    await git(f.checkout, 'checkout', '--', NAME + '/references/guide.md')
    await expectDelivered(f)

    // Untracked addition.
    await writeFile(join(f.skillDir, 'references', 'extra.md'), 'Unreviewed extra file.\n')
    await expectRefused(f)
    await unlink(join(f.skillDir, 'references', 'extra.md'))
    await expectDelivered(f)

    // Deletion.
    await unlink(join(f.skillDir, 'references', 'guide.md'))
    await expectRefused(f)
    await git(f.checkout, 'checkout', '--', NAME + '/references/guide.md')
    await expectDelivered(f)

    // Edit hidden from git status by assume-unchanged.
    await git(f.checkout, 'update-index', '--assume-unchanged', NAME + '/SKILL.md')
    await writeFile(join(f.skillDir, 'SKILL.md'), '---\nname: ' + NAME + '\ndescription: Review recorded robot reel evidence\n---\n\nUnreviewed assume-unchanged instructions.\n')
    expect(await git(f.checkout, 'status', '--porcelain', '--', NAME)).toBe('')
    const assumed = await expectRefused(f)
    expect(assumed.text).not.toContain('Unreviewed assume-unchanged instructions.')
    await git(f.checkout, 'update-index', '--no-assume-unchanged', NAME + '/SKILL.md')
    await git(f.checkout, 'checkout', '--', NAME + '/SKILL.md')
    await expectDelivered(f)

    // Edit hidden from git status by skip-worktree.
    await git(f.checkout, 'update-index', '--skip-worktree', NAME + '/SKILL.md')
    await writeFile(join(f.skillDir, 'SKILL.md'), '---\nname: ' + NAME + '\ndescription: Review recorded robot reel evidence\n---\n\nUnreviewed skip-worktree instructions.\n')
    expect(await git(f.checkout, 'status', '--porcelain', '--', NAME)).toBe('')
    const skipped = await expectRefused(f)
    expect(skipped.text).not.toContain('Unreviewed skip-worktree instructions.')
    await git(f.checkout, 'update-index', '--no-skip-worktree', NAME + '/SKILL.md')
    await git(f.checkout, 'checkout', '--', NAME + '/SKILL.md')
    await expectDelivered(f)

    expect(cleanWarnings(f)).toEqual([])
  }, SLOW)

  it('ignores changes outside the skill directory, leaves unpinned loads alone and keeps the commit refusal', async () => {
    const f = await fixture(false)
    await writeFile(join(f.checkout, 'README.md'), '# locally edited readme\n')
    await writeFile(join(f.checkout, 'NOTES.md'), 'untracked note outside the skill\n')
    await expectDelivered(f)

    await writeFile(join(f.skillDir, 'references', 'guide.md'), 'Unreviewed guide text.\n')
    await expectRefused(f)
    const unpinned = await call(f.client, { name: NAME })
    expect(unpinned.isError).toBe(false)
    expect(unpinned.text).toContain(BODY)
    expect((unpinned.structured?.receipt as { source_commit?: unknown } | undefined)?.source_commit).toBe(f.head)
    await git(f.checkout, 'checkout', '--', NAME + '/references/guide.md')

    await git(f.checkout, 'add', '-A')
    await git(f.checkout, 'commit', '-qm', 'unreviewed revision')
    const moved = await git(f.checkout, 'rev-parse', 'HEAD')
    expect(moved).not.toBe(f.head)
    const result = await pinned(f)
    expect(result.isError).toBe(true)
    expect(result.text).toContain('Git source commit changed for "' + NAME + '"')
    expect(result.text).not.toContain(BODY)
    expect(cleanWarnings(f)).toEqual([])
  }, SLOW)

  it('fails closed with one warning when the index is corrupt', async () => {
    const f = await fixture(false)
    await writeFile(join(f.checkout, '.git', 'index'), 'this is not a git index file\n')
    const result = await pinned(f)
    expect(result.isError).toBe(true)
    expect(result.text).toContain('could not be proven clean')
    expect(result.text).toContain('"' + NAME + '"')
    expect(result.text).not.toContain(BODY)
    expect(result.text).not.toContain(f.root)
    expect(result.structured ?? {}).not.toHaveProperty('receipt')
    const warnings = cleanWarnings(f)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('source checkout not proven clean for ' + NAME)
  }, SLOW)

  it('reports an exceeded output bound without throwing', async () => {
    const f = await fixture(true)
    expect(CLEAN_CHECK_MAX_OUTPUT_BYTES).toBe(8 * 1024 * 1024)
    const skill = (await f.mcp.refresh(true)).skills.find(entry => entry.name === NAME)
    expect(skill).toBeDefined()
    const messages: string[] = []
    const log = { warn: (message: string) => { messages.push(message) } }

    expect(await sourceCommitClean(skill!, f.cacheDir, log)).toEqual({ ok: true })
    expect(messages).toEqual([])

    const bounded = await sourceCommitClean(skill!, f.cacheDir, log, { maxOutputBytes: 1024 })
    expect(bounded.ok).toBe(false)
    expect('reason' in bounded ? bounded.reason : '').toMatch(/output bound/)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('source checkout not proven clean for ' + NAME)
  }, SLOW)
})
