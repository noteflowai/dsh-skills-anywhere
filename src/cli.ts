#!/usr/bin/env node
/**
 * `dsh-skills-anywhere` command line: inspect what the provider would give
 * dsh, manage git sources, and diagnose skipped skills — without booting dsh.
 *
 * @module
 */

import { parseArgs } from 'node:util'
import { isAbsolute, relative, sep } from 'node:path'
import { AGENTS } from './agents.ts'
import { projectSourcesFile, resolveConfig, type ResolvedConfig } from './config.ts'
import { findProjectRoot, type DiscoveryReport } from './discover.ts'
import { originLabel } from './origin.ts'
import { SkillsAnywhereProvider } from './provider.ts'
import {
  hasGit, readLock, readSourcesFile, resolveSource, sameRepository, writeSourcesFile, type ResolvedSource, type SourceSpec,
} from './sources.ts'

const HELP = `dsh-skills-anywhere — your skills, anywhere.

Usage: dsh-skills-anywhere <command> [options]

Commands
  list                 Skills the provider would publish to dsh (default)
  agents               Supported agents and which directories exist here
  sources              Configured git sources and their synced commits
  add <source>         Add a git source (owner/repo, owner/repo/sub/dir,
                       https://github.com/o/r/tree/main/dir, git URL, or path)
  remove <source>      Remove a git source
  sync                 Clone or refresh every source now
  doctor               Explain skipped, repaired, and duplicate skills
  check <files...>      Check explicit Markdown files locally (strict by default)
  bundle <directory>   Fingerprint a skill directory or compare a reviewed manifest
  mcp                  Serve the same skills to any MCP client over stdio

Options
  --cwd <dir>          Project directory (default: current directory)
  --project            add/remove: use <project>/.dsh/skills-anywhere.json
  --ref <ref>          add: branch, tag, or commit
  --path <dir>         add: sub-directory inside the repository
  --rank <n>           add: precedence rank inside dsh (lower wins)
  --force              sync: refresh even when pinned to a commit
  --all                list: include dropped duplicates
  --json               Machine-readable output
  --lenient            check: accept repairs made by the provider
  --fail-on-repair      check: fail if the selected mode needs any repairs
  --require-pinned-sources  check: fail if an external source is not pinned to an immutable revision
  --against <file>      bundle: compare with a saved manifest outside the directory
  -h, --help           Show this help
`

