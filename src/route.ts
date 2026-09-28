/**
 * Route a recorded skill pick.
 *
 * `buildRouteRequest` turns a task into a typed choice request over the
 * installed, openable shortlist, plus a reserved no-match option.
 * `evaluateRoute` validates a decider's recorded response against that request
 * and the skills discovered now, and reports exactly one outcome.
 *
 * Pure: no filesystem, network or dsh runtime imports. Nothing is loaded or
 * executed; the caller only learns which SKILL.md to open.
 *
 * @module
 */

import type { DiscoveredSkill } from './discover.ts'
import { isSkillName } from './frontmatter.ts'
import { originLabel } from './origin.ts'
import { searchSkills } from './search.ts'

export const ROUTE_REQUEST_SCHEMA = 'skills-anywhere-route-request-1'
export const ROUTE_RESULT_SCHEMA = 'skills-anywhere-route-result-1'
/** Reserved "no listed skill fits" option; never a valid skill name. */
export const NO_MATCH = '_none'
/** Fixed shortlist size. */
export const MAX_CANDIDATES = 8
/** Placeholder threshold. It is not calibrated against any decider. */
export const DEFAULT_MIN_CONFIDENCE = 0.7
const MAX_ECHO_LENGTH = 200

if (isSkillName(NO_MATCH)) {
  throw new Error('skills-anywhere: the reserved no-match id must not be a valid skill name')
}

export interface OpenabilityInput {
  readonly invocation: { readonly modelInvocable: boolean }
  readonly metadata?: Record<string, unknown>
}

/**
 * Same rule as `open_skill`: model-invocable, or hidden only by the catalog
 * budget and not by the author's own `disable-model-invocation`.
 */
export function isOpenable(skill: OpenabilityInput): boolean {
  if (skill.invocation.modelInvocable) return true
  const extra = skill.metadata?.skillsAnywhere as { catalog?: unknown; authorInvocation?: { modelInvocable?: unknown } } | undefined
  return extra?.catalog === 'hidden' && extra.authorInvocation?.modelInvocable !== false
}

export type RouteSkill = Pick<DiscoveredSkill,
  'name' | 'description' | 'whenToUse' | 'invocation' | 'source' | 'rank' | 'path' | 'contentHash' | 'origin' | 'metadata'>

/** One skill per name: the lowest rank wins, as in the dsh registry. */
function winners(skills: readonly RouteSkill[]): Map<string, RouteSkill> {
  const byName = new Map<string, RouteSkill>()
  for (const skill of skills) {
    const current = byName.get(skill.name)
    if (current === undefined || skill.rank < current.rank) byName.set(skill.name, skill)
  }
  return byName
}

export interface RouteCandidate {
  readonly id: string
  readonly description: string
  readonly origin: string
  readonly path: string
  readonly contentHash: string
}

export interface RouteRequest {
  readonly schema: typeof ROUTE_REQUEST_SCHEMA
  readonly task: string
  readonly tool: { readonly name: string; readonly version: string | null }
  readonly candidates: readonly RouteCandidate[]
  readonly noMatch: typeof NO_MATCH
  readonly question: {
    readonly type: 'choice'
    readonly instructions: string
    readonly criteria: Readonly<Record<string, string>>
  }
}

export type BuildRouteResult =
  | { readonly ok: true; readonly request: RouteRequest }
  | { readonly ok: false; readonly reason: 'empty_task' | 'no_matches' }

