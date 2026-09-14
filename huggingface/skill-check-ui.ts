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
    el('check').setAttribute('aria-busy', 'false')
    el<HTMLButtonElement>('check-run').disabled = false
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
      const { externalSources, declaredTools } = report.surface
      const assessed = report.lenient.ok
      const unverified = externalSources.filter(item => !item.pinned).length
      el('check-source-state').textContent = !assessed ? 'Unavailable: parsing failed'
        : externalSources.length === 0 ? 'No HTTP(S) references found'
          : `${externalSources.length} hosts · ${unverified} need source review`
      el('check-sources').replaceChildren()
      for (const source of externalSources) {
        const item = document.createElement('li')
        const heading = document.createElement('strong')
        heading.textContent = `${source.host} — ${source.pinned ? 'Full-commit addresses' : 'Unverified or mutable address'}`
        const urls = document.createElement('pre')
        urls.tabIndex = 0
        urls.textContent = source.urls.join('\n')
        item.append(heading, urls)
        el('check-sources').append(item)
      }
      el('check-tools').textContent = !assessed ? 'Unavailable: parsing failed.'
        : declaredTools.length ? declaredTools.join('\n')
          : 'No allowed-tools declaration. No tool restriction can be inferred.'
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
    file.value = ''
    const request = revision
    input.value = ''
    el('check').setAttribute('aria-busy', 'true')
    el<HTMLButtonElement>('check-run').disabled = true
    status.textContent = 'Reading the selected file locally…'
    try {
      if (selected.size > MAX_SKILL_BYTES) throw new Error('Choose a SKILL.md of 128 KiB or less.')
      const bytes = await selected.arrayBuffer()
      if (revision !== request) return
      input.value = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      run()
    } catch (error) {
      if (revision === request) {
        el('check').setAttribute('aria-busy', 'false')
        el<HTMLButtonElement>('check-run').disabled = false
        status.textContent = error instanceof TypeError
          ? 'Could not read UTF-8 text. Save this file as UTF-8 and open it again.'
          : error instanceof Error ? error.message : 'Could not read this file.'
      }
    }
  })
  download.addEventListener('click', () => {
    if (!report) return
    const url = URL.createObjectURL(new Blob([JSON.stringify({
      ...report, source,
      scope: 'Provider parsing and local source-address/tool-declaration review. No fetching, content verification, script execution or client permission enforcement.',
    }, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'skills-anywhere-local-check.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
    status.textContent = 'Check report downloaded with descriptions, referenced URLs, tool declarations and diagnostics. The raw file body is omitted.'
  })
}
