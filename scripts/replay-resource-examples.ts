/** Verify pinned sample bytes, then compare a full folder with SKILL.md alone. */
import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { checkResourceFiles } from '../src/resource-files.ts'
import { checkResourceInventory } from '../src/resource-links.ts'

const directory = resolve('examples/resource-portability')
const manifest = JSON.parse(await readFile(resolve(directory, 'sources.json'), 'utf8')) as {
  samples: { name: string; repository: string; commit: string; directory: string; files: Record<string, { sha256: string; bytes: number }> }[]
}
const samples = []
for (const sample of manifest.samples) {
  const root = resolve(directory, 'snapshots', sample.name)
  const actual = (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter(entry => entry.isFile()).map(entry => relative(root, resolve(entry.parentPath, entry.name))).sort()
  if (JSON.stringify(actual) !== JSON.stringify(Object.keys(sample.files).sort())) throw new Error(`Inventory changed: ${sample.name}`)
  for (const [name, identity] of Object.entries(sample.files)) {
    const bytes = await readFile(resolve(root, name))
    if (bytes.length !== identity.bytes || createHash('sha256').update(bytes).digest('hex') !== identity.sha256) throw new Error(`Changed snapshot: ${sample.name}/${name}`)
  }
  const raw = await readFile(resolve(root, 'SKILL.md'), 'utf8')
  samples.push({
    name: sample.name, repository: sample.repository, commit: sample.commit, directory: sample.directory,
    original: await checkResourceFiles(raw, resolve(root, 'SKILL.md')),
    skillOnlyControl: checkResourceInventory(raw, ['SKILL.md']),
  })
}
const output = `${JSON.stringify({
  schema: 'skill-resource-examples-1',
  scope: 'Three selected snapshots, not a representative benchmark. The SKILL.md-only control is constructed locally; it is not an upstream defect. Referenced file contents are not assessed or executed.',
  samples,
}, null, 2)}\n`
const destination = resolve(directory, 'results.json')
if (process.argv.includes('--write')) await writeFile(destination, output)
else if (await readFile(destination, 'utf8') !== output) throw new Error('Resource example reports differ; review and regenerate with --write.')
console.log(samples.map(sample => `${sample.name}: full ${sample.original.counts.present}/${sample.original.counts.total}; SKILL.md-only ${sample.skillOnlyControl.counts.present}/${sample.skillOnlyControl.counts.total}`).join('\n'))
