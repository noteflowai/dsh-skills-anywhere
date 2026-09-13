/**
 * SKILL.md parsing that follows the Agent Skills specification
 * (https://agentskills.io/specification) while tolerating the real-world
 * variations found across agent ecosystems.
 *
 * Strict mode mirrors the shipped dsh provider: `name` and `description` are
 * required and the name must already be valid. Lenient mode (the default)
 * repairs what it safely can — a missing name falls back to the directory,
 * an invalid name is normalised to kebab-case, a missing description is taken
 * from the first paragraph — and records every repair as a warning so the CLI
 * `doctor` command can surface it.
 *
 * @module
 */

import { parse as parseYaml } from 'yaml'

/** Agent Skills spec limits. */
export const MAX_NAME_LENGTH = 64
export const MAX_DESCRIPTION_LENGTH = 1024

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const FRONTMATTER_OPEN = /^﻿?---[ \t]*\r?\n/
const FRONTMATTER_CLOSE = /^(?:---|\.\.\.)[ \t]*$/

export interface SkillInvocation {
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
}

export interface ParsedSkill {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly invocation: SkillInvocation
  /** Spec fields and pass-through extras, ready for `SkillCandidate.metadata`. */
  readonly metadata: Record<string, unknown>
  /** Markdown body with the frontmatter removed and surrounding whitespace trimmed. */
  readonly content: string
  /** Repairs applied in lenient mode; empty when the file was spec-clean. */
  readonly warnings: readonly string[]
}

export type ParseResult =
  | { readonly ok: true; readonly skill: ParsedSkill }
  | { readonly ok: false; readonly reason: string }

export interface ParseOptions {
  /** Name used when the frontmatter has none (usually the directory name). */
  readonly fallbackName: string
  /** Repair recoverable problems instead of rejecting the file. Default `true`. */
  readonly lenient?: boolean
}

/** Whether a string is a valid Agent Skills / dsh skill name. */
export function isSkillName(name: string): boolean {
  return name.length > 0 && name.length <= MAX_NAME_LENGTH && SKILL_NAME.test(name)
}

/**
 * Normalise an arbitrary string into a valid skill name, or `undefined` when
 * nothing usable remains (for example an empty or all-punctuation string).
 */
export function normalizeSkillName(input: string): string | undefined {
  let name = input
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (name.length > MAX_NAME_LENGTH) {
    name = name.slice(0, MAX_NAME_LENGTH).replace(/-+$/g, '')
  }
  return isSkillName(name) ? name : undefined
}

/** Split a Markdown document into YAML frontmatter text and body. */
export function splitFrontmatter(raw: string): { frontmatter: string; body: string } | undefined {
  const open = FRONTMATTER_OPEN.exec(raw)
  if (open === null) return undefined
  const rest = raw.slice(open[0].length)
  const lines = rest.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    if (FRONTMATTER_CLOSE.test(lines[index] ?? '')) {
      return {
        frontmatter: lines.slice(0, index).join('\n'),
        body: lines.slice(index + 1).join('\n'),
      }
    }
  }
  return undefined
}

/** Parse one SKILL.md (or flat `<name>.md`) document. */
export function parseSkillMarkdown(raw: string, options: ParseOptions): ParseResult {
  const lenient = options.lenient ?? true
  const warnings: string[] = []

  const split = splitFrontmatter(raw)
  if (split === undefined) {
    if (!lenient) return { ok: false, reason: 'missing YAML frontmatter' }
    // No frontmatter at all: treat the whole file as the body and derive everything.
    return finish({}, raw, options, warnings, 'missing YAML frontmatter; derived name and description')
  }

  let data: unknown
  try {
    data = split.frontmatter.trim().length === 0 ? {} : parseYaml(split.frontmatter)
  } catch (error) {
    return { ok: false, reason: `invalid YAML frontmatter: ${String(error)}` }
  }
  if (data === null || data === undefined) data = {}
  if (typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, reason: 'frontmatter must be a YAML mapping' }
  }
  return finish(data as Record<string, unknown>, split.body, options, warnings)
}

