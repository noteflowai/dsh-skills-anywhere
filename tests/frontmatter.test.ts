import { describe, expect, it } from 'vitest'
import { firstParagraph, isSkillName, normalizeSkillName, parseSkillMarkdown, splitFrontmatter } from '../src/frontmatter.ts'

describe('normalizeSkillName', () => {
  it('keeps valid names', () => {
    expect(normalizeSkillName('pdf-processing')).toBe('pdf-processing')
  })
  it('lowercases and replaces punctuation, spaces, and consecutive hyphens', () => {
    expect(normalizeSkillName('PDF Processing')).toBe('pdf-processing')
    expect(normalizeSkillName('my__skill--v2')).toBe('my-skill-v2')
    expect(normalizeSkillName('-leading-and-trailing-')).toBe('leading-and-trailing')
    expect(normalizeSkillName('Café Résumé')).toBe('cafe-resume')
  })
  it('truncates to 64 characters without a trailing hyphen', () => {
    const long = `${'a'.repeat(63)}-bcd`
    const name = normalizeSkillName(long)
    expect(name).toBeDefined()
    expect(name!.length).toBeLessThanOrEqual(64)
    expect(name!.endsWith('-')).toBe(false)
  })
  it('returns undefined when nothing usable remains', () => {
    expect(normalizeSkillName('---')).toBeUndefined()
    expect(normalizeSkillName('')).toBeUndefined()
    expect(normalizeSkillName('日本語')).toBeUndefined()
  })
  it('isSkillName enforces the spec grammar', () => {
    expect(isSkillName('ok-name')).toBe(true)
    expect(isSkillName('Bad')).toBe(false)
    expect(isSkillName('a--b')).toBe(false)
    expect(isSkillName('a'.repeat(65))).toBe(false)
  })
})

describe('splitFrontmatter', () => {
  it('splits on the closing delimiter and handles CRLF and BOM', () => {
    const split = splitFrontmatter('﻿---\r\nname: x\r\n---\r\nbody\r\n')
    expect(split?.frontmatter).toBe('name: x')
    expect(split?.body.trim()).toBe('body')
  })
  it('accepts the YAML document-end marker', () => {
    expect(splitFrontmatter('---\nname: x\n...\nbody')).toEqual({ frontmatter: 'name: x', body: 'body' })
  })
  it('returns undefined without an opening or closing delimiter', () => {
    expect(splitFrontmatter('# just markdown')).toBeUndefined()
    expect(splitFrontmatter('---\nname: x\nnever closed')).toBeUndefined()
  })
})