interface Cli {
  readonly command: string
  readonly positional: readonly string[]
  readonly cwd: string
  readonly json: boolean
  readonly all: boolean
  readonly project: boolean
  readonly force: boolean
  readonly ref?: string
  readonly path?: string
  readonly rank?: number
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        cwd: { type: 'string' },
        json: { type: 'boolean', default: false },
        all: { type: 'boolean', default: false },
        project: { type: 'boolean', default: false },
        force: { type: 'boolean', default: false },
        ref: { type: 'string' },
        path: { type: 'string' },
        rank: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
        lenient: { type: 'boolean', default: false },
        'fail-on-repair': { type: 'boolean', default: false },
        'require-pinned-sources': { type: 'boolean', default: false },
        against: { type: 'string' },
      },
    })
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error))
    console.error(HELP)
    return 2
  }
  if (parsed.values.help) {
    console.log(HELP)
    return 0
  }
  const [command = 'list', ...positional] = parsed.positionals
  if (command !== 'bundle' && parsed.values.against !== undefined) {
    console.error('--against is only available for bundle.')
    return 2
  }
  if (command !== 'check' && (parsed.values.lenient || parsed.values['fail-on-repair'] || parsed.values['require-pinned-sources'])) {
    console.error('--lenient, --fail-on-repair and --require-pinned-sources are only available for check.')
    return 2
  }
  if (command === 'bundle') {
    if (positional.length !== 1) {
      console.error('usage: dsh-skills-anywhere bundle <directory> [--against <manifest.json>] [--json]')
      return 2
    }
    const { bundleCommand } = await import('./bundle-cli.ts')
    return bundleCommand(positional[0]!, {
      cwd: parsed.values.cwd ?? process.cwd(),
      json: parsed.values.json ?? false,
      ...(parsed.values.against !== undefined ? { against: parsed.values.against } : {}),
    })
  }
  if (command === 'check') {
    if (positional.length === 0) {
      console.error('usage: dsh-skills-anywhere check <files...> [--lenient] [--fail-on-repair] [--require-pinned-sources] [--json]')
      return 2
    }
    const { checkFiles } = await import('./check-files.ts')
    const result = await checkFiles(positional, {
      cwd: parsed.values.cwd ?? process.cwd(),
      lenient: parsed.values.lenient ?? false,
      failOnRepair: parsed.values['fail-on-repair'] ?? false,
      requirePinnedSources: parsed.values['require-pinned-sources'] ?? false,
    })
    if (parsed.values.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      // JSON-escape input-derived strings, including terminal control sequences.
      for (const file of result.files) {
        console.log(`${file.status.toUpperCase()} ${JSON.stringify(file.path)}`)
        if (file.status === 'input_error') console.log(`  ${JSON.stringify(file.error)}`)
        else {
          const selected = file.report[result.mode]
          if (!selected.ok) console.log(`  ${JSON.stringify(selected.reason)}`)
          else for (const warning of selected.warnings) console.log(`  Repair: ${JSON.stringify(warning)}`)
          // Reported for every file, passing or not: the parsing gate says
          // nothing about where the instructions come from.
          const { surface } = file.report
          for (const source of surface.externalSources) {
            const pinning = source.pinned ? ' (pinned)' : result.requirePinnedSources ? ' (not pinned: required)' : ' (not pinned)'
            console.log(`  External source: ${JSON.stringify(source.host)}${pinning}`)
          }
          if (surface.declaredTools.length > 0) {
            console.log(`  Declared tools: ${JSON.stringify(surface.declaredTools.join(', '))}`)
          }
        }
      }
      console.log(`\n${result.counts.passed} passed, ${result.counts.failed} failed, ${result.counts.inputErrors} input errors (${result.mode}).`)
      console.log(result.scope)
    }
    return result.exitCode
  }
  const cli: Cli = {
    command,
    positional,
    cwd: parsed.values.cwd ?? process.cwd(),
    json: parsed.values.json ?? false,
    all: parsed.values.all ?? false,
    project: parsed.values.project ?? false,
    force: parsed.values.force ?? false,
    ...(parsed.values.ref !== undefined ? { ref: parsed.values.ref } : {}),
    ...(parsed.values.path !== undefined ? { path: parsed.values.path } : {}),
    ...(parsed.values.rank !== undefined ? { rank: Number(parsed.values.rank) } : {}),
  }
  const config = resolveConfig({ watch: false, sync: false })

  switch (command) {
    case 'list': return await list(cli, config)
    case 'agents': return agents(cli, config)
    case 'sources': return await sources(cli, config)
    case 'add': return await add(cli, config)
    case 'remove': case 'rm': return await remove(cli, config)
    case 'sync': return await sync(cli, config)
    case 'doctor': return await doctor(cli, config)
    case 'mcp': return await mcp(cli)
    default:
      console.error(`unknown command "${command}"\n`)
      console.error(HELP)
      return 2
  }
}

function logger() {
  return {
    info: (message: string) => console.error(message),
    warn: (message: string) => console.error(message),
  }
}

async function collect(cli: Cli, config: ResolvedConfig): Promise<DiscoveryReport> {
  return (await collectWithSources(cli, config)).report
}

/** One discovery pass plus the resolved git sources, so paths inside a source checkout can be shown repo-relative. */
async function collectWithSources(cli: Cli, config: ResolvedConfig): Promise<{ report: DiscoveryReport; sourceDirs: readonly string[] }> {
  const provider = new SkillsAnywhereProvider(config, logger())
  try {
    await provider.list({ cwd: cli.cwd })
    const report = provider.report() ?? { skills: [], dropped: [], invalid: [], roots: [], complete: true }
    const sourceDirs = (await provider.sources(cli.cwd)).map(source => source.dir)
    return { report, sourceDirs }
  } finally {
    await provider.dispose()
  }
}

/** `~`-shortened path, or the path inside its git source checkout (the FROM column already names the repo). */
function displayPath(path: string, config: ResolvedConfig, sourceDirs: readonly string[]): string {
  const inside = sourceDirs.map(dir => relative(dir, path))
    .filter(rel => rel !== '' && !rel.startsWith('..') && !isAbsolute(rel))
    .toSorted((a, b) => a.length - b.length)[0]
  return inside ?? shorten(path, config.home)
}


function table(rows: readonly (readonly string[])[]): string {
  if (rows.length === 0) return ''
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map(row => (row[column] ?? '').length)))
  return rows.map(row => row.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join('  ').trimEnd()).join('\n')
}

