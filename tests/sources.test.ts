import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  hasGit, readLock, readSourcesFile, resolveSource, sameRepository, syncSource, writeLock, writeSourcesFile,
} from '../src/sources.ts'
import { git, makeSkillRepo, skillMarkdown, tempDir } from './helpers.ts'

const CACHE = '/tmp/cache'

describe('resolveSource', () => {
  it('parses owner/repo', () => {
    const source = resolveSource('anthropics/skills', CACHE)
    expect(source).toMatchObject({
      id: 'github.com/anthropics/skills',
      url: 'https://github.com/anthropics/skills.git',
      dir: join(CACHE, 'github.com', 'anthropics', 'skills'),
      display: 'anthropics/skills',
    })
    expect(source.scanDir).toBe(source.dir)
    expect(source.ref).toBeUndefined()
  })

  it('parses owner/repo/sub/path and github: prefixes', () => {
    const source = resolveSource('github:vercel-labs/agent-skills/skills/web-design', CACHE)
    expect(source.display).toBe('vercel-labs/agent-skills/skills/web-design')
    expect(source.path).toBe('skills/web-design')
    expect(source.scanDir).toBe(join(CACHE, 'github.com', 'vercel-labs', 'agent-skills', 'skills', 'web-design'))
  })

  it('parses @ref and #ref suffixes', () => {
    expect(resolveSource('anthropics/skills@v1.2.0', CACHE).ref).toBe('v1.2.0')
    expect(resolveSource('anthropics/skills#main', CACHE).ref).toBe('main')
    expect(resolveSource('anthropics/skills.git', CACHE).display).toBe('anthropics/skills')
  })

  it('parses GitHub tree URLs into repo, ref and path', () => {
    const source = resolveSource('https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines', CACHE)
    expect(source).toMatchObject({
      id: 'github.com/vercel-labs/agent-skills',
      ref: 'main',
      path: 'skills/web-design-guidelines',
      url: 'https://github.com/vercel-labs/agent-skills.git',
    })
    expect(resolveSource('https://github.com/anthropics/skills', CACHE).id).toBe('github.com/anthropics/skills')
    expect(resolveSource('https://github.com/anthropics/skills.git', CACHE).url).toBe('https://github.com/anthropics/skills.git')
  })

  it('parses arbitrary git URLs', () => {
    const https = resolveSource('https://gitlab.com/group/sub/repo.git', CACHE)
    expect(https.id).toBe('gitlab.com/group/sub/repo')
    expect(https.dir).toBe(join(CACHE, 'gitlab.com', 'group', 'sub', 'repo'))
    const ssh = resolveSource('git@github.com:owner/repo.git', CACHE)
    expect(ssh.id).toBe('github.com/owner/repo')
    expect(ssh.url).toBe('git@github.com:owner/repo.git')
  })

  it('parses local paths and file URLs', () => {
    const path = resolve('/srv/skills')
    const local = resolveSource(path, CACHE)
    expect(local.url).toBe(path)
    expect(local.id).toMatch(/^local\/[0-9a-f]{12}$/)
    expect(resolveSource(pathToFileURL(path).href, CACHE).id).toBe(local.id)
  })

  it('object specs override parsed values and carry rank', () => {
    const source = resolveSource({ repo: 'o/r', ref: 'dev', path: 'skills', rank: 42 }, CACHE)
    expect(source).toMatchObject({ ref: 'dev', path: 'skills', rank: 42, display: 'o/r/skills' })
  })

  it('rejects unparsable specs and escaping paths', () => {
    expect(() => resolveSource('just-a-word', CACHE)).toThrow(/cannot parse source/)
    expect(() => resolveSource({ repo: 'o/r', path: '../../etc' }, CACHE)).toThrow(/escapes/)
    // A sibling directory that merely shares the repository name as a prefix is still outside.
    expect(() => resolveSource({ repo: 'o/r', path: '../r-private' }, CACHE)).toThrow(/escapes/)
    expect(() => resolveSource({ repo: 'o/r', path: '..' }, CACHE)).toThrow(/escapes/)
  })

  it('never resolves a cache directory outside the cache, whatever the source string says', () => {
    // These would otherwise become `rm -rf` targets when the checkout is missing.
    // (`../..` alone is a relative *local* path, hashed into `local/<sha>`, and stays allowed.)
    expect(resolveSource('../..', CACHE).id).toMatch(/^local\//)
    for (const hostile of ['github:../..', 'https://github.com/../..', 'https://x/../../../..', 'git@h:../../..', 'o/./r', 'o\\r/x']) {
      expect(() => resolveSource(hostile, CACHE), hostile).toThrow(/cannot parse source|outside the cache/)
    }
    expect(resolveSource('o/r', CACHE).dir).toBe(join(CACHE, 'github.com', 'o', 'r'))
  })

  it('gives every ref of a repository its own checkout directory and lock key', () => {
    const main = resolveSource('o/r', CACHE)
    const tag = resolveSource('o/r@v1.0.0', CACHE)
    const branch = resolveSource({ repo: 'o/r', ref: 'feature/x' }, CACHE)
    expect(main.key).toBe('github.com/o/r')
    expect(tag.key).toBe('github.com/o/r@v1.0.0')
    expect(tag.dir).toBe(join(CACHE, 'github.com', 'o', 'r@v1.0.0'))
    expect(branch.dir).toBe(join(CACHE, 'github.com', 'o', 'r@feature_x'))
    expect(new Set([main.dir, tag.dir, branch.dir]).size).toBe(3)
    expect(tag.id).toBe(main.id)
  })

  it('sameRepository ignores ref, path and rank', () => {
    expect(sameRepository('o/r@v1', { repo: 'https://github.com/o/r', path: 'x' }, CACHE)).toBe(true)
    expect(sameRepository('o/r', 'o/other', CACHE)).toBe(false)
    expect(sameRepository('???', 'o/r', CACHE)).toBe(false)
  })
})

describe('sources files and lock', () => {
  it('reads a missing sources file as empty and round-trips writes', async () => {
    const dir = await tempDir()
    const file = join(dir, 'nested', 'sources.json')
    expect(await readSourcesFile(file)).toEqual([])
    await writeSourcesFile(file, ['a/b', { repo: 'c/d', ref: 'main' }])
    expect(await readSourcesFile(file)).toEqual([{ repo: 'a/b' }, { repo: 'c/d', ref: 'main' }])
  })

  it('accepts a bare array and rejects malformed entries', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'arr.json'), '["a/b"]')
    expect(await readSourcesFile(join(dir, 'arr.json'))).toEqual([{ repo: 'a/b' }])
    await writeFile(join(dir, 'bad.json'), '{"sources": [42]}')
    await expect(readSourcesFile(join(dir, 'bad.json'))).rejects.toThrow(/invalid source entry/)
    await writeFile(join(dir, 'shape.json'), '{"nope": true}')
    await expect(readSourcesFile(join(dir, 'shape.json'))).rejects.toThrow(/must be/)
  })

  it('reads a missing or broken lock as empty and round-trips writes', async () => {
    const dir = await tempDir()
    const lock = join(dir, 'lock.json')
    expect(await readLock(lock)).toEqual({})
    await writeLock(lock, { 'github.com/o/r': { url: 'u', sha: 'abc', syncedAt: 'now' } })
    expect(await readLock(lock)).toEqual({ 'github.com/o/r': { url: 'u', sha: 'abc', syncedAt: 'now' } })
    await writeFile(lock, '{not json')
    expect(await readLock(lock)).toEqual({})
  })
})

