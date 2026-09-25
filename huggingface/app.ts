import { applyCatalogBudget } from '../src/catalog.ts'
import { searchSkills } from '../src/search.ts'
import type { DemoData, DemoSkill } from './types.ts'
import { installSkillCheck } from './skill-check-ui.ts'
import { installBundleComparison } from './bundle-ui.ts'
import { installResourceCheck } from './resource-check-ui.ts'

declare global {
  interface Window {
    SKILLS_DEMO: DemoData
    SKILLS_BUILD: { commit: string; dirty: boolean }
  }
}

const data = window.SKILLS_DEMO
const build = window.SKILLS_BUILD
installResourceCheck(build)
const names = new Set(data.skills.map(skill => skill.name))
const availableCount = data.skills.filter(skill => skill.invocation.modelInvocable).length
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const budget = el<HTMLInputElement>('budget')
const search = el<HTMLInputElement>('search')
let pinned = new Set<string>()
let hidden = new Set<string>()
let selected = 'review'
let install = 'cli'
const stateLabels = { visible: 'in catalog', hidden: 'on demand', disabled: 'author disabled' }
const guidance: Record<string, string> = {
  default: 'Follow each skill back to its source. The identical review copy is collapsed; different configure skills stay reachable.',
  collision: 'Two plugins both call their skill configure. Discovery keeps both and prefixes their names with the plugin, so you can choose the right one.',
  budget: 'The catalog only lists one skill now. Search still finds test-plan; inspect it on demand, or Pin it to move it into the catalog.',
  robot: 'Load a real Microduck review skill, then use the linked walkthrough with your own MCP client. This browser shows instructions; your agent runs the read-only verifier in its own workspace.',
  custom: 'Custom view. Search, budget, pins and hidden skills reflect your choices. Choose a guided example to start a new walkthrough.',
  shared: 'Restored view. The link includes search, budget, pins and hidden skills; local SKILL.md input is never included.',
}

function guide(scenario: string): void {
  el('scenario-note').textContent = guidance[scenario]!
  document.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach(button => {
    const active = button.dataset.scenario === scenario
    button.classList.toggle('active', active)
    button.setAttribute('aria-pressed', String(active))
  })
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag)
  result.className = className
  result.textContent = text
  return result
}

function settings() {
  return { limit: Number(budget.value), pin: pinned, hide: hidden }
}

function fragment(): string {
  const params = new URLSearchParams({ budget: budget.value, skill: selected })
  if (search.value) params.set('q', search.value)
  if (pinned.size) params.set('pin', [...pinned].sort().join(','))
  if (hidden.size) params.set('hide', [...hidden].sort().join(','))
  return `#${params}`
}

function loadFragment(): void {
  if (!location.hash.includes('=')) return
  const params = new URLSearchParams(location.hash.slice(1))
  const value = params.has('budget') ? Number(params.get('budget')) : 3
  budget.value = Number.isInteger(value) && value >= 0 && value <= availableCount ? String(value) : '3'
  search.value = (params.get('q') ?? '').slice(0, 120)
  const readSet = (key: string) => new Set((params.get(key) ?? '').split(',').filter(name =>
    names.has(name) && data.skills.find(skill => skill.name === name)?.invocation.modelInvocable))
  pinned = readSet('pin')
  hidden = readSet('hide')
  const requested = data.skills.find(skill => skill.name === params.get('skill'))
  selected = requested?.invocation.modelInvocable ? requested.name : 'review'
  guide('shared')
}

function inspect(skill: DemoSkill, state: string): void {
  el('selected-name').textContent = skill.name
  el('selected-path').textContent = skill.path
  el('selected-content').textContent = skill.content
  el('selected-state').textContent = state
}

