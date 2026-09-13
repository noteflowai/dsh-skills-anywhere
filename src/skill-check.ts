import { parseSkillMarkdown, type ParseResult } from './frontmatter.ts'

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
  }
}

export type SkillCheck = ReturnType<typeof checkSkill>
