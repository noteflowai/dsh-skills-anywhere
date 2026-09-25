import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { createDemoData } from './fixture.ts'

const asciiJson = (value: unknown) => JSON.stringify(value).replace(/[\u007f-\uffff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

async function browserNotices(root: string): Promise<string> {
  const seen = new Set<string>()
  const notices: string[] = []
  async function collect(name: string, from: string): Promise<void> {
    if (name.startsWith('@types/')) return
    const require = createRequire(resolve(from, 'package.json'))
    let folder = dirname(require.resolve(name))
    let pkg: { name: string; version: string; dependencies?: Record<string, string> } | undefined
    while (dirname(folder) !== folder) {
      try {
        const candidate = JSON.parse(await readFile(resolve(folder, 'package.json'), 'utf8')) as typeof pkg
        if (candidate?.name === name) { pkg = candidate; break }
      } catch { /* The entry point can be below the package root. */ }
      folder = dirname(folder)
    }
    if (!pkg) throw new Error(`Cannot locate bundled package ${name}`)
    const key = `${pkg.name}@${pkg.version}`
    if (seen.has(key)) return
    seen.add(key)
    const licenseName = (await readdir(folder)).find(file => /^license(?:\.md|\.txt)?$/i.test(file))
    if (!licenseName) throw new Error(`Cannot locate license for ${key}`)
    notices.push(`${key}\n\n${await readFile(resolve(folder, licenseName), 'utf8')}`)
    for (const dependency of Object.keys(pkg.dependencies ?? {}).sort()) await collect(dependency, folder)
  }
  for (const name of ['yaml', 'mdast-util-from-markdown']) await collect(name, root)
  return `Browser parser dependencies and their license notices.\n\n${notices.join('\n\n---\n\n')}\n`
}

export async function buildShowcase(root = process.cwd()): Promise<void> {
  const dest = resolve(root, '.dsh-showcase/site')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  const source = { commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain').length > 0 }
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as { version: string }
  const data = await createDemoData(pkg.version, root)
  const html = await readFile(resolve(root, 'huggingface/index.html'), 'utf8')
  // HF's static HTML injector has corrupted multibyte text at a buffer boundary.
  // Entity-encoded HTML and escaped data also make file integrity unambiguous.
  if (/[^\x00-\x7f]/.test(html)) throw new Error('Use HTML entities for non-ASCII landing-page text')
  await mkdir(dest, { recursive: true })
  for (const name of ['index.html', 'style.css', 'README.md']) await copyFile(resolve(root, 'huggingface', name), resolve(dest, name))
  for (const name of ['ai-first-review.mp4', 'ai-first-review.png', 'ai-first-review.vtt', 'ai-first-review-media.json']) await copyFile(resolve(root, 'docs/assets', name), resolve(dest, name))
  await copyFile(resolve(root, 'LICENSE'), resolve(dest, 'LICENSE'))
  await writeFile(resolve(dest, 'THIRD_PARTY_NOTICES.txt'), await browserNotices(root))
  await writeFile(resolve(dest, 'data.js'), `window.SKILLS_DEMO=${asciiJson(data)};\nwindow.SKILLS_BUILD=${asciiJson(source)};\n`)
  // A source link and separate hash list keep the static fixture inspectable.
  await writeFile(resolve(dest, 'workspace.json'), `${JSON.stringify({ ...source, ...data }, null, 2)}\n`)
  await writeFile(resolve(dest, '.gitattributes'), '*.png filter=lfs diff=lfs merge=lfs -text\n*.mp4 filter=lfs diff=lfs merge=lfs -text\n')
  await writeManifest(dest, source)
}

export async function writeManifest(dest: string, source: { commit: string; dirty: boolean }): Promise<void> {
  const files: Record<string, { sha256: string; bytes: number }> = {}
  for (const name of (await readdir(dest)).sort()) {
    if (name === 'manifest.json') continue
    if (!['index.html', 'style.css', 'app.js', 'data.js', 'workspace.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.txt', '.gitattributes', 'thumbnail.png', 'ai-first-review.mp4', 'ai-first-review.png', 'ai-first-review.vtt', 'ai-first-review-media.json'].includes(name)) throw new Error(`Unexpected showcase file: ${name}`)
    const bytes = await readFile(resolve(dest, name))
    files[name] = { sha256: sha256(bytes), bytes: bytes.length }
  }
  if (!files['app.js']) throw new Error('Build the browser bundle first')
  await writeFile(resolve(dest, 'manifest.json'), `${JSON.stringify({ schema: 'skills-anywhere-space-1', source, files }, null, 2)}\n`)
}

if (process.argv.includes('--build')) await buildShowcase()
if (process.argv.includes('--seal')) {
  const dest = resolve('.dsh-showcase/site')
  const old = JSON.parse(await readFile(resolve(dest, 'manifest.json'), 'utf8')) as { source: { commit: string; dirty: boolean } }
  await writeManifest(dest, old.source)
}