function render(updateAddress = true): void {
  const states = applyCatalogBudget(data.skills, settings())
  const openable = data.skills.filter(skill => skill.invocation.modelInvocable)
  el('listed-count').textContent = String([...states.values()].filter(state => state === 'visible').length)
  el('budget-value').textContent = budget.value === '0' ? 'unlimited' : budget.value
  budget.setAttribute('aria-valuetext', budget.value === '0' ? 'Unlimited catalog' : `${budget.value} skills in catalog budget`)
  el('clear-search').hidden = !search.value
  el('eligible-count').textContent = String(openable.length)
  el('disabled-count').textContent = String(data.skills.length - openable.length)
  const query = search.value.trim()
  const matches = query ? searchSkills(openable.map(skill => ({
    ...skill, invocation: { modelInvocable: states.get(skill.name) === 'visible' },
  })), query, 20) : undefined
  const shown = matches ? matches.map(match => data.skills.find(skill => skill.name === match.name)!) : data.skills
  el('result-count').textContent = `${shown.length} ${query ? 'search results' : 'discovered skills'}`
  const list = el('skill-list')
  list.replaceChildren()
  for (const skill of shown) {
    const state = states.get(skill.name)!
    const row = node('article', `skill-row${selected === skill.name ? ' selected' : ''}`)
    row.dataset.name = skill.name
    const main = node('div')
    const title = node('div', 'skill-title', skill.name)
    title.append(node('span', `state ${state}`, stateLabels[state]))
    main.append(title, node('span', 'skill-origin', `${skill.origin}${skill.renamedFrom ? ` / renamed from ${skill.renamedFrom}` : ''}`))
    const controls = node('div', 'skill-controls')
    for (const [action, collection] of [['Pin', pinned], ['Hide', hidden]] as const) {
      const button = node('button', '', action)
      button.type = 'button'
      button.disabled = !skill.invocation.modelInvocable
      button.setAttribute('aria-label', `${action} ${skill.name}`)
      button.setAttribute('aria-pressed', String(collection.has(skill.name)))
      button.addEventListener('click', () => {
        if (collection.has(skill.name)) collection.delete(skill.name)
        else collection.add(skill.name)
        guide('custom')
        render()
        document.querySelector<HTMLButtonElement>(`[aria-label="${action} ${skill.name}"]`)?.focus()
      })
      controls.append(button)
    }
    const open = node('button', 'inspect', 'Inspect')
    open.type = 'button'
    open.disabled = !skill.invocation.modelInvocable
    open.setAttribute('aria-label', `Inspect ${skill.name}`)
    open.setAttribute('aria-controls', 'inspector')
    open.addEventListener('click', () => {
      selected = skill.name
      render()
      el('selected-name').focus()
    })
    controls.append(open)
    row.append(main, controls)
    list.append(row)
  }
  if (!shown.length) list.append(node('p', 'empty', 'No searchable skills match. Clear search to show all skills; your catalog settings will stay in place.'))
  const chosen = data.skills.find(skill => skill.name === selected && skill.invocation.modelInvocable)!
  inspect(chosen, stateLabels[states.get(chosen.name)!])
  el('review-workflow').hidden = chosen.name !== 'robot-reel-review'
  if (updateAddress) {
    try { history.replaceState(null, '', fragment()) } catch { /* Preview embeds may restrict history. */ }
  }
}

function reset(scenario = 'default'): void {
  pinned.clear()
  hidden.clear()
  budget.value = scenario === 'budget' ? '1' : '3'
  search.value = scenario === 'collision' ? 'configure' : scenario === 'budget' ? 'test' : scenario === 'robot' ? 'Microduck' : ''
  selected = scenario === 'budget' ? 'test-plan' : scenario === 'collision'
    ? data.skills.find(skill => skill.renamedFrom === 'configure')!.name : scenario === 'robot' ? 'robot-reel-review' : 'review'
  guide(scenario)
  render()
}

async function copy(text: string, message: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    el('share-fallback').hidden = true
    el('action-status').textContent = message
  } catch {
    const fallback = el<HTMLInputElement>('share-fallback')
    fallback.hidden = false
    fallback.value = text
    fallback.setAttribute('aria-label', 'Text to copy')
    fallback.focus()
    fallback.select()
    el('action-status').textContent = 'Clipboard unavailable here. Select and copy the text below.'
  }
}

const commands: Record<string, [string, string]> = {
  cli: [`npx -y dsh-skills-anywhere@${data.version} agents`, 'List supported agent directories on your machine. No model API or dsh session needed.'],
  dsh: [`dsh plugin --profile web add dsh-skills-anywhere@${data.version}`, 'Add the provider to an existing DeepSeek Harness web profile. Requires dsh 0.1.5-rc.1 or newer.'],
  mcp: [`npx -y dsh-skills-anywhere@${data.version} mcp`, 'Use this command as a stdio server in your MCP client configuration. The setup guide has examples.'],
}

