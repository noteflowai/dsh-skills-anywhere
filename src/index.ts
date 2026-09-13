/**
 * dsh-skills-anywhere — a live Agent Skills provider for DeepSeek Harness.
 *
 * Mount it next to `@deepseek-ai/dsh-skill` and the shipped catalog gains the
 * skills of every other coding agent on the machine, the skills inside Claude
 * Code plugin marketplaces, and any git repository listed as a source. Nothing
 * is copied or symlinked: files are read where they live and re-read on load.
 *
 * @module dsh-skills-anywhere
 */

import type { Context } from '@deepseek-ai/cordis'
import { Config, resolveConfig } from './config.ts'
import { SkillsAnywhereProvider } from './provider.ts'
import { installWeb, settingsInForce } from './web.ts'

/** Cordis plugin name; stable across releases. */
export const name = 'skills-anywhere'

/** The skill registry must exist before the provider can register. */
export const inject = ['skills']

export { Config }
export type { Config as ConfigInput, RankConfig, CatalogConfig, ResolvedConfig } from './config.ts'
export { resolveConfig, projectSourcesFile, DEFAULT_RANKS } from './config.ts'
export { AGENTS, agentById, type AgentSpec } from './agents.ts'
export { discover, findProjectRoot } from './discover.ts'
export type { DiscoveredSkill, DiscoveryReport, DroppedSkill, InvalidSkill, RootReport, SkillOrigin, SkillRoot } from './discover.ts'
export { parseSkillMarkdown, normalizeSkillName, isSkillName, splitFrontmatter } from './frontmatter.ts'
export type { ParsedSkill, ParseResult } from './frontmatter.ts'
export {
  resolveSource, syncSource, hasGit, readSourcesFile, writeSourcesFile, readLock, sameRepository,
} from './sources.ts'
export type { SourceSpec, ResolvedSource, SyncResult, SyncStatus, LockEntry, LockFile } from './sources.ts'
export { SkillsAnywhereProvider, applyCatalogBudget, type ProviderLogger, type CatalogState } from './provider.ts'
export { originLabel, originGroup } from './origin.ts'
export type { ReportView, SkillView, SkillState, CatalogSettings } from './web-protocol.ts'
export { SETTINGS_NAMESPACE, REPORT_PATH } from './web-protocol.ts'
export { installWeb, handleReport, settingsEntry, SettingsSchema, type ReportRequest, type RpcResult } from './web.ts'

/**
 * Register the skills-anywhere provider on `ctx.skills`, plus the runtime
 * settings namespace and the web report endpoint when their services exist.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  let provider: SkillsAnywhereProvider | undefined
  const log = {
    info: (message: string) => ctx.logger.info(message),
    warn: (message: string) => ctx.logger.warn(message),
    debug: (message: string) => ctx.logger.debug(message),
  }
  installWeb(ctx, () => provider, resolved, log)
  ctx.skills.registerProvider((control) => {
    provider = new SkillsAnywhereProvider(resolved, log, control)
    // Settings committed before the provider existed (or the composition
    // entry) apply to the very first catalog.
    const settings = settingsInForce(ctx)
    if (settings !== undefined) provider.reconfigure(settings)
    return provider
  })
  ctx.effect(() => () => { void provider?.dispose() }, 'skills-anywhere provider')
  ctx.logger.info(`skills-anywhere: provider "${resolved.providerName}" registered (agents=${resolved.agents}, claudePlugins=${resolved.claudePlugins}, sources=${resolved.sources.length}${resolved.sourcesFiles ? '+files' : ''})`)
}
