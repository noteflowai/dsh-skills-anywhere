import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkResourceInventory, resourceLinks, resourceTarget } from '../src/resource-links.ts'
import { checkFiles } from '../src/check-files.ts'
import { main } from '../src/cli.ts'
import { skillMarkdown, tempDir } from './helpers.ts'

describe('local CommonMark resources', () => {
  it('resolves used reference links, images, escaped spaces and nested parentheses at their actual lines', () => {
    const raw = ['---', 'description: "[not a link](yaml.md)"', '---',
      '[Guide][ref]', '![image](assets/plot%20one.png)', '[nested](guide_(one).md#part)',
      '', '[ref]: <references/a b.md> "A title"', '[unused]: absent.md',
      '`[ignored](inline.md)`', '```md', '[ignored](example.md)', '```',
      '<a href="html.md">ignored HTML</a>', '[remote](https://example.com/x)', '[anchor](#top)',
    ].join('\n')
    expect(resourceLinks(raw)).toEqual([
      { url: 'references/a b.md', line: 4, path: 'references/a b.md' },
      { url: 'assets/plot%20one.png', line: 5, path: 'assets/plot one.png' },
      { url: 'guide_(one).md#part', line: 6, path: 'guide_(one).md' },
    ])
  })

  it('does not resolve absolute paths, encoded traversal or malformed destinations', () => {
    for (const url of ['../private', '%2e%2e/private', '/etc/hosts', 'C:/private', 'file:///tmp/a']) {
      expect(resourceTarget(url)).toEqual({ problem: 'outside' })
    }
    for (const url of ['a%00b', 'a%5Cb', 'a%FFb']) expect(resourceTarget(url)).toEqual({ problem: 'invalid' })
    expect(resourceTarget('a/../b?q=x#part')).toEqual({ path: 'b' })
  })

  it('checks browser inventories without reading resource contents', () => {
    const result = checkResourceInventory('[a](references/a.md)\n[b](missing.md)\n[c](../shared.md)\n[d](references/)', ['SKILL.md', 'references/a.md'])
    expect(result.references.map(item => [item.status, item.kind])).toEqual([
      ['present', 'file'], ['missing', undefined], ['outside', undefined], ['present', 'directory'],
    ])
    expect(result.counts).toEqual({ total: 4, present: 2, issues: 2 })
    expect(checkResourceInventory('[x](a%25b.md)', ['a%b.md']).counts.present).toBe(1)
    expect(() => checkResourceInventory('', ['../private'])).toThrow('normalized paths')
  })

  it('reports a missing installed resource and does not follow a symlink to another directory', async () => {
    const cwd = await tempDir('resources')
    await mkdir(join(cwd, 'skill', 'references'), { recursive: true })
    await writeFile(join(cwd, 'secret.md'), 'not resource content')
    await symlink('../secret.md', join(cwd, 'skill', 'linked.md'))
    await writeFile(join(cwd, 'skill', 'references', 'present.md'), 'present')
    await writeFile(join(cwd, 'skill', 'SKILL.md'), skillMarkdown('review', 'Review records.', {
      body: '[p](references/present.md)\n[m](references/missing.md)\n[s](linked.md)\n[o](../secret.md)',
    }))
    const options = { cwd, lenient: false, failOnRepair: false, requirePinnedSources: false }
    const listed = await checkFiles(['skill/SKILL.md'], { ...options, resources: true })
    expect(listed.exitCode).toBe(0)
    const file = listed.files[0]!
    if (file.status === 'input_error') throw new Error(file.error)
    expect(file.resources?.references.map(item => item.status)).toEqual(['present', 'missing', 'symlink', 'outside'])
    const gated = await checkFiles(['skill/SKILL.md'], { ...options, failOnResourceIssues: true })
    expect(gated.exitCode).toBe(1)
    expect(gated.resources).toBe(true)
    expect(await main(['check', 'skill/SKILL.md', '--cwd', cwd, '--fail-on-resource-issues', '--json'])).toBe(1)
  })
})