async function list(cli: Cli, config: ResolvedConfig): Promise<number> {
  const { report, sourceDirs } = await collectWithSources(cli, config)
  if (cli.json) {
    console.log(JSON.stringify({
      skills: report.skills.map(skill => ({
        name: skill.name, description: skill.description, source: skill.source, rank: skill.rank,
        path: skill.path, origin: skill.origin, warnings: skill.warnings,
      })),
      ...(cli.all ? { dropped: report.dropped.map(entry => ({ name: entry.skill.name, path: entry.skill.path, reason: entry.reason, winner: entry.winner.path })) } : {}),
      invalid: report.invalid.map(entry => ({ path: entry.path, reason: entry.reason })),
      complete: report.complete,
    }, null, 2))
    return 0
  }
  if (report.skills.length === 0) {
    console.log('No skills found outside the dsh defaults. Try: dsh-skills-anywhere add anthropics/skills')
  } else {
    console.log(table([
      ['NAME', 'FROM', 'PATH'],
      ...report.skills.map(skill => [skill.name, originLabel(skill.origin), displayPath(skill.path, config, sourceDirs)]),
    ]))
  }
  if (cli.all && report.dropped.length > 0) {
    console.log(`\nDropped duplicates (${report.dropped.length}):`)
    console.log(table(report.dropped.map(entry => [entry.skill.name, entry.reason, shorten(entry.skill.path, config.home), `-> ${shorten(entry.winner.path, config.home)}`])))
  }
  const renamed = report.skills.filter(isRenamed).length
  const repaired = report.skills.filter(skill => skill.warnings.length > 0 && !isRenamed(skill)).length
  console.log(`\n${report.skills.length} skills` +
    (report.dropped.length > 0 ? `, ${report.dropped.length} duplicates hidden` : '') +
    (report.invalid.length > 0 ? `, ${report.invalid.length} skipped` : '') +
    (renamed > 0 ? `, ${renamed} renamed` : '') +
    (repaired > 0 ? `, ${repaired} repaired` : '') +
    (report.invalid.length + repaired + renamed > 0 ? ' — run `dsh-skills-anywhere doctor` for details' : ''))
  return 0
}

function isRenamed(skill: { metadata: Record<string, unknown> }): boolean {
  return typeof (skill.metadata.skillsAnywhere as { renamedFrom?: unknown } | undefined)?.renamedFrom === 'string'
}

async function agents(cli: Cli, config: ResolvedConfig): Promise<number> {
  const provider = new SkillsAnywhereProvider(config, logger())
  try {
    const roots = await provider.roots(cli.cwd)
    const existing = new Set((await collect(cli, config)).roots.filter(root => root.exists).map(root => root.root.path))
    const rows = AGENTS.map((agent) => {
      const projectRoot = roots.find(root => root.origin.kind === 'agent' && root.origin.agent === agent.id && root.origin.scope === 'project')
      const userRoot = roots.find(root => root.origin.kind === 'agent' && root.origin.agent === agent.id && root.origin.scope === 'user')
      return {
        id: agent.id,
        label: agent.label,
        project: agent.project ?? null,
        user: agent.user !== undefined ? `~/${agent.user}` : null,
        present: (projectRoot !== undefined && existing.has(projectRoot.path)) || (userRoot !== undefined && existing.has(userRoot.path)),
      }
    })
    if (cli.json) {
      console.log(JSON.stringify(rows, null, 2))
    } else {
      console.log(table([
        ['AGENT', 'ID', 'PROJECT DIR', 'USER DIR', 'FOUND HERE'],
        ...rows.map(row => [row.label, row.id, row.project ?? '-', row.user ?? '-', row.present ? 'yes' : '']),
      ]))
      console.log(`\n${rows.length} agents supported; ${rows.filter(row => row.present).length} have a skills directory on this machine.`)
      console.log('(.agents/skills and .dsh/skills are handled by the built-in dsh provider.)')
    }
    return 0
  } finally {
    await provider.dispose()
  }
}

