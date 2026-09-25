import { checkResourceInventory, MAX_RESOURCE_FILES, type ResourceReport } from '../src/resource-links.ts'
import { MAX_SKILL_BYTES } from '../src/skill-check.ts'

export function installResourceCheck(source: { commit: string; dirty: boolean }): void {
  const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
  const picker = el<HTMLInputElement>('resources-folder')
  const download = el<HTMLButtonElement>('resources-download')
  const status = el('resources-status')
  let revision = 0
  let report: ResourceReport | undefined

  function clear(): void {
    revision++
    report = undefined
    download.disabled = true
    picker.value = ''
    el('resources-rows').replaceChildren()
    el('resources-results').hidden = true
    status.textContent = 'Choose a skill folder containing SKILL.md. Its files stay in this page.'
  }

  function show(raw: string, names: string[]): void {
    report = checkResourceInventory(raw, names)
    el('resources-rows').replaceChildren()
    for (const item of report.references) {
      const row = document.createElement('tr')
      for (const text of [String(item.line), item.url, item.status + (item.kind ? ` (${item.kind})` : '')]) {
        const cell = document.createElement('td')
        cell.textContent = text
        row.append(cell)
      }
      el('resources-rows').append(row)
    }
    el('resources-results').hidden = false
    download.disabled = false
    const { total, present, issues } = report.counts
    status.textContent = total === 0
      ? 'No local Markdown links found. Paths written only in prose, code or HTML were not checked.'
      : `${present} of ${total} local link targets present; ${issues} need review.`
  }

  picker.addEventListener('change', async () => {
    const files = [...(picker.files ?? [])]
    clear()
    const request = revision
    if (files.length === 0) return
    try {
      if (files.length > MAX_RESOURCE_FILES) throw new Error(`Choose a folder with at most ${MAX_RESOURCE_FILES} files.`)
      const root = files[0]!.webkitRelativePath.split('/')[0]
      const prefix = `${root}/`
      if (!root || files.some(file => !file.webkitRelativePath.startsWith(prefix))) throw new Error('Choose one skill folder.')
      const skill = files.find(file => file.webkitRelativePath === `${prefix}SKILL.md`)
      if (!skill) throw new Error('Choose the folder that directly contains SKILL.md.')
      if (skill.size > MAX_SKILL_BYTES) throw new Error('Choose a SKILL.md of 128 KiB or less.')
      status.textContent = 'Reading SKILL.md and the selected file names locally…'
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(await skill.arrayBuffer())
      if (request !== revision) return
      show(raw, files.map(file => file.webkitRelativePath.slice(prefix.length)))
    } catch (error) {
      if (request === revision) status.textContent = error instanceof Error ? error.message : 'Could not check this directory.'
    }
  })
  el('resources-example').addEventListener('click', () => {
    clear()
    show('# Review skill\n\nRead [the checklist](references/checklist.md), then [the missing guide](references/guide.md).\n\n[Repository sibling](../shared.md) stays outside this skill.\n',
      ['SKILL.md', 'references/checklist.md'])
  })
  el('resources-clear').addEventListener('click', clear)
  download.addEventListener('click', () => {
    if (!report) return
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...report, source }, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'skills-anywhere-resources.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
    status.textContent = 'Downloaded the local resource report. It includes the referenced paths and their status.'
  })
}