/** Rank every skill, drop what cannot be opened, and only then cap at 8. */
export function buildRouteRequest(skills: readonly RouteSkill[], task: string, tool: RouteRequest['tool']): BuildRouteResult {
  const trimmed = task.trim()
  if (trimmed === '') return { ok: false, reason: 'empty_task' }
  const pool = [...winners(skills).values()].filter(skill => skill.name !== NO_MATCH)
  if (pool.length === 0) return { ok: false, reason: 'no_matches' }
  const byName = new Map(pool.map(skill => [skill.name, skill] as const))
  const ranked = searchSkills(pool.map(skill => ({
    name: skill.name,
    description: skill.description,
    ...(skill.whenToUse !== undefined ? { whenToUse: skill.whenToUse } : {}),
    source: skill.source,
    provider: 'skills-anywhere',
    invocation: skill.invocation,
  })), trimmed, pool.length)
  const candidates: RouteCandidate[] = []
  for (const match of ranked) {
    const skill = byName.get(match.name)
    if (skill === undefined || !isOpenable(skill)) continue
    candidates.push({
      id: skill.name,
      description: skill.description,
      origin: originLabel(skill.origin),
      path: skill.path,
      contentHash: skill.contentHash,
    })
    if (candidates.length === MAX_CANDIDATES) break
  }
  if (candidates.length === 0) return { ok: false, reason: 'no_matches' }
  const criteria = Object.fromEntries([
    ...candidates.map(candidate => [candidate.id, candidate.description] as const),
    [NO_MATCH, 'No listed skill fits this task'] as const,
  ])
  return {
    ok: true,
    request: {
      schema: ROUTE_REQUEST_SCHEMA,
      task: trimmed,
      tool,
      candidates,
      noMatch: NO_MATCH,
      question: {
        type: 'choice',
        instructions: `Choose the single listed skill id whose description best fits the task, or "${NO_MATCH}" if none fits. ` +
          `Reply with JSON: {"choice": "<id or ${NO_MATCH}>", "confidence": <number from 0 to 1>, "model": "<optional decider name>"}.`,
        criteria,
      },
    },
  }
}

export type RouteOutcome = 'selected' | 'no_match' | 'abstain' | 'stale' | 'invalid_input'

export interface RouteResult {
  readonly schema: typeof ROUTE_RESULT_SCHEMA
  readonly outcome: RouteOutcome
  readonly choice: string | null
  readonly confidence: number | null
  readonly threshold: number
  readonly model: string | null
  readonly skill: { readonly name: string; readonly origin: string; readonly path: string } | null
  readonly reason: string
  readonly hint: string
}

const HINTS: Readonly<Record<RouteOutcome, string>> = {
  selected: "open it with your agent's skill tool, /name or MCP open_skill; nothing was loaded",
  no_match: 'no listed skill fits; try route prepare with other keywords or add a source',
  abstain: 'review the shortlist yourself or ask the decider again; the default threshold is uncalibrated',
  stale: 'run route prepare again and ask the decider again',
  invalid_input: 'use the request from route prepare --json and a response like {"choice": "<id>", "confidence": 0.8}',
}

interface Provenance {
  readonly choice?: string | null
  readonly confidence?: number | null
  readonly model?: string | null
}

function makeResult(outcome: RouteOutcome, threshold: number, reason: string, provenance: Provenance = {}, skill: RouteResult['skill'] = null): RouteResult {
  return {
    schema: ROUTE_RESULT_SCHEMA,
    outcome,
    choice: provenance.choice ?? null,
    confidence: provenance.confidence ?? null,
    threshold,
    model: provenance.model ?? null,
    skill,
    reason,
    hint: HINTS[outcome],
  }
}

export function invalidRoute(reason: string, threshold: number): RouteResult {
  return makeResult('invalid_input', threshold, reason)
}

export function routeExitCode(result: RouteResult): number {
  if (result.outcome === 'invalid_input') return 2
  if (result.outcome === 'stale') return 1
  return 0
}

function clip(value: string): string {
  return value.length > MAX_ECHO_LENGTH ? `${value.slice(0, MAX_ECHO_LENGTH)}…` : value
}

/** JSON-escaped (and length-bounded) echo of an untrusted string. */
function quote(value: string): string {
  return JSON.stringify(clip(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface ParsedRequest {
  readonly candidates: readonly { readonly id: string; readonly path: string; readonly contentHash: string }[]
  readonly options: readonly string[]
}

export function parseRouteRequest(value: unknown): { readonly ok: true; readonly request: ParsedRequest } | { readonly ok: false; readonly reason: string } {
  if (!isRecord(value) || value.schema !== ROUTE_REQUEST_SCHEMA) {
    return { ok: false, reason: `request is not a ${ROUTE_REQUEST_SCHEMA} document; create it with route prepare --json` }
  }
  if (value.noMatch !== NO_MATCH) return { ok: false, reason: `request noMatch must be ${JSON.stringify(NO_MATCH)}` }
  const list = value.candidates
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_CANDIDATES) {
    return { ok: false, reason: `request candidates must list 1 to ${MAX_CANDIDATES} skills` }
  }
  const candidates: { id: string; path: string; contentHash: string }[] = []
  const seen = new Set<string>()
  for (const entry of list as unknown[]) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id === '' || entry.id === NO_MATCH || seen.has(entry.id)
      || typeof entry.path !== 'string' || typeof entry.contentHash !== 'string') {
      return { ok: false, reason: 'request candidates must each have a unique id, a path and a contentHash' }
    }
    seen.add(entry.id)
    candidates.push({ id: entry.id, path: entry.path, contentHash: entry.contentHash })
  }
  return { ok: true, request: { candidates, options: [...seen, NO_MATCH] } }
}

