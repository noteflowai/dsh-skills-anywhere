/**
 * Human-readable origin labels. Shared by the CLI, the MCP server, the dsh
 * tools and the web card, so it imports nothing from dsh.
 *
 * @module
 */

import type { SkillOrigin } from './discover.ts'

/** One-line label such as `claude-code (user)`, `claude plugin discord @ official` or `git anthropics/skills`. */
export function originLabel(origin: SkillOrigin): string {
  switch (origin.kind) {
    case 'agent': return `${origin.agent ?? 'agent'} (${origin.scope ?? '?'})`
    case 'claude-plugins': return `claude plugin ${origin.plugin ?? '?'}${origin.marketplace !== undefined ? ` @ ${origin.marketplace}` : ''}`
    case 'source': return `git ${origin.repo ?? '?'}`
    default: return `custom (${origin.scope ?? '?'})`
  }
}

/** Group heading for the web card: where a skill physically lives. */
export function originGroup(origin: SkillOrigin): string {
  switch (origin.kind) {
    case 'agent': return origin.scope === 'project' ? 'Project skill directories' : 'User skill directories'
    case 'claude-plugins': return 'Claude Code plugins'
    case 'source': return 'Git sources'
    default: return origin.scope === 'project' ? 'Project skill directories' : 'User skill directories'
  }
}
