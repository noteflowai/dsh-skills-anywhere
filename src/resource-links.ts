/** CommonMark destinations only: no script execution or inferred prose dependencies. */
import { fromMarkdown } from 'mdast-util-from-markdown'
import type { Root, RootContent, Definition } from 'mdast'
import { MAX_SKILL_BYTES } from './skill-check.ts'

export const MAX_RESOURCE_LINKS = 1000
export const MAX_RESOURCE_FILES = 10000
export type ResourceStatus = 'present' | 'missing' | 'outside' | 'symlink' | 'unavailable' | 'invalid'
export interface ResourceLink {
  readonly url: string
  readonly line: number
  readonly path?: string
  readonly problem?: 'outside' | 'invalid'
}
export interface ResourceResult extends ResourceLink {
  readonly status: ResourceStatus
  readonly kind?: 'file' | 'directory'
}

function visit(node: Root | RootContent, callback: (node: Root | RootContent) => void): void {
  callback(node)
  if ('children' in node) for (const child of node.children) visit(child, callback)
}

/** Resolve relative to SKILL.md, using portable forward-slash paths. */
export function resourceTarget(url: string): Pick<ResourceLink, 'path' | 'problem'> | undefined {
  if (!url || url.startsWith('#') || url.startsWith('//')) return undefined
  if (/^file:/i.test(url) || /^[a-z]:[/\\]/i.test(url)) return { problem: 'outside' }
  if (/^[a-z][a-z\d+.-]*:/i.test(url)) return undefined
  let path: string
  try {
    path = decodeURIComponent(url.split(/[?#]/, 1)[0]!)
  } catch {
    return { problem: 'invalid' }
  }
  if (!path) return undefined
  if (invalidPathCharacters(path)) return { problem: 'invalid' }
  if (path.startsWith('/') || /^[a-z]:/i.test(path)) return { problem: 'outside' }
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '.' || part === '') continue
    if (part === '..') {
      if (parts.length === 0) return { problem: 'outside' }
      parts.pop()
    } else parts.push(part)
  }
  return { path: parts.join('/') || '.' }
}

export function resourceLinks(raw: string): ResourceLink[] {
  if (new TextEncoder().encode(raw).length > MAX_SKILL_BYTES) throw new Error('Choose a SKILL.md of 128 KiB or less.')
  // Preserve line numbers while excluding YAML from the Markdown document.
  const body = raw.replace(/^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, text => text.replace(/[^\r\n]/g, ' '))
  const tree = fromMarkdown(body)
  const definitions = new Map<string, Definition>()
  visit(tree, node => {
    if (node.type === 'definition' && !definitions.has(node.identifier)) definitions.set(node.identifier, node)
  })
  const result: ResourceLink[] = []
  visit(tree, node => {
    let url: string | undefined
    if (node.type === 'link' || node.type === 'image') url = node.url
    else if (node.type === 'linkReference' || node.type === 'imageReference') url = definitions.get(node.identifier)?.url
    if (url === undefined) return
    const target = resourceTarget(url)
    if (!target) return
    result.push({ url, line: node.position?.start.line ?? 1, ...target })
    if (result.length > MAX_RESOURCE_LINKS) throw new Error(`At most ${MAX_RESOURCE_LINKS} local resource links can be checked.`)
  })
  return result
}

export function resourceReport(references: readonly ResourceResult[], method: 'filesystem' | 'selected-files') {
  return {
    schema: 'skills-anywhere-resources-1' as const,
    method,
    references,
    counts: {
      total: references.length,
      present: references.filter(item => item.status === 'present').length,
      issues: references.filter(item => item.status !== 'present').length,
    },
    scope: 'CommonMark links and images relative to the SKILL.md directory; queries and fragments are ignored. No HTML, prose/code dependencies, recursive link checking, remote fetches, content validation or execution. Outside paths are not inspected.',
  }
}

export type ResourceReport = ReturnType<typeof resourceReport>

function invalidPathCharacters(value: string): boolean {
  return [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || character === '\\')
}

/** Check a browser-selected inventory. The caller supplies names relative to SKILL.md. */
export function checkResourceInventory(raw: string, files: readonly string[]): ResourceReport {
  if (files.length > MAX_RESOURCE_FILES) throw new Error(`Choose a folder with at most ${MAX_RESOURCE_FILES} files.`)
  const names = new Set<string>()
  const directories = new Set<string>(['.'])
  for (const file of files) {
    if (!file || /^[a-z]:/i.test(file) || invalidPathCharacters(file)
      || file.split('/').some(part => part === '' || part === '.' || part === '..')) {
      throw new Error('The selected inventory must use normalized paths relative to the skill directory.')
    }
    names.add(file)
    const parts = file.split('/')
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'))
  }
  return resourceReport(resourceLinks(raw).map(link => {
    if (link.problem) return { ...link, status: link.problem }
    if (names.has(link.path!)) return { ...link, status: 'present', kind: 'file' }
    if (directories.has(link.path!)) return { ...link, status: 'present', kind: 'directory' }
    return { ...link, status: 'missing' }
  }), 'selected-files')
}
