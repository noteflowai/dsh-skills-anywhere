import { parseSkillMarkdown, type ParseResult } from './frontmatter.ts'
import { readSkillSurface } from './skill-surface.ts'

export const MAX_SKILL_BYTES = 128 * 1024
const encoder = new TextEncoder()

function summarize(result: ParseResult) {
  if (!result.ok) return result
  const { name, description, invocation, warnings, metadata, content } = result.skill
  return {
    ok: true as const, name, description, invocation, warnings,
    metadataKeys: Object.keys(metadata).toSorted(),
    bodyBytes: encoder.encode(content).length,
  }
}

/** Read the reachable surface from whichever parse succeeded, if either did. */
function surfaceOf(result: ParseResult) {
  if (!result.ok) return readSkillSurface('', [])
  const declared = result.skill.metadata.allowedTools
  return readSkillSurface(result.skill.content, Array.isArray(declared) ? declared as string[] : [])
}

/** A bounded, local comparison of the provider's two parsing modes. */
export function checkSkill(raw: string, fallbackName: string) {
  const bytes = encoder.encode(raw).length
  if (bytes > MAX_SKILL_BYTES) throw new Error('Choose a SKILL.md of 128 KiB or less.')
  if (fallbackName.length > 128) throw new Error('Use a directory name of 128 characters or less.')
  return {
    schema: 'skills-anywhere-local-check-1' as const,
    input: { bytes, fallbackName },
    strict: summarize(parseSkillMarkdown(raw, { fallbackName, lenient: false })),
    lenient: summarize(parseSkillMarkdown(raw, { fallbackName, lenient: true })),
    // Independent of the parsing gate: a skill that passes strict parsing can
    // still take its instructions from somewhere a reviewer never looked.
    surface: surfaceOf(parseSkillMarkdown(raw, { fallbackName, lenient: true })),
  }
}

export type SkillCheck = ReturnType<typeof checkSkill>
