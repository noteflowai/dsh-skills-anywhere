/**
 * Wire shapes shared by the host remote (`skills-anywhere/report`) and the
 * browser card. Plain JSON, no dsh imports, so the client bundle can import
 * the types without pulling in Node code.
 *
 * @module
 */

/** Why a skill is or is not in the model catalog. */
export type SkillState = 'visible' | 'hidden' | 'disabled'

export interface SkillView {
  readonly name: string
  readonly description: string
  /** `originLabel()` of the skill's origin. */
  readonly origin: string
  /** `originGroup()` of the skill's origin. */
  readonly group: string
  readonly path: string
  readonly state: SkillState
  /** The skill's own frontmatter disables model invocation. */
  readonly authorDisabled: boolean
  /** Present when a name collision renamed the skill. */
  readonly renamedFrom?: string
  readonly pinned: boolean
  readonly hidden: boolean
  /** Frontmatter repairs and other warnings recorded at discovery. */
  readonly warnings: readonly string[]
}

export interface DroppedView {
  readonly name: string
  readonly path: string
  readonly reason: 'same-file' | 'same-content' | 'excluded'
  readonly winner: string
}

export interface RootView {
  readonly label: string
  readonly path: string
  readonly exists: boolean
  readonly count: number
}

export interface ReportView {
  readonly skills: readonly SkillView[]
  readonly dropped: readonly DroppedView[]
  readonly invalid: readonly { readonly path: string; readonly reason: string }[]
  readonly roots: readonly RootView[]
  readonly complete: boolean
  /** Current runtime catalog settings, as the host resolved them. */
  readonly catalog: { readonly limit: number; readonly pin: readonly string[]; readonly hide: readonly string[] }
  readonly excludeSkills: readonly string[]
  /** Number of skills the model catalog lists right now. */
  readonly listed: number
}

/** Settings namespace the host registers and the card edits. */
export const SETTINGS_NAMESPACE = 'skills-anywhere'
/**
 * Exact Fetch route the host registers on the dsh connection's shared `/api`
 * channel (the public seam for feature packages; it inherits the browser-trust
 * fence and authentication) and the card POSTs to. Body: `ReportRequest` JSON;
 * response: `RpcResult<ReportView>` JSON.
 */
export const REPORT_PATH = '/api/skills-anywhere/report'

/** The runtime-editable part of the plugin config. */
export interface CatalogSettings {
  readonly catalog: { readonly limit: number; readonly pin: readonly string[]; readonly hide: readonly string[] }
  readonly excludeSkills: readonly string[]
}
