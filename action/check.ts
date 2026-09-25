/**
 * Runtime of the `noteflowai/dsh-skills-anywhere` GitHub Action.
 *
 * Selects files with Git pathspecs, runs the installed `check --json`, then
 * turns the report into workflow annotations, a job summary and step outputs.
 * Node runs this file directly (type stripping), so it uses erasable syntax
 * only and imports nothing outside Node itself.
 *
 * Every string taken from a skill file is escaped before it reaches a workflow
 * command or the Markdown summary: a SKILL.md under review must not be able to
 * issue commands to the runner or render links and images in the summary.
 *
 * @module
 */

import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

type Parse =
  | { readonly ok: true; readonly name: string; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly reason: string }

interface ExternalSource { readonly host: string; readonly pinned: boolean }

interface HiddenCharacter {
  readonly codePoint: string
  readonly name: string
  readonly count: number
  readonly lines: readonly number[]
}

interface CheckedFile {
  readonly path: string
  readonly status: 'passed' | 'failed' | 'input_error'
  readonly error?: string
  readonly unpinnedSources?: readonly string[]
  readonly resources?: {
    readonly counts: { readonly present: number; readonly total: number; readonly issues: number }
    readonly references: readonly { readonly url: string; readonly line: number; readonly status: string }[]
  }
  readonly report?: {
    readonly strict: Parse
    readonly lenient: Parse
    readonly surface: {
      readonly externalSources: readonly ExternalSource[]
      readonly declaredTools: readonly string[]
      /** Absent in reports from releases before 0.14.0. */
      readonly hiddenCharacters?: readonly HiddenCharacter[]
    }
  }
}

export interface FileCheckReport {
  readonly schema: string
  readonly tool: { readonly name: string; readonly version: string }
  readonly mode: 'strict' | 'lenient'
  readonly failOnRepair: boolean
  readonly requirePinnedSources: boolean
  readonly failOnHiddenCharacters?: boolean
  readonly resources?: boolean
  readonly failOnResourceIssues?: boolean
  readonly files: readonly CheckedFile[]
  readonly counts: { readonly passed: number; readonly failed: number; readonly inputErrors: number }
  readonly exitCode: number
  readonly scope: string
}

export interface ActionInputs {
  readonly files: string
  readonly lenient: boolean
  readonly failOnRepair: boolean
  readonly requirePinnedSources: boolean
  readonly failOnHiddenCharacters: boolean
  readonly resources: boolean
  readonly failOnResourceIssues: boolean
  readonly allowEmpty: boolean
  readonly report: string
}

/** Parse a boolean action input the way `core.getBooleanInput` does. */
export function booleanInput(name: string, value: string | undefined): boolean {
  const text = (value ?? '').trim()
  if (['', 'false', 'False', 'FALSE'].includes(text)) return false
  if (['true', 'True', 'TRUE'].includes(text)) return true
  throw new Error(`Input ${name} must be true or false, not ${JSON.stringify(text)}.`)
}

export function readInputs(env: NodeJS.ProcessEnv): ActionInputs {
  return {
    files: env.INPUT_FILES ?? '**/SKILL.md',
    lenient: booleanInput('lenient', env.INPUT_LENIENT),
    failOnRepair: booleanInput('fail-on-repair', env.INPUT_FAIL_ON_REPAIR),
    requirePinnedSources: booleanInput('require-pinned-sources', env.INPUT_REQUIRE_PINNED_SOURCES),
    failOnHiddenCharacters: booleanInput('fail-on-hidden-characters', env.INPUT_FAIL_ON_HIDDEN_CHARACTERS),
    resources: booleanInput('resources', env.INPUT_RESOURCES),
    failOnResourceIssues: booleanInput('fail-on-resource-issues', env.INPUT_FAIL_ON_RESOURCE_ISSUES),
    allowEmpty: booleanInput('allow-empty', env.INPUT_ALLOW_EMPTY),
    report: (env.INPUT_REPORT ?? '').trim() || 'skill-check.json',
  }
}

