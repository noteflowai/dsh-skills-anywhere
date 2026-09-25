import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  annotations, booleanInput, escapeData, escapeProperty, markdownText, pathspecs, run, summary, type FileCheckReport,
} from '../action/check.ts'
import { checkFiles } from '../src/check-files.ts'
import { git, skillMarkdown, tempDir, writeSkill } from './helpers.ts'

const root = join(import.meta.dirname, '..')
const cli = join(root, 'lib', 'cli.js')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }

afterEach(() => vi.restoreAllMocks())

async function repository(): Promise<string> {
  const cwd = await tempDir('action')
  await git(cwd, 'init', '-q')
  return cwd
}

function capture(): string[] {
  const out: string[] = []
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { out.push(args.map(String).join(' ')) })
  return out
}

describe('action.yml', () => {
  const action = parseYaml(readFileSync(join(root, 'action.yml'), 'utf8')) as {
    inputs: Record<string, { default?: string }>
    runs: { using: string; steps: { run?: string; uses?: string }[] }
  }

  it('runs scripts that exist in this checkout', () => {
    const scripts = action.runs.steps.flatMap(step => [...(step.run ?? '').matchAll(/\$GITHUB_ACTION_PATH\/([\w./-]+)/g)].map(match => match[1]!))
    expect(scripts).toEqual(['action/check.ts'])
    for (const script of scripts) expect(existsSync(join(root, script))).toBe(true)
  })

  it('runs the release that contains it by default', () => {
    expect(action.inputs.version?.default).toBe(pkg.version)
  })

  it('is a composite action whose third-party steps are pinned to a commit', () => {
    expect(action.runs.using).toBe('composite')
    for (const step of action.runs.steps) {
      if (step.uses !== undefined) expect(step.uses).toMatch(/^[\w.-]+\/[\w.-]+@[a-f0-9]{40}$/)
    }
    // Inputs reach shell steps through env, never through expression interpolation.
    for (const step of action.runs.steps) expect(step.run ?? '').not.toContain('${{')
  })
})

describe('action inputs', () => {
  it('accepts only GitHub boolean spellings', () => {
    expect(booleanInput('lenient', undefined)).toBe(false)
    expect(booleanInput('lenient', ' TRUE ')).toBe(true)
    expect(() => booleanInput('lenient', 'yes')).toThrow('Input lenient must be true or false')
  })

  it('turns lines into glob pathspecs and keeps explicit magic', () => {
    expect(pathspecs('**/SKILL.md\n\n# comment\r\n  :(exclude)vendor/**  \nskills/*.md')).toEqual([
      ':(glob)**/SKILL.md', ':(exclude)vendor/**', ':(glob)skills/*.md',
    ])
  })
})

