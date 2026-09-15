import { compareManifests, MAX_MANIFEST_BYTES, validateManifest, type BundleManifest } from '../src/bundle-manifest.ts'

export function installBundleComparison(example: { reviewed: BundleManifest; changed: BundleManifest }): void {
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  type Side = 'reviewed' | 'current'
  const state: Record<Side, BundleManifest | undefined> = { reviewed: undefined, current: undefined }
  const tokens: Record<Side, number> = { reviewed: 0, current: 0 }
  const errors: Record<Side, string> = { reviewed: '', current: '' }
  const pending: Record<Side, boolean> = { reviewed: false, current: false }

  function render(): void {
    const { reviewed, current } = state
    for (const side of ['reviewed', 'current'] as const) {
      el<HTMLButtonElement>(`bundle-download-${side}`).disabled = !state[side]
      el(`bundle-${side}-hash`).textContent = state[side]?.sha256
        ?? (pending[side] ? 'Reading and validating locally…' : 'No valid manifest loaded')
      el(`bundle-${side}-hash`).setAttribute('aria-busy', String(pending[side]))
    }
    const ready = reviewed !== undefined && current !== undefined
    el('bundle-results').hidden = !ready
    if (!ready) {
      el('bundle-status').textContent = [
        ...Object.values(errors).filter(Boolean),
        ...(['reviewed', 'current'] as const).filter(side => pending[side]).map(side => `Validating ${side} manifest locally…`),
      ].join(' ') || 'Choose a valid manifest for each side, or load an example.'
      return
    }
    const comparison = compareManifests(reviewed, current)
    const sameSkill = reviewed.files.find(file => file.path === 'SKILL.md')!.sha256 === current.files.find(file => file.path === 'SKILL.md')!.sha256
    el('bundle-status').textContent = comparison.matches ? 'Bundle matches the reviewed files.' : 'Bundle changed. Review the differences before loading.'
    el('bundle-verdict').textContent = comparison.matches ? 'MATCH' : 'REVIEW REQUIRED'
    el('bundle-verdict').dataset.match = String(comparison.matches)
    el('bundle-skill-state').textContent = sameSkill ? 'SKILL.md is unchanged.' : 'SKILL.md changed too.'
    el('bundle-counts').textContent = `${reviewed.files.length} reviewed / ${current.files.length} current files · ${comparison.changed.length} changed · ${comparison.added.length} added · ${comparison.removed.length} removed`
    const rows = (['changed', 'added', 'removed'] as const).flatMap(kind => comparison[kind].map(path => `${kind.toUpperCase()}  ${path}`))
    el('bundle-changes').textContent = rows.join('\n') || 'No file path or content changes.'
    el('bundle-mcp').textContent = JSON.stringify({ name: 'review', expected_bundle_sha256: reviewed.sha256 }, null, 2)
  }

  async function sample(changed: boolean): Promise<void> {
    for (const side of ['reviewed', 'current'] as const) {
      ++tokens[side]
      state[side] = undefined
      errors[side] = ''
      pending[side] = true
      el<HTMLInputElement>(`bundle-file-${side}`).value = ''
      el(`bundle-source-${side}`).textContent = 'Authored example'
    }
    const token = { ...tokens }
    render()
    await Promise.all((['reviewed', 'current'] as const).map(async side => {
      try {
        const value = await validateManifest(side === 'current' && changed ? example.changed : example.reviewed)
        if (token[side] !== tokens[side]) return
        state[side] = value
      } catch {
        if (token[side] !== tokens[side]) return
        errors[side] = `The ${side} example manifest could not be verified. Choose a local manifest or retry the example.`
      } finally {
        if (token[side] === tokens[side]) {
          pending[side] = false
          render()
        }
      }
    }))
  }

  for (const side of ['reviewed', 'current'] as const) {
    el<HTMLInputElement>(`bundle-file-${side}`).addEventListener('change', async event => {
      const file = (event.currentTarget as HTMLInputElement).files?.[0]
      if (!file) return
      ;(event.currentTarget as HTMLInputElement).value = ''
      const token = ++tokens[side]
      state[side] = undefined
      errors[side] = ''
      pending[side] = true
      el(`bundle-source-${side}`).textContent = file.name
      render()
      try {
        if (file.size > MAX_MANIFEST_BYTES) throw new Error('Use a manifest of 1 MiB or less.')
        const bytes = await file.arrayBuffer()
        if (token !== tokens[side]) return
        const value = await validateManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown)
        if (token !== tokens[side]) return
        state[side] = value
      } catch (error) {
        if (token !== tokens[side]) return
        errors[side] = `${side === 'reviewed' ? 'Reviewed' : 'Current'}: ${error instanceof Error ? error.message : 'Cannot read this manifest.'}`
      } finally {
        if (token === tokens[side]) {
          pending[side] = false
          render()
        }
      }
    })
    el(`bundle-download-${side}`).addEventListener('click', () => {
      const manifest = state[side]
      if (!manifest) return
      const url = URL.createObjectURL(new Blob([JSON.stringify(manifest, null, 2) + '\n'], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `${side}-skill-bundle.json`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    })
  }
  el('bundle-demo-changed').addEventListener('click', () => { void sample(true) })
  el('bundle-demo-matching').addEventListener('click', () => { void sample(false) })
  void sample(true)
}