/** One Git pathspec per non-empty, non-comment line; plain patterns get `:(glob)` magic. */
export function pathspecs(files: string): string[] {
  return files.split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'))
    .map(line => line.startsWith(':') ? line : `:(glob)${line}`)
}

/** Tracked files plus untracked files Git would not ignore, sorted and unique. */
export function selectFiles(cwd: string, specs: readonly string[]): string[] {
  if (specs.length === 0) return []
  const result = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...specs], {
    cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`git ls-files failed: ${result.stderr.trim() || `exit ${result.status}`}`)
  return [...new Set(result.stdout.split('\0').filter(Boolean))].toSorted()
}

/** Escape a workflow command message. */
export function escapeData(value: string): string {
  return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
}

/** Escape a workflow command property such as `file` or `title`. */
export function escapeProperty(value: string): string {
  return escapeData(value).replaceAll(':', '%3A').replaceAll(',', '%2C')
}

function command(level: 'error' | 'warning' | 'notice', file: string, title: string, message: string, line?: number): string {
  const at = line === undefined ? '' : `,line=${line}`
  return `::${level} file=${escapeProperty(file)}${at},title=${escapeProperty(title)}::${escapeData(message)}`
}

/** Workflow annotations for rejected files, repairs, unpinned sources and hidden characters. */
export function annotations(report: FileCheckReport): string[] {
  const lines: string[] = []
  for (const file of report.files) {
    if (file.status === 'input_error' || file.report === undefined) {
      lines.push(command('error', file.path, 'Unreadable skill file', file.error ?? 'The file could not be read.'))
      continue
    }
    // Listed even when the frontmatter is rejected, as the report does.
    for (const hidden of file.report.surface.hiddenCharacters ?? []) {
      const level = report.failOnHiddenCharacters ? 'error' : 'warning'
      lines.push(command(level, file.path, 'Hidden character',
        `${hidden.codePoint} ${hidden.name} x${hidden.count}, line${hidden.lines.length === 1 ? '' : 's'} ${hidden.lines.join(', ')}`,
        hidden.lines[0]))
    }
    for (const link of file.resources?.references ?? []) {
      if (link.status === 'present') continue
      lines.push(command(report.failOnResourceIssues ? 'error' : 'warning', file.path,
        'Local resource', `${link.status}: ${link.url}`, link.line))
    }
    const selected = file.report[report.mode]
    if (!selected.ok) {
      lines.push(command('error', file.path, `Skill rejected (${report.mode})`, selected.reason))
      continue
    }
    const level = file.status === 'failed' && report.failOnRepair ? 'error' : 'warning'
    for (const warning of selected.warnings) {
      lines.push(command(level, file.path, level === 'error' ? 'Repair required' : 'Repair applied', warning))
    }
    if (file.unpinnedSources?.length) {
      lines.push(command('error', file.path, 'Unpinned external source',
        `No recognized full-commit address for: ${file.unpinnedSources.join(', ')}`))
    }
  }
  return lines
}

