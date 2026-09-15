/**
 * MCP server mode: the same skill pool the dsh provider publishes, exposed to
 * any Model Context Protocol client (Claude Code, Cursor, Codex, Windsurf, …)
 * as three tools and one resource template.
 *
 * - `list_skills`  — browse every model-invocable skill with its description
 * - `find_skills`  — keyword search over names, descriptions and origins
 * - `open_skill`   — load one skill's instructions plus its resource directory
 * - `skill://{name}` resources for clients that prefer @-mentions
 *
 * The server imports nothing from dsh at runtime, so `npx dsh-skills-anywhere
 * mcp` works on machines that never installed DeepSeek Harness.
 *
 * @module dsh-skills-anywhere/mcp
 */

import { createHash } from 'node:crypto'
import { loadReceipt, type LoadReceipt } from './load-receipt.ts'
import { readSkillBytes } from './skill-input.ts'
import { readBundle } from './skill-bundle.ts'
import type { BundleManifest } from './bundle-manifest.ts'
import { createRequire } from 'node:module'
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'
import { resolveConfig, type Config, type ResolvedConfig } from './config.ts'
import type { DiscoveredSkill, DiscoveryReport } from './discover.ts'
import { originLabel } from './origin.ts'
import { isSkillName, parseSkillMarkdown } from './frontmatter.ts'
import { SkillsAnywhereProvider, type ProviderLogger } from './provider.ts'
import { searchSkills } from './search.ts'

export interface McpOptions {
  /** Project directory that selects project-level skill roots and sources. */
  readonly cwd?: string
  /** Provider configuration; defaults follow the dsh plugin defaults. */
  readonly config?: Config | ResolvedConfig
  /** Where diagnostics go. Defaults to stderr, which stdio MCP clients ignore. */
  readonly log?: ProviderLogger
  /** How long one discovery pass is reused before rescanning (ms). */
  readonly cacheMs?: number
  /** Default `find_skills` result count. */
  readonly findLimit?: number
  /** Hard cap for `find_skills` and `list_skills` result counts. */
  readonly maxLimit?: number
}

export interface SkillsAnywhereMcp {
  readonly server: McpServer
  readonly provider: SkillsAnywhereProvider
  /** Discover (or reuse the cached pass) and return the current pool. */
  refresh(force?: boolean): Promise<DiscoveryReport>
  /** Close the transport and release watchers and timers. */
  close(): Promise<void>
}

export interface OpenedSkill {
  readonly name: string
  readonly description: string
  readonly directory: string
  readonly path: string
  readonly source: string
  readonly content: string
  /** SHA-256 of the original SKILL.md bytes, including frontmatter. */
  readonly sha256: string
  /**
   * Tools the author declared this skill needs, from `allowed-tools`.
   *
   * The origin agent may enforce this; MCP gives a server no way to restrict a
   * client's tools, so it is reported rather than applied. Dropping it silently
   * would hand the reader a skill that looks unrestricted when its author
   * narrowed it, which is the metadata loss that makes a skill riskier on the
   * second platform than on the first.
   */
  readonly declaredTools?: readonly string[]
  readonly bundle?: BundleManifest
  /** Returned instruction identity; no execution or task-success assertion. */
  readonly receipt: LoadReceipt
}

const DEFAULT_CACHE_MS = 3000
const DEFAULT_FIND_LIMIT = 10
const DEFAULT_MAX_LIMIT = 200

const INSTRUCTIONS = [
  'This server exposes Agent Skills (SKILL.md folders) installed for other coding agents on this machine, inside Claude Code plugin marketplaces, and from configured git repositories.',
  'When a task might match a skill, call find_skills with a few keywords, then open_skill with the exact name to load its instructions.',
  'Skills may reference scripts and files relative to the directory returned by open_skill; read them from that directory only as needed.',
].join(' ')

function isResolved(config: Config | ResolvedConfig | undefined): config is ResolvedConfig {
  return config !== undefined && 'stateDir' in config && typeof config.stateDir === 'string'
}

function stderrLogger(): ProviderLogger {
  return {
    info: message => process.stderr.write(`${message}\n`),
    warn: message => process.stderr.write(`${message}\n`),
  }
}

