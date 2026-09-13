import { describe, expect, it } from 'vitest'
import { AGENTS, agentById } from '../src/agents.ts'
import { originGroup, originLabel } from '../src/origin.ts'

describe('origin labels', () => {
  it('describes every origin kind for humans', () => {
    expect(originLabel({ kind: 'agent', agent: 'codex', scope: 'user' })).toBe('codex (user)')
    expect(originLabel({ kind: 'agent', scope: 'project' })).toBe('agent (project)')
    expect(originLabel({ kind: 'claude-plugins', plugin: 'discord', marketplace: 'official' })).toBe('claude plugin discord @ official')
    expect(originLabel({ kind: 'claude-plugins' })).toBe('claude plugin ?')
    expect(originLabel({ kind: 'source', repo: 'anthropics/skills' })).toBe('git anthropics/skills')
    expect(originLabel({ kind: 'source' })).toBe('git ?')
    expect(originLabel({ kind: 'custom', scope: 'user' })).toBe('custom (user)')
    expect(originLabel({ kind: 'custom' })).toBe('custom (?)')
  })

  it('groups origins by where the files live', () => {
    expect(originGroup({ kind: 'agent', agent: 'cursor', scope: 'project' })).toBe('Project skill directories')
    expect(originGroup({ kind: 'agent', agent: 'cursor', scope: 'user' })).toBe('User skill directories')
    expect(originGroup({ kind: 'claude-plugins', plugin: 'x' })).toBe('Claude Code plugins')
    expect(originGroup({ kind: 'source', repo: 'o/r' })).toBe('Git sources')
    expect(originGroup({ kind: 'custom', scope: 'project' })).toBe('Project skill directories')
    expect(originGroup({ kind: 'custom', scope: 'user' })).toBe('User skill directories')
  })
})

describe('agents table', () => {
  it('has unique ids, at least one directory per agent, and a lookup by id', () => {
    const ids = AGENTS.map(agent => agent.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(AGENTS.length).toBeGreaterThanOrEqual(60)
    for (const agent of AGENTS) expect(agent.project !== undefined || agent.user !== undefined).toBe(true)
    expect(agentById('claude-code')?.user).toBe('.claude/skills')
    expect(agentById('no-such-agent')).toBeUndefined()
  })
})
