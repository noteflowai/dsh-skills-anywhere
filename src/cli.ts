#!/usr/bin/env node
/**
 * `dsh-skills-anywhere` command line: inspect what the provider would give
 * dsh, manage git sources, and diagnose skipped skills — without booting dsh.
 *
 * @module
 */

import { parseArgs } from 'node:util'
import { relative } from 'node:path'
import { AGENTS } from './agents.ts'
import { projectSourcesFile, resolveConfig, type ResolvedConfig } from './config.ts'
import { findProjectRoot, type DiscoveryReport } from './discover.ts'
import { SkillsAnywhereProvider } from './provider.ts'
import {
  hasGit, readLock, readSourcesFile, resolveSource, sameRepository, writeSourcesFile, type SourceSpec,
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

Options
  --cwd <dir>          Project directory (default: current directory)
  --project            add/remove: use <project>/.dsh/skills-anywhere.json
  --ref <ref>          add: branch, tag, or commit
  --path <dir>         add: sub-directory inside the repository
  --rank <n>           add: precedence rank inside dsh (lower wins)
  --force              sync: refresh even when pinned to a commit
  --all                list: include dropped duplicates
  --json               Machine-readable output
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
  const provider = new SkillsAnywhereProvider(config, logger())
  try {
    await provider.list({ cwd: cli.cwd })
    return provider.report() ?? { skills: [], dropped: [], invalid: [], roots: [], complete: true }
  } finally {
    await provider.dispose()
  }
}

function originLabel(skill: { origin: { kind: string; agent?: string; scope?: string; repo?: string; marketplace?: string; plugin?: string } }): string {
  const { origin } = skill
  switch (origin.kind) {
    case 'agent': return `${origin.agent ?? 'agent'} (${origin.scope ?? '?'})`
    case 'claude-plugins': return `claude plugin ${origin.plugin ?? '?'}${origin.marketplace !== undefined ? ` @ ${origin.marketplace}` : ''}`
    case 'source': return `source ${origin.repo ?? '?'}`
    default: return `custom (${origin.scope ?? '?'})`
  }
}

function table(rows: readonly (readonly string[])[]): string {
  if (rows.length === 0) return ''
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map(row => (row[column] ?? '').length)))
  return rows.map(row => row.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join('  ').trimEnd()).join('\n')
}

async function list(cli: Cli, config: ResolvedConfig): Promise<number> {
  const report = await collect(cli, config)
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
      ...report.skills.map(skill => [skill.name, originLabel(skill), shorten(skill.path, config.home)]),
    ]))
  }
  if (cli.all && report.dropped.length > 0) {
    console.log(`\nDropped duplicates (${report.dropped.length}):`)
    console.log(table(report.dropped.map(entry => [entry.skill.name, entry.reason, shorten(entry.skill.path, config.home), `-> ${shorten(entry.winner.path, config.home)}`])))
  }
  const repaired = report.skills.filter(skill => skill.warnings.length > 0).length
  console.log(`\n${report.skills.length} skills` +
    (report.dropped.length > 0 ? `, ${report.dropped.length} duplicates hidden` : '') +
    (report.invalid.length > 0 ? `, ${report.invalid.length} skipped` : '') +
    (repaired > 0 ? `, ${repaired} repaired` : '') +
    (report.invalid.length + repaired > 0 ? ' — run `dsh-skills-anywhere doctor` for details' : ''))
  return 0
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
      console.log(JSON.stringify(resolved.map(source => ({ ...source, lock: lock[source.id] ?? null })), null, 2))
      return 0
    }
    if (resolved.length === 0) {
      console.log('No git sources configured. Add one with: dsh-skills-anywhere add owner/repo')
      return 0
    }
    console.log(table([
      ['SOURCE', 'REF', 'SYNCED COMMIT', 'CACHE'],
      ...resolved.map(source => [
        source.display, source.ref ?? '(default)', lock[source.id]?.sha.slice(0, 12) ?? '(never)', shorten(source.dir, config.home),
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
  if (existing.some(entry => sameRepository(entry, spec, config.cacheDir) && (typeof entry === 'string' ? undefined : entry.path) === resolved.path)) {
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
      repaired: report.skills.filter(skill => skill.warnings.length > 0).map(skill => ({ name: skill.name, path: skill.path, warnings: skill.warnings })),
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
  const repaired = report.skills.filter(skill => skill.warnings.length > 0)
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

function shorten(path: string, home: string): string {
  if (path === home) return '~'
  if (path.startsWith(`${home}/`)) return `~/${relative(home, path)}`
  return path
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
