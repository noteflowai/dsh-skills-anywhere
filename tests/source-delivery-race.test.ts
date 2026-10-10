import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { devNull, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSkillsAnywhereServer } from '../src/mcp.ts'
import { readBundle } from '../src/skill-bundle.ts'
import { resolveSource, syncSource } from '../src/sources.ts'

type Snapshot = Awaited<ReturnType<typeof readBundle>>

const interleave = vi.hoisted(() => ({
  afterSkillRead: undefined as ((path: string, bytes: Buffer) => Promise<void>) | undefined,
  afterBundleRead: undefined as ((directory: string, snapshot: Snapshot) => Promise<void>) | undefined,
  afterSourceCommit: undefined as ((commit: string | null) => Promise<void>) | undefined,
  beforeClean: undefined as (() => Promise<void>) | undefined,
}))

// Wrap actual I/O, not its result: the handler receives bytes genuinely read
// from the fixture, and the real Git clean/blob probes still decide acceptance.
vi.mock('../src/skill-input.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/skill-input.ts')>()
  return {
    ...actual,
    readSkillBytes: async (path: string) => {
      const bytes = await actual.readSkillBytes(path)
      await interleave.afterSkillRead?.(path, bytes)
      return bytes
    },
  }
})

vi.mock('../src/skill-bundle.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/skill-bundle.ts')>()
  return {
    ...actual,
    readBundle: async (directory: string) => {
      const snapshot = await actual.readBundle(directory)
      await interleave.afterBundleRead?.(directory, snapshot)
      return snapshot
    },
  }
})

vi.mock('../src/source-commit.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/source-commit.ts')>()
  return {
    ...actual,
    sourceCommit: async (...args: Parameters<typeof actual.sourceCommit>) => {
      const commit = await actual.sourceCommit(...args)
      await interleave.afterSourceCommit?.(commit)
      return commit
    },
    sourceCommitClean: async (...args: Parameters<typeof actual.sourceCommitClean>) => {
      await interleave.beforeClean?.()
      return actual.sourceCommitClean(...args)
    },
  }
})

const run = promisify(execFile)
const NAME = 'delivery-review'
const CLEAN_BODY = 'Follow the reviewed delivery instructions.'
const DIRTY_BODY = 'UNCOMMITTED-INSTRUCTIONS-MUST-NOT-BE-DELIVERED'
const GUIDE = 'Reviewed reference.\n'
const DIRTY_GUIDE = 'Injected reference.\n'
const SKILL = Buffer.from(`---\nname: ${NAME}\ndescription: Review a synthetic delivery\n---\n\n${CLEAN_BODY}\n`)
const DIRTY_SKILL = Buffer.from(SKILL.toString().replace(CLEAN_BODY, DIRTY_BODY))
const cleanups: (() => Promise<unknown>)[] = []

afterEach(async () => {
  interleave.afterSkillRead = undefined
  interleave.afterBundleRead = undefined
  interleave.afterSourceCommit = undefined
  interleave.beforeClean = undefined
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup()
})

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.toUpperCase().startsWith('GIT_')) env[key] = value
  }
  env.GIT_TERMINAL_PROMPT = '0'
  env.GIT_CONFIG_NOSYSTEM = '1'
  env.GIT_CONFIG_GLOBAL = devNull
  const { stdout } = await run('git', [
    '-c', 'user.name=Delivery Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main',
    '-c', 'core.autocrlf=false', '-c', 'core.fsmonitor=false',
    '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...args,
  ], { cwd, env, windowsHide: true, timeout: 15_000 })
  return stdout.trim()
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sa-delivery-race-'))
  cleanups.push(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }))
  const home = join(root, 'home')
  const project = join(root, 'project')
  const repo = join(root, 'repo')
  const cacheDir = join(root, 'cache')
  const source = join(repo, NAME)
  await mkdir(join(project, '.git'), { recursive: true })
  await mkdir(cacheDir, { recursive: true })
  await mkdir(join(source, 'references'), { recursive: true })
  await writeFile(join(source, 'SKILL.md'), SKILL)
  await writeFile(join(source, 'references', 'guide.md'), GUIDE)
  // Keep committed/delivered bytes identical on Windows regardless of CRLF defaults.
  await writeFile(join(repo, '.gitattributes'), '* -text\n')
  await writeFile(join(repo, 'README.md'), '# revision A\n')
  await git(repo, 'init', '-q')
  await git(repo, 'add', '-A')
  await git(repo, 'commit', '-qm', 'synthetic revision A')
  const cached = resolveSource(repo, cacheDir)
  const synced = await syncSource(cached)
  expect(synced.status, synced.error).toBe('cloned')
  const checkout = cached.dir
  const head = await git(checkout, 'rev-parse', 'HEAD')
  const skillDir = join(checkout, NAME)
  const skillPath = join(skillDir, 'SKILL.md')
  const guidePath = join(skillDir, 'references', 'guide.md')
  expect(await readFile(skillPath)).toEqual(SKILL)

  const mcp = createSkillsAnywhereServer({
    cwd: project,
    config: {
      home, dshHome: join(home, '.dsh'), cacheDir, sources: [repo],
      sourcesFiles: false, sync: false, syncOnStart: false, watch: false,
    },
    log: { info: () => undefined, warn: () => undefined },
    cacheMs: 60_000,
  })
  cleanups.push(() => mcp.close())
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await mcp.server.connect(serverTransport)
  const client = new Client({ name: 'delivery-race-test', version: '0.0.0' })
  await client.connect(clientTransport)
  cleanups.push(() => client.close())
  // Discover clean metadata before arming any race; use the actual cached entry.
  const report = await mcp.refresh()
  expect(report.skills.find(skill => skill.name === NAME)?.origin.kind).toBe('source')
  return { root, checkout, skillDir, skillPath, guidePath, head, client }
}

