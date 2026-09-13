/** Pure catalog selection, shared by the provider and the browser playground. */
export type CatalogState = 'visible' | 'hidden' | 'disabled'

export interface CatalogSkill {
  readonly name: string
  readonly invocation: { readonly modelInvocable: boolean }
}

export interface CatalogSelection {
  readonly limit: number
  readonly pin: ReadonlySet<string>
  readonly hide: ReadonlySet<string>
}

/** Author-disabled skills never count; pins precede the remaining eligible skills. */
export function applyCatalogBudget(
  skills: readonly CatalogSkill[],
  catalog: CatalogSelection,
): Map<string, CatalogState> {
  const states = new Map<string, CatalogState>()
  const eligible: CatalogSkill[] = []
  for (const skill of skills) {
    if (!skill.invocation.modelInvocable) states.set(skill.name, 'disabled')
    else if (catalog.hide.has(skill.name)) states.set(skill.name, 'hidden')
    else eligible.push(skill)
  }
  const ordered = [
    ...eligible.filter(skill => catalog.pin.has(skill.name)),
    ...eligible.filter(skill => !catalog.pin.has(skill.name)),
  ]
  ordered.forEach((skill, index) => {
    states.set(skill.name, catalog.limit === 0 || index < catalog.limit ? 'visible' : 'hidden')
  })
  return states
}
