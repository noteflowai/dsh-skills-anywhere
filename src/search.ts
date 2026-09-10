/**
 * Keyword search over skill summaries. Shared by the dsh tools and the MCP
 * server, so it imports nothing from dsh.
 *
 * @module
 */

/** The fields search needs; both dsh `SkillSummary` and discovered skills satisfy it. */
export interface SearchableSkill {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly source: string
  readonly provider: string
  readonly invocation: { readonly modelInvocable: boolean }
}

export interface SkillMatch {
  readonly name: string
  readonly description: string
  readonly source: string
  readonly provider: string
  /** Listed in the session catalog for the model. */
  readonly listed: boolean
  readonly score: number
}

/** Split a query into lowercase alphanumeric terms. */
export function queryTerms(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(term => term.length > 1))]
}

/**
 * Rank skills against a keyword query. Name matches weigh most, then
 * description, `whenToUse`, and origin labels. Skills matching no term are
 * dropped; ties break alphabetically.
 */
export function searchSkills(skills: readonly SearchableSkill[], query: string, limit: number): SkillMatch[] {
  const terms = queryTerms(query)
  if (terms.length === 0) return []
  const matches: SkillMatch[] = []
  for (const skill of skills) {
    const nameText = skill.name.toLowerCase()
    const nameWords = nameText.split('-')
    const description = skill.description.toLowerCase()
    const whenToUse = (skill.whenToUse ?? '').toLowerCase()
    const origin = `${skill.source} ${skill.provider}`.toLowerCase()
    let score = 0
    let matched = 0
    for (const term of terms) {
      let termScore = 0
      if (nameText === term) termScore += 60
      else if (nameWords.includes(term)) termScore += 40
      else if (nameText.includes(term)) termScore += 20
      if (description.includes(term)) termScore += 8
      if (whenToUse.includes(term)) termScore += 6
      if (origin.includes(term)) termScore += 2
      if (termScore > 0) matched += 1
      score += termScore
    }
    if (matched === 0) continue
    // Reward covering more of the query over hammering one term.
    score += matched * 30
    matches.push({
      name: skill.name,
      description: skill.description,
      source: skill.source,
      provider: skill.provider,
      listed: skill.invocation.modelInvocable,
      score,
    })
  }
  return matches
    .toSorted((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, limit)
}

