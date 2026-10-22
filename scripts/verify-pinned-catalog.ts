/**
 * Manual, networked, read-only check of a commit-pinned skill catalog.
 *
 *   pnpm run build
 *   node scripts/verify-pinned-catalog.ts [--catalog <catalog.json>] [--project <dir>]
 *                                         [--dsh-home <dir>] [--config <file>]...
 *
 * Run it when bumping the pin, not in CI. It syncs the example config through
 * dsh's own Git-source code into a temporary DSH_HOME, then:
 *   - requires discovery to publish exactly the catalogued skill names;
 *   - recomputes the sha256 and size of every catalogued file from the pinned
 *     commit's blobs and from the checked-out bytes, and compares the inventory;
 *   - checks the LICENSE SPDX line, frontmatter name/audience/status, every
 *     checkout-relative reference, and that every SKILL.md directory at the
 *     commit is either allowlisted or listed under `excluded`;
 *   - reports whether the tag still points at the commit (a moved tag is
 *     reported, not a failure);
 *   - reports the three allowlist bypasses detectable from --project, the
 *     user/project sources files and any --config file.
 *
 * Exit 0: content matches (bypasses are reported only). Exit 1: a mismatch.
 * Exit 2: usage, build or network failure. Nothing outside the temporary
 * directory is written; the user's DSH_HOME is only read.
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs, promisify } from 'node:util'
import { parse as parseYaml } from 'yaml'
import type * as Dsh from '../src/index.ts'
import type { SourceSpec } from '../src/sources.ts'
import {
  nonAllowlistedOnDisk, projectAgentBypasses, unpinnedSourceBypasses, validatePinnedCatalog, type PinnedCatalog,
} from './pinned-catalog.ts'

const run = promisify(execFile)
const root = resolve(import.meta.dirname, '..')

const { values } = parseArgs({
  options: {
    catalog: { type: 'string', default: join(root, 'examples', 'isaaclab-v3.0.0', 'catalog.json') },
    project: { type: 'string', default: process.cwd() },
    'dsh-home': { type: 'string', default: process.env.DSH_HOME ?? join(homedir(), '.dsh') },
    config: { type: 'string', multiple: true, default: [] },
    help: { type: 'boolean', default: false },
  },
})
if (values.help) {
  console.log('usage: node scripts/verify-pinned-catalog.ts [--catalog <file>] [--project <dir>] [--dsh-home <dir>] [--config <file>]...')
  process.exit(0)
}

const mismatches: string[] = []
const notes: string[] = []
function mismatch(message: string): void {
  mismatches.push(message)
  console.log(`  MISMATCH ${message}`)
}
function ok(message: string): void {
  console.log(`  ok ${message}`)
}
function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

let dsh: typeof Dsh
try {
  dsh = await import(pathToFileURL(join(root, 'lib', 'index.js')).href) as typeof Dsh
} catch (error) {
  console.error(`verify-pinned-catalog: cannot load lib/index.js (run \`pnpm run build\` first): ${String(error)}`)
  process.exit(2)
}

const catalogPath = resolve(values.catalog)
const catalog = JSON.parse(await readFile(catalogPath, 'utf8')) as PinnedCatalog
const configPath = resolve(catalogPath, '..', catalog.config)
const sources = await dsh.readSourcesFile(configPath)
const { commit, repository, tag } = catalog.source

console.log(`catalog ${catalogPath}`)
console.log(`source  ${repository} @ ${commit} (tag ${tag})`)

console.log('\n[1] offline consistency (catalog <-> config)')
const offline = validatePinnedCatalog(dsh, catalog, sources)
for (const error of offline) mismatch(error)
if (offline.length === 0) ok(`${sources.length} sources, ${catalog.skills.length} skills, ${catalog.excluded.length} exclusions`)

const temp = await mkdtemp(join(tmpdir(), 'verify-pinned-catalog-'))
let exitCode = 0
try {
  const gitEnv: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) if (!key.toUpperCase().startsWith('GIT_')) gitEnv[key] = value
  gitEnv.GIT_TERMINAL_PROMPT = '0'
  gitEnv.GIT_LFS_SKIP_SMUDGE = '1'
  const git = async (cwd: string, ...args: string[]): Promise<Buffer> => {
    const { stdout } = await run('git', ['--no-replace-objects', ...args], {
      cwd, env: gitEnv, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 120_000, windowsHide: true,
    })
    return stdout
  }
  const text = async (cwd: string, ...args: string[]): Promise<string> => (await git(cwd, ...args)).toString('utf8').trim()

  console.log('\n[2] sync through dsh (temporary DSH_HOME, project-level .dsh/skills-anywhere.json)')
  const home = join(temp, 'home')
  const dshHome = join(temp, 'dsh')
  const project = join(temp, 'project')
  await mkdir(join(project, '.git'), { recursive: true })
  await mkdir(join(project, '.dsh'), { recursive: true })
  await mkdir(home, { recursive: true })
  await writeFile(join(project, '.dsh', 'skills-anywhere.json'), await readFile(configPath))
  const config = dsh.resolveConfig({
    home, dshHome, agents: false, claudePlugins: false, sync: true, syncOnStart: false, syncIntervalMs: 0, watch: false,
  }, {})
  const provider = new dsh.SkillsAnywhereProvider(config, { info: () => undefined, warn: message => console.log(`  warn ${message}`) })
  let names: string[]
  try {
    const results = await provider.syncAll(project)
    console.log(`  sync: ${results.map(result => `${result.source.path ?? '.'}=${result.status}`).join(', ')}`)
    const failed = results.filter(result => result.status === 'failed' || result.status === 'skipped')
    if (failed.length > 0 || results.length === 0) {
      console.error(`verify-pinned-catalog: sync failed: ${failed.map(result => result.error).join('; ') || 'no sources'}`)
      process.exitCode = 2
      throw new Error('sync failed')
    }
    for (const result of results) if (result.sha !== commit) mismatch(`${result.source.path}: synced ${result.sha}, expected ${commit}`)
    const listed = await provider.list({ cwd: project })
    names = (Array.isArray(listed) ? listed : listed.candidates).map(skill => skill.name).toSorted()
  } finally {
    await provider.dispose()
  }
  const expectedNames = catalog.skills.map(skill => skill.name).toSorted()
  if (JSON.stringify(names) === JSON.stringify(expectedNames)) ok(`discovered exactly ${names.length}: ${names.join(', ')}`)
  else mismatch(`discovered ${JSON.stringify(names)}, catalog lists ${JSON.stringify(expectedNames)}`)

  const first = sources[0] as SourceSpec
  const checkout = dsh.resolveSource(first, config.cacheDir).dir
  const head = await text(checkout, 'rev-parse', 'HEAD')
  if (head === commit) ok(`checkout HEAD ${head}`)
  else mismatch(`checkout HEAD ${head}, expected ${commit}`)

  console.log('\n[3] file identities at the pinned commit')
  let files = 0
  for (const skill of catalog.skills) {
    const tree = (await text(checkout, 'ls-tree', '-r', '--full-tree', commit, '--', skill.directory)).split('\n').filter(Boolean)
    const inventory = new Map<string, string>()
    for (const line of tree) {
      const [meta, path] = line.split('\t') as [string, string]
      inventory.set(path.slice(skill.directory.length + 1), meta.split(' ')[0] as string)
    }
    const expected = Object.keys(skill.files).toSorted()
    const actual = [...inventory.keys()].toSorted()
    if (JSON.stringify(expected) !== JSON.stringify(actual)) mismatch(`${skill.directory}: files ${JSON.stringify(actual)}, catalog lists ${JSON.stringify(expected)}`)
    for (const [file, identity] of Object.entries(skill.files)) {
      const path = `${skill.directory}/${file}`
      const mode = inventory.get(file)
      if (mode === undefined) continue
      if (mode !== '100644' && mode !== '100755') mismatch(`${path}: mode ${mode} is not a regular file`)
      const blob = await git(checkout, 'cat-file', 'blob', `${commit}:${path}`)
      const disk = await readFile(join(checkout, ...path.split('/')))
      files += 1
      if (sha256(blob) !== identity.sha256 || blob.length !== identity.bytes) mismatch(`${path}: blob sha256 ${sha256(blob)} (${blob.length} B), catalog ${identity.sha256} (${identity.bytes} B)`)
      if (!disk.equals(blob)) mismatch(`${path}: checked-out bytes differ from the commit blob`)
    }
    const parsed = dsh.parseSkillMarkdown((await git(checkout, 'cat-file', 'blob', `${commit}:${skill.directory}/SKILL.md`)).toString('utf8'), { fallbackName: skill.slug, lenient: false })
    if (!parsed.ok) {
      mismatch(`${skill.directory}/SKILL.md: ${parsed.reason}`)
      continue
    }
    const frontmatter = (parsed.skill.metadata.frontmatter ?? {}) as Record<string, unknown>
    for (const [field, value] of [['name', parsed.skill.name], ['audience', frontmatter.audience], ['status', frontmatter.status]] as const) {
      if (value !== skill[field]) mismatch(`${skill.directory}: frontmatter ${field} ${JSON.stringify(value)}, catalog ${JSON.stringify(skill[field])}`)
    }
    if (parsed.skill.metadata.license !== undefined) notes.push(`${skill.directory} now declares license ${JSON.stringify(parsed.skill.metadata.license)}; review license.basis`)
  }
  ok(`${files} catalogued files hashed`)

  for (const [file, identity] of Object.entries(catalog.license_files)) {
    const blob = await git(checkout, 'cat-file', 'blob', `${commit}:${file}`)
    const line = blob.toString('utf8').split(/\r?\n/)[identity.spdx_line - 1]?.trim()
    if (sha256(blob) !== identity.sha256 || blob.length !== identity.bytes) mismatch(`${file}: sha256 ${sha256(blob)} (${blob.length} B), catalog ${identity.sha256} (${identity.bytes} B)`)
    else if (line !== `SPDX-License-Identifier: ${identity.spdx}`) mismatch(`${file}: line ${identity.spdx_line} is ${JSON.stringify(line)}`)
    else ok(`${file}: ${line} (line ${identity.spdx_line}), sha256 ${identity.sha256}`)
  }

  console.log('\n[4] checkout-relative references')
  let references = 0
  for (const skill of catalog.skills) {
    const paths = [...skill.references.links, ...skill.references.mentioned_paths]
    for (const link of [...skill.references.skill_links, ...skill.references.mentioned_skills]) paths.push(`${link.directory}/SKILL.md`)
    for (const path of new Set(paths)) {
      references += 1
      try {
        await git(checkout, 'cat-file', '-e', `${commit}:${path}`)
      } catch {
        mismatch(`${skill.directory}: reference ${path} does not exist at ${commit}`)
      }
    }
    for (const link of [...skill.references.skill_links, ...skill.references.mentioned_skills]) {
      if (link.allowlisted !== catalog.skills.some(entry => entry.directory === link.directory)) mismatch(`${skill.directory}: ${link.directory} allowlisted flag is wrong`)
    }
  }
  ok(`${references} reference paths checked`)

  console.log('\n[5] skill inventory at the commit (allowlisted + excluded)')
  const allFiles = (await text(checkout, 'ls-tree', '-r', '--full-tree', commit)).split('\n')
  const skillDirs = allFiles
    .filter(line => line.startsWith('100') && line.endsWith('/SKILL.md'))
    .map(line => (line.split('\t')[1] as string).slice(0, -'/SKILL.md'.length))
    .toSorted()
  const catalogued = [...catalog.skills.map(skill => skill.directory), ...catalog.excluded.map(entry => entry.directory)].toSorted()
  if (JSON.stringify(skillDirs) === JSON.stringify(catalogued)) ok(`${skillDirs.length} SKILL.md directories: ${catalog.skills.length} allowlisted, ${catalog.excluded.length} excluded`)
  else mismatch(`SKILL.md directories at the commit ${JSON.stringify(skillDirs)} differ from catalog ${JSON.stringify(catalogued)}`)
  for (const entry of catalog.excluded) {
    if (!skillDirs.includes(entry.directory)) continue
    const parsed = dsh.parseSkillMarkdown((await git(checkout, 'cat-file', 'blob', `${commit}:${entry.directory}/SKILL.md`)).toString('utf8'), { fallbackName: entry.directory, lenient: true })
    const frontmatter = parsed.ok ? (parsed.skill.metadata.frontmatter ?? {}) as Record<string, unknown> : {}
    const actual = parsed.ok ? [parsed.skill.name, frontmatter.audience, frontmatter.status] : []
    if (JSON.stringify(actual) !== JSON.stringify([entry.name, entry.audience, entry.status])) mismatch(`excluded ${entry.directory}: frontmatter ${JSON.stringify(actual)}, catalog ${JSON.stringify([entry.name, entry.audience, entry.status])}`)
  }

  console.log('\n[6] tag')
  try {
    const remote = await text(temp, 'ls-remote', catalog.source.url, `refs/tags/${tag}`, `refs/tags/${tag}^{}`)
    const lines = remote.split('\n').filter(Boolean).map(line => line.split('\t') as [string, string])
    const target = (lines.find(([, ref]) => ref.endsWith('^{}')) ?? lines[0])?.[0]
    if (target === undefined) notes.push(`tag ${tag} no longer exists upstream; the pinned commit is unaffected`)
    else if (target !== commit) notes.push(`tag ${tag} MOVED to ${target}; the pin still selects ${commit}. Review before bumping.`)
    else ok(`${tag} -> ${target} (${lines.some(([, ref]) => ref.endsWith('^{}')) ? 'annotated' : 'lightweight'})`)
  } catch (error) {
    notes.push(`could not resolve tag ${tag}: ${String(error).split('\n')[0]}`)
  }

  console.log('\n[7] allowlist bypasses (reported, not failures)')
  const projectDir = resolve(values.project)
  const projectRoot = await dsh.findProjectRoot(projectDir)
  const agentSkills = await projectAgentBypasses(dsh, catalog, projectDir)
  if (agentSkills.length === 0) {
    console.log(`  isaaclab-project-agent-dirs: none for ${projectRoot}`)
  } else {
    const agents = [...new Set(agentSkills.map(skill => skill.agent))]
    const extra = new Set(agentSkills.filter(skill => !skill.allowlisted).map(skill => skill.name))
    console.log(`  BYPASS isaaclab-project-agent-dirs: ${projectRoot} exposes ${new Set(agentSkills.map(skill => skill.name)).size} ${repository} skills (${extra.size} not allowlisted) through ${agents.join(', ')}; set excludeAgents: ${JSON.stringify(agents)}`)
  }

  const specs: { origin: string; entry: string | SourceSpec }[] = []
  const userFile = join(resolve(values['dsh-home']), 'skills-anywhere', 'sources.json')
  const projectFile = join(projectRoot, '.dsh', 'skills-anywhere.json')
  for (const file of [userFile, projectFile]) {
    try {
      for (const entry of await dsh.readSourcesFile(file)) specs.push({ origin: file, entry })
    } catch (error) {
      notes.push(`could not read ${file}: ${String(error)}`)
    }
  }
  for (const file of values.config) {
    const parsed: unknown = parseYaml(await readFile(resolve(file), 'utf8'))
    const list = Array.isArray(parsed) ? parsed : (parsed as { sources?: unknown } | null)?.sources
    if (!Array.isArray(list)) {
      console.error(`verify-pinned-catalog: ${file} has no sources list`)
      process.exitCode = 2
      continue
    }
    for (const entry of list as (string | SourceSpec)[]) specs.push({ origin: resolve(file), entry })
  }
  const unpinned = unpinnedSourceBypasses(dsh, catalog, specs)
  if (unpinned.length === 0) console.log(`  unpinned-isaaclab-source: none in ${specs.length} configured sources`)
  for (const item of unpinned) console.log(`  BYPASS unpinned-isaaclab-source: ${item.origin}: ${JSON.stringify(item.entry)}: ${item.reason}`)

  const onDisk = await nonAllowlistedOnDisk(catalog, checkout)
  console.log(`  non-allowlisted-on-disk: ${onDisk.length} SKILL.md directories in the pinned checkout are not allowlisted (accepted; not discovered): ${onDisk.join(', ')}`)
  const userCheckout = dsh.resolveSource(first, join(resolve(values['dsh-home']), 'skills-anywhere', 'cache')).dir
  if (await stat(join(userCheckout, '.git')).then(() => true, () => false)) {
    const local = await nonAllowlistedOnDisk(catalog, userCheckout)
    console.log(`  non-allowlisted-on-disk: ${userCheckout} holds ${local.length} non-allowlisted SKILL.md directories`)
  }
} catch (error) {
  if (process.exitCode !== 2) {
    console.error(`verify-pinned-catalog: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    process.exitCode = 2
  }
} finally {
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

console.log('\nsummary')
for (const note of notes) console.log(`  note ${note}`)
if (process.exitCode === 2) {
  exitCode = 2
  console.log('  FAILED to complete the check')
} else if (mismatches.length > 0) {
  exitCode = 1
  console.log(`  ${mismatches.length} mismatch(es); do not adopt this catalog`)
} else {
  console.log(`  content matches ${repository}@${commit}`)
}
process.exitCode = exitCode