/**
 * Validate a recorded response (`{choice, confidence?, model?}`, untrusted;
 * other keys are ignored) against the request and the skills discovered now.
 */
export function evaluateRoute(requestValue: unknown, responseValue: unknown, threshold: number, skills: readonly RouteSkill[]): RouteResult {
  const parsed = parseRouteRequest(requestValue)
  if (!parsed.ok) return invalidRoute(parsed.reason, threshold)
  const { request } = parsed
  if (!isRecord(responseValue)) return invalidRoute('response must be a JSON object with a "choice"', threshold)
  const model = typeof responseValue.model === 'string' ? clip(responseValue.model) : null
  const choice = responseValue.choice
  if (typeof choice !== 'string') {
    return makeResult('invalid_input', threshold, 'response "choice" must be a string', { model })
  }
  if (!request.options.includes(choice)) {
    return makeResult('invalid_input', threshold, `response choice ${quote(choice)} is not one of the request's options`, { model })
  }
  let confidence: number | null = null
  if (Object.prototype.hasOwnProperty.call(responseValue, 'confidence')) {
    const raw = responseValue.confidence
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 1) {
      return makeResult('invalid_input', threshold, 'response "confidence" must be a number from 0 to 1 when present', { choice, model })
    }
    confidence = raw
  }
  const provenance: Provenance = { choice, confidence, model }
  if (confidence === null) return makeResult('abstain', threshold, 'the response reports no confidence', provenance)
  if (confidence < threshold) {
    return makeResult('abstain', threshold, `confidence ${confidence} is below the threshold ${threshold}`, provenance)
  }
  if (choice === NO_MATCH) {
    return makeResult('no_match', threshold, `the decider chose ${JSON.stringify(NO_MATCH)} at confidence ${confidence}`, provenance)
  }
  const recorded = request.candidates.find(candidate => candidate.id === choice)!
  const current = winners(skills).get(choice)
  const name = quote(choice)
  if (current === undefined) {
    return makeResult('stale', threshold, `${name} is no longer discovered under that name`, provenance)
  }
  if (!isOpenable(current)) {
    return makeResult('stale', threshold, `${name} is no longer openable here (model invocation is disabled)`, provenance)
  }
  if (current.path !== recorded.path) {
    return makeResult('stale', threshold, `${name} now resolves to a different SKILL.md (${JSON.stringify(current.path)})`, provenance)
  }
  if (current.contentHash !== recorded.contentHash) {
    return makeResult('stale', threshold, `${name} SKILL.md content changed since route prepare`, provenance)
  }
  return makeResult('selected', threshold, `confidence ${confidence} meets the threshold ${threshold}`, provenance, {
    name: current.name,
    origin: originLabel(current.origin),
    path: current.path,
  })
}

/** One human-readable line; input-derived strings are JSON-escaped. */
export function formatRouteLine(result: RouteResult): string {
  const head = result.outcome.toUpperCase()
  const detail = result.skill !== null
    ? `${JSON.stringify(result.skill.name)} from ${JSON.stringify(result.skill.origin)} at ${JSON.stringify(result.skill.path)} (${result.reason})`
    : result.reason
  return `${head} ${detail} — ${result.hint}`
}

const DECIMAL = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

export function parseMinConfidence(raw: string | undefined): { readonly ok: true; readonly value: number } | { readonly ok: false; readonly reason: string } {
  if (raw === undefined) return { ok: true, value: DEFAULT_MIN_CONFIDENCE }
  const text = raw.trim()
  const value = DECIMAL.test(text) ? Number(text) : Number.NaN
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    return { ok: false, reason: `--min-confidence must be a number from 0 to 1 (got ${quote(raw)})` }
  }
  return { ok: true, value }
}