function showInstall(method: string): void {
  install = method
  el('install-command').textContent = commands[method]![0]
  el('install-note').textContent = commands[method]![1]
  el('install-panel').setAttribute('aria-labelledby', `tab-${method}`)
  document.querySelectorAll<HTMLButtonElement>('[data-install]').forEach(button => {
    const active = button.dataset.install === method
    button.setAttribute('aria-selected', String(active))
    button.tabIndex = active ? 0 : -1
  })
}

el('agent-count').textContent = String(data.agentCount)
budget.max = String(availableCount)
el('build-meta').textContent = `Package ${data.version} / source ${build.commit.slice(0, 12)}${build.dirty ? ' (local preview)' : ''} / discovery fixture, no live inference`
el('diagnostic-count').textContent = `${data.dropped.length} duplicate / ${data.invalid.length} invalid / ${data.skills.filter(skill => skill.renamedFrom).length} renamed`
const diagnostics = el('diagnostics')
for (const duplicate of data.dropped) diagnostics.append(node('p', '', `Duplicate: ${duplicate.path} matches ${duplicate.winner}; kept one copy (${duplicate.reason}).`))
for (const invalid of data.invalid) diagnostics.append(node('p', '', `Skipped: ${invalid.path}. ${invalid.reason}`))
for (const skill of data.skills) {
  if (skill.renamedFrom) diagnostics.append(node('p', '', `Renamed: ${skill.renamedFrom} -> ${skill.name} (${skill.origin}).`))
  if (skill.warnings.length) diagnostics.append(node('p', '', `Repaired ${skill.name}: ${skill.warnings.join('; ')}`))
}
budget.addEventListener('input', () => { guide('custom'); render() })
search.addEventListener('input', () => { guide('custom'); render() })
el('clear-search').addEventListener('click', () => {
  search.value = ''
  guide('custom')
  render()
  search.focus()
})
el('back-to-skills').addEventListener('click', () => {
  const open = document.querySelector<HTMLButtonElement>(`[aria-label="Inspect ${selected}"]`)
  ;(open ?? search).focus()
})
el('reset').addEventListener('click', () => reset())
el('robot-start').addEventListener('click', event => {
  event.preventDefault()
  reset('robot')
  el('workspace-title').focus()
})
document.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach(button =>
  button.addEventListener('click', () => reset(button.dataset.scenario)))
el('share').addEventListener('click', () => {
  const base = location.protocol === 'file:' ? 'https://glayguo-dsh-skills-anywhere.static.hf.space/' : `${location.origin}${location.pathname}`
  void copy(`${base}${fragment()}`, 'View link copied.')
})
el('copy-install').addEventListener('click', () => void copy(commands[install]![0], 'Install command copied.'))
el('download').addEventListener('click', () => {
  const payload = { schema: data.schema, source: build, version: data.version, files: data.inputs, view: fragment() }
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
  const link = node('a')
  link.href = url
  link.download = 'skills-anywhere-sample-workspace.json'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  el('action-status').textContent = 'Sample files and current view downloaded as JSON.'
})
document.querySelectorAll<HTMLButtonElement>('[data-install]').forEach((button, index, buttons) => {
  button.addEventListener('click', () => showInstall(button.dataset.install!))
  button.addEventListener('keydown', event => {
    const next = event.key === 'ArrowRight' ? (index + 1) % buttons.length
      : event.key === 'ArrowLeft' ? (index + buttons.length - 1) % buttons.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1
    if (next < 0) return
    event.preventDefault()
    const target = buttons[next]!
    showInstall(target.dataset.install!)
    target.focus()
  })
})
window.addEventListener('hashchange', () => { loadFragment(); render(false) })
guide('default')
loadFragment()
showInstall('cli')
render(false)
installSkillCheck(data.inputs.find(input => input.path.includes('/incident-summary/'))!.markdown, build)
installBundleComparison(data.bundles)
