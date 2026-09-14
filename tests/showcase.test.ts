import { describe, expect, it } from 'vitest'
import { createDemoData } from '../huggingface/fixture.ts'
import { applyCatalogBudget } from '../src/catalog.ts'
import { searchSkills } from '../src/search.ts'
import { readFile } from 'node:fs/promises'
import { compareManifests, validateManifest } from '../src/bundle-manifest.ts'

describe('public showcase fixture', () => {
  it('records real discovery without paths or skills from the host machine', async () => {
    const data = await createDemoData('test-version')
    expect(data.inputs).toHaveLength(10)
    expect(data.skills).toHaveLength(8)
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
    const robot = searchSkills(data.skills, 'Microduck recorded frame', 20)[0]
    expect(robot?.name).toBe('robot-reel-review')
    expect(data.inputs.find(input => input.path.endsWith('/robot-reel-review/SKILL.md'))?.markdown)
      .toBe(await readFile('examples/robot-reel-review/SKILL.md', 'utf8'))
    const reviewed = await validateManifest(data.bundles.reviewed)
    const changed = await validateManifest(data.bundles.changed)
    expect(compareManifests(reviewed, changed)).toMatchObject({
      matches: false, changed: ['scripts/review.py'], added: [], removed: [],
    })
    expect(reviewed.files.find(file => file.path === 'SKILL.md')).toEqual(changed.files.find(file => file.path === 'SKILL.md'))
  })
})
