// Exercise the packed CLI from an unrelated directory, with real process exits.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const entry = realpathSync(resolve(process.argv[2] ?? 'node_modules/dsh-skills-anywhere/lib/cli.js'))
const source = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'))
const version = JSON.parse(readFileSync(resolve(dirname(entry), '../package.json'), 'utf8')).version
assert.ok(!entry.startsWith(source + sep), 'Check an installed tarball outside the source checkout')
const cwd = mkdtempSync(join(tmpdir(), 'skills-installed-check-'))
try {
  writeFileSync(join(cwd, 'valid.md'), '---\nname: incident\ndescription: Inspect supplied evidence.\n---\nPRIVATE BODY\n')
  writeFileSync(join(cwd, 'repair.md'), 'Inspect supplied evidence.')
  function run(args, code) {
    const result = spawnSync(process.execPath, [entry, 'check', ...args, '--json'], { cwd, encoding: 'utf8', timeout: 15000 })
    assert.equal(result.status, code, result.stderr || result.error?.message)
    assert.equal(result.stderr, '')
    assert.ok(!result.stdout.includes('PRIVATE BODY'))
    const report = JSON.parse(result.stdout)
    assert.deepEqual(report.tool, { name: 'dsh-skills-anywhere', version })
    return report
  }
  assert.deepEqual(run(['valid.md'], 0).counts, { passed: 1, failed: 0, inputErrors: 0 })
  const repaired = run(['repair.md'], 1)
  assert.equal(repaired.files[0].report.lenient.name, 'repair')
  assert.equal(repaired.files[0].sha256.length, 64)
  run(['repair.md', '--lenient'], 0)
  run(['repair.md', '--lenient', '--fail-on-repair'], 1)
  assert.deepEqual(run(['repair.md', 'missing.md', 'valid.md'], 2).counts, { passed: 1, failed: 1, inputErrors: 1 })
  console.log('Installed tarball: strict/lenient gates, repairs, full reports and process exits passed.')
} finally {
  rmSync(cwd, { recursive: true, force: true })
}
