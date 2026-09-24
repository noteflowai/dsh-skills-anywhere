/**
 * Enumerate what a skill reaches for, without judging whether it is malicious.
 *
 * The OWASP Agentic Skills Top 10 lists Poor Scanning (AST08) as a risk in its
 * own right: every public skill scanner Trail of Bits tested was bypassed in
 * under an hour, and a pattern matcher that returns a verdict mostly produces
 * false confidence. So this returns facts a reviewer can act on and refuses to
 * return a verdict.
 *
 * The facts worth having are the ones a reviewer cannot get by reading the file
 * once: where the instructions come from, and how wide a tool scope the author
 * asked for. A skill whose real instructions arrive from a URL at run time is a
 * skill whose reviewed bytes are not the bytes that will act (AST05); Air
 * Security found 17,822 of 142,836 live skills resting on at least one such
 * source. A skill that declares nothing has declared no narrowing, which is not
 * the same as being narrow (AST03).
 */

/** A host the skill body points at, with the references that named it. */
export interface ExternalSource {
  readonly host: string
  readonly urls: readonly string[]
  /**
   * True when every reference uses a recognized full-commit URL layout.
   * This is an offline address check; no remote bytes or redirects are verified.
   */
  readonly pinned: boolean
}

/**
 * Invisible or direction-changing characters, grouped by code point (or by
 * block for tag characters and supplementary variation selectors).
 *
 * They render as nothing, or reorder what is shown, in editors, diffs and web
 * views, so a reviewer reading the file does not see what the model will read.
 * Tag characters can spell a whole hidden instruction ("ASCII smuggling");
 * bidirectional controls can make reviewed text differ from parsed text
 * (Trojan Source, CVE-2021-42574). Listing them is a fact, not a verdict:
 * zero-width joiners and non-joiners are ordinary in some scripts.
 */
export interface HiddenCharacter {
  /** `U+202E`, or a range such as `U+E0000..U+E007F` for a grouped block. */
  readonly codePoint: string
  readonly name: string
  readonly kind: 'bidi-control' | 'zero-width' | 'tag' | 'variation-selector' | 'invisible-format'
  readonly count: number
  /** First distinct 1-based line numbers, at most 20. */
  readonly lines: readonly number[]
}

