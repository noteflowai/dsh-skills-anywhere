import { cp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { tempDir } from './helpers.ts'
import { findModelSkills } from '../src/mcp.ts'

// Exercise the distributed example against the built module and a real child
// process. The check pipeline builds before testing so a fresh clone exercises
// the same compiled module as the child MCP process.
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

it('a new MCP session honors earlier pins instead of approving a changed skill', async () => {
  const root = await tempDir('handoff-pins')
  const skill = join(root, 'robot-recording-review')
  await cp(new URL('../examples/robot-recording-review', import.meta.url), skill, { recursive: true })
  const { connectBridge } = await import('../examples/skill-impact/bridge.mjs')
  const first = await connectBridge('mcp', root)
  const pins = first.pins
  await first.close()
  const pin = pins['robot-recording-review']
  if (!pin) throw new Error('reviewed skill pin is missing')
  const next = await connectBridge('mcp', root, pins)
  try {
    const loaded = await next.call('open_skill', { name: 'robot-recording-review' })
    expect(loaded.view.sha256).toBe(pin.sha256)
    expect(loaded.view.bundle_sha256).toBe(pin.bundle_sha256)
    expect(loaded.receipt.protocol_era).toBe('modern')
  } finally {
    await next.close()
  }
  await writeFile(join(skill, 'SKILL.md'), '---\nname: robot-recording-review\ndescription: Changed after handoff.\n---\nChanged instructions.\n')
  await expect(connectBridge('mcp', root, pins)).rejects.toThrow(/changed since the handoff/)
  await expect(connectBridge('direct', root, pins)).rejects.toThrow(/changed since the handoff/)
})

it('handoff pins reject a different pool and malformed identities', async () => {
  const root = await tempDir('handoff-pin-shape')
  await cp(new URL('../examples/robot-recording-review', import.meta.url), join(root, 'robot-recording-review'), { recursive: true })
  const { connectBridge } = await import('../examples/skill-impact/bridge.mjs')
  const first = await connectBridge('mcp', root)
  const pins = first.pins
  await first.close()
  await expect(connectBridge('mcp', root, {})).rejects.toThrow(/pool differs/)
  await expect(connectBridge('mcp', root, { ...pins, unreviewed: pins['robot-recording-review'] })).rejects.toThrow(/pool differs/)
  await expect(connectBridge('mcp', root, { 'robot-recording-review': { sha256: 'short', bundle_sha256: '0'.repeat(64) } })).rejects.toThrow(/exact SHA-256/)
  await expect(connectBridge('mcp', root, null)).rejects.toThrow(/must be an object/)
})