describe('untrusted text', () => {
  it('cannot start a new workflow command', () => {
    const hostile = 'x\n::add-mask::secret\r\n%0A::error::forged'
    expect(escapeData(hostile)).not.toMatch(/[\r\n]/)
    expect(escapeData(hostile)).toBe('x%0A::add-mask::secret%0D%0A%250A::error::forged')
    expect(escapeProperty('a,b:c')).toBe('a%2Cb%3Ac')
  })

  it('cannot render links, images, HTML or table cells in the summary', () => {
    const hostile = '![x](https://evil.example/p.png) <img src=x> | `a` [l](u)\nnext'
    const text = markdownText(hostile)
    expect(text).not.toMatch(/(?<!\\)[!|[\]()`<>\n]/)
    expect(text).toContain('&lt;img src=x&gt;')
  })
})

describe('report rendering', () => {
  it('reports resource issues at their source lines and only blocks when requested', async () => {
    const cwd = await tempDir('action-resources')
    await writeFile(join(cwd, 'SKILL.md'), skillMarkdown('check-links', 'Check links.', { body: '[missing](references/absent.md)' }))
    const options = { cwd, lenient: false, failOnRepair: false, requirePinnedSources: false, resources: true }
    const report = await checkFiles(['SKILL.md'], options)
    expect(annotations(report)[0]).toMatch(/::warning file=SKILL.md,line=\d+,title=Local resource::missing: references\/absent.md/)
    expect(summary(report)).toContain('local resources: 0/1 present')
    const gated = await checkFiles(['SKILL.md'], { ...options, failOnResourceIssues: true })
    expect(annotations(gated)[0]).toMatch(/^::error /)
    expect(gated.exitCode).toBe(1)
  })
  it('annotates rejections, required repairs and unpinned sources', async () => {
    const cwd = await tempDir('action-report')
    await writeFile(join(cwd, 'bad.md'), '---\n- not a mapping\n---\nbody\n')
    await writeFile(join(cwd, 'drift.md'), skillMarkdown('drift', 'd', { frontmatter: { 'allowed-tools': ['Bash', 'Read'] }, omitName: true, body: 'See https://example.com/rules.md' }))
    const report = await checkFiles(['bad.md', 'drift.md', 'missing.md'], {
      cwd, lenient: true, failOnRepair: true, requirePinnedSources: true,
    }) as FileCheckReport
    const lines = annotations(report)
    expect(lines).toContain('::error file=bad.md,title=Skill rejected (lenient)::frontmatter must be a YAML mapping')
    expect(lines).toContain('::error file=drift.md,title=Repair required::name missing or invalid; using "drift" from the directory')
    expect(lines).toContain('::error file=drift.md,title=Unpinned external source::No recognized full-commit address for: example.com')
    expect(lines.some(line => line.startsWith('::error file=missing.md,title=Unreadable skill file::'))).toBe(true)
    const markdown = summary(report)
    expect(markdown).toContain('**0 passed, 2 failed, 1 input errors** (lenient parsing, fail on repair, require pinned sources;')
    expect(markdown).toContain('| Failed | drift\\.md | drift | 1 repair; 1 external host (1 not pinned); declared tools: Bash, Read |')
  })

  it('annotates hidden characters at their first line, as errors only when they fail the file', async () => {
    const cwd = await tempDir('action-hidden')
    await writeFile(join(cwd, 'hidden.md'), skillMarkdown('hidden', 'd', { body: 'Safe\ntext \u202E here\u200B and \u200B' }))
    const allowed = await checkFiles(['hidden.md'], { cwd, lenient: false, failOnRepair: false, requirePinnedSources: false }) as FileCheckReport
    const listed = annotations(allowed)
    expect(listed).toHaveLength(2)
    expect(listed[0]).toMatch(/^::warning file=hidden\.md,line=\d+,title=Hidden character::U\+200B .+ x2, line \d+$/)
    expect(listed[1]).toMatch(/^::warning file=hidden\.md,line=\d+,title=Hidden character::U\+202E /)
    expect(summary(allowed)).toContain('| Passed | hidden\\.md | hidden | 3 hidden characters |')
    const gated = await checkFiles(['hidden.md'], {
      cwd, lenient: false, failOnRepair: false, requirePinnedSources: false, failOnHiddenCharacters: true,
    }) as FileCheckReport
    expect(annotations(gated).every(line => line.startsWith('::error file=hidden.md,line='))).toBe(true)
    expect(summary(gated)).toContain('(strict parsing, fail on hidden characters;')
  })

  it('renders reports from releases without hidden-character listings', () => {
    const report: FileCheckReport = {
      schema: 'skills-anywhere-file-check-1', tool: { name: 'dsh-skills-anywhere', version: '0.13.0' }, mode: 'strict',
      failOnRepair: false, requirePinnedSources: false, counts: { passed: 1, failed: 0, inputErrors: 0 }, exitCode: 0, scope: 's',
      files: [{ path: 'a.md', status: 'passed', report: {
        strict: { ok: true, name: 'a', warnings: [] }, lenient: { ok: true, name: 'a', warnings: [] },
        surface: { externalSources: [], declaredTools: [] },
      } }],
    }
    expect(annotations(report)).toEqual([])
    expect(summary(report)).toContain('| Passed | a\\.md | a | — |')
  })

  it('reports applied repairs as warnings when they are allowed', async () => {
    const cwd = await tempDir('action-lenient')
    await writeFile(join(cwd, 'drift.md'), skillMarkdown('drift', 'd', { omitName: true }))
    const report = await checkFiles(['drift.md'], { cwd, lenient: true, failOnRepair: false, requirePinnedSources: false }) as FileCheckReport
    expect(annotations(report)).toEqual(['::warning file=drift.md,title=Repair applied::name missing or invalid; using "drift" from the directory'])
  })
})

describe('run', () => {
  it('passes resource listing and its explicit gate through the CLI', async () => {
    const cwd = await repository()
    await writeSkill(join(cwd, 'skills'), 'review', 'Review code.', { body: '[guide](references/missing.md)' })
    const out = capture()
    expect(run({ SKILLS_ANYWHERE_CLI: cli, INPUT_RESOURCES: 'true' }, cwd)).toBe(0)
    expect(run({ SKILLS_ANYWHERE_CLI: cli, INPUT_FAIL_ON_RESOURCE_ISSUES: 'true', INPUT_REPORT: 'gated.json' }, cwd)).toBe(1)
    const report = JSON.parse(await readFile(join(cwd, 'gated.json'), 'utf8')) as FileCheckReport
    expect(report.resources).toBe(true)
    expect(report.failOnResourceIssues).toBe(true)
    expect(out.some(line => line.startsWith('::error file=skills/review/SKILL.md,line=') && line.includes('missing.md'))).toBe(true)
  })

  it('checks tracked and unignored files, then writes the report, outputs and summary', async () => {
    const cwd = await repository()
    await writeSkill(join(cwd, 'skills'), 'good')
    await writeSkill(join(cwd, 'skills'), 'also-good')
    await mkdir(join(cwd, 'node_modules', 'dep'), { recursive: true })
    await writeFile(join(cwd, 'node_modules', 'dep', 'SKILL.md'), 'not checked')
    await writeFile(join(cwd, '.gitignore'), 'node_modules/\n')
    await git(cwd, 'add', 'skills/good')
    const output = join(cwd, 'output.txt')
    const stepSummary = join(cwd, 'summary.md')
    const out = capture()
    const code = run({
      SKILLS_ANYWHERE_CLI: cli, INPUT_REPORT: 'reports/skills.json', GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: stepSummary,
    }, cwd)
    expect(code).toBe(0)
    const report = JSON.parse(await readFile(join(cwd, 'reports', 'skills.json'), 'utf8')) as FileCheckReport
    expect(report.files.map(file => file.path)).toEqual(['skills/also-good/SKILL.md', 'skills/good/SKILL.md'])
    expect(await readFile(output, 'utf8')).toBe('report=reports/skills.json\npassed=2\nfailed=0\ninput-errors=0\nexit-code=0\n')
    expect(await readFile(stepSummary, 'utf8')).toContain('| Passed | skills/also\\-good/SKILL\\.md | also\\-good | — |')
    expect(out.at(-1)).toBe('2 passed, 0 failed, 0 input errors (strict). Report: reports/skills.json')
  })

  it('returns the checker exit code for a rejected file', async () => {
    const cwd = await repository()
    await mkdir(join(cwd, 'bad'))
    await writeFile(join(cwd, 'bad', 'SKILL.md'), '---\ndescription: no name\n---\nbody\n')
    const out = capture()
    expect(run({ SKILLS_ANYWHERE_CLI: cli }, cwd)).toBe(1)
    expect(out[0]).toBe('::error file=bad/SKILL.md,title=Skill rejected (strict)::frontmatter requires name')
  })

  it('passes fail-on-hidden-characters to the checker', async () => {
    const cwd = await repository()
    await writeSkill(join(cwd, 'skills'), 'hidden', 'hidden description', { body: 'Look \u202E here' })
    const out = capture()
    expect(run({ SKILLS_ANYWHERE_CLI: cli }, cwd)).toBe(0)
    expect(run({ SKILLS_ANYWHERE_CLI: cli, INPUT_FAIL_ON_HIDDEN_CHARACTERS: 'true', INPUT_REPORT: 'gated.json' }, cwd)).toBe(1)
    const report = JSON.parse(await readFile(join(cwd, 'gated.json'), 'utf8')) as FileCheckReport
    expect(report.failOnHiddenCharacters).toBe(true)
    expect(out.some(line => line.startsWith('::error file=skills/hidden/SKILL.md,line=') && line.includes('U+202E'))).toBe(true)
  })

  it('fails on no matching files unless empty selections are allowed', async () => {
    const cwd = await repository()
    const out = capture()
    expect(run({ SKILLS_ANYWHERE_CLI: cli }, cwd)).toBe(2)
    expect(run({ SKILLS_ANYWHERE_CLI: cli, INPUT_ALLOW_EMPTY: 'true' }, cwd)).toBe(0)
    expect(out[0]).toMatch(/^::error title=No skill files::No files match "\*\*\/SKILL\.md"/)
    expect(out[1]).toMatch(/^::notice title=No skill files::/)
  })

  it('runs as a script and reports configuration errors as annotations', async () => {
    const cwd = await repository()
    const result = spawnSync(process.execPath, [join(root, 'action', 'check.ts')], {
      cwd, encoding: 'utf8', env: { ...process.env, SKILLS_ANYWHERE_CLI: '' },
    })
    expect(result.status).toBe(2)
    expect(result.stdout).toContain('::error title=dsh-skills-anywhere::SKILLS_ANYWHERE_CLI must point at')
  })
})