describe('syncSource (local git repositories)', () => {
  it('detects git', async () => {
    expect(await hasGit()).toBe(true)
  })

  it('clones, reports unchanged, then updates after a new commit', async () => {
    const repo = await makeSkillRepo([{ path: 'skills/alpha', name: 'alpha' }])
    const cache = await tempDir('cache')
    const source = resolveSource(repo, cache)
    const log: string[] = []

    const first = await syncSource(source, { log: message => log.push(message) })
    expect(first.status).toBe('cloned')
    expect(first.sha).toMatch(/^[0-9a-f]{40}$/)
    expect(await readFile(join(source.dir, 'skills', 'alpha', 'SKILL.md'), 'utf8')).toContain('name: alpha')

    const second = await syncSource(source)
    expect(second).toMatchObject({ status: 'unchanged', sha: first.sha })

    await mkdir(join(repo, 'skills', 'beta'), { recursive: true })
    await writeFile(join(repo, 'skills', 'beta', 'SKILL.md'), skillMarkdown('beta', 'new'))
    await git(repo, 'add', '-A')
    await git(repo, 'commit', '-q', '-m', 'add beta')

    const third = await syncSource(source, { log: message => log.push(message) })
    expect(third.status).toBe('updated')
    expect(third.sha).not.toBe(first.sha)
    expect(await readFile(join(source.dir, 'skills', 'beta', 'SKILL.md'), 'utf8')).toContain('name: beta')
    expect(log.some(message => message.includes('cloned'))).toBe(true)
    expect(log.some(message => message.includes('updated'))).toBe(true)
  })

  it('checks out a named branch and a pinned commit', async () => {
    const repo = await makeSkillRepo([{ path: 'skills/alpha', name: 'alpha' }])
    const mainSha = await git(repo, 'rev-parse', 'HEAD')
    await git(repo, 'checkout', '-q', '-b', 'feature')
    await mkdir(join(repo, 'skills', 'feature-only'), { recursive: true })
    await writeFile(join(repo, 'skills', 'feature-only', 'SKILL.md'), skillMarkdown('feature-only', 'x'))
    await git(repo, 'add', '-A')
    await git(repo, 'commit', '-q', '-m', 'feature')
    await git(repo, 'checkout', '-q', 'main')

    const cache = await tempDir('cache')
    const branch = resolveSource({ repo, ref: 'feature' }, cache)
    const onBranch = await syncSource(branch)
    expect(onBranch.status).toBe('cloned')
    expect(await readFile(join(branch.dir, 'skills', 'feature-only', 'SKILL.md'), 'utf8')).toContain('feature-only')

    const cache2 = await tempDir('cache2')
    const pinned = resolveSource({ repo, ref: mainSha }, cache2)
    const atSha = await syncSource(pinned)
    expect(atSha).toMatchObject({ status: 'cloned', sha: mainSha })
    expect(await syncSource(pinned)).toMatchObject({ status: 'unchanged', sha: mainSha })
    const forced = await syncSource(pinned, { force: true })
    expect(forced.status).toBe('unchanged')
  })

  it('reports a failure without throwing and leaves no half-clone behind', async () => {
    const cache = await tempDir('cache')
    const source = resolveSource('/nonexistent/repo/path', cache)
    const result = await syncSource(source, { timeoutMs: 20000 })
    expect(result.status).toBe('failed')
    expect(result.error).toBeTruthy()
    await expect(readFile(join(source.dir, 'README.md'))).rejects.toThrow()
  })
})
