import { cp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { tempDir } from './helpers.ts'
import { findModelSkills } from '../src/mcp.ts'

// Exercise the distributed example against the built module and a real child
// process. This test runs after build in the example-specific verification.
it('shared discovery rejects invalid query and limit values', () => {
  const report = { skills: [], dropped: [], invalid: [], roots: [], complete: true }
  expect(() => findModelSkills(report, ' ')).toThrow(/empty/)
  expect(() => findModelSkills(report, 'robot', Number.NaN)).toThrow(/integer/)
  expect(findModelSkills(report, 'robot', 300)).toEqual({ total: 0, matches: [] })
})

it('direct and real MCP delivery agree and reject changed reviewed bytes', async () => {
  const root = await tempDir('impact-bridge')
  const skill = join(root, 'robot-recording-review')
  await cp(new URL('../examples/robot-recording-review', import.meta.url), skill, { recursive: true })
  // The example is executable JavaScript rather than an additional package API.
  const { connectBridge } = await import('../examples/skill-impact/bridge.mjs')
  const direct = await connectBridge('direct', root)
  const mcp = await connectBridge('mcp', root)
  try {
    expect(direct.pins).toEqual(mcp.pins)
    const args = { query: 'robot motion' }
    const directFind = await direct.call('find_skills', args)
    const mcpFind = await mcp.call('find_skills', args)
    expect(directFind.view).toEqual(mcpFind.view)
    expect((await direct.call('list_skills', {})).view).toEqual(
      (await mcp.call('list_skills', {})).view,
    )
    expect((await mcp.call('find_skills', { query: 'json processing' })).view).toMatchObject({
      matches: [{ name: 'robot-recording-review' }],
    })
    const openArgs = { name: 'robot-recording-review' }
    const a = await direct.call('open_skill', openArgs)
    const b = await mcp.call('open_skill', openArgs)
    expect(a.view).toEqual(b.view)
    expect(b.receipt.protocol_era).toBe('modern')
    await writeFile(join(skill, 'SKILL.md'), '---\nname: robot-recording-review\ndescription: changed\n---\nCHANGED BODY\n')
    await expect(direct.call('open_skill', openArgs)).rejects.toThrow(/changed/)
    await expect(mcp.call('open_skill', openArgs)).rejects.toThrow(/changed/)
    await expect(mcp.call('open_skill', { name: 'private-user-skill' })).rejects.toThrow(/reviewed pool/)
  } finally {
    await direct.close()
    await mcp.close()
  }
})

it('resource-bearing skills require a resource protocol, not silent omission', async () => {
  const root = await tempDir('impact-resources')
  const skill = join(root, 'extra')
  await mkdir(skill)
  await writeFile(join(skill, 'SKILL.md'), '---\nname: extra\ndescription: Extra resources.\n---\nRead helper.txt.\n')
  await writeFile(join(skill, 'helper.txt'), 'Resource bytes')
  const { connectBridge } = await import('../examples/skill-impact/bridge.mjs')
  await expect(connectBridge('direct', root)).rejects.toThrow(/SKILL.md-only/)
})
