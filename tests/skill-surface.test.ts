import { expect, it } from 'vitest'
import { readSkillSurface } from '../src/skill-surface.ts'

const commit = 'a'.repeat(40)
const digest = 'b'.repeat(64)

it.each([
  `https://raw.githubusercontent.com/team/repo/${commit}/SKILL.md`,
  `https://github.com/team/repo/blob/${commit}/SKILL.md`,
  `https://huggingface.co/datasets/team/repo/resolve/${commit}/README.md`,
  `https://huggingface.co/team/model/blob/${commit}/README.md`,
])('recognizes the full-commit position in %s without fetching it', url => {
  expect(readSkillSurface(url).externalSources[0]?.pinned).toBe(true)
})

it.each([
  `https://example.com/${commit}/latest.md`,
  `https://example.com/instructions#sha256:${digest}`,
  `https://github.com/${commit}/repo/blob/main/SKILL.md`,
  `https://github.com/team/repo/blob/main/${commit}`,
  `https://github.com.evil.example/team/repo/blob/${commit}/SKILL.md`,
  `https://raw.githubusercontent.com/team/repo/${commit}/SKILL.md?revision=main`,
  `http://raw.githubusercontent.com/team/repo/${commit}/SKILL.md`,
  `https://user:pass@raw.githubusercontent.com/team/repo/${commit}/SKILL.md`,
  `https://huggingface.co/datasets/team/repo/resolve/main/${commit}`,
])('does not mistake a token or arbitrary hash for verified pinning: %s', url => {
  expect(readSkillSurface(url).externalSources[0]?.pinned).toBe(false)
})

it('keeps a mixed host unverified and preserves all unique references', () => {
  const pinned = `https://raw.githubusercontent.com/team/repo/${commit}/SKILL.md`
  const floating = 'https://raw.githubusercontent.com/team/repo/main/SKILL.md'
  const [source] = readSkillSurface(`${pinned}\n${floating}\n${pinned}`).externalSources
  expect(source?.pinned).toBe(false)
  expect(source?.urls).toHaveLength(2)
})
