import { checkResourceInventory, MAX_RESOURCE_FILES, type ResourceReport } from '../src/resource-links.ts'
import { MAX_SKILL_BYTES } from '../src/skill-check.ts'

export function installResourceCheck(source: { commit: string; dirty: boolean }): void {
  const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
  const picker = el<HTMLInputElement>('resources-folder')
  const download = el<HTMLButtonElement>('resources-download')
  const image = el<HTMLButtonElement>('resources-image')
  const status = el('resources-status')
  let revision = 0
  let report: ResourceReport | undefined
  let example = false

  function clear(): void {
    revision++
    report = undefined
    download.disabled = true
    image.disabled = true
    example = false
    picker.value = ''
    el('resources-rows').replaceChildren()
    el('resources-results').hidden = true
    el('resources-summary').hidden = true
    status.textContent = 'Choose a skill folder containing SKILL.md. Its files stay in this page.'
  }

  function show(raw: string, names: string[]): void {
    report = checkResourceInventory(raw, names)
    el('resources-rows').replaceChildren()
    for (const item of report.references) {
      const row = document.createElement('tr')
      row.dataset.status = item.status
      for (const text of [String(item.line), item.url, item.status + (item.kind ? ` (${item.kind})` : '')]) {
        const cell = document.createElement('td')
        cell.textContent = text
        row.append(cell)
      }
      el('resources-rows').append(row)
    }
    el('resources-results').hidden = false
    download.disabled = false
    image.disabled = false
    const { total, present, issues } = report.counts
    el('resources-summary').hidden = false
    el('resources-present').textContent = String(present)
    el('resources-total').textContent = String(total)
    el('resources-issues').textContent = String(issues)
    el('resources-origin').textContent = example ? 'Authored example' : 'Your local folder'
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
  function showExample(): void {
    clear()
    example = true
    show('# Review skill\n\nRead [the checklist](references/checklist.md), then [the missing guide](references/guide.md).\n\n[Repository sibling](../shared.md) stays outside this skill.\n',
      ['SKILL.md', 'references/checklist.md'])
  }
  el('resources-example').addEventListener('click', showExample)
  el('resources-clear').addEventListener('click', clear)
  download.addEventListener('click', () => {
    if (!report) return
    const inputKind = example ? 'authored-example' : 'local-folder'
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...report, input_kind: inputKind, source }, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'skills-anywhere-resources.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
    status.textContent = `Downloaded the ${example ? 'authored example' : 'local folder'} report. It includes the referenced paths, their status and the input kind.`
  })
  image.addEventListener('click', () => {
    if (!report) return
    const canvas = document.createElement('canvas')
    canvas.width = 1200
    canvas.height = 630
    const ctx = canvas.getContext('2d')
    if (!ctx) { status.textContent = 'Image export is unavailable. Download the JSON report instead.'; return }
    const { present, total, issues } = report.counts
    const gradient = ctx.createLinearGradient(0, 0, 1200, 630)
    gradient.addColorStop(0, '#18352c')
    gradient.addColorStop(1, '#0c1019')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 1200, 630)
    ctx.fillStyle = '#a3f4c7'
    ctx.font = '600 24px system-ui, sans-serif'
    ctx.fillText('SKILLS ANYWHERE / RESOURCE CHECK', 64, 72)
    ctx.fillStyle = '#f0f4fb'
    ctx.font = '600 62px system-ui, sans-serif'
    ctx.fillText('Did the files come along?', 64, 170)
    const counts = `${present} / ${total}`
    let countSize = 116
    ctx.font = `600 ${countSize}px system-ui, sans-serif`
    while (ctx.measureText(counts).width > 510 && countSize > 48) {
      countSize -= 4
      ctx.font = `600 ${countSize}px system-ui, sans-serif`
    }
    ctx.fillText(counts, 64, 330)
    ctx.fillStyle = '#b6c3d4'
    ctx.font = '28px system-ui, sans-serif'
    ctx.fillText('local link targets present', 64, 385)
    ctx.fillStyle = issues ? '#ffcd86' : '#a3f4c7'
    ctx.font = '600 44px system-ui, sans-serif'
    ctx.fillText(`${issues} need review`, 650, 310)
    ctx.fillStyle = '#b6c3d4'
    ctx.font = '22px system-ui, sans-serif'
    ctx.fillText(example ? 'Authored example · no user files' : 'Local folder check · file names omitted', 64, 470)
    ctx.fillText('Markdown links only. File presence does not verify skill behavior.', 64, 510)
    ctx.font = '18px ui-monospace, monospace'
    ctx.fillText(`github.com/noteflowai/dsh-skills-anywhere · ${source.commit.slice(0, 12)}${source.dirty ? ' (modified)' : ''}`, 64, 574)
    canvas.toBlob(blob => {
      if (!blob) { status.textContent = 'Image export failed. Download the JSON report instead.'; return }
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'skills-anywhere-resource-check.png'
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      status.textContent = 'Saved a result image with counts and scope. File names and contents are omitted.'
    }, 'image/png')
  })
  showExample()
}
