import { lstat, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { resourceLinks, resourceReport, type ResourceResult } from './resource-links.ts'

/** Inspect metadata inside the explicitly selected skill directory; never open linked content. */
export async function checkResourceFiles(raw: string, skillPath: string) {
  const root = await realpath(dirname(skillPath))
  const references: ResourceResult[] = []
  for (const link of resourceLinks(raw)) {
    if (link.problem) {
      references.push({ ...link, status: link.problem })
      continue
    }
    try {
      let current = root
      let status: ResourceResult['status'] = 'present'
      let kind: ResourceResult['kind'] = 'directory'
      const parts = link.path === '.' ? [] : link.path!.split('/')
      for (let index = 0; index < parts.length; index++) {
        current = join(current, parts[index]!)
        const info = await lstat(current)
        if (info.isSymbolicLink()) { status = 'symlink'; kind = undefined; break }
        if (!info.isFile() && !info.isDirectory()) { status = 'unavailable'; kind = undefined; break }
        if (index < parts.length - 1 && !info.isDirectory()) { status = 'missing'; kind = undefined; break }
        kind = info.isDirectory() ? 'directory' : 'file'
      }
      references.push({ ...link, status, ...(kind ? { kind } : {}) })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      references.push({ ...link, status: code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unavailable' })
    }
  }
  return resourceReport(references, 'filesystem')
}