type Fixture = Awaited<ReturnType<typeof fixture>>

async function open(f: Fixture, args: Record<string, unknown> = {}) {
  const result = await f.client.callTool({
    name: 'open_skill',
    arguments: { name: NAME, expected_source_commit: f.head, ...args },
  }) as {
    isError?: boolean
    content?: { type: string; text?: string }[]
    structuredContent?: Record<string, unknown>
  }
  return { ...result, text: (result.content ?? []).map(block => block.text ?? '').join('\n') }
}

function cleanObservations(f: Fixture) {
  const observations: { head: string; status: string }[] = []
  interleave.beforeClean = async () => {
    observations.push({
      head: await git(f.checkout, 'rev-parse', 'HEAD'),
      status: await git(f.checkout, 'status', '--porcelain=v1', '--untracked-files=all'),
    })
  }
  return observations
}

function expectRefused(result: Awaited<ReturnType<typeof open>>) {
  expect(result.isError).toBe(true)
  expect(result.text).toContain('could not be proven clean')
  expect(result.text).not.toContain('uncommitted change(s)')
  expect(result.text).not.toContain('skill_instructions')
  expect(result.text).not.toContain(CLEAN_BODY)
  expect(result.text).not.toContain(DIRTY_BODY)
  expect(result.structuredContent ?? {}).not.toHaveProperty('receipt')
  expect(result.structuredContent ?? {}).not.toHaveProperty('content')
  expect(result.structuredContent ?? {}).not.toHaveProperty('bundle')
}

describe('actual open_skill delivery snapshot races', () => {
  it('refuses dirty SKILL.md bytes restored before the clean probe', async () => {
    const f = await fixture()
    await writeFile(f.skillPath, DIRTY_SKILL)
    const observed = cleanObservations(f)
    const delivered: Buffer[] = []
    interleave.afterSkillRead = async (path, bytes) => {
      if (path !== f.skillPath) return
      delivered.push(Buffer.from(bytes))
      await writeFile(path, SKILL)
    }

    const result = await open(f, { expected_sha256: sha256(DIRTY_SKILL) })
    // Assertions outside callbacks cannot accidentally turn a failed hook into
    // the handler rejection that this regression is supposed to prove.
    expect(delivered).toEqual([DIRTY_SKILL])
    expect(observed).toEqual([{ head: f.head, status: '' }])
    expect(await readFile(f.skillPath)).toEqual(SKILL)
    expectRefused(result)
  })

  it('refuses HEAD A sampled before the clean probe sees clean HEAD B', async () => {
    const f = await fixture()
    // Only an out-of-skill file changes: A and B deliver identical skill bytes.
    await writeFile(join(f.checkout, 'README.md'), '# revision B\n')
    await git(f.checkout, 'add', 'README.md')
    await git(f.checkout, 'commit', '-qm', 'synthetic revision B')
    const headB = await git(f.checkout, 'rev-parse', 'HEAD')
    expect(headB).not.toBe(f.head)
    await git(f.checkout, 'checkout', '--detach', '-q', f.head)
    const observed = cleanObservations(f)
    const sampled: (string | null)[] = []
    interleave.afterSourceCommit = async commit => {
      sampled.push(commit)
      await git(f.checkout, 'checkout', '--detach', '-q', headB)
    }

    const result = await open(f, { expected_sha256: sha256(SKILL) })
    expect(sampled).toEqual([f.head])
    expect(observed).toEqual([{ head: headB, status: '' }])
    expect(await readFile(f.skillPath)).toEqual(SKILL)
    expectRefused(result)
  })

  it('refuses a dirty reference snapshot restored before bundle clean/blob checks', async () => {
    const f = await fixture()
    expect(Buffer.byteLength(DIRTY_GUIDE)).toBe(Buffer.byteLength(GUIDE))
    await writeFile(f.guidePath, DIRTY_GUIDE)
    const observed = cleanObservations(f)
    const snapshots: Snapshot[] = []
    interleave.afterBundleRead = async (directory, snapshot) => {
      if (directory !== f.skillDir) return
      snapshots.push(snapshot)
      await writeFile(f.guidePath, GUIDE)
    }

    const result = await open(f, { include_bundle: true, expected_sha256: sha256(SKILL) })
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]?.skillBytes).toEqual(SKILL)
    expect(snapshots[0]?.manifest.files.find(file => file.path === 'references/guide.md')).toEqual({
      path: 'references/guide.md', bytes: Buffer.byteLength(DIRTY_GUIDE), sha256: sha256(DIRTY_GUIDE),
    })
    expect(observed).toEqual([{ head: f.head, status: '' }])
    expect(await readFile(f.guidePath, 'utf8')).toBe(GUIDE)
    expectRefused(result)
  })

  it('delivers a clean bundled skill pinned to the committed bytes and inventory', async () => {
    const f = await fixture()
    const { manifest } = await readBundle(f.skillDir)
    const observed = cleanObservations(f)
    const result = await open(f, {
      include_bundle: true, expected_sha256: sha256(SKILL), expected_bundle_sha256: manifest.sha256,
    })
    expect(observed).toEqual([{ head: f.head, status: '' }])
    expect(result.isError).toBeFalsy()
    expect(result.text).toContain(CLEAN_BODY)
    expect(result.structuredContent).toMatchObject({
      sha256: sha256(SKILL), bundle: manifest,
      receipt: {
        schema: 'skills-anywhere-load-1', source_commit: f.head,
        skill_sha256: sha256(SKILL), bundle_sha256: manifest.sha256,
      },
    })
  })
})
