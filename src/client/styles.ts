/**
 * Inline styles for the card. The dsh shell exposes its theme as CSS custom
 * properties (`--dsw-alias-*`), so the card follows light and dark themes
 * without shipping a stylesheet.
 */
import type { CSSProperties } from 'react'

const label = 'var(--dsw-alias-label-primary)'
const secondary = 'var(--dsw-alias-label-secondary)'
const tertiary = 'var(--dsw-alias-label-tertiary)'
const border = 'var(--dsw-alias-border-l2)'
const brand = 'var(--dsw-alias-brand-primary)'
const error = 'var(--dsw-alias-label-error)'
const layer = 'var(--dsw-alias-bg-layer-3)'

export const styles = {
  card: { listStyle: 'none', border: `1px solid ${border}`, borderRadius: 10, marginBottom: 8, background: layer, color: label } satisfies CSSProperties,
  header: { display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '12px 14px', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', textAlign: 'left', font: 'inherit' } satisfies CSSProperties,
  headText: { display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 } satisfies CSSProperties,
  name: { fontWeight: 600, fontSize: 14 } satisfies CSSProperties,
  description: { color: tertiary, fontSize: 12, lineHeight: 1.4 } satisfies CSSProperties,
  chevron: { color: tertiary, fontSize: 12, transition: 'transform .15s' } satisfies CSSProperties,
  body: { padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 12 } satisfies CSSProperties,
  status: { color: tertiary, fontSize: 12, margin: 0 } satisfies CSSProperties,
  errorText: { color: error, fontSize: 12, margin: 0 } satisfies CSSProperties,
  row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } satisfies CSSProperties,
  input: { font: 'inherit', fontSize: 13, color: label, background: 'transparent', border: `1px solid ${border}`, borderRadius: 6, padding: '5px 8px', minWidth: 0 } satisfies CSSProperties,
  search: { flex: 1, minWidth: 180 } satisfies CSSProperties,
  limitInput: { width: 72, textAlign: 'right' } satisfies CSSProperties,
  hint: { color: tertiary, fontSize: 12 } satisfies CSSProperties,
  group: { margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 } satisfies CSSProperties,
  groupTitle: { color: secondary, fontSize: 12, fontWeight: 600, margin: '8px 0 4px', textTransform: 'uppercase', letterSpacing: '.04em' } satisfies CSSProperties,
  skill: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '2px 12px', alignItems: 'center', padding: '6px 8px', borderRadius: 6, border: `1px solid transparent` } satisfies CSSProperties,
  skillHidden: { opacity: 0.7 } satisfies CSSProperties,
  skillName: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } satisfies CSSProperties,
  skillMeta: { gridColumn: '1 / 2', color: tertiary, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } satisfies CSSProperties,
  actions: { gridColumn: '2 / 3', gridRow: '1 / 3', display: 'flex', gap: 6 } satisfies CSSProperties,
  tag: { fontSize: 11, lineHeight: '16px', padding: '0 6px', borderRadius: 999, border: `1px solid ${border}`, color: secondary, whiteSpace: 'nowrap' } satisfies CSSProperties,
  tagOn: { borderColor: brand, color: brand } satisfies CSSProperties,
  tagOff: { color: tertiary } satisfies CSSProperties,
  button: { font: 'inherit', fontSize: 12, color: label, background: 'transparent', border: `1px solid ${border}`, borderRadius: 6, padding: '3px 8px', cursor: 'pointer' } satisfies CSSProperties,
  buttonActive: { borderColor: brand, color: brand } satisfies CSSProperties,
  buttonDisabled: { opacity: 0.5, cursor: 'default' } satisfies CSSProperties,
  details: { color: tertiary, fontSize: 12 } satisfies CSSProperties,
  mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } satisfies CSSProperties,
} as const
