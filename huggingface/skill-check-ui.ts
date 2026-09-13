import { checkSkill, MAX_SKILL_BYTES, type SkillCheck } from '../src/skill-check.ts'

export function installSkillCheck(example: string, source: { commit: string; dirty: boolean }): void {
  const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
  const input = el<HTMLTextAreaElement>('check-input')
  const directory = el<HTMLInputElement>('check-directory')
  const file = el<HTMLInputElement>('check-file')
  const status = el<HTMLElement>('check-status')
  const download = el<HTMLButtonElement>('check-download')
  let report: SkillCheck | undefined
  let revision = 0

  function invalidate(): void {
    revision += 1
    report = undefined
    download.disabled = true
    el('check-results').hidden = true
    status.textContent = 'Ready to check. Your text stays in this page.'
  }

  function run(): void {
    invalidate()
    try {
      report = checkSkill(input.value, directory.value)
      for (const mode of ['strict', 'lenient'] as const) {
        const result = report[mode]
        el(`check-${mode}-state`).textContent = result.ok
          ? result.warnings.length ? 'Accepted with repairs' : 'Accepted'
          : 'Rejected'
        el(`check-${mode}-state`).dataset.ok = String(result.ok)
        el(`check-${mode}-details`).textContent = result.ok
          ? [
            `Name: ${result.name}`, `Description: ${result.description}`,
            `Model invocation: ${result.invocation.modelInvocable ? 'enabled' : 'author disabled'}`,
            `User invocation: ${result.invocation.userInvocable ? 'enabled' : 'disabled'}`,
            `Preserved metadata keys: ${result.metadataKeys.join(', ') || '(none)'}`,
            `Body: ${result.bodyBytes.toLocaleString()} UTF-8 bytes`,
            ...result.warnings.map(warning => `Repair: ${warning}`),
          ].join('\n\n')
          : result.reason
      }
      el('check-results').hidden = false
      download.disabled = false
      status.textContent = `Checked ${report.input.bytes.toLocaleString()} UTF-8 bytes with both provider modes.`
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Could not check this file.'
    }
  }

  input.addEventListener('input', invalidate)
  directory.addEventListener('input', invalidate)
  el('check-run').addEventListener('click', run)
  el('check-example').addEventListener('click', () => {
    input.value = example
    directory.value = 'incident-summary'
    file.value = ''
    run()
  })
  el('check-clear').addEventListener('click', () => {
    input.value = ''
    directory.value = 'my-skill'
    file.value = ''
    invalidate()
    status.textContent = 'Local input and results cleared.'
    input.focus()
  })
  file.addEventListener('change', async () => {
    invalidate()
    const selected = file.files?.[0]
    if (!selected) return
    const request = revision
    input.value = ''
    try {
      if (selected.size > MAX_SKILL_BYTES) throw new Error('Choose a SKILL.md of 128 KiB or less.')
      const text = await selected.text()
      if (revision !== request) return
      input.value = text
      run()
    } catch (error) {
      if (revision === request) status.textContent = error instanceof Error ? error.message : 'Could not read this file.'
    }
  })
  download.addEventListener('click', () => {
    if (!report) return
    const url = URL.createObjectURL(new Blob([JSON.stringify({
      ...report, source,
      scope: 'Provider parsing only; no script, resource, security or client compatibility verification.',
    }, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'skills-anywhere-local-check.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
    status.textContent = 'Check report downloaded. It contains parsed descriptions and diagnostics, but not the raw file body.'
  })
}