export function packageVersion(): string {
  try {
    const pkg = createRequire(import.meta.url)('../package.json') as { version?: unknown }
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** Skills the author allows a model to invoke, in catalog order. */
export function modelSkills(report: DiscoveryReport): DiscoveredSkill[] {
  return report.skills.filter(skill => skill.invocation.modelInvocable)
}

/** The same catalog search for direct clients and the MCP tool. */
export function findModelSkills(report: DiscoveryReport, query: string, limit = 10) {
  const trimmed = query.trim()
  if (trimmed.length === 0) throw new Error('query must not be empty')
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('limit must be a positive safe integer')
  const skills = modelSkills(report)
  const matches = searchSkills(
    skills.map(skill => ({ ...skill, source: originLabel(skill.origin), provider: 'skills-anywhere' })),
    trimmed,
    limit,
  )
  return {
    total: skills.length,
    matches: matches.map(match => ({ name: match.name, description: match.description, source: match.source })),
  }
}

/** Escape text for an XML attribute value. */
function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Escape text placed between tags. */
function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Render a skill the way dsh hands it to its model, so clients that already
 * understand `<skill_content>` blocks see a familiar shape.
 */
export function renderSkill(skill: Pick<OpenedSkill, 'name' | 'directory' | 'content' | 'declaredTools'>): string {
  const declared = skill.declaredTools ?? []
  return [
    `<skill_content name="${escapeAttr(skill.name)}">`,
    '<skill_resources>',
    `Base directory for this skill: ${escapeText(skill.directory)}`,
    'Resolve relative paths mentioned by this skill against the base directory before using them. Load referenced resources only as needed.',
    '</skill_resources>',
    // Stated in the text as well, because a model may act on the instructions
    // without its client ever reading the structured payload.
    ...(declared.length > 0
      ? [
          '',
          '<skill_author_declared_tools>',
          `The author declared this skill needs only: ${escapeText(declared.join(', '))}.`,
          'This server cannot restrict your tools. Treat anything beyond that list as outside what the author asked for.',
          '</skill_author_declared_tools>',
        ]
      : []),
    '',
    '<skill_instructions>',
    skill.content,
    '</skill_instructions>',
    '</skill_content>',
  ].join('\n')
}

/** Re-read a discovered skill from disk so edits since discovery are honoured. */
export async function openSkill(skill: DiscoveredSkill, lenient: boolean, includeBundle = false): Promise<OpenedSkill | undefined> {
  let raw: string
  let bytes: Buffer
  const snapshot = includeBundle ? await readBundle(skill.directory) : undefined
  try {
    bytes = snapshot?.skillBytes ?? await readSkillBytes(skill.path)
    raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return undefined
  }
  const parsed = parseSkillMarkdown(raw, { fallbackName: skill.name, lenient })
  if (!parsed.ok) return undefined
  // Discovery may be cached. Honour the author's current file at every load.
  if (!parsed.skill.invocation.modelInvocable) throw new Error(`skill "${skill.name}" is not available for model invocation (disabled by its author)`)
  const opened = {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    name: skill.name,
    description: parsed.skill.description,
    directory: skill.directory,
    path: skill.path,
    source: skill.source,
    content: parsed.skill.content,
    ...(Array.isArray(parsed.skill.metadata.allowedTools) && parsed.skill.metadata.allowedTools.length > 0
      ? { declaredTools: parsed.skill.metadata.allowedTools as readonly string[] }
      : {}),
    ...(snapshot ? { bundle: snapshot.manifest } : {}),
  }
  return { ...opened, receipt: loadReceipt(opened, packageVersion()) }
}


/** Build a server over a standalone provider. Nothing is connected yet. */
export function createSkillsAnywhereServer(options: McpOptions = {}): SkillsAnywhereMcp {
  const log = options.log ?? stderrLogger()
  const config = isResolved(options.config)
    ? options.config
    // No dsh registry to invalidate, so file watching would only burn handles.
    : resolveConfig({ ...options.config, watch: false })
  const cwd = options.cwd ?? process.cwd()
  const cacheMs = Math.max(0, options.cacheMs ?? DEFAULT_CACHE_MS)
  const findLimit = Math.max(1, Math.floor(options.findLimit ?? DEFAULT_FIND_LIMIT))
  const maxLimit = Math.max(findLimit, Math.floor(options.maxLimit ?? DEFAULT_MAX_LIMIT))
  const provider = new SkillsAnywhereProvider(config, log)
  const server = new McpServer({ name: 'dsh-skills-anywhere', version: packageVersion() }, { instructions: INSTRUCTIONS })

  let cached: { at: number; report: DiscoveryReport } | undefined
  let inflight: Promise<DiscoveryReport> | undefined
  const empty: DiscoveryReport = { skills: [], dropped: [], invalid: [], roots: [], complete: true }

  async function refresh(force = false): Promise<DiscoveryReport> {
    if (!force && cached !== undefined && Date.now() - cached.at < cacheMs) return cached.report
    if (inflight !== undefined) return inflight
    inflight = (async () => {
      try {
        await provider.list({ cwd })
        const report = provider.report() ?? empty
        cached = { at: Date.now(), report }
        return report
      } finally {
        inflight = undefined
      }
    })()
    return inflight
  }

  function clampLimit(limit: number | undefined, fallback: number): number {
    return Math.min(maxLimit, Math.max(1, Math.floor(limit ?? fallback)))
  }

  server.registerTool('list_skills', {
    title: 'List skills',
    description: 'List installed Agent Skills (name, description, origin) available through this server. Use find_skills to search a large pool instead of paging through it.',
    inputSchema: {
      limit: z.number().int().min(1).max(maxLimit).optional().describe(`Maximum skills to return (default ${maxLimit}).`),
      offset: z.number().int().min(0).optional().describe('Skip this many skills (for paging).'),
    },
    outputSchema: {
      total: z.number().describe('Model-invocable skills available.'),
      skills: z.array(z.object({ name: z.string(), description: z.string(), source: z.string() })),
    },
  }, async ({ limit, offset }) => {
    const skills = modelSkills(await refresh())
    const start = Math.max(0, Math.floor(offset ?? 0))
    const page = skills.slice(start, start + clampLimit(limit, maxLimit))
    const structured = {
      total: skills.length,
      skills: page.map(skill => ({ name: skill.name, description: skill.description, source: originLabel(skill.origin) })),
    }
    const text = skills.length === 0
      ? 'No skills found. Add a git source with `dsh-skills-anywhere add owner/repo` or install skills for any supported agent.'
      : [`${page.length} of ${skills.length} skills:`, ...page.map(skill => `- ${skill.name} — ${skill.description} [${originLabel(skill.origin)}]`)].join('\n')
    return { content: [{ type: 'text', text }], structuredContent: structured }
  })

  server.registerTool('find_skills', {
    title: 'Find skills',
    description: 'Search installed Agent Skills by keyword across names, descriptions and origins. Returns the best matches; load one with open_skill.',
    inputSchema: {
      query: z.string().min(1).describe('Keywords describing the task or skill, e.g. "pdf forms", "react testing", "docx".'),
      limit: z.number().int().min(1).max(maxLimit).optional().describe(`Maximum matches to return (default ${findLimit}).`),
    },
    outputSchema: {
      total: z.number().describe('Skills searched.'),
      matches: z.array(z.object({ name: z.string(), description: z.string(), source: z.string() })),
    },
  }, async ({ query, limit }) => {
    const trimmed = query.trim()
    const structured = findModelSkills(await refresh(), trimmed, clampLimit(limit, findLimit))
    const { matches, total } = structured
    const text = matches.length === 0
      ? `No skills matched "${trimmed}". ${total} skills searched; try different keywords or list_skills.`
      : [`${matches.length} of ${total} skills matched:`, ...matches.map(match => `- ${match.name} — ${match.description} [${match.source}]`)].join('\n')
    return { content: [{ type: 'text', text }], structuredContent: structured }
  })

  async function lookup(name: string, includeBundle = false): Promise<OpenedSkill> {
    if (!isSkillName(name)) throw new Error(`invalid skill name "${name}"`)
    let report = await refresh()
    let skill = report.skills.find(entry => entry.name === name)
    if (skill === undefined) {
      // Maybe it was installed after the last scan.
      report = await refresh(true)
      skill = report.skills.find(entry => entry.name === name)
    }
    if (skill === undefined) throw new Error(`skill "${name}" is unknown; search with find_skills`)
    if (!skill.invocation.modelInvocable) throw new Error(`skill "${name}" is not available for model invocation (disabled by its author)`)
    const opened = await openSkill(skill, config.lenient, includeBundle)
    if (opened === undefined) throw new Error(`skill "${name}" is no longer readable at ${skill.path}`)
    return opened
  }

  server.registerTool('open_skill', {
    title: 'Open skill',
    description: 'Load the full instructions of an installed Agent Skill by exact name, together with the directory its scripts and references live in.',
    inputSchema: {
      name: z.string().min(1).describe('Exact skill name as returned by find_skills or list_skills.'),
      expected_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional().describe('Require these exact SKILL.md bytes, using a hash from check --json or an earlier open_skill. Excludes referenced files.'),
      include_bundle: z.boolean().optional().describe('Also fingerprint all regular files below this skill directory; bounded reads, no execution.'),
      expected_bundle_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional().describe('Require the reviewed directory digest from bundle --json. Includes its scripts, references, assets and hidden files; excludes external dependencies. Implies include_bundle.'),
    },
    outputSchema: {
      name: z.string(),
      description: z.string(),
      directory: z.string().describe('Absolute directory; resolve relative paths in the instructions against it.'),
      path: z.string().describe('Absolute path of the SKILL.md file.'),
      source: z.string(),
      content: z.string().describe('The skill instructions (Markdown body without frontmatter).'),
      sha256: z.string().describe('SHA-256 of original SKILL.md bytes, including frontmatter; not a security or resource verification.'),
      declared_tools: z.array(z.string()).optional().describe("Tools the author declared this skill needs, from allowed-tools. Reported, not enforced: this server cannot restrict your tools. Absent when the author declared none, which is not a statement that the skill is unrestricted."),
      bundle: z.object({
        schema: z.literal('skills-anywhere-bundle-1'),
        sha256: z.string(),
        total_bytes: z.number(),
        files: z.array(z.object({ path: z.string(), bytes: z.number(), sha256: z.string() })),
      }).optional().describe('Directory inventory at inspection time. Does not freeze files for later execution or authenticate an author.'),
      receipt: z.object({
        schema: z.literal('skills-anywhere-load-1'),
        load_id: z.string(),
        loaded_at: z.string(),
        provider: z.literal('dsh-skills-anywhere'),
        provider_version: z.string(),
        name: z.string(),
        skill_sha256: z.string(),
        content_sha256: z.string(),
        bundle_sha256: z.string().nullable(),
        declared_tools: z.array(z.string()).nullable(),
        permissions_enforced: z.literal(false),
      }).describe('Identity of this instruction delivery. Attach to your own tool span; does not assert execution, permission enforcement or task success. Omits source path fields and instruction text; preserves author tool declarations.'),
    },
  }, async ({ name, expected_sha256, include_bundle, expected_bundle_sha256 }) => {
    const skill = await lookup(name, include_bundle === true || expected_bundle_sha256 !== undefined)
    if (expected_sha256 !== undefined && skill.sha256 !== expected_sha256) throw new Error('SKILL.md changed: expected_sha256 does not match; review the current file before loading instructions')
    if (expected_bundle_sha256 !== undefined && skill.bundle?.sha256 !== expected_bundle_sha256) throw new Error('Skill bundle changed: expected_bundle_sha256 does not match; review scripts and resources before loading instructions')
    const { declaredTools, ...rest } = skill
    return {
      content: [{ type: 'text', text: renderSkill(skill) }],
      structuredContent: { ...rest, ...(declaredTools !== undefined ? { declared_tools: [...declaredTools] } : {}) },
    }
  })

  server.registerResource('skill', new ResourceTemplate('skill://{name}', {
    list: async () => ({
      resources: modelSkills(await refresh()).map(skill => ({
        uri: `skill://${skill.name}`,
        name: skill.name,
        description: skill.description,
        mimeType: 'text/markdown',
      })),
    }),
    complete: {
      name: async (value) => modelSkills(await refresh()).map(skill => skill.name).filter(name => name.startsWith(value)),
    },
  }), {
    title: 'Agent Skill',
    description: 'Instructions of one installed Agent Skill, rendered with its resource directory.',
    mimeType: 'text/markdown',
  }, async (uri, variables) => {
    const raw = variables.name
    const name = Array.isArray(raw) ? raw[0] ?? '' : raw ?? ''
    const skill = await lookup(name)
    return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: renderSkill(skill) }] }
  })

  return {
    server,
    provider,
    refresh,
    async close() {
      await server.close()
      await provider.dispose()
    },
  }
}

/** Serve over stdio until the client disconnects; resolves when closed. */
export async function runStdio(options: McpOptions = {}): Promise<void> {
  const mcp = createSkillsAnywhereServer(options)
  let finish!: () => void
  const closed = new Promise<void>(resolve => { finish = resolve })
  // The SDK's entry selects the protocol from the opening exchange. A direct
  // server.connect(transport) would still speak only the legacy protocol.
  const handle = serveStdio(() => mcp.server, {
    onerror: error => (options.log ?? stderrLogger()).warn(error.message),
  })
  // EOF can arrive before any opening exchange (including a discovery probe).
  // Release the provider and transport even when no server session was started.
  process.stdin.once('end', finish)
  process.once('SIGINT', finish)
  process.once('SIGTERM', finish)
  // oxlint-disable-next-line unicorn/prefer-add-event-listener
  mcp.server.server.onclose = finish
  try {
    if (process.stdin.readableEnded || process.stdin.destroyed) finish()
    await closed
  } finally {
    process.stdin.off('end', finish)
    process.off('SIGINT', finish)
    process.off('SIGTERM', finish)
    await handle.close()
    await mcp.provider.dispose()
  }
}