async function sources(cli: Cli, config: ResolvedConfig): Promise<number> {
  const provider = new SkillsAnywhereProvider(config, logger())
  try {
    const resolved = await provider.sources(cli.cwd)
    const lock = await readLock(config.lockFile)
    if (cli.json) {
      console.log(JSON.stringify(resolved.map(source => ({ ...source, lock: lock[source.key] ?? null })), null, 2))
      return 0
    }
    if (resolved.length === 0) {
      console.log('No git sources configured. Add one with: dsh-skills-anywhere add owner/repo')
      return 0
    }
    console.log(table([
      ['SOURCE', 'REF', 'SYNCED COMMIT', 'CACHE'],
      ...resolved.map(source => [
        source.display, source.ref ?? '(default)', lock[source.key]?.sha.slice(0, 12) ?? '(never)', shorten(source.dir, config.home),
      ]),
    ]))
    console.log(`\nuser file:    ${shorten(config.userSourcesFile, config.home)}`)
    console.log(`project file: ${shorten(projectSourcesFile(await findProjectRoot(cli.cwd)), config.home)}`)
    return 0
  } finally {
    await provider.dispose()
  }
}

async function targetFile(cli: Cli, config: ResolvedConfig): Promise<string> {
  return cli.project ? projectSourcesFile(await findProjectRoot(cli.cwd)) : config.userSourcesFile
}

async function add(cli: Cli, config: ResolvedConfig): Promise<number> {
  const input = cli.positional[0]
  if (input === undefined) {
    console.error('usage: dsh-skills-anywhere add <source> [--ref <ref>] [--path <dir>] [--rank <n>] [--project]')
    return 2
  }
  const spec: SourceSpec = {
    repo: input,
    ...(cli.ref !== undefined ? { ref: cli.ref } : {}),
    ...(cli.path !== undefined ? { path: cli.path } : {}),
    ...(cli.rank !== undefined && Number.isFinite(cli.rank) ? { rank: cli.rank } : {}),
  }
  let resolved
  try {
    resolved = resolveSource(spec, config.cacheDir)
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error))
    return 2
  }
  const file = await targetFile(cli, config)
  const existing = await readSourcesFile(file)
  if (existing.some(entry => sameSourcePath(entry, resolved, config.cacheDir))) {
    console.log(`${resolved.display} is already in ${shorten(file, config.home)}`)
    return 0
  }
  await writeSourcesFile(file, [...existing, spec])
  console.log(`added ${resolved.display} to ${shorten(file, config.home)}`)
  if (!(await hasGit())) {
    console.error('git was not found on PATH; the source will sync once git is installed.')
    return 0
  }
  const provider = new SkillsAnywhereProvider(config, logger())
  try {
    const results = await provider.syncAll(cli.cwd)
    const mine = results.find(result => result.source.id === resolved.id)
    if (mine !== undefined) printSync([mine], config)
    const report = await collectWith(provider, cli)
    const fromSource = report.skills.filter(skill => skill.origin.kind === 'source' && skill.origin.repo === resolved.display)
    console.log(`${fromSource.length} skills available from ${resolved.display}`)
    return mine?.status === 'failed' ? 1 : 0
  } finally {
    await provider.dispose()
  }
}

async function collectWith(provider: SkillsAnywhereProvider, cli: Cli): Promise<DiscoveryReport> {
  await provider.list({ cwd: cli.cwd })
  return provider.report() ?? { skills: [], dropped: [], invalid: [], roots: [], complete: true }
}

/** Same repository and same sub-path, comparing resolved values so `o/r/sub` and `{ repo: 'o/r', path: 'sub' }` match. */
function sameSourcePath(entry: string | SourceSpec, resolved: ResolvedSource, cacheDir: string): boolean {
  try {
    const other = resolveSource(entry, cacheDir)
    return other.id === resolved.id && (other.path ?? '') === (resolved.path ?? '')
  } catch {
    return false
  }
}

async function remove(cli: Cli, config: ResolvedConfig): Promise<number> {
  const input = cli.positional[0]
  if (input === undefined) {
    console.error('usage: dsh-skills-anywhere remove <source> [--project]')
    return 2
  }
  const file = await targetFile(cli, config)
  const existing = await readSourcesFile(file)
  const remaining = existing.filter(entry => !sameRepository(entry, input, config.cacheDir))
  if (remaining.length === existing.length) {
    console.error(`${input} is not listed in ${shorten(file, config.home)}`)
    return 1
  }
  await writeSourcesFile(file, remaining)
  console.log(`removed ${input} from ${shorten(file, config.home)} (cached checkout kept under ${shorten(config.cacheDir, config.home)})`)
  return 0
}

