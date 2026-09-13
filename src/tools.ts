/**
 * Model-facing tools that make the catalog budget safe: `find_skills` searches
 * every skill by keyword (including the ones the budget keeps out of the
 * session catalog) and `open_skill` loads any of them. Skills whose own
 * frontmatter disables model invocation stay off limits.
 *
 * This is a separate Cordis plugin so the provider still works in a profile
 * that has no tool runtime.
 *
 * @module dsh-skills-anywhere/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { isSkillName, renderSkillContent, type SkillDefinition } from '@deepseek-ai/dsh-skill'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { searchSkills } from './search.ts'

export { searchSkills, queryTerms, type SkillMatch, type SearchableSkill } from './search.ts'

export const name = 'skills-anywhere-tools'
export const inject = ['skills', 'tools']

export interface Config {
  /** Default number of matches `find_skills` returns. */
  readonly findLimit?: number
  /** Maximum matches a single `find_skills` call may request. */
  readonly findMaxLimit?: number
  /** Register `find_skills`. */
  readonly find?: boolean
  /** Register `open_skill`. */
  readonly open?: boolean
}

export const Config: Schema<Config> = z.object({
  findLimit: z.number().default(10),
  findMaxLimit: z.number().default(50),
  find: z.boolean().default(true),
  open: z.boolean().default(true),
}) as unknown as Schema<Config>

/** Whether a loaded definition may be handed to the model. */
export function isOpenable(skill: Pick<SkillDefinition, 'invocation' | 'metadata'>): boolean {
  if (skill.invocation.modelInvocable) return true
  const extra = skill.metadata?.skillsAnywhere as { catalog?: string; authorInvocation?: { modelInvocable?: boolean } } | undefined
  // Hidden by the budget, not by the author.
  return extra?.catalog === 'hidden' && extra.authorInvocation?.modelInvocable !== false
}

export function apply(ctx: Context, config: Config = {}): void {
  const findLimit = Math.max(1, Math.floor(config.findLimit ?? 10))
  const findMaxLimit = Math.max(findLimit, Math.floor(config.findMaxLimit ?? 50))

  if (config.find ?? true) {
    ctx.tools.register(defineTool({
      name: 'find_skills',
      description: 'Search every installed skill by keyword, including skills that are not listed in the session skill catalog. The catalog shows only a budgeted subset; when a task might match a skill you do not see listed, search here first, then load the match with open_skill (or with skill if it is listed).',
      parameters: {
        query: { type: 'string', required: true, description: 'Keywords describing the task or skill, e.g. "pdf forms", "react testing", "docx".' },
        limit: { type: 'number', description: `Maximum matches to return (default ${findLimit}, max ${findMaxLimit}).` },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            total: { type: 'number', required: true, description: 'Skills searched.' },
            unlisted: { type: 'number', required: true, description: 'Skills searched that are not in the session catalog.' },
            matches: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  name: { type: 'string', required: true },
                  description: { type: 'string', required: true },
                  listed: { type: 'boolean', required: true, description: 'True when the skill is in the session catalog and loadable with the skill tool.' },
                  source: { type: 'string', required: true },
                },
              },
            },
          },
        },
        render: (_args, value) => {
          if (value.matches.length === 0) {
            return [{ type: 'text', text: `No skills matched. ${value.total} skills searched (${value.unlisted} not in the catalog). Try different keywords.` }]
          }
          const lines = value.matches.map(match =>
            `- ${match.name}${match.listed ? '' : ' (not in catalog: load with open_skill)'} — ${match.description}`)
          return [{ type: 'text', text: [`${value.matches.length} of ${value.total} skills matched (${value.unlisted} searched skills are not in the catalog):`, ...lines].join('\n') }]
        },
      },
      async execute(args, exec) {
        const query = args.query.trim()
        if (query.length === 0) throw new Error('query must not be empty')
        const limit = Math.min(findMaxLimit, Math.max(1, Math.floor(args.limit ?? findLimit)))
        const lookup = { cwd: exec.agent?.session.header.cwd, signal: exec.signal, scope: exec.agent }
        const skills = await ctx.skills.list(lookup)
        // Summaries do not say *why* a skill is outside the catalog, so load the
        // definition of unlisted matches and drop the ones whose author opted out
        // of model invocation: find_skills must never point at a skill that
        // open_skill will refuse.
        const matches: ReturnType<typeof searchSkills> = []
        for (const match of searchSkills(skills, query, skills.length)) {
          if (matches.length >= limit) break
          if (!match.listed) {
            const definition = await ctx.skills.get(match.name, lookup)
            if (definition === undefined || !isOpenable(definition)) continue
          }
          matches.push(match)
        }
        return {
          total: skills.length,
          unlisted: skills.filter(skill => !skill.invocation.modelInvocable).length,
          matches: matches.map(match => ({
            name: match.name,
            description: match.description,
            listed: match.listed,
            source: match.source,
          })),
        }
      },
      presentCall(args) {
        return { card: 'generic', title: `Find skills: ${args.query}`, kind: 'search', rawInput: args.query }
      },
    }))
  }

  if (config.open ?? true) {
    ctx.tools.register(defineTool({
      name: 'open_skill',
      description: 'Load the full instructions of a skill by exact name, including skills that find_skills reported as not listed in the session catalog. Use skill for catalog skills; use this for the rest.',
      parameters: {
        name: { type: 'string', required: true, description: 'Exact skill name as returned by find_skills.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true },
            provider: { type: 'string', required: true },
            resourceBase: {
              oneOf: [
                { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', required: true, const: 'directory' }, path: { type: 'string', required: true } } },
                { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', required: true, const: 'url' }, url: { type: 'string', required: true } } },
                { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', required: true, const: 'opaque' }, description: { type: 'string', required: true } } },
              ],
            },
            content: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: renderSkillContent(value) }],
      },
      async execute(args, exec) {
        if (!isSkillName(args.name)) throw new Error(`invalid skill name "${args.name}"`)
        const lookup = { cwd: exec.agent?.session.header.cwd, signal: exec.signal, scope: exec.agent }
        const skill = await ctx.skills.get(args.name, lookup)
        if (skill === undefined) throw new Error(`skill "${args.name}" is unknown or no longer available; search with find_skills`)
        if (!isOpenable(skill)) throw new Error(`skill "${args.name}" is not available for model invocation`)
        return {
          name: skill.name,
          provider: skill.provider,
          ...(skill.resourceBase !== undefined ? { resourceBase: { ...skill.resourceBase } } : {}),
          content: skill.content,
        }
      },
      presentCall(args) {
        return { card: 'generic', title: `Open skill ${args.name}`, kind: 'read', rawInput: args.name }
      },
    }))
  }
}
