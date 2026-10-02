import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { afterEach, describe, expect, it } from 'vitest'
import { createSkillsAnywhereServer } from '../src/mcp.ts'
import { resolveSource } from '../src/sources.ts'

// Synthetic local fixtures: a throwaway Git repository configured as a source,
// cloned into the managed cache, plus one agent-directory skill.

const run = promisify(execFile)
const BODY = 'Step through the reel and confirm each joint fact before writing.'
const LOCAL_BODY = 'Local notes body that must never leak.'

function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.toUpperCase().startsWith('GIT_')) env[key] = value
  }
  env.GIT_TERMINAL_PROMPT = '0'
  return env
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd, env: gitEnv() })
  return String(stdout).trim()
}

async function skillFile(dir: string, name: string, description: string, body: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), '---\nname: ' + name + '\ndescription: ' + description + '\n---\n\n' + body + '\n')
}

interface Fixture {
  readonly checkout: string
  readonly head: string
  readonly client: Client
  readonly warnings: string[]
}

const cleanups: (() => Promise<unknown>)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'sa-source-pin-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const home = join(root, 'home')
  const project = join(root, 'project')
  const repo = join(root, 'repo')
  const cacheDir = join(root, 'cache')
  await mkdir(join(project, '.git'), { recursive: true })
  await mkdir(cacheDir, { recursive: true })

  await skillFile(join(repo, 'robot-reel-review'), 'robot-reel-review', 'Review recorded robot reel evidence', BODY)
  await git(repo, 'init', '-q')
  await git(repo, 'add', '-A')
  await git(repo, 'commit', '-qm', 'reviewed revision')
  const checkout = resolveSource(repo, cacheDir).dir
  await mkdir(dirname(checkout), { recursive: true })
  await git(root, 'clone', '-q', repo, checkout)
  const head = await git(checkout, 'rev-parse', 'HEAD')

  await skillFile(join(home, '.claude', 'skills', 'local-notes'), 'local-notes', 'Local notes kept in an agent directory', LOCAL_BODY)

  const warnings: string[] = []
  const mcp = createSkillsAnywhereServer({
    cwd: project,
    config: { home, dshHome: join(home, '.dsh'), cacheDir, sources: [repo], sourcesFiles: false, sync: false, watch: false },
    log: { info: () => undefined, warn: (message: string) => { warnings.push(message) } },
  })
  cleanups.push(() => mcp.close())
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await mcp.server.connect(serverTransport)
  const client = new Client({ name: 'source-pin-test', version: '0.0.0' })
  await client.connect(clientTransport)
  cleanups.push(() => client.close())
  return { checkout, head, client, warnings }
}

interface Outcome {
  readonly isError: boolean
  readonly text: string
  readonly receipt?: { source_commit?: string | null } | undefined
}

/** Call open_skill; input-validation failures may surface as a thrown protocol error or an isError result. */
async function openSkill(client: Client, args: Record<string, unknown>): Promise<Outcome> {
  try {
    const result = await client.callTool({ name: 'open_skill', arguments: args }) as {
      isError?: boolean
      content?: { type: string; text?: string }[]
      structuredContent?: { receipt?: { source_commit?: string | null } }
    }
    const text = (result.content ?? []).map(block => block.text ?? '').join('\n')
    const receipt = result.structuredContent?.receipt
    const isError = result.isError === true
    return receipt === undefined ? { isError, text } : { isError, text, receipt }
  } catch (error) {
    return { isError: true, text: error instanceof Error ? error.message : String(error) }
  }
}

