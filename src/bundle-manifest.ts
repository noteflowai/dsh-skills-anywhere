/** Portable manifest semantics shared by the CLI, MCP and browser comparison. */
export const MAX_BUNDLE_FILES = 512
export const MAX_BUNDLE_BYTES = 32 * 1024 * 1024
export const MAX_BUNDLE_FILE_BYTES = 16 * 1024 * 1024
export const MAX_MANIFEST_BYTES = 1024 * 1024
export const BUNDLE_SCHEMA = 'skills-anywhere-bundle-1' as const

export interface BundleFile {
  readonly path: string
  readonly bytes: number
  readonly sha256: string
}

export interface BundleManifest {
  readonly schema: typeof BUNDLE_SCHEMA
  readonly sha256: string
  readonly total_bytes: number
  readonly files: readonly BundleFile[]
}

const digestPattern = /^[a-f0-9]{64}$/
export function validBundlePath(path: string): boolean {
  const parts = path.split('/')
  return path.isWellFormed() && new TextEncoder().encode(path).length <= 1024
    // Control bytes must not enter displayable manifest paths.
    // oxlint-disable-next-line eslint/no-control-regex
    && !/[\\:\x00-\x1f\x7f\ufffd]/.test(path)
    && parts.length <= 12 && parts.every(part => part !== '' && part !== '.' && part !== '..')
}

function objectKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).toSorted().join(',') === keys.toSorted().join(',')
}

/** Canonical UTF-8 JSON tuple: schema followed by [path, bytes, sha256] rows. */
export async function makeManifest(files: readonly BundleFile[]): Promise<BundleManifest> {
  if (files.length < 1 || files.length > MAX_BUNDLE_FILES) throw new Error('A bundle needs 1–512 files.')
  let previous = ''
  let total = 0
  const paths = new Set<string>()
  for (const file of files) {
    if (!objectKeys(file, ['path', 'bytes', 'sha256'])
      || typeof file.path !== 'string' || !validBundlePath(file.path) || file.path <= previous
      || typeof file.bytes !== 'number' || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > MAX_BUNDLE_FILE_BYTES
      || typeof file.sha256 !== 'string' || !digestPattern.test(file.sha256)) {
      throw new Error('Invalid bundle file: require unique sorted relative paths, bounded byte counts and SHA-256.')
    }
    const parents = file.path.split('/')
    parents.pop()
    while (parents.length) {
      if (paths.has(parents.join('/'))) throw new Error('A bundle file cannot also be a directory.')
      parents.pop()
    }
    if (file.path === 'SKILL.md' && file.bytes > 128 * 1024) throw new Error('SKILL.md exceeds 128 KiB.')
    paths.add(file.path)
    previous = file.path
    total += file.bytes
  }
  if (!files.some(file => file.path === 'SKILL.md')) throw new Error('A bundle must contain SKILL.md.')
  if (total > MAX_BUNDLE_BYTES) throw new Error('A bundle must not exceed 32 MiB.')
  const payload = JSON.stringify([BUNDLE_SCHEMA, files.map(file => [file.path, file.bytes, file.sha256])])
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))
  return {
    schema: BUNDLE_SCHEMA,
    sha256: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(''),
    total_bytes: total,
    files: files.map(file => ({ path: file.path, bytes: file.bytes, sha256: file.sha256 })),
  }
}

/** A received manifest must agree with its own inventory and digest. */
export async function validateManifest(value: unknown): Promise<BundleManifest> {
  if (!objectKeys(value, ['schema', 'sha256', 'total_bytes', 'files'])
    || value.schema !== BUNDLE_SCHEMA || !Array.isArray(value.files)) throw new Error('Expected a skills-anywhere-bundle-1 manifest.')
  const computed = await makeManifest(value.files as BundleFile[])
  if (value.sha256 !== computed.sha256 || value.total_bytes !== computed.total_bytes) throw new Error('Manifest digest or total bytes disagrees with its inventory.')
  return computed
}

export function compareManifests(expected: BundleManifest, actual: BundleManifest) {
  const before = new Map(expected.files.map(file => [file.path, file]))
  const after = new Map(actual.files.map(file => [file.path, file]))
  return {
    schema: 'skills-anywhere-bundle-comparison-1' as const,
    matches: expected.sha256 === actual.sha256,
    expected_sha256: expected.sha256,
    actual_sha256: actual.sha256,
    added: actual.files.filter(file => !before.has(file.path)).map(file => file.path),
    removed: expected.files.filter(file => !after.has(file.path)).map(file => file.path),
    changed: actual.files.filter(file => {
      const old = before.get(file.path)
      return old !== undefined && (old.sha256 !== file.sha256 || old.bytes !== file.bytes)
    }).map(file => file.path),
  }
}
