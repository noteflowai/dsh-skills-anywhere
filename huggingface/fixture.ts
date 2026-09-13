import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { AGENTS } from '../src/agents.ts'
import { resolveConfig } from '../src/config.ts'
import { SkillsAnywhereProvider } from '../src/provider.ts'
import { originLabel } from '../src/origin.ts'
import type { DemoData } from './types.ts'

function skill(name: string, description: string, body: string, extra = ''): string {
  return `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n${body}\n`
}

const review = skill('review', 'Review a change for correctness, tests and clear explanations.',
  '# Review a change\n\nRead the diff and relevant tests. Trace one realistic input through the changed code.\nReport concrete findings with file references and explain what behavior each test protects.')

/** Authored fixtures only. Never discover the builder's real home or worktree. */
export async function createDemoData(version: string): Promise<DemoData> {
  const scratch = await mkdtemp(join(tmpdir(), 'skills-playground-'))
  const fixtureHome = join(scratch, 'home')
  const project = join(scratch, 'project')
  const inputs = [
    { path: 'project/.claude/skills/review/SKILL.md', markdown: review },
    { path: 'home/.cursor/skills/review/SKILL.md', markdown: review },
    { path: 'home/.codex/skills/test-plan/SKILL.md', markdown: skill('test-plan', 'Plan tests for behavior, failure cases and regressions.', '# Plan a test\n\nChoose one user-visible behavior. Describe a successful case and a failure case.\nPrefer a regression test that fails before the fix and passes after it.') },
    { path: 'home/.gemini/skills/release-notes/SKILL.md', markdown: skill('release-notes', 'Write release notes from verified changes.', '# Release notes\n\nGroup changes by user impact. Link each claim to a merged change.\nSeparate released features from unreleased work.') },
    { path: 'home/.claude/skills/manual-deploy/SKILL.md', markdown: skill('manual-deploy', 'A sample skill whose author disabled model invocation.', '# Manual deployment\n\nThis fictional example is intentionally unavailable to model tools.\nIt contains no deployment commands or credentials.', 'disable-model-invocation: true\n') },
    { path: 'home/.claude/plugins/marketplaces/demo-market/plugins/chat/skills/configure/SKILL.md', markdown: skill('configure', 'Configure a fictional team chat integration.', '# Chat configuration\n\nList the requested channels and notification preferences.\nThis example has no service connection and performs no external action.') },
    { path: 'home/.claude/plugins/marketplaces/demo-market/plugins/issues/skills/configure/SKILL.md', markdown: skill('configure', 'Configure a fictional issue tracker integration.', '# Issue tracker configuration\n\nDescribe issue labels and routing rules in a local plan.\nThis example has no service connection and performs no external action.') },
    { path: 'home/.codex/skills/incident-summary/SKILL.md', markdown: '---\nname: Incident_Summary\n---\n\n# Incident summary\n\nSummarize an incident using observed facts, impact and follow-up actions.\n' },
    { path: 'home/.cursor/skills/broken-example/SKILL.md', markdown: '---\nname: [unclosed\n---\n\nAn intentionally invalid YAML example.\n' },
  ]
  const portable = (path: string) => {
    const rel = relative(scratch, path).split(sep).join('/')
    if (rel.startsWith('../') || rel === '..') throw new Error('Fixture escaped its temporary root')
    return rel.replace(/^home\//, '~/')
  }
  let provider: SkillsAnywhereProvider | undefined
  try {
    await mkdir(join(project, '.git'), { recursive: true })
    await Promise.all(inputs.map(async input => {
      const path = join(scratch, input.path)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, input.markdown)
    }))
    provider = new SkillsAnywhereProvider(resolveConfig({
      home: fixtureHome, dshHome: join(fixtureHome, '.dsh'),
      watch: false, sync: false, sourcesFiles: false, sources: [],
      catalog: { limit: 3 },
    }), { info() {}, warn() {} })
    const discovered = await provider.list({ cwd: project })
    const candidates = Array.isArray(discovered) ? discovered : discovered.candidates
    const report = provider.report()
    if (!report?.complete) throw new Error('Fixture discovery incomplete')
    return {
      schema: 'skills-anywhere-playground-1', version, agentCount: AGENTS.length,
      skills: await Promise.all(report.skills.map(async entry => {
        const extra = entry.metadata.skillsAnywhere as { renamedFrom?: string } | undefined
        const raw = await readFile(entry.path, 'utf8')
        // The provider's loader supplies the same parsed body it uses in dsh.
        const candidate = candidates.find(c => c.name === entry.name)!
        const loaded = await provider!.get(candidate, { cwd: project })
        if (!loaded || !inputs.some(input => input.markdown === raw)) throw new Error('Unexpected fixture content')
        return {
          name: entry.name, description: entry.description, source: entry.source,
          provider: 'skills-anywhere', origin: originLabel(entry.origin),
          path: portable(entry.path), content: loaded.content, invocation: entry.invocation,
          ...(extra?.renamedFrom ? { renamedFrom: extra.renamedFrom } : {}),
          warnings: entry.warnings,
        }
      })),
      inputs: inputs.map(input => ({ ...input, path: input.path.replace(/^home\//, '~/') })),
      dropped: report.dropped.map(entry => ({ name: entry.skill.name, path: portable(entry.skill.path), winner: entry.winner.name, reason: entry.reason })),
      invalid: report.invalid.map(entry => ({ path: portable(entry.path), reason: entry.reason })),
    }
  } finally {
    await provider?.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
}
