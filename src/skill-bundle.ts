/** Read a bounded skill directory without executing code or resolving references. */
import { createHash } from 'node:crypto'
import { constants, type BigIntStats } from 'node:fs'
import { lstat, open, opendir, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  makeManifest, MAX_BUNDLE_BYTES, MAX_BUNDLE_FILES, MAX_BUNDLE_FILE_BYTES,
  validBundlePath, type BundleFile,
} from './bundle-manifest.ts'
import { MAX_SKILL_BYTES } from './skill-check.ts'

function identity(stat: BigIntStats): string {
  return [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].join(':')
}

export async function readBundle(directory: string) {
  // A symlinked installation root is supported. Links inside it are rejected.
  const root = await realpath(resolve(directory))
  const observed = new Map<string, string>()
  const files: BundleFile[] = []
  let count = 0
  let total = 0
  let skillBytes: Buffer | undefined

  async function visit(path: string, name: string, depth: number): Promise<void> {
    if (++count > 1024 || depth > 12) throw new Error('Bundle exceeds 1024 entries or 12 path levels.')
    if (name && !validBundlePath(name)) throw new Error('Bundle contains an unsupported relative path.')
    const stat = await lstat(path, { bigint: true })
    if (stat.isSymbolicLink()) throw new Error(`Bundle links are not supported: ${JSON.stringify(name)}`)
    observed.set(path, identity(stat))
    if (stat.isDirectory()) {
      // Paths containing decoder replacement characters are rejected rather
      // than allowing an invalid filename to alias a different UTF-8 name.
      const directoryHandle = await opendir(path)
      for await (const entry of directoryHandle) {
        const child = entry.name
        await visit(join(path, child), name ? `${name}/${child}` : child, depth + 1)
      }
      return
    }
    if (!stat.isFile()) throw new Error(`Bundle requires regular files: ${JSON.stringify(name)}`)
    if (files.length >= MAX_BUNDLE_FILES) throw new Error('A bundle must not exceed 512 files.')
    const limit = Math.min(name === 'SKILL.md' ? MAX_SKILL_BYTES : MAX_BUNDLE_FILE_BYTES, MAX_BUNDLE_BYTES - total)
    if (stat.size > BigInt(limit)) throw new Error('Bundle exceeds its 128 KiB SKILL.md, 16 MiB file or 32 MiB total limit.')
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    try {
      const opened = await handle.stat({ bigint: true })
      if (!opened.isFile() || identity(opened) !== identity(stat)) throw new Error('Bundle changed during inspection; retry a stable directory.')
      const hash = createHash('sha256')
      const buffer = Buffer.alloc(Math.min(limit + 1, 64 * 1024))
      const chunks: Buffer[] = []
      let size = 0
      while (true) {
        const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, limit - size + 1), null)
        if (!bytesRead) break
        size += bytesRead
        if (size > limit) throw new Error('Bundle grew beyond its byte limit during inspection.')
        hash.update(buffer.subarray(0, bytesRead))
        if (name === 'SKILL.md') chunks.push(Buffer.from(buffer.subarray(0, bytesRead)))
      }
      if (BigInt(size) !== stat.size || identity(await handle.stat({ bigint: true })) !== identity(stat)) {
        throw new Error('Bundle changed during inspection; retry a stable directory.')
      }
      if (name === 'SKILL.md') skillBytes = Buffer.concat(chunks)
      total += size
      files.push({ path: name, bytes: size, sha256: hash.digest('hex') })
    } finally {
      await handle.close()
    }
  }

  const rootStat = await lstat(root)
  if (!rootStat.isDirectory()) throw new Error('Choose a skill directory containing SKILL.md.')
  await visit(root, '', 0)
  // Detect additions, removals and changes while other entries were being read.
  for (const [path, stamp] of observed) {
    if (identity(await lstat(path, { bigint: true })) !== stamp) throw new Error('Bundle changed during inspection; retry a stable directory.')
  }
  if (skillBytes === undefined) throw new Error('A bundle must contain SKILL.md.')
  new TextDecoder('utf-8', { fatal: true }).decode(skillBytes)
  const manifest = await makeManifest(files.toSorted((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { manifest, skillBytes }
}
