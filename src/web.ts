/**
 * Web integration for the dsh browser UI (host half).
 *
 * Two optional attachments, each alive only while the matching dsh service is:
 *
 * - `ctx.settings` (`@deepseek-ai/dsh-settings`): the catalog budget, pins,
 *   hides and exclusions become the runtime-editable settings namespace
 *   `skills-anywhere`, layered over the composition config. Every committed
 *   change is pushed into the provider, which invalidates the catalog.
 * - `ctx.connection` (`@deepseek-ai/dsh-client-connection`): the exact route
 *   `POST /api/skills-anywhere/report` serves the provider's latest discovery
 *   report to the browser card (`dsh-skills-anywhere/client`). Exact routes are
 *   the connection's public seam for feature packages; the shared `/api`
 *   channel's single RPC interceptor belongs to the Typert gateway.
 *
 * Profiles without these services (headless, sdk) load the provider exactly as
 * before; nothing here is required for the catalog to work.
 *
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import type { ResolvedConfig } from './config.ts'
import type { SkillsAnywhereProvider } from './provider.ts'
import { REPORT_PATH, SETTINGS_NAMESPACE, type CatalogSettings, type ReportView } from './web-protocol.ts'

/** Schema of the `skills-anywhere` settings namespace: the runtime-editable part of the plugin config. */
export const SettingsSchema: Schema<CatalogSettings> = z.object({
  catalog: z.object({
    limit: z.number().min(0).step(1).default(50),
    pin: z.array(z.string()).default([]),
    hide: z.array(z.string()).default([]),
  }).default({ limit: 50, pin: [], hide: [] }),
  excludeSkills: z.array(z.string()).default([]),
}) as unknown as Schema<CatalogSettings>

/** The composition entry for the settings namespace, derived from the resolved plugin config. */
export function settingsEntry(config: ResolvedConfig): CatalogSettings {
  return {
    catalog: { limit: config.catalog.limit, pin: [...config.catalog.pin], hide: [...config.catalog.hide] },
    excludeSkills: [...config.excludeSkills],
  }
}

// Minimal structural views of the two optional dsh services. Declared here so
// the package needs no type-level dependency on their packages; the shapes are
// the documented public surfaces of `ctx.settings` and `ctx.connection`.
interface SettingsLike {
  installSection<T>(owner: Context, ns: string, schema: Schema<T>, entry: T, hooks: {
    setSource(current: () => T): void
    onChange(): void
    validate?: (value: T) => void
  }): void
}
export type RpcResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details: object } }
interface ConnectionLike {
  fetch: {
    /** Register one exact route below `/api`; the carrier applies trust and authentication first. */
    register(route: {
      readonly path: string
      readonly methods: readonly ('GET' | 'HEAD' | 'POST')[]
      readonly requestBody: 'buffered' | 'streaming'
      readonly fetch: (request: Request) => Promise<Response>
    }): () => Promise<void>
  }
}

export interface WebLogger {
  info(message: string): void
  warn(message: string): void
}

/** Wire request of `skills-anywhere/report`. */
export interface ReportRequest {
  /** Project directory whose project-level roots should be included. */
  readonly cwd?: string
}

/** Serve one report request. Exported for tests and custom transports. */
export async function handleReport(provider: SkillsAnywhereProvider | undefined, payload: unknown): Promise<RpcResult<ReportView>> {
  if (provider === undefined) {
    return { ok: false, error: { code: 'skills-anywhere/not-ready', message: 'the skills-anywhere provider is not registered yet', details: {} } }
  }
  const request = (typeof payload === 'object' && payload !== null ? payload : {}) as ReportRequest
  const cwd = typeof request.cwd === 'string' && request.cwd.length > 0 ? request.cwd : undefined
  try {
    return { ok: true, value: await provider.snapshot(cwd) }
  } catch (error) {
    return { ok: false, error: { code: 'skills-anywhere/internal', message: error instanceof Error ? error.message : String(error), details: {} } }
  }
}

/**
 * Attach the settings namespace and the report endpoint to `ctx`. `provider`
 * is a getter because dsh constructs the provider lazily through
 * `ctx.skills.registerProvider`.
 */
export function installWeb(ctx: Context, provider: () => SkillsAnywhereProvider | undefined, config: ResolvedConfig, log: WebLogger): void {
  const entry = settingsEntry(config)
  let current: () => CatalogSettings = () => entry

  ctx.inject(['settings'], (settingsCtx) => {
    const settings = (settingsCtx as unknown as { settings: SettingsLike }).settings
    settings.installSection(ctx, SETTINGS_NAMESPACE, SettingsSchema, entry, {
      setSource: (source) => { current = source },
      onChange: () => {
        const next = current()
        // The provider may not exist yet at attach time; `apply` re-applies
        // the current settings once it is constructed.
        provider()?.reconfigure(next)
      },
    })
    log.info(`skills-anywhere: settings namespace "${SETTINGS_NAMESPACE}" registered`)
  })

  ctx.inject(['connection'], (connectionCtx) => {
    const connection = (connectionCtx as unknown as { connection: ConnectionLike }).connection
    connectionCtx.effect(() => {
      const dispose = connection.fetch.register({
        path: REPORT_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const payload: unknown = await request.json().catch(() => ({}))
          const result = await handleReport(provider(), payload)
          return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } })
        },
      })
      return () => { void dispose() }
    }, 'skills-anywhere: report route')
    log.info(`skills-anywhere: web route "POST ${REPORT_PATH}" registered`)
  })

  // Expose the settings in force for the provider constructed later.
  currentSettings.set(ctx, () => current())
}

const currentSettings = new WeakMap<Context, () => CatalogSettings>()

/** Settings currently in force for `ctx` (composition entry until the settings service attaches). */
export function settingsInForce(ctx: Context): CatalogSettings | undefined {
  return currentSettings.get(ctx)?.()
}