/** Escape text for a Markdown table cell; nothing input-derived may become markup. */
export function markdownText(value: string): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replace(/[\\`*_{}[\]()#+\-.!|~:]/g, match => `\\${match}`)
}

function notes(report: FileCheckReport, file: CheckedFile): string {
  if (file.report === undefined) return markdownText(file.error ?? 'Unreadable')
  const selected = file.report[report.mode]
  const parts: string[] = []
  if (!selected.ok) parts.push(markdownText(selected.reason))
  else if (selected.warnings.length > 0) parts.push(`${selected.warnings.length} repair${selected.warnings.length === 1 ? '' : 's'}`)
  const sources = file.report.surface.externalSources
  if (sources.length > 0) {
    const unpinned = sources.filter(source => !source.pinned).length
    parts.push(`${sources.length} external host${sources.length === 1 ? '' : 's'}${unpinned > 0 ? ` (${unpinned} not pinned)` : ''}`)
  }
  const hidden = (file.report.surface.hiddenCharacters ?? []).reduce((total, entry) => total + entry.count, 0)
  if (hidden > 0) parts.push(`${hidden} hidden character${hidden === 1 ? '' : 's'}`)
  if (file.resources) parts.push(`local resources: ${file.resources.counts.present}/${file.resources.counts.total} present`)
  const tools = file.report.surface.declaredTools
  if (tools.length > 0) parts.push(`declared tools: ${markdownText(tools.join(', '))}`)
  return parts.join('; ') || '—'
}

const STATUS = { passed: 'Passed', failed: 'Failed', input_error: 'Input error' } as const

/** Job summary: one table row per file, plus the report's own scope statement. */
export function summary(report: FileCheckReport): string {
  const { passed, failed, inputErrors } = report.counts
  const gate = [
    `${report.mode} parsing`,
    ...(report.failOnRepair ? ['fail on repair'] : []),
    ...(report.requirePinnedSources ? ['require pinned sources'] : []),
    ...(report.failOnHiddenCharacters ? ['fail on hidden characters'] : []),
    ...(report.failOnResourceIssues ? ['require local resources'] : report.resources ? ['inspect local resources'] : []),
  ].join(', ')
  const rows = report.files.map(file => {
    const name = file.report?.[report.mode].ok ? markdownText((file.report[report.mode] as { name: string }).name) : '—'
    return `| ${STATUS[file.status]} | ${markdownText(file.path)} | ${name} | ${notes(report, file)} |`
  })
  return [
    '### Agent Skills check',
    '',
    `**${passed} passed, ${failed} failed, ${inputErrors} input errors** (${gate}; ${markdownText(report.tool.name)} ${markdownText(report.tool.version)})`,
    '',
    '| Result | File | Skill | Notes |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    `_${markdownText(report.scope)}_`,
    '',
  ].join('\n')
}

function setOutputs(env: NodeJS.ProcessEnv, values: Record<string, string | number>): void {
  const file = env.GITHUB_OUTPUT
  if (!file) return
  appendFileSync(file, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''))
}

export function run(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): number {
  const inputs = readInputs(env)
  const cli = env.SKILLS_ANYWHERE_CLI
  if (!cli) throw new Error('SKILLS_ANYWHERE_CLI must point at the installed dsh-skills-anywhere lib/cli.js.')
  const files = selectFiles(cwd, pathspecs(inputs.files))
  if (files.length === 0) {
    const message = `No files match ${JSON.stringify(inputs.files)}. Only files Git tracks or would track are selected.`
    console.log(`${inputs.allowEmpty ? '::notice' : '::error'} title=No skill files::${escapeData(message)}`)
    setOutputs(env, { report: '', passed: 0, failed: 0, 'input-errors': 0, 'exit-code': inputs.allowEmpty ? 0 : 2 })
    return inputs.allowEmpty ? 0 : 2
  }
  const args = [
    cli, 'check', '--json',
    ...(inputs.lenient ? ['--lenient'] : []),
    ...(inputs.failOnRepair ? ['--fail-on-repair'] : []),
    ...(inputs.requirePinnedSources ? ['--require-pinned-sources'] : []),
    ...(inputs.failOnHiddenCharacters ? ['--fail-on-hidden-characters'] : []),
    ...(inputs.resources ? ['--resources'] : []),
    ...(inputs.failOnResourceIssues ? ['--fail-on-resource-issues'] : []),
    '--', ...files,
  ]
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (result.error) throw result.error
  let report: FileCheckReport
  try {
    report = JSON.parse(result.stdout) as FileCheckReport
  } catch {
    process.stderr.write(result.stderr)
    throw new Error(`dsh-skills-anywhere check exited ${result.status} without a JSON report.`)
  }
  const reportPath = resolve(cwd, inputs.report)
  mkdirSync(dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  for (const line of annotations(report)) console.log(line)
  const { passed, failed, inputErrors } = report.counts
  console.log(`${passed} passed, ${failed} failed, ${inputErrors} input errors (${report.mode}). Report: ${inputs.report}`)
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary(report))
  setOutputs(env, { report: inputs.report, passed, failed, 'input-errors': inputErrors, 'exit-code': report.exitCode })
  return report.exitCode
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = run()
  } catch (error) {
    console.log(`::error title=dsh-skills-anywhere::${escapeData(error instanceof Error ? error.message : String(error))}`)
    process.exitCode = 2
  }
}
