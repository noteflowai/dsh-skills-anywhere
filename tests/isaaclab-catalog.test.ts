import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { describe, expect, it } from 'vitest'
import * as dsh from '../src/index.ts'
import { createSkillsAnywhereServer } from '../src/mcp.ts'
import type { SourceSpec } from '../src/sources.ts'
import {
  BYPASS_IDS, nonAllowlistedOnDisk, projectAgentBypasses, unpinnedSourceBypasses, validatePinnedCatalog, type PinnedCatalog,
} from '../scripts/pinned-catalog.ts'
import { git, quietLogger, tempDir } from './helpers.ts'

const EXAMPLE = new URL('../examples/isaaclab-v3.0.0/', import.meta.url)
const CONFIG_PATH = new URL('skills-anywhere.json', EXAMPLE)
const catalog = JSON.parse(await readFile(new URL('catalog.json', EXAMPLE), 'utf8')) as PinnedCatalog
const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8')) as { sources: SourceSpec[] }

const COMMIT = 'e3f7d9ff1f5d7f8280de3ece9000b7117f66bcf4'
/** The reviewed allowlist: folder slug -> published (frontmatter) name. */
const ALLOWLIST: Record<string, string> = {
  'migrate-2x-to-3x': 'isaaclab-migrating-2x-to-3x',
  'train-rl-agents': 'isaaclab-training-rl-agents',
  'create-environments': 'isaaclab-building-environments',
  'select-backends': 'isaaclab-selecting-backends',
  'debug-rl-training': 'isaaclab-debugging-rl-training',
}
const ALLOWED_DIRS = Object.keys(ALLOWLIST).map(slug => `skills/user/${slug}`).toSorted()
const PUBLISHED = Object.values(ALLOWLIST).toSorted()

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

