export interface DemoSkill {
  name: string
  description: string
  source: string
  provider: string
  origin: string
  path: string
  content: string
  invocation: { modelInvocable: boolean; userInvocable: boolean }
  renamedFrom?: string
  warnings: readonly string[]
}

export interface DemoData {
  schema: 'skills-anywhere-playground-1'
  version: string
  agentCount: number
  skills: DemoSkill[]
  inputs: { path: string; markdown: string }[]
  dropped: { name: string; path: string; winner: string; reason: string }[]
  invalid: { path: string; reason: string }[]
  bundles: { reviewed: BundleManifest; changed: BundleManifest }
}
import type { BundleManifest } from '../src/bundle-manifest.ts'