async function sync(cli: Cli, config: ResolvedConfig): Promise<number> {
  const provider = new SkillsAnywhereProvider(config, logger())
  try {
    const results = await provider.syncAll(cli.cwd, { force: cli.force })
    if (cli.json) {
      console.log(JSON.stringify(results.map(result => ({ source: result.source.display, status: result.status, sha: result.sha ?? null, error: result.error ?? null })), null, 2))
    } else if (results.length === 0) {
      console.log('No git sources configured.')
    } else {
      printSync(results, config)
    }
    return results.some(result => result.status === 'failed') ? 1 : 0
  } finally {
    await provider.dispose()
  }
}

function printSync(results: readonly { source: { display: string }; status: string; sha?: string; error?: string }[], _config: ResolvedConfig): void {
  console.log(table([
    ['SOURCE', 'STATUS', 'COMMIT'],
    ...results.map(result => [result.source.display, result.status, result.sha?.slice(0, 12) ?? (result.error ?? '')]),
  ]))
}

async function doctor(cli: Cli, config: ResolvedConfig): Promise<number> {
  const report = await collect(cli, config)
  const git = await hasGit()
  if (cli.json) {
    console.log(JSON.stringify({
      git,
      roots: report.roots.map(root => ({ label: root.root.label, path: root.root.path, exists: root.exists, count: root.count })),
      renamed: report.skills.filter(isRenamed).map(skill => ({ name: skill.name, from: (skill.metadata.skillsAnywhere as { renamedFrom: string }).renamedFrom, path: skill.path })),
      repaired: report.skills.filter(skill => skill.warnings.length > 0 && !isRenamed(skill)).map(skill => ({ name: skill.name, path: skill.path, warnings: skill.warnings })),
      invalid: report.invalid.map(entry => ({ path: entry.path, reason: entry.reason })),
      dropped: report.dropped.map(entry => ({ name: entry.skill.name, path: entry.skill.path, reason: entry.reason, winner: entry.winner.path })),
      complete: report.complete,
    }, null, 2))
    return 0
  }
  console.log(`git: ${git ? 'available' : 'NOT FOUND (git sources disabled)'}`)
  console.log(`state: ${shorten(config.stateDir, config.home)}`)
  const present = report.roots.filter(root => root.exists)
  console.log(`\nRoots present (${present.length} of ${report.roots.length}):`)
  console.log(table(present.map(root => [root.root.label, String(root.count).padStart(3), shorten(root.root.path, config.home)])))
  const renamed = report.skills.filter(isRenamed)
  if (renamed.length > 0) {
    console.log(`\nRenamed to avoid collisions (${renamed.length}):`)
    console.log(table(renamed.map(skill => [(skill.metadata.skillsAnywhere as { renamedFrom: string }).renamedFrom, `-> ${skill.name}`, shorten(skill.path, config.home)])))
  }
  const repaired = report.skills.filter(skill => skill.warnings.length > 0 && !isRenamed(skill))
  if (repaired.length > 0) {
    console.log(`\nRepaired frontmatter (${repaired.length}):`)
    for (const skill of repaired) {
      console.log(`  ${skill.name}  ${shorten(skill.path, config.home)}`)
      for (const warning of skill.warnings) console.log(`    - ${warning}`)
    }
  }
  if (report.invalid.length > 0) {
    console.log(`\nSkipped (${report.invalid.length}):`)
    for (const entry of report.invalid) console.log(`  ${shorten(entry.path, config.home)}\n    - ${entry.reason}`)
  }
  if (report.dropped.length > 0) {
    console.log(`\nHidden duplicates (${report.dropped.length}):`)
    console.log(table(report.dropped.map(entry => [entry.skill.name, entry.reason, shorten(entry.skill.path, config.home), `-> ${shorten(entry.winner.path, config.home)}`])))
  }
  if (!report.complete) console.log('\nWARNING: at least one root could not be read completely; see messages above.')
  return 0
}

async function mcp(cli: Cli): Promise<number> {
  const { runStdio } = await import('./mcp.ts')
  await runStdio({ cwd: cli.cwd, config: { sync: true, watch: false } })
  return 0
}

function shorten(path: string, home: string): string {
  if (path === home) return '~'
  const rel = relative(home, path)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return path
  return `~${sep}${rel}`
}

const invokedDirectly = (() => {
  const entry = process.argv[1]
  return entry !== undefined && /(?:^|[\\/])(?:dsh-skills-anywhere|cli(?:\.js|\.ts)?)$/.test(entry)
})()

if (invokedDirectly) {
  main().then(code => { process.exitCode = code }, (error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error))
    process.exitCode = 1
  })
}