describe('IsaacLab v3.0.0 pinned example: config and catalog', () => {
  it('parses with the plugin schema and the sources-file reader into one checkout', async () => {
    const parsed = (dsh.Config as unknown as (value: unknown) => dsh.ConfigInput)({ sources: config.sources })
    expect(parsed.sources).toEqual(config.sources)
    expect(await dsh.readSourcesFile(fileURLToPath(CONFIG_PATH))).toEqual(config.sources)

    const cacheDir = await tempDir('isaaclab-cache')
    const resolved = config.sources.map(source => dsh.resolveSource(source, cacheDir))
    expect(new Set(resolved.map(source => source.id))).toEqual(new Set(['github.com/isaac-sim/IsaacLab']))
    expect(new Set(resolved.map(source => source.key))).toEqual(new Set([`github.com/isaac-sim/IsaacLab@${COMMIT}`]))
    expect(new Set(resolved.map(source => source.dir)).size).toBe(1)
    expect(resolved.map(source => source.url)).toEqual(Array(5).fill('https://github.com/isaac-sim/IsaacLab.git'))
    expect(resolved.every(source => source.rank === undefined)).toBe(true)
  })

  it('pins every entry to the same full 40-hex commit', () => {
    expect(config.sources).toHaveLength(5)
    for (const source of config.sources) {
      expect(source.repo).toBe('isaac-sim/IsaacLab')
      expect(source.ref).toMatch(/^[0-9a-f]{40}$/)
      expect(source.ref).toBe(COMMIT)
    }
    expect(catalog.source.commit).toBe(COMMIT)
  })

  it('allowlists exactly the five user skill folders', () => {
    const paths = config.sources.map(source => source.path ?? '')
    expect(paths.toSorted()).toEqual(ALLOWED_DIRS)
    expect(new Set(paths).size).toBe(paths.length)
    for (const path of paths) {
      expect(path).not.toContain('install-isaac-lab')
      expect(path.startsWith('skills/developer')).toBe(false)
      expect(['', 'skills', 'skills/user', '.agents/skills', '.claude/skills']).not.toContain(path)
    }
  })

  it('keeps catalog and config consistent', () => {
    expect(validatePinnedCatalog(dsh, catalog, config.sources)).toEqual([])
    expect(catalog.schema).toBe('skills-anywhere-pinned-catalog-1')
    expect(catalog.config).toBe('skills-anywhere.json')
    expect(catalog.source).toMatchObject({ repository: 'isaac-sim/IsaacLab', tag: 'v3.0.0', tag_kind: 'lightweight', commit: COMMIT })
    expect(catalog.skills.map(skill => skill.directory).toSorted()).toEqual(ALLOWED_DIRS)
    for (const skill of catalog.skills) expect(skill.name).toBe(ALLOWLIST[skill.slug])
  })

  it('records license spdx, basis and the upstream status for every skill', () => {
    expect(catalog.license_files.LICENSE).toEqual({
      spdx: 'BSD-3-Clause', spdx_line: 7, sha256: '932e8d7120d38062d68754314b8be64380bc8236eb012626f9c6c1353d6dc9df', bytes: 1690,
    })
    for (const skill of catalog.skills) {
      expect(skill.license.spdx).toBe('BSD-3-Clause')
      expect(skill.license.file).toBe('LICENSE')
      expect(skill.license.basis).toMatch(/repository root LICENSE \(line 7/)
      expect(skill.license.basis).toContain('not a skill-level declaration')
      expect(skill.status).toBe('experimental')
      expect(skill.audience).toBe('user')
      expect(Object.keys(skill.files)).toEqual(expect.arrayContaining(['SKILL.md', 'evaluations.md']))
      for (const identity of Object.values(skill.files)) expect(identity.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
    // The reviewed digests from the plan.
    expect(Object.fromEntries(catalog.skills.map(skill => [skill.slug, [skill.files['SKILL.md']?.sha256, skill.files['evaluations.md']?.sha256]]))).toEqual({
      'migrate-2x-to-3x': ['adaa2ded83f201c83aa0567f60179b9b2c7ae3b6d4530e0f53ea7b8f63f4f1f6', '11ddd702d427ee5edc8e0ee8d650b23f0cfdfe89d42d2cf1a1f454502889873c'],
      'train-rl-agents': ['057459c84cccc84e9797c6710bacfa1e93fa847d0620c07105855a83fc136bf5', '29bdab4c0c6ed77f44436d3d1fada60cdc41fedd3fc80ad5c746b7412130a9a2'],
      'create-environments': ['ba84da725af1b107c39298b75b0669f150461b36f854c097bd056e5448570b9d', '9b1166a9ec0932ebb53efc15c59d10ff916da0d7ced991ccdb0e7ec85e2e93d2'],
      'select-backends': ['2054c579f9908212bfe5af22031ef72b1a64ffb9cb93e4b289a4b8e3a016dbdf', 'c6e89764635afad6a4160590e300bce3c60e4ce566db82763bfa11361b68e269'],
      'debug-rl-training': ['9c6edf7d7dab455eb3d8e20fa0f101815c48e8853bb82a7ebd1beec2b4420cb0', '546df6bae996e9e871ce8de24afba092e011c5d971daad5a4b274fb96a5ccdbc'],
    })
  })

  it('records every other upstream skill as excluded, and the three bypasses', () => {
    const all = [...catalog.skills.map(skill => skill.directory), ...catalog.excluded.map(entry => entry.directory)]
    expect(new Set(all).size).toBe(24)
    const byReason = (reason: string) => catalog.excluded.filter(entry => entry.reason === reason)
    expect(byReason('install-automation').map(entry => entry.directory)).toEqual(['skills/user/install-isaac-lab'])
    expect(byReason('install-automation')[0]?.note).toContain('executes the docs-prescribed commands unattended')
    const developer = byReason('developer-audience')
    expect(developer).toHaveLength(7)
    expect(developer.every(entry => entry.directory.startsWith('skills/developer/') && entry.audience === 'developer')).toBe(true)
    const testAudit = developer.find(entry => entry.directory === 'skills/developer/test-audit')
    expect(testAudit?.note).toMatch(/OpenClaw/)
    expect(testAudit?.note).toMatch(/MIT/)
    expect(testAudit?.note).toMatch(/THIRD_PARTY_NOTICES\.md, which does not exist/)
    const others = byReason('not-allowlisted')
    expect(others).toHaveLength(11)
    expect(others.every(entry => entry.directory.startsWith('skills/user/') && entry.audience === 'user')).toBe(true)
    expect(catalog.excluded).toHaveLength(19)
    expect(catalog.bypasses.map(bypass => bypass.id)).toEqual([...BYPASS_IDS])
  })

  it('lists the four links from allowlisted skills to non-allowlisted ones', () => {
    const links = catalog.skills.flatMap(skill => skill.references.skill_links.filter(link => !link.allowlisted).map(link => `${skill.slug} -> ${link.directory}`))
    expect(links.toSorted()).toEqual([
      'create-environments -> skills/user/convert-direct-to-manager',
      'create-environments -> skills/user/plan-manipulation-tasks',
      'select-backends -> skills/user/prepare-assets-for-newton',
      'train-rl-agents -> skills/user/train-multi-gpu',
    ])
    for (const skill of catalog.skills) {
      for (const path of [...skill.references.links, ...skill.references.mentioned_paths]) expect(path).toMatch(/^(docs|source|scripts|tools)\//)
    }
  })

  it.each([
    ['a tag ref', (_: PinnedCatalog, sources: SourceSpec[]) => { sources[0] = { ...sources[0]!, ref: 'v3.0.0' } }, /sources\[0\]: ref must be a full 40-character/],
    ['a short SHA', (_: PinnedCatalog, sources: SourceSpec[]) => { sources[1] = { ...sources[1]!, ref: COMMIT.slice(0, 12) } }, /sources\[1\]: ref must be a full 40-character/],
    ['an uppercase SHA', (_: PinnedCatalog, sources: SourceSpec[]) => { sources[1] = { ...sources[1]!, ref: COMMIT.toUpperCase() } }, /sources\[1\]: ref must be a full 40-character/],
    ['another commit', (_: PinnedCatalog, sources: SourceSpec[]) => { sources[2] = { ...sources[2]!, ref: '0'.repeat(40) } }, /differs from the catalogued commit/],
    ['a string entry', (_: PinnedCatalog, sources: (SourceSpec | string)[]) => { sources[0] = `isaac-sim/IsaacLab@${COMMIT}` }, /sources\[0\]: must be an object/],
    ['a sixth entry (install-isaac-lab)', (_: PinnedCatalog, sources: SourceSpec[]) => { sources.push({ repo: 'isaac-sim/IsaacLab', ref: COMMIT, path: 'skills/user/install-isaac-lab' }) }, /sources\[5\]: path "skills\/user\/install-isaac-lab" is not a catalogued skill directory/],
    ['a whole-group path', (_: PinnedCatalog, sources: SourceSpec[]) => { sources[4] = { ...sources[4]!, path: 'skills/user' } }, /is not a catalogued skill directory/],
    ['a duplicated path', (_: PinnedCatalog, sources: SourceSpec[]) => { sources[4] = { ...sources[3]! } }, /is duplicated/],
    ['a missing entry', (_: PinnedCatalog, sources: SourceSpec[]) => { sources.pop() }, /no source for catalogued skill skills\/user\/debug-rl-training/],
    ['another repository', (_: PinnedCatalog, sources: SourceSpec[]) => { sources[0] = { ...sources[0]!, repo: 'someone/IsaacLab' } }, /repo must be isaac-sim\/IsaacLab/],
    ['an allowlisted skill that is also excluded', (c: PinnedCatalog) => { (c.excluded as unknown[]).push({ directory: 'skills/user/train-rl-agents', name: 'x', audience: 'user', status: 'experimental', reason: 'x' }) }, /train-rl-agents: skills\/user\/train-rl-agents is listed as excluded/],
    ['a missing license', (c: PinnedCatalog) => { delete (c.skills[0] as { license?: unknown }).license }, /migrate-2x-to-3x: missing license$/],
    ['a missing license.basis', (c: PinnedCatalog) => { delete (c.skills[1]!.license as { basis?: string }).basis }, /train-rl-agents: missing license.basis/],
    ['a missing license.spdx', (c: PinnedCatalog) => { delete (c.skills[2]!.license as { spdx?: string }).spdx }, /create-environments: missing license.spdx/],
    ['a license file not recorded', (c: PinnedCatalog) => { delete (c.license_files as Record<string, unknown>).LICENSE }, /license.file must name an entry of license_files/],
    ['a missing status', (c: PinnedCatalog) => { delete (c.skills[3] as { status?: string }).status }, /select-backends: missing status/],
    ['a short file digest', (c: PinnedCatalog) => { (c.skills[4]!.files as Record<string, unknown>)['SKILL.md'] = { sha256: 'abc', bytes: 1 } }, /debug-rl-training: files must record SKILL.md/],
    ['a short catalog commit', (c: PinnedCatalog) => { (c.source as { commit: string }).commit = COMMIT.slice(0, 7) }, /source: commit must be a full 40-character/],
    ['a missing bypass', (c: PinnedCatalog) => { (c.bypasses as unknown[]).pop() }, /bypasses: non-allowlisted-on-disk/],
    ['an escaping reference', (c: PinnedCatalog) => { (c.skills[0]!.references.links as string[]).push('../outside') }, /reference \.\.\/outside is not a checkout-relative path/],
  ] as const)('rejects %s', (_label, mutate, message) => {
    const mutated = clone(catalog)
    const sources = clone(config.sources)
    ;(mutate as (c: PinnedCatalog, s: (SourceSpec | string)[]) => void)(mutated, sources)
    const errors = validatePinnedCatalog(dsh, mutated, sources)
    expect(errors.some(error => message.test(error)), errors.join('\n')).toBe(true)
  })

  it('reports IsaacLab sources that would bypass the pinned allowlist', () => {
    const specs: { origin: string; entry: string | SourceSpec }[] = [
      ...config.sources.map(entry => ({ origin: 'example', entry })),
      { origin: 'user', entry: 'isaac-sim/IsaacLab' },
      { origin: 'user', entry: 'isaac-sim/IsaacLab@v3.0.0' },
      { origin: 'project', entry: { repo: 'https://github.com/isaac-sim/IsaacLab', ref: COMMIT.slice(0, 10), path: 'skills/user/train-rl-agents' } },
      { origin: 'project', entry: { repo: 'isaac-sim/IsaacLab', ref: COMMIT, path: 'skills/user' } },
      { origin: 'project', entry: { repo: 'github:isaac-sim/IsaacLab', ref: COMMIT } },
      { origin: 'project', entry: { repo: 'isaac-sim/IsaacLab', ref: '1'.repeat(40), path: 'skills/user/train-rl-agents' } },
      { origin: 'project', entry: 'anthropics/skills' },
    ]
    expect(unpinnedSourceBypasses(dsh, catalog, specs).map(item => [item.origin, item.reason])).toEqual([
      ['user', 'no ref: follows the default branch'],
      ['user', 'ref v3.0.0 is not a full commit SHA (tags, branches and short SHAs are resolved again on sync)'],
      ['project', `ref ${COMMIT.slice(0, 10)} is not a full commit SHA (tags, branches and short SHAs are resolved again on sync)`],
      ['project', 'path skills/user is not an allowlisted skill directory'],
      ['project', 'no path: scans the whole repository, including .agents/skills'],
      ['project', `ref ${'1'.repeat(40)} is not the catalogued commit ${COMMIT}`],
    ])
  })
})

// --- synthetic IsaacLab-shaped repository ------------------------------------

interface Synthetic {
  readonly repo: string
  readonly commit: string
  /** directory -> file -> sha256, generated from the bytes written to the synthetic repository. */
  readonly manifest: Record<string, Record<string, string>>
}

function syntheticSkill(name: string, audience: string, status: string, body: string): string {
  return `---\nname: ${name}\ndescription: Synthetic ${name} for the pinned-catalog test.\naudience: ${audience}\nstatus: ${status}\n---\n\n${body}\n`
}

async function put(repo: string, path: string, content: string): Promise<Buffer> {
  const file = join(repo, ...path.split('/'))
  await mkdir(dirname(file), { recursive: true })
  const bytes = Buffer.from(content)
  await writeFile(file, bytes)
  return bytes
}

/** Commit a symlink object without creating a filesystem symlink (works on Windows too). */
async function addSymlink(repo: string, scratch: string, path: string, target: string): Promise<void> {
  const file = join(scratch, `${sha256(path)}.link`)
  await writeFile(file, target)
  const blob = await git(repo, 'hash-object', '-w', file)
  await git(repo, 'update-index', '--add', '--cacheinfo', `120000,${blob},${path}`)
}

/** Lay out every catalogued directory like the upstream commit, with synthetic contents. */
async function makeIsaacLab(): Promise<Synthetic> {
  const repo = await tempDir('isaaclab-synthetic')
  const scratch = await tempDir('isaaclab-links')
  await git(repo, 'init', '-q')
  await put(repo, '.gitattributes', '* -text\n')
  await put(repo, 'LICENSE', 'Synthetic license.\n\nCopyright (c) Synthetic.\n\nAll rights reserved.\n\nSPDX-License-Identifier: BSD-3-Clause\n')
  const manifest: Synthetic['manifest'] = {}
  for (const skill of catalog.skills) {
    const links = [
      ...skill.references.links.map(path => `- [${posix.basename(path)}](../../../${path})`),
      ...skill.references.skill_links.map(link => `- [${link.name}](../${posix.basename(link.directory)}/SKILL.md)`),
    ]
    manifest[skill.directory] = {}
    for (const file of Object.keys(skill.files)) {
      const content = file === 'SKILL.md'
        ? syntheticSkill(skill.name, skill.audience, skill.status, `Synthetic body for ${skill.slug}.\n\n${links.join('\n')}`)
        : `# ${file}\n\nSynthetic ${skill.slug} ${file}.\n`
      manifest[skill.directory]![file] = sha256(await put(repo, `${skill.directory}/${file}`, content))
    }
    for (const path of [...skill.references.links, ...skill.references.mentioned_paths]) {
      // Directory references get a file inside; file references are created as files.
      if (/\.[a-z]+$/.test(path)) await put(repo, path, `synthetic ${path}\n`)
      else await put(repo, `${path}/__init__.py`, '')
    }
  }
  for (const entry of catalog.excluded) {
    await put(repo, `${entry.directory}/SKILL.md`, syntheticSkill(entry.name, entry.audience, entry.status, `Synthetic body for excluded ${entry.name}.`))
  }
  await git(repo, 'add', '-A')
  // Upstream aliases: .agents/skills/<name> -> ../../skills/<group>/<slug>, .claude/skills -> ../.agents/skills.
  for (const entry of [...catalog.skills, ...catalog.excluded]) {
    await addSymlink(repo, scratch, `.agents/skills/${entry.name}`, `../../${entry.directory}`)
  }
  await addSymlink(repo, scratch, '.claude/skills', '../.agents/skills')
  await git(repo, 'commit', '-q', '-m', 'synthetic IsaacLab layout')
  const commit = await git(repo, 'rev-parse', 'HEAD')
  await git(repo, 'tag', 'v3.0.0', commit)
  return { repo, commit, manifest }
}

/** The example config with the repository swapped for the synthetic one; nothing else changes. */
function syntheticConfig(synthetic: Synthetic): { sources: SourceSpec[] } {
  return { sources: config.sources.map(source => ({ ...source, repo: synthetic.repo, ref: synthetic.commit })) }
}

async function syntheticProject(synthetic: Synthetic) {
  const home = await tempDir('isaaclab-home')
  const project = await tempDir('isaaclab-project')
  const dshHome = join(home, '.dsh')
  await mkdir(join(project, '.git'))
  await mkdir(join(project, '.dsh'))
  await writeFile(join(project, '.dsh', 'skills-anywhere.json'), `${JSON.stringify(syntheticConfig(synthetic), null, 2)}\n`)
  const provider = new dsh.SkillsAnywhereProvider(dsh.resolveConfig({ home, dshHome, watch: false, sync: true, syncOnStart: false, syncIntervalMs: 0 }, {}), quietLogger())
  const checkout = dsh.resolveSource(syntheticConfig(synthetic).sources[0]!, join(dshHome, 'skills-anywhere', 'cache')).dir
  return { home, project, dshHome, provider, checkout }
}

async function listNames(provider: dsh.SkillsAnywhereProvider, project: string) {
  const listed = await provider.list({ cwd: project })
  return Array.isArray(listed) ? listed : listed.candidates
}

async function folderHashes(directory: string): Promise<Record<string, string>> {
  const entries = await readdir(directory, { withFileTypes: true })
  const hashes: Record<string, string> = {}
  for (const entry of entries.filter(item => item.isFile()).toSorted((left, right) => left.name.localeCompare(right.name))) {
    hashes[entry.name] = sha256(await readFile(join(directory, entry.name)))
  }
  return hashes
}

describe('IsaacLab v3.0.0 pinned example synced through dsh Git sources (synthetic repository)', () => {
  it('discovers only the five published names, with the manifest bytes, at the pinned commit', async () => {
    const synthetic = await makeIsaacLab()
    expect(validatePinnedCatalog(dsh, { ...catalog, source: { ...catalog.source, repository: synthetic.repo, commit: synthetic.commit } }, syntheticConfig(synthetic).sources)).toEqual([])
    const { project, provider, checkout } = await syntheticProject(synthetic)
    try {
      const results = await provider.syncAll(project)
      expect(results.map(result => [result.source.path, result.status, result.sha])).toEqual([
        ['skills/user/migrate-2x-to-3x', 'cloned', synthetic.commit],
        ...config.sources.slice(1).map(source => [source.path, 'unchanged', synthetic.commit]),
      ])
      expect(await git(checkout, 'rev-parse', 'HEAD')).toBe(synthetic.commit)

      const candidates = await listNames(provider, project)
      expect(candidates.map(skill => skill.name).toSorted()).toEqual(PUBLISHED)
      expect(candidates.every(skill => skill.source === 'anywhere-source')).toBe(true)
      for (const skill of candidates) {
        const directory = dirname(skill.path!)
        const relativeDir = posix.join(...directory.slice(checkout.length + 1).split(/[\\/]/))
        expect(ALLOWED_DIRS).toContain(relativeDir)
        expect(await folderHashes(directory)).toEqual(synthetic.manifest[relativeDir])
        // Markdown links leave the skill folder but stay inside the same pinned checkout.
        const entry = catalog.skills.find(item => item.directory === relativeDir)!
        for (const path of entry.references.links) await expect(stat(join(directory, '..', '..', '..', ...path.split('/')))).resolves.toBeDefined()
      }

      // Non-allowlisted skills are on disk in the full checkout, yet never discovered.
      expect((await stat(join(checkout, 'skills', 'user', 'install-isaac-lab', 'SKILL.md'))).isFile()).toBe(true)
      expect((await stat(join(checkout, 'skills', 'developer', 'test-audit', 'SKILL.md'))).isFile()).toBe(true)
      expect(await nonAllowlistedOnDisk(catalog, checkout)).toEqual(catalog.excluded.map(entry => entry.directory).toSorted())
      const names = candidates.map(skill => skill.name)
      for (const entry of catalog.excluded) expect(names).not.toContain(entry.name)
    } finally {
      await provider.dispose()
    }
  })

  it('keeps the pinned content when the tag moves, while a tag ref would follow it', async () => {
    const synthetic = await makeIsaacLab()
    const { project, provider, checkout, dshHome } = await syntheticProject(synthetic)
    try {
      await provider.syncAll(project)
      await put(synthetic.repo, 'skills/user/train-rl-agents/SKILL.md', syntheticSkill('isaaclab-training-rl-agents', 'user', 'experimental', 'MOVED-TAG-CONTENT'))
      await put(synthetic.repo, 'skills/user/train-rl-agents/extra.md', 'added after the pin\n')
      await git(synthetic.repo, 'add', '-A')
      await git(synthetic.repo, 'commit', '-q', '-m', 'move the tag')
      await git(synthetic.repo, 'tag', '-f', 'v3.0.0')
      const moved = await git(synthetic.repo, 'rev-parse', 'v3.0.0')
      expect(moved).not.toBe(synthetic.commit)

      const again = await provider.syncAll(project)
      expect(again.map(result => result.status)).toEqual(Array(5).fill('unchanged'))
      const forced = await provider.syncAll(project, { force: true })
      expect(forced.every(result => result.sha === synthetic.commit)).toBe(true)
      expect(await git(checkout, 'rev-parse', 'HEAD')).toBe(synthetic.commit)
      const train = join(checkout, 'skills', 'user', 'train-rl-agents')
      expect(await folderHashes(train)).toEqual(synthetic.manifest['skills/user/train-rl-agents'])

      // Why the catalog rejects tag refs: the same entry with ref v3.0.0 resolves to the moved commit.
      const tagged = dsh.resolveSource({ repo: synthetic.repo, ref: 'v3.0.0', path: 'skills/user/train-rl-agents' }, join(dshHome, 'tag-cache'))
      const result = await dsh.syncSource(tagged)
      expect([result.status, result.sha]).toEqual(['cloned', moved])
      expect(await readFile(join(tagged.scanDir, 'SKILL.md'), 'utf8')).toContain('MOVED-TAG-CONTENT')
    } finally {
      await provider.dispose()
    }
  })

  it('delivers over MCP only with the catalogued commit and SKILL.md digest', async () => {
    const synthetic = await makeIsaacLab()
    const { home, project, provider, dshHome } = await syntheticProject(synthetic)
    await provider.syncAll(project)
    await provider.dispose()
    const mcp = createSkillsAnywhereServer({
      cwd: project,
      config: { home, dshHome, sync: false, syncOnStart: false, watch: false },
      log: { info: () => undefined, warn: () => undefined },
    })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await mcp.server.connect(serverTransport)
    const client = new Client({ name: 'isaaclab-catalog-test', version: '0.0.0' })
    await client.connect(clientTransport)
    try {
      const open = async (args: Record<string, unknown>) => await client.callTool({ name: 'open_skill', arguments: { name: 'isaaclab-training-rl-agents', ...args } }) as {
        isError?: boolean
        content?: { text?: string }[]
        structuredContent?: { sha256?: string; receipt?: { source_commit?: string | null } }
      }
      const digest = synthetic.manifest['skills/user/train-rl-agents']!['SKILL.md']
      const pinned = await open({ expected_source_commit: synthetic.commit, expected_sha256: digest })
      expect(pinned.isError).toBeFalsy()
      expect(pinned.structuredContent?.sha256).toBe(digest)
      expect(pinned.structuredContent?.receipt?.source_commit).toBe(synthetic.commit)

      const other = await open({ expected_source_commit: '0'.repeat(40), expected_sha256: digest })
      expect(other.isError).toBe(true)
      expect((other.content ?? []).map(block => block.text ?? '').join('\n')).toContain('Git source commit changed')
    } finally {
      await client.close()
      await mcp.close()
    }
  })

  it('reports the project agent-directory bypass for a cwd inside an IsaacLab-shaped checkout', async () => {
    const outside = await tempDir('isaaclab-outside')
    await mkdir(join(outside, '.git'))
    expect(await projectAgentBypasses(dsh, catalog, outside)).toEqual([])

    // Real directories rather than upstream's symlinks, so the check is the same on every platform.
    const inside = await tempDir('isaaclab-inside')
    await mkdir(join(inside, '.git'))
    await put(inside, '.claude/skills/isaaclab-training-rl-agents/SKILL.md', syntheticSkill('isaaclab-training-rl-agents', 'user', 'experimental', 'x'))
    await put(inside, '.claude/skills/isaaclab-installing-isaac-lab/SKILL.md', syntheticSkill('isaaclab-installing-isaac-lab', 'user', 'experimental', 'x'))
    await put(inside, '.agents/skills/isaaclab-auditing-tests/SKILL.md', syntheticSkill('isaaclab-auditing-tests', 'developer', 'experimental', 'x'))
    await put(inside, '.claude/skills/unrelated/SKILL.md', syntheticSkill('unrelated', 'user', 'stable', 'x'))
    const nested = join(inside, 'source', 'isaaclab')
    await mkdir(nested, { recursive: true })
    const found = await projectAgentBypasses(dsh, catalog, nested)
    expect(found.map(skill => [skill.agent, skill.name, skill.allowlisted])).toEqual([
      ['agents', 'isaaclab-auditing-tests', false],
      ['claude-code', 'isaaclab-installing-isaac-lab', false],
      ['claude-code', 'isaaclab-training-rl-agents', true],
    ])
  })

  it.runIf(process.platform !== 'win32')('reports both agent roots when .claude/skills links to .agents/skills, as upstream does', async () => {
    const inside = await tempDir('isaaclab-linked')
    await mkdir(join(inside, '.git'))
    await put(inside, '.agents/skills/isaaclab-using-presets/SKILL.md', syntheticSkill('isaaclab-using-presets', 'user', 'experimental', 'x'))
    await mkdir(join(inside, '.claude'))
    await symlink('../.agents/skills', join(inside, '.claude', 'skills'))
    const found = await projectAgentBypasses(dsh, catalog, inside)
    expect(found.map(skill => [skill.agent, skill.name])).toEqual([
      ['agents', 'isaaclab-using-presets'],
      ['claude-code', 'isaaclab-using-presets'],
    ])
  })
})