function finish(
  data: Record<string, unknown>,
  body: string,
  options: ParseOptions,
  warnings: string[],
  initialWarning?: string,
): ParseResult {
  const lenient = options.lenient ?? true
  if (initialWarning !== undefined) warnings.push(initialWarning)

  // --- name -----------------------------------------------------------------
  const rawName = stringField(data, 'name')
  let name: string | undefined
  if (rawName !== undefined && isSkillName(rawName)) {
    name = rawName
  } else if (!lenient) {
    return { ok: false, reason: rawName === undefined ? 'frontmatter requires name' : `invalid skill name "${rawName}"` }
  } else if (rawName !== undefined) {
    name = normalizeSkillName(rawName)
    if (name !== undefined) warnings.push(`name "${rawName}" normalised to "${name}"`)
  }
  if (name === undefined) {
    name = normalizeSkillName(options.fallbackName)
    if (name === undefined) return { ok: false, reason: `no usable skill name (frontmatter: ${JSON.stringify(rawName)}, directory: ${JSON.stringify(options.fallbackName)})` }
    warnings.push(`name missing or invalid; using "${name}" from the directory`)
  }

  // --- description ----------------------------------------------------------
  let description = stringField(data, 'description')
  if (description === undefined) {
    if (!lenient) return { ok: false, reason: 'frontmatter requires description' }
    description = firstParagraph(body)
    if (description === undefined) return { ok: false, reason: 'no description in frontmatter and no body text to derive one from' }
    warnings.push('description missing; derived from the first paragraph')
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    description = description.slice(0, MAX_DESCRIPTION_LENGTH)
    warnings.push(`description longer than ${MAX_DESCRIPTION_LENGTH} characters; truncated`)
  }

  // --- invocation policy ----------------------------------------------------
  let invocation: SkillInvocation
  try {
    invocation = parseInvocation(data, lenient, warnings)
  } catch (error) {
    return { ok: false, reason: String(error instanceof Error ? error.message : error) }
  }

  // --- metadata -------------------------------------------------------------
  const metadata = collectMetadata(data)

  const whenToUse = stringField(data, 'whenToUse') ?? stringField(data, 'when-to-use')
  return {
    ok: true,
    skill: {
      name,
      description,
      ...(whenToUse !== undefined ? { whenToUse } : {}),
      invocation,
      metadata,
      content: body.trim(),
      warnings,
    },
  }
}

const KNOWN_KEYS = new Set([
  'name', 'description', 'whenToUse', 'when-to-use', 'metadata',
  'license', 'compatibility', 'allowed-tools',
  'disable-model-invocation', 'user-invocable', 'disableModelInvocation', 'modelInvocable', 'userInvocable',
])

function collectMetadata(data: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {}
  const declared = data.metadata
  if (typeof declared === 'object' && declared !== null && !Array.isArray(declared)) {
    Object.assign(metadata, declared as Record<string, unknown>)
  }
  for (const key of ['license', 'compatibility'] as const) {
    const value = stringField(data, key)
    if (value !== undefined) metadata[key] = value
  }
  const allowedTools = data['allowed-tools']
  if (typeof allowedTools === 'string' && allowedTools.trim().length > 0) {
    metadata.allowedTools = allowedTools.trim().split(/\s+/)
  } else if (Array.isArray(allowedTools)) {
    metadata.allowedTools = allowedTools.filter((tool): tool is string => typeof tool === 'string')
  }
  // Anything else (Claude Code's `argument-hint`, `context`, `model`, ...) is
  // preserved verbatim so consumers can still see it.
  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (KNOWN_KEYS.has(key)) continue
    if (value === null || value === undefined) continue
    if (typeof value === 'object' && !Array.isArray(value)) continue
    extra[key] = value
  }
  if (Object.keys(extra).length > 0) metadata.frontmatter = extra
  return metadata
}

function parseInvocation(data: Record<string, unknown>, lenient: boolean, warnings: string[]): SkillInvocation {
  let disableModel = readBoolean(data, 'disable-model-invocation')
  let userInvocable = readBoolean(data, 'user-invocable')
  // Legacy camelCase spellings are rejected by dsh; we accept them in lenient mode.
  for (const [legacy, apply] of [
    ['disableModelInvocation', (value: boolean) => { disableModel ??= value }],
    ['modelInvocable', (value: boolean) => { disableModel ??= !value }],
    ['userInvocable', (value: boolean) => { userInvocable ??= value }],
  ] as const) {
    if (!Object.hasOwn(data, legacy)) continue
    if (!lenient) throw new Error(`frontmatter field "${legacy}" is unsupported`)
    const value = readBoolean(data, legacy)
    if (value !== undefined) {
      apply(value)
      warnings.push(`legacy frontmatter field "${legacy}" accepted`)
    }
  }
  return { modelInvocable: disableModel !== true, userInvocable: userInvocable !== false }
}

function readBoolean(data: Record<string, unknown>, key: string): boolean | undefined {
  if (!Object.hasOwn(data, key)) return undefined
  const value = data[key]
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  if (typeof value === 'string') {
    switch (value.trim().toLowerCase()) {
      case 'true': case 'yes': case 'on': return true
      case 'false': case 'no': case 'off': return false
    }
  }
  throw new TypeError(`frontmatter field "${key}" must be a boolean`)
}

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  if (typeof value === 'number') return String(value)
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** First non-heading, non-empty paragraph of a Markdown body, flattened to one line. */
export function firstParagraph(body: string): string | undefined {
  const stripped = body
    .replace(/```[\s\S]*?(?:```|$)/g, '')
    .replace(/~~~[\s\S]*?(?:~~~|$)/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // An unterminated comment runs to the end of the document; never let it
    // leak into a description.
    .replace(/<!--[\s\S]*$/, '')
  const blocks = stripped.split(/\r?\n\s*\r?\n/)
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0)
    if (lines.length === 0) continue
    if (lines.every(line => /^(#{1,6}\s|[-*_]{3,}$|```|<!--)/.test(line))) continue
    const text = lines
      .filter(line => !/^#{1,6}\s/.test(line))
      .join(' ')
      .replace(/[*_`>]+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (text.length > 0) return text.slice(0, MAX_DESCRIPTION_LENGTH)
  }
  return undefined
}
