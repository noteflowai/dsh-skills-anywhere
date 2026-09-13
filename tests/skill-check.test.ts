import { describe, expect, it } from 'vitest'
import { checkSkill, MAX_SKILL_BYTES } from '../huggingface/skill-check.ts'

describe('local skill check', () => {
  it('shows strict rejection and the provider repairs side by side', () => {
    const result = checkSkill('---\nname: Incident_Summary\n---\n\nDescribe observed facts.', 'incident')
    expect(result.strict).toEqual({ ok: false, reason: 'invalid skill name "Incident_Summary"' })
    expect(result.lenient).toMatchObject({
      ok: true, name: 'incident-summary', description: 'Describe observed facts.',
      warnings: ['name "Incident_Summary" normalised to "incident-summary"', 'description missing; derived from the first paragraph'],
    })
  })

  it('reports author invocation settings without treating them as a catalog budget', () => {
    const result = checkSkill('---\nname: manual\ndescription: A manual action.\ndisable-model-invocation: true\nuser-invocable: false\n---\nSecret body not in report.', 'manual')
    expect(result.strict).toMatchObject({ ok: true, invocation: { modelInvocable: false, userInvocable: false } })
    expect(JSON.stringify(result)).not.toContain('Secret body not in report.')
  })

  it('measures UTF-8 bytes and rejects oversized input before YAML parsing', () => {
    expect(checkSkill('中文', 'example').input.bytes).toBe(6)
    expect(() => checkSkill('中'.repeat(Math.ceil(MAX_SKILL_BYTES / 3)), 'example')).toThrow('128 KiB')
    expect(() => checkSkill('body', 'a'.repeat(129))).toThrow('128 characters')
  })

  it('reports invalid YAML and can serialize preserved cyclic metadata safely', () => {
    const bad = checkSkill('---\nname: [broken\n---\nBody', 'broken')
    expect(bad.strict.ok).toBe(false)
    expect(bad.lenient.ok).toBe(false)
    const cyclic = checkSkill('---\nname: cyclic\ndescription: Test aliases.\nmetadata: &data\n  nested: *data\n---\nBody', 'cyclic')
    expect(cyclic.strict).toMatchObject({ ok: true, metadataKeys: ['nested'] })
    expect(() => JSON.stringify(cyclic)).not.toThrow()
  })
})
