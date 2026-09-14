#!/usr/bin/env node
/**
 * JSONL bridge for a controlled direct-file / real-stdio-MCP experiment.
 * Requires a checkout with `pnpm install && pnpm build`.
 * Never discovers the caller's installed skills or private agent history.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { createSkillsAnywhereServer, findModelSkills, modelSkills, openSkill, runStdio } from '../../lib/mcp.js'

const entry = fileURLToPath(import.meta.url)

function options(pool, isolated) {
  return {
    cwd: isolated,
    cacheMs: 0,
    config: {
      home: isolated, dshHome: join(isolated, '.dsh'),
      agents: false, claudePlugins: false, sourcesFiles: false,
      extraUserDirs: [pool], sync: false, watch: false,
    },
    log: { info() {}, warn(message) { process.stderr.write(`${message}\n`) } },
  }
}

export async function connectBridge(route, pool) {
  if (!['direct', 'mcp'].includes(route)) throw new Error('route must be direct or mcp')
  const isolated = await mkdtemp(join(tmpdir(), 'skill-impact-'))
  const api = createSkillsAnywhereServer(options(resolve(pool), isolated))
  let client
  let transport
  try {
    const report = await api.refresh()
    if (!report.complete || report.invalid.length || report.dropped.length) throw new Error('skill pool must be complete and unambiguous')
    const pins = new Map()
    for (const skill of modelSkills(report)) {
      const opened = await openSkill(skill, false, true)
      if (!opened?.bundle) throw new Error(`cannot pin skill ${skill.name}`)
      // This experiment exposes instructions only. Do not silently omit resources.
      if (opened.bundle.files.some(file => file.path !== 'SKILL.md')) throw new Error('instruction-only experiment requires SKILL.md-only bundles')
      pins.set(skill.name, { sha256: opened.sha256, bundle_sha256: opened.bundle.sha256 })
    }
    if (!pins.size) throw new Error('skill pool is empty')
    if (route === 'mcp') {
      client = new Client({ name: 'skills-anywhere-impact', version: '1' }, { versionNegotiation: { mode: 'auto' } })
      transport = new StdioClientTransport({
        command: process.execPath,
        args: [entry, 'server', resolve(pool), isolated],
        cwd: isolated,
        stderr: 'pipe',
      })
      await client.connect(transport)
    }
    async function call(name, args) {
      const started = performance.now()
      let raw
      let view
      if (name === 'list_skills') {
        if (Object.keys(args).length) throw new Error('this bounded experiment catalog takes no arguments')
        if (client) {
          raw = await client.callTool({ name, arguments: { limit: 10 } })
          if (raw.isError) throw new Error(JSON.stringify(raw))
        } else {
          const skills = modelSkills(await api.refresh(true))
          raw = {
            structuredContent: {
              total: skills.length,
              skills: skills.slice(0, 10).map(({ name, description, source }) => ({ name, description, source })),
            },
          }
        }
        view = {
          total: raw.structuredContent.total,
          skills: raw.structuredContent.skills.map(({ name, description }) => ({ name, description })),
        }
      } else if (name === 'find_skills') {
        const query = args.query
        if (typeof query !== 'string' || query.length > 1024) throw new Error('query must be a bounded string')
        const queryArgs = { query, limit: 10 }
        raw = client
          ? await client.callTool({ name, arguments: queryArgs })
          : { structuredContent: findModelSkills(await api.refresh(true), query, 10) }
        if (raw.isError) throw new Error(JSON.stringify(raw))
        view = {
          total: raw.structuredContent.total,
          matches: raw.structuredContent.matches.map(({ name, description }) => ({ name, description })),
        }
      } else if (name === 'open_skill') {
        const pin = pins.get(args.name)
        if (!pin) throw new Error('skill was not in the reviewed pool')
        const loadArgs = { name: args.name, expected_sha256: pin.sha256, expected_bundle_sha256: pin.bundle_sha256 }
        if (client) {
          raw = await client.callTool({ name, arguments: loadArgs })
          if (raw.isError) throw new Error(JSON.stringify(raw))
        } else {
          const current = modelSkills(await api.refresh(true)).find(skill => skill.name === args.name)
          const opened = current && await openSkill(current, false, true)
          if (!opened || opened.sha256 !== pin.sha256 || opened.bundle?.sha256 !== pin.bundle_sha256) throw new Error('reviewed skill changed')
          raw = { structuredContent: opened }
        }
        const opened = raw.structuredContent
        view = {
          name: opened.name, description: opened.description,
          content: opened.content, sha256: opened.sha256,
          bundle_sha256: opened.bundle.sha256,
        }
      } else throw new Error('unknown bridge tool')
      return {
        view,
        receipt: {
          route, tool: name, arguments: args,
          elapsed_ms: performance.now() - started,
          protocol_era: client?.getProtocolEra() ?? null,
          raw,
        },
      }
    }
    return {
      pins: Object.fromEntries(pins),
      call,
      async close() {
        try { await client?.close(); await transport?.close() }
        finally { await api.close(); await rm(isolated, { recursive: true, force: true }) }
      },
    }
  } catch (error) {
    await client?.close()
    await transport?.close()
    await api.close()
    await rm(isolated, { recursive: true, force: true })
    throw error
  }
}

async function main() {
  const [route, pool, isolated] = process.argv.slice(2)
  if (route === 'server') {
    await runStdio(options(pool, isolated))
    return
  }
  const bridge = await connectBridge(route, pool ?? join(dirname(entry), '..'))
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  process.stdout.write(`${JSON.stringify({ ready: true, route, pins: bridge.pins })}\n`)
  try {
    for await (const line of lines) {
      let request
      try {
        if (Buffer.byteLength(line) > 8192) throw new Error('request too large')
        request = JSON.parse(line)
        const result = await bridge.call(request.tool, request.arguments ?? {})
        process.stdout.write(`${JSON.stringify({ id: request.id, ...result })}\n`)
      } catch (error) {
        process.stdout.write(`${JSON.stringify({ id: request?.id, error: String(error.message ?? error) })}\n`)
      }
    }
  } finally { await bridge.close() }
}

if (process.argv[1] && resolve(process.argv[1]) === entry) await main()
