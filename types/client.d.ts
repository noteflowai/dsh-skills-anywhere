/**
 * Browser half of dsh-skills-anywhere: the Cordis plugin the dsh web shell
 * loads from `exports["./client"]`. The bundle itself is a lazy-CJS factory
 * for the dsh client module system, not an importable module; this file only
 * describes the plugin face for type-aware hosts and tooling.
 */
import type { Context } from '@deepseek-ai/cordis'

/** Client services the plugin needs before `apply` runs. */
export declare const inject: string[]

/** Register the dictionaries and the Skills Anywhere settings card. */
export declare function apply(ctx: Context): void
