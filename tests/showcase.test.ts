import { describe, expect, it } from 'vitest'
import { createDemoData } from '../huggingface/fixture.ts'
import { applyCatalogBudget } from '../src/catalog.ts'
import { searchSkills } from '../src/search.ts'

describe('public showcase fixture', () => {
  it('records real discovery without paths or skills from the host machine', async () => {
    const data = await createDemoData('test-version')
    expect(data.inputs).toHaveLength(9)
    expect(data.skills).toHaveLength(7)
    expect(data.dropped).toEqual([
      expect.objectContaining({ name: 'review', winner: 'review', reason: 'same-content', path: '~/.cursor/skills/review/SKILL.md' }),
    ])
    expect(data.invalid).toHaveLength(1)
    expect(data.skills.filter(skill => skill.renamedFrom === 'configure').map(skill => skill.name).sort())
      .toEqual(['chat-configure', 'issues-configure'])
    expect(data.skills.find(skill => skill.name === 'incident-summary')?.warnings.length).toBeGreaterThan(0)
    expect(data.skills.find(skill => skill.name === 'manual-deploy')?.invocation.modelInvocable).toBe(false)
    for (const skill of data.skills) {
      expect(skill.path).toMatch(/^(~\/|project\/)/)
      expect(skill.content).toBeTruthy()
    }
    expect(JSON.stringify(data)).not.toMatch(/skills-playground-|\/tmp\/|\/home\/dcvuser|[A-Z]:\\\\/)
    const result = applyCatalogBudget(data.skills, { limit: 1, pin: new Set(['test-plan']), hide: new Set() })
    expect(result.get('test-plan')).toBe('visible')
    expect(result.get('manual-deploy')).toBe('disabled')
    expect([...result.values()].filter(value => value === 'visible')).toHaveLength(1)
    const matches = searchSkills(data.skills.filter(skill => skill.invocation.modelInvocable), 'configure', 20)
    expect(matches.map(match => match.name).sort()).toEqual(['chat-configure', 'issues-configure'])
  })
})