describe('parseSkillMarkdown', () => {
  it('parses a spec-clean skill with every optional field', () => {
    const result = parseSkillMarkdown([
      '---',
      'name: pdf-processing',
      'description: Extract PDF text. Use when handling PDFs.',
      'license: Apache-2.0',
      'compatibility: Requires python3',
      'allowed-tools: Bash(git:*) Read',
      'metadata:',
      '  author: example-org',
      '  version: "1.0"',
      'argument-hint: "[file]"',
      '---',
      '',
      '# PDF',
      '',
      'Do the thing.',
    ].join('\n'), { fallbackName: 'pdf-processing' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.skill.name).toBe('pdf-processing')
    expect(result.skill.description).toBe('Extract PDF text. Use when handling PDFs.')
    expect(result.skill.invocation).toEqual({ modelInvocable: true, userInvocable: true })
    expect(result.skill.metadata).toEqual({
      author: 'example-org',
      version: '1.0',
      license: 'Apache-2.0',
      compatibility: 'Requires python3',
      allowedTools: ['Bash(git:*)', 'Read'],
      frontmatter: { 'argument-hint': '[file]' },
    })
    expect(result.skill.content).toBe('# PDF\n\nDo the thing.')
    expect(result.skill.warnings).toEqual([])
  })

  it('honours invocation policy keys in every boolean spelling', () => {
    for (const [value, expected] of [['true', false], ['yes', false], ['on', false], ['1', false], ['false', true], ['off', true]] as const) {
      const result = parseSkillMarkdown(`---\nname: a\ndescription: b\ndisable-model-invocation: ${value}\n---\nbody`, { fallbackName: 'a' })
      expect(result.ok && result.skill.invocation.modelInvocable).toBe(expected)
    }
    const user = parseSkillMarkdown('---\nname: a\ndescription: b\nuser-invocable: false\n---\nbody', { fallbackName: 'a' })
    expect(user.ok && user.skill.invocation.userInvocable).toBe(false)
  })

  it('rejects a non-boolean invocation value', () => {
    const result = parseSkillMarkdown('---\nname: a\ndescription: b\nuser-invocable: maybe\n---\nbody', { fallbackName: 'a' })
    expect(result).toEqual({ ok: false, reason: 'frontmatter field "user-invocable" must be a boolean' })
  })

  it('repairs a missing name from the directory in lenient mode and records it', () => {
    const result = parseSkillMarkdown('---\ndescription: b\n---\nbody', { fallbackName: 'My Dir' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.skill.name).toBe('my-dir')
    expect(result.skill.warnings[0]).toMatch(/using "my-dir" from the directory/)
  })

  it('normalises an invalid name in lenient mode', () => {
    const result = parseSkillMarkdown('---\nname: Code_Review\ndescription: b\n---\nbody', { fallbackName: 'x' })
    expect(result.ok && result.skill.name).toBe('code-review')
    expect(result.ok && result.skill.warnings[0]).toMatch(/normalised to "code-review"/)
  })

  it('derives a description from the first paragraph when absent', () => {
    const result = parseSkillMarkdown('---\nname: a\n---\n# Title\n\nUse **this** when things happen.\nSecond line.\n\nMore.', { fallbackName: 'a' })
    expect(result.ok && result.skill.description).toBe('Use this when things happen. Second line.')
  })

  it('accepts a file with no frontmatter at all in lenient mode', () => {
    const result = parseSkillMarkdown('# Heading\n\nFirst paragraph here.', { fallbackName: 'flat-file' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.skill.name).toBe('flat-file')
    expect(result.skill.description).toBe('First paragraph here.')
    expect(result.skill.warnings[0]).toMatch(/missing YAML frontmatter/)
  })

  it('accepts legacy camelCase invocation keys in lenient mode only', () => {
    const lenient = parseSkillMarkdown('---\nname: a\ndescription: b\ndisableModelInvocation: true\n---\nbody', { fallbackName: 'a' })
    expect(lenient.ok && lenient.skill.invocation.modelInvocable).toBe(false)
    const strict = parseSkillMarkdown('---\nname: a\ndescription: b\ndisableModelInvocation: true\n---\nbody', { fallbackName: 'a', lenient: false })
    expect(strict.ok).toBe(false)
  })

  it('is strict when asked', () => {
    expect(parseSkillMarkdown('---\ndescription: b\n---\nbody', { fallbackName: 'a', lenient: false })).toEqual({ ok: false, reason: 'frontmatter requires name' })
    expect(parseSkillMarkdown('---\nname: Bad\ndescription: b\n---\nbody', { fallbackName: 'a', lenient: false })).toEqual({ ok: false, reason: 'invalid skill name "Bad"' })
    expect(parseSkillMarkdown('---\nname: a\n---\nbody', { fallbackName: 'a', lenient: false })).toEqual({ ok: false, reason: 'frontmatter requires description' })
    expect(parseSkillMarkdown('no frontmatter', { fallbackName: 'a', lenient: false })).toEqual({ ok: false, reason: 'missing YAML frontmatter' })
  })

  it('rejects broken YAML and non-mapping frontmatter', () => {
    expect(parseSkillMarkdown('---\nname: [\n---\nbody', { fallbackName: 'a' }).ok).toBe(false)
    expect(parseSkillMarkdown('---\n- a\n- b\n---\nbody', { fallbackName: 'a' })).toEqual({ ok: false, reason: 'frontmatter must be a YAML mapping' })
  })

  it('truncates over-long descriptions and reports it', () => {
    const result = parseSkillMarkdown(`---\nname: a\ndescription: ${'x'.repeat(1100)}\n---\nbody`, { fallbackName: 'a' })
    expect(result.ok && result.skill.description.length).toBe(1024)
    expect(result.ok && result.skill.warnings[0]).toMatch(/truncated/)
  })

  it('fails when neither a name nor a directory yields anything usable', () => {
    const result = parseSkillMarkdown('---\ndescription: b\n---\nbody', { fallbackName: '###' })
    expect(result.ok).toBe(false)
  })

  it('fails when no description can be derived', () => {
    const result = parseSkillMarkdown('---\nname: a\n---\n# Only a heading\n', { fallbackName: 'a' })
    expect(result.ok).toBe(false)
  })
})

describe('firstParagraph', () => {
  it('skips headings, rules, fences and comments', () => {
    expect(firstParagraph('# H\n\n---\n\n```\ncode\n```\n\n<!-- c -->\n\nReal text.')).toBe('Real text.')
  })
  it('returns undefined for an empty body', () => {
    expect(firstParagraph('\n\n# Only heading\n')).toBeUndefined()
  })

  it('drops an unterminated HTML comment instead of leaking it into the description', () => {
    const parsed = parseSkillMarkdown('---\nname: x\n---\n\nReal paragraph.\n\n<!-- draft notes\nstill inside the comment', { fallbackName: 'x', lenient: true })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.skill.description).toBe('Real paragraph.')
      expect(parsed.skill.description).not.toContain('draft notes')
    }
  })

})