export interface SkillSurface {
  readonly schema: 'skills-anywhere-surface-1'
  /**
   * Hosts referenced by the instructions, deduplicated and sorted.
   *
   * Whether the agent fetches any of these depends on the instructions and on
   * the client's tools, which cannot be settled by reading the file. They are
   * reported as reachable, not as fetched.
   */
  readonly externalSources: readonly ExternalSource[]
  /** Tools declared through `allowed-tools`, or an empty list when none were. */
  readonly declaredTools: readonly string[]
  /** Hidden characters anywhere in the file, frontmatter included, sorted by code point. */
  readonly hiddenCharacters: readonly HiddenCharacter[]
  /**
   * Risks this report does not speak to, so a passing report is not mistaken
   * for a clean bill of health.
   */
  readonly notAssessed: readonly string[]
}

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`)\]}]+/gi

/** Trailing punctuation belongs to the prose, not to the URL. */
function trimPunctuation(url: string): string {
  return url.replace(/[.,;:!?]+$/, '')
}

/**
 * Whether a reference names an immutable revision.
 *
 * Only recognize commit positions on known source hosts. A random hex segment
 * or a digest fragment on an arbitrary host does not constrain the response.
 * Fragments are not even sent to an HTTP server. Queries can change routing.
 */
function isPinned(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.search) return false
  const segments = parsed.pathname.split('/').slice(1)
  const commit = (value: string | undefined) => /^[a-f0-9]{40}$/i.test(value ?? '')
  const file = (start: number) => segments.length > start && segments.slice(start).every(Boolean)
  if (parsed.hostname === 'raw.githubusercontent.com') {
    return !!segments[0] && !!segments[1] && commit(segments[2]) && file(3)
  }
  if (parsed.hostname === 'github.com') {
    return !!segments[0] && !!segments[1] && ['blob', 'raw', 'tree'].includes(segments[2] ?? '')
      && commit(segments[3]) && file(4)
  }
  if (parsed.hostname === 'huggingface.co') {
    const offset = ['datasets', 'spaces'].includes(segments[0] ?? '') ? 1 : 0
    return !!segments[offset] && !!segments[offset + 1]
      && ['resolve', 'blob'].includes(segments[offset + 2] ?? '')
      && commit(segments[offset + 3]) && file(offset + 4)
  }
  return false
}

const NAMED: ReadonlyMap<number, readonly [HiddenCharacter['kind'], string]> = new Map([
  [0x061C, ['bidi-control', 'ARABIC LETTER MARK']],
  [0x200E, ['bidi-control', 'LEFT-TO-RIGHT MARK']],
  [0x200F, ['bidi-control', 'RIGHT-TO-LEFT MARK']],
  [0x202A, ['bidi-control', 'LEFT-TO-RIGHT EMBEDDING']],
  [0x202B, ['bidi-control', 'RIGHT-TO-LEFT EMBEDDING']],
  [0x202C, ['bidi-control', 'POP DIRECTIONAL FORMATTING']],
  [0x202D, ['bidi-control', 'LEFT-TO-RIGHT OVERRIDE']],
  [0x202E, ['bidi-control', 'RIGHT-TO-LEFT OVERRIDE']],
  [0x2066, ['bidi-control', 'LEFT-TO-RIGHT ISOLATE']],
  [0x2067, ['bidi-control', 'RIGHT-TO-LEFT ISOLATE']],
  [0x2068, ['bidi-control', 'FIRST STRONG ISOLATE']],
  [0x2069, ['bidi-control', 'POP DIRECTIONAL ISOLATE']],
  [0x180E, ['zero-width', 'MONGOLIAN VOWEL SEPARATOR']],
  [0x200B, ['zero-width', 'ZERO WIDTH SPACE']],
  [0x200C, ['zero-width', 'ZERO WIDTH NON-JOINER']],
  [0x200D, ['zero-width', 'ZERO WIDTH JOINER']],
  [0x2060, ['zero-width', 'WORD JOINER']],
  [0xFEFF, ['zero-width', 'ZERO WIDTH NO-BREAK SPACE']],
  [0x00AD, ['invisible-format', 'SOFT HYPHEN']],
  [0x034F, ['invisible-format', 'COMBINING GRAPHEME JOINER']],
  [0x115F, ['invisible-format', 'HANGUL CHOSEONG FILLER']],
  [0x1160, ['invisible-format', 'HANGUL JUNGSEONG FILLER']],
  [0x2061, ['invisible-format', 'FUNCTION APPLICATION']],
  [0x2062, ['invisible-format', 'INVISIBLE TIMES']],
  [0x2063, ['invisible-format', 'INVISIBLE SEPARATOR']],
  [0x2064, ['invisible-format', 'INVISIBLE PLUS']],
  [0x3164, ['invisible-format', 'HANGUL FILLER']],
  [0xFFA0, ['invisible-format', 'HALFWIDTH HANGUL FILLER']],
])

/** Combining marks (U+034F, the supplement selectors) sit outside the first class so they cannot pair with a neighbour. */
const HIDDEN_PATTERN = /[\u00AD\u061C\u115F\u1160\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\u3164\uFEFF\uFFA0\u{E0000}-\u{E007F}]|\u034F|[\u{E0100}-\u{E01EF}]/gu
/** A joiner between two pictographs is part of an emoji sequence, such as a profession or family. */
const EMOJI_JOINER = /(?<=\p{Extended_Pictographic}\uFE0F?)\u200D(?=\p{Extended_Pictographic})/gu
/** Subdivision flags (England, Scotland, Wales) are a black flag followed by tag letters and a cancel tag. */
const FLAG_TAGS = /(?<=\u{1F3F4})[\u{E0030}-\u{E0039}\u{E0061}-\u{E007A}]{2,6}\u{E007F}/gu
const MAX_LINES = 20

function classify(code: number): readonly [string, HiddenCharacter['kind'], string] {
  if (code >= 0xE0000 && code <= 0xE007F) return ['U+E0000..U+E007F', 'tag', 'TAG CHARACTERS']
  if (code >= 0xE0100) return ['U+E0100..U+E01EF', 'variation-selector', 'VARIATION SELECTORS SUPPLEMENT']
  const [kind, name] = NAMED.get(code)!
  return [`U+${code.toString(16).toUpperCase().padStart(4, '0')}`, kind, name]
}

/**
 * List invisible and direction-changing characters in the whole file.
 *
 * A leading byte order mark, joiners inside emoji sequences and the tags of
 * subdivision flags are ordinary encoding and are not listed. Everything else
 * is, including joiners that some scripts use legitimately.
 */
export function readHiddenCharacters(raw: string): HiddenCharacter[] {
  // Blank out the ordinary uses with a same-length placeholder so offsets and lines stay put.
  const text = raw.replace(/^\uFEFF/, ' ')
    .replace(EMOJI_JOINER, ' ')
    .replace(FLAG_TAGS, match => ' '.repeat(match.length))
  const found = new Map<string, { kind: HiddenCharacter['kind']; name: string; sort: number; count: number; lines: number[] }>()
  let line = 1
  let scanned = 0
  for (const match of text.matchAll(HIDDEN_PATTERN)) {
    for (let index = scanned; index < match.index; index++) if (text.charCodeAt(index) === 10) line++
    scanned = match.index
    const code = match[0].codePointAt(0)!
    const [codePoint, kind, name] = classify(code)
    const entry = found.get(codePoint) ?? { kind, name, sort: code >= 0xE0000 ? code & 0xFFF00 : code, count: 0, lines: [] }
    entry.count++
    if (entry.lines.length < MAX_LINES && entry.lines.at(-1) !== line) entry.lines.push(line)
    found.set(codePoint, entry)
  }
  return [...found.entries()]
    .toSorted(([, left], [, right]) => left.sort - right.sort)
    .map(([codePoint, { kind, name, count, lines }]) => ({ codePoint, name, kind, count, lines }))
}

/**
 * Read the reachable surface of a skill body.
 *
 * Bounded and local: no request is made, nothing is resolved, and the body is
 * scanned once. Callers get the same answer offline as online, which is what
 * makes the result usable in CI.
 */
export function readSkillSurface(body: string, declaredTools: readonly string[] = [], raw: string = body): SkillSurface {
  const byHost = new Map<string, { urls: Set<string>; pinned: boolean }>()
  for (const match of body.matchAll(URL_PATTERN)) {
    const url = trimPunctuation(match[0])
    let host: string
    try {
      host = new URL(url).host.toLowerCase()
    } catch {
      continue
    }
    if (host.length === 0) continue
    const entry = byHost.get(host) ?? { urls: new Set<string>(), pinned: true }
    entry.urls.add(url)
    // One floating reference is enough to make the host's content mutable.
    entry.pinned = entry.pinned && isPinned(url)
    byHost.set(host, entry)
  }
  const externalSources = [...byHost.entries()]
    .map(([host, entry]) => ({ host, urls: [...entry.urls].toSorted(), pinned: entry.pinned }))
    .toSorted((left, right) => left.host.localeCompare(right.host))
  return {
    schema: 'skills-anywhere-surface-1',
    externalSources,
    declaredTools: [...declaredTools],
    hiddenCharacters: readHiddenCharacters(raw),
    notAssessed: [
      'AST01 Malicious Skills: no verdict on intent; reading a file cannot establish it.',
      'AST08 Poor Scanning: this enumerates sources, declarations and hidden characters, and does not pattern-match for payloads.',
      'AST06 Weak Isolation: a property of how the agent runs, not of the file.',
    ],
  }
}
