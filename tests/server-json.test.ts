import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Invariants the official MCP registry enforces when the release workflow runs
// `mcp-publisher publish`. Caught here so a release never fails on them.

const root = join(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const server = JSON.parse(readFileSync(join(root, 'server.json'), 'utf8'))
const agentPlugin = JSON.parse(readFileSync(join(root, 'plugin.json'), 'utf8'))
const agentMcp = JSON.parse(readFileSync(join(root, 'mcp.json'), 'utf8'))
const claudePlugin = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8'))

describe('server.json', () => {
  it('names the server exactly as package.json mcpName', () => {
    expect(server.name).toBe(pkg.mcpName)
    expect(server.name).toMatch(/^io\.github\.noteflowai\//)
  })

  it('keeps the description within the registry limit of 100 characters', () => {
    expect(server.description.length).toBeLessThanOrEqual(100)
    expect(server.description.length).toBeGreaterThan(0)
  })

  it('points at this npm package and version', () => {
    expect(server.version).toBe(pkg.version)
    const npm = server.packages.find((entry: { registryType: string }) => entry.registryType === 'npm')
    expect(npm).toBeDefined()
    expect(npm.identifier).toBe(pkg.name)
    expect(npm.version).toBe(pkg.version)
    expect(npm.transport.type).toBe('stdio')
    expect(npm.packageArguments[0]).toMatchObject({ type: 'positional', value: 'mcp' })
  })

  it('Agent Plugins and Claude Code manifests pin this version of the npm package', () => {
    expect(agentPlugin.$schema).toBe('https://agent-plugins.org/schemas/1.0.0/plugin.schema.json')
    expect(agentPlugin.name).toBe(pkg.name)
    expect(agentPlugin.version).toBe(pkg.version)
    expect(agentMcp.mcpServers['skills-anywhere']).toMatchObject({ type: 'stdio', command: 'npx', args: ['-y', `${pkg.name}@${pkg.version}`, 'mcp'] })
    expect(claudePlugin.version).toBe(pkg.version)
    expect(claudePlugin.mcpServers['skills-anywhere'].args).toContain(`${pkg.name}@${pkg.version}`)
  })
})
