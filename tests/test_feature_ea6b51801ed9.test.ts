import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { describe, expect, it } from 'vitest'
import type { Config } from '../src/config.ts'
import { createSkillsAnywhereServer, openSkill, type SkillsAnywhereMcp } from '../src/mcp.ts'
import { resolveSource, syncSource } from '../src/sources.ts'
import { git, makeSkillRepo, quietLogger, skillMarkdown, tempDir, writeSkill } from './helpers.ts'

interface Session {
  readonly client: Client
  readonly mcp: SkillsAnywhereMcp
  readonly log: ReturnType<typeof quietLogger>
}

interface OpenResult {
  content: string
  receipt: Record<string, unknown> & { schema: string; source_commit?: string | null }
}

const EXISTING_FIELDS = [
  'schema', 'load_id', 'loaded_at', 'provider', 'provider_version', 'name',
  'skill_sha256', 'content_sha256', 'bundle_sha256', 'declared_tools', 'permissions_enforced',
]

async function connect(config: Config, cwd: string): Promise<Session> {
  const log = quietLogger()
  const mcp = createSkillsAnywhereServer({ cwd, config: { sync: false, ...config }, log, cacheMs: 0 })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await mcp.server.connect(serverTransport)
  const client = new Client({ name: 'source-commit-test', version: '0.0.0' })
  await client.connect(clientTransport)
  return { client, mcp, log }
}

async function closeSession(session: Session): Promise<void> {
  await session.client.close()
  await session.mcp.close()
}

async function openOk(client: Client, name: string): Promise<OpenResult> {
  const result = await client.callTool({ name: 'open_skill', arguments: { name } })
  expect(result.isError).toBeFalsy()
  return result.structuredContent as unknown as OpenResult
}

function commitWarnings(session: Session): string[] {
  return session.log.messages.filter(message => message.includes('source commit unavailable'))
}

async function workspace(prefix: string): Promise<{ home: string; project: string }> {
  const home = await tempDir(`${prefix}-home`)
  const project = await tempDir(`${prefix}-project`)
  await mkdir(join(project, '.git'))
  return { home, project }
}

describe('open_skill receipt source_commit', () => {
  it('names the checkout HEAD before and after a forward sync and an upstream reset', async () => {
    const repo = await makeSkillRepo([{ path: 'skills/alpha', name: 'alpha' }])
    const firstSha = await git(repo, 'rev-parse', 'HEAD')
    const cache = await tempDir('sc-cache')
    const source = resolveSource(repo, cache)
    expect(await syncSource(source)).toMatchObject({ status: 'cloned', sha: firstSha })
    const { home, project } = await workspace('sc-forward')
    const session = await connect({ home, dshHome: join(home, '.dsh'), cacheDir: cache, sources: [repo] }, project)
    try {
      const { tools } = await session.client.listTools()
      const tool = tools.find(entry => entry.name === 'open_skill')
      const receiptSchema = (tool?.outputSchema as { properties?: Record<string, { properties?: Record<string, unknown> }> } | undefined)?.properties?.receipt
      expect(receiptSchema?.properties).toHaveProperty('source_commit')

      const first = await openOk(session.client, 'alpha')
      expect(first.receipt.source_commit).toBe(firstSha)
      expect(first.receipt.source_commit).toMatch(/^[0-9a-f]{40}$/)
      expect(first.receipt.schema).toBe('skills-anywhere-load-1')
      for (const field of EXISTING_FIELDS) expect(first.receipt).toHaveProperty(field)

      await writeFile(join(repo, 'skills', 'alpha', 'SKILL.md'), skillMarkdown('alpha', 'alpha second revision', { body: 'Second revision.' }))
      await git(repo, 'add', '-A')
      await git(repo, 'commit', '-q', '-m', 'second')
      const secondSha = await git(repo, 'rev-parse', 'HEAD')
      expect(await syncSource(source)).toMatchObject({ status: 'updated', sha: secondSha })

      const second = await openOk(session.client, 'alpha')
      expect(second.receipt.source_commit).toBe(secondSha)
      expect(second.content).toContain('Second revision.')

      await git(repo, 'reset', '-q', '--hard', firstSha)
      expect(await syncSource(source)).toMatchObject({ sha: firstSha })
      const rolledBack = await openOk(session.client, 'alpha')
      expect(rolledBack.receipt.source_commit).toBe(firstSha)
      expect(rolledBack.content).not.toContain('Second revision.')
      expect(commitWarnings(session)).toEqual([])
    } finally {
      await closeSession(session)
    }
  })

  it('is null for agent-directory skills, and openSkill() receipts stay unchanged', async () => {
    const { home, project } = await workspace('sc-agent')
    await writeSkill(join(home, '.claude', 'skills'), 'pdf-forms', 'Fill PDF forms')
    const session = await connect({ home, dshHome: join(home, '.dsh'), cacheDir: await tempDir('sc-empty-cache') }, project)
    try {
      const opened = await openOk(session.client, 'pdf-forms')
      expect(opened.receipt).toHaveProperty('source_commit', null)
      expect(commitWarnings(session)).toEqual([])

      const discovered = (await session.mcp.refresh()).skills.find(skill => skill.name === 'pdf-forms')
      expect(discovered).toBeDefined()
      const direct = await openSkill(discovered!, true)
      expect(direct?.receipt).toBeDefined()
      expect(direct!.receipt).not.toHaveProperty('source_commit')
    } finally {
      await closeSession(session)
    }
  })

  it('never reports an enclosing repository and runs no lookup on rejected loads', async () => {
    const outer = await tempDir('sc-outer')
    await git(outer, 'init', '-q')
    await writeFile(join(outer, 'README.md'), 'outer\n')
    await git(outer, 'add', '-A')
    await git(outer, 'commit', '-q', '-m', 'outer')
    const outerSha = await git(outer, 'rev-parse', 'HEAD')

    const repo = await makeSkillRepo([{ path: 'skills/alpha', name: 'alpha' }])
    const cache = join(outer, 'cache')
    const source = resolveSource(repo, cache)
    expect(await syncSource(source)).toMatchObject({ status: 'cloned' })
    await rm(join(source.dir, '.git'), { recursive: true, force: true })

    const { home, project } = await workspace('sc-outer')
    const session = await connect({ home, dshHome: join(home, '.dsh'), cacheDir: cache, sources: [repo] }, project)
    try {
      const opened = await openOk(session.client, 'alpha')
      expect(opened.content).toContain('Instructions for alpha.')
      expect(opened.receipt.source_commit).toBeNull()
      expect(opened.receipt.source_commit).not.toBe(outerSha)
      const warnings = commitWarnings(session)
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain('source commit unavailable for alpha')

      const rejected = await session.client.callTool({ name: 'open_skill', arguments: { name: 'alpha', expected_sha256: '0'.repeat(64) } })
      expect(rejected.isError).toBe(true)
      expect(JSON.stringify(rejected.content)).toContain('expected_sha256 does not match')
      expect(commitWarnings(session)).toHaveLength(1)
    } finally {
      await closeSession(session)
    }
  })
})