describe('open_skill expected_source_commit', () => {
  it('delivers when the pin matches and leaves unpinned loads unchanged', async () => {
    const { client, head } = await fixture()
    const pinned = await openSkill(client, { name: 'robot-reel-review', expected_source_commit: head })
    expect(pinned.isError).toBe(false)
    expect(pinned.text).toContain(BODY)
    expect(pinned.receipt?.source_commit).toBe(head)

    const unpinned = await openSkill(client, { name: 'robot-reel-review' })
    expect(unpinned.isError).toBe(false)
    expect(unpinned.text).toContain(BODY)
    expect(unpinned.receipt?.source_commit).toBe(head)

    const local = await openSkill(client, { name: 'local-notes' })
    expect(local.isError).toBe(false)
    expect(local.text).toContain(LOCAL_BODY)
    expect(local.receipt?.source_commit).toBeNull()
  })

  it('refuses delivery after the cached checkout moves to another commit', async () => {
    const { client, head, checkout } = await fixture()
    await writeFile(join(checkout, 'NOTES.md'), 'unreviewed change\n')
    await git(checkout, 'add', '-A')
    await git(checkout, 'commit', '-qm', 'unreviewed revision')
    const moved = await git(checkout, 'rev-parse', 'HEAD')
    expect(moved).not.toBe(head)

    const result = await openSkill(client, { name: 'robot-reel-review', expected_source_commit: head })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('Git source commit changed for "robot-reel-review"')
    expect(result.text).toContain(head)
    expect(result.text).toContain(moved)
    expect(result.text).not.toContain(BODY)
    expect(result.text).not.toContain('skill_content')
  })

  it('fails closed when the source commit cannot be proven', async () => {
    const { client, head, checkout, warnings } = await fixture()
    await rm(join(checkout, '.git'), { recursive: true, force: true })
    const result = await openSkill(client, { name: 'robot-reel-review', expected_source_commit: head })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('could not be proven')
    expect(result.text).not.toContain(BODY)
    expect(warnings.some(message => message.includes('source commit unavailable for robot-reel-review'))).toBe(true)
  })

  it('rejects malformed pins and non-Git origins without instruction text', async () => {
    const { client, head } = await fixture()
    for (const bad of [head.slice(0, 7), head.toUpperCase()]) {
      // Called directly, without the try/catch helper: a schema rejection must
      // resolve as a CallToolResult with isError true, not a thrown protocol error.
      const result = await client.callTool({ name: 'open_skill', arguments: { name: 'robot-reel-review', expected_source_commit: bad } }) as {
        isError?: boolean
        content?: { type: string; text?: string }[]
        structuredContent?: unknown
      }
      const text = (result.content ?? []).map(block => block.text ?? '').join('\n')
      expect(result.isError).toBe(true)
      expect(text).toContain('expected_source_commit')
      expect(text).toContain('must be a full 40-character lowercase Git commit')
      expect(text).not.toContain(BODY)
      expect(result.structuredContent ?? {}).not.toHaveProperty('receipt')
    }
    const local = await openSkill(client, { name: 'local-notes', expected_source_commit: head })
    expect(local.isError).toBe(true)
    expect(local.text).toContain('is not from a Git source')
    expect(local.text).not.toContain(LOCAL_BODY)
  })

  it('keeps the existing digest error first and runs no git for a rejected digest', async () => {
    const { client, head, checkout, warnings } = await fixture()
    const wrong = '0'.repeat(64)
    const matching = await openSkill(client, { name: 'robot-reel-review', expected_source_commit: head, expected_sha256: wrong })
    expect(matching.isError).toBe(true)
    expect(matching.text).toContain('SKILL.md changed: expected_sha256 does not match')
    expect(matching.text).not.toContain(BODY)

    // With an unprovable checkout, a digest rejection still wins and the git probe never runs.
    await rm(join(checkout, '.git'), { recursive: true, force: true })
    const rejected = await openSkill(client, { name: 'robot-reel-review', expected_source_commit: head, expected_sha256: wrong })
    expect(rejected.text).toContain('SKILL.md changed: expected_sha256 does not match')
    expect(warnings).toHaveLength(0)
  })

  it('advertises expected_source_commit as an optional input', async () => {
    const { client } = await fixture()
    const { tools } = await client.listTools()
    const tool = tools.find(entry => entry.name === 'open_skill')
    const schema = tool?.inputSchema as { properties?: Record<string, unknown>; required?: string[] } | undefined
    expect(schema?.properties).toHaveProperty('expected_source_commit')
    expect(schema?.required ?? []).not.toContain('expected_source_commit')
  })
})
