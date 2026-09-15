import { createHash, randomUUID } from 'node:crypto'

/** A delivery record. The caller associates it with its own trace/span IDs. */
export interface LoadReceipt {
  readonly schema: 'skills-anywhere-load-1'
  readonly load_id: string
  readonly loaded_at: string
  readonly provider: 'dsh-skills-anywhere'
  readonly provider_version: string
  readonly name: string
  readonly skill_sha256: string
  readonly content_sha256: string
  readonly bundle_sha256: string | null
  readonly declared_tools: readonly string[] | null
  readonly permissions_enforced: false
}

export function loadReceipt(skill: {
  name: string
  sha256: string
  content: string
  bundle?: { sha256: string }
  declaredTools?: readonly string[]
}, version: string): LoadReceipt {
  return {
    schema: 'skills-anywhere-load-1',
    load_id: randomUUID(),
    loaded_at: new Date().toISOString(),
    provider: 'dsh-skills-anywhere',
    provider_version: version,
    name: skill.name,
    skill_sha256: skill.sha256,
    content_sha256: createHash('sha256').update(skill.content, 'utf8').digest('hex'),
    bundle_sha256: skill.bundle?.sha256 ?? null,
    declared_tools: skill.declaredTools ? [...skill.declaredTools] : null,
    permissions_enforced: false,
  }
}
