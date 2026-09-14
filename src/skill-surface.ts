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
   * True when every reference to this host names an immutable revision, so the
   * bytes fetched later are the bytes reviewed now. Pinning is what separates a
   * reference from a standing invitation to change the instructions (AST07).
   */
  readonly pinned: boolean
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
 * A 40 or 64 character hex path segment is a git object or a digest. A branch
 * name, a `latest` tag or a bare host is not: the same URL can serve different
 * instructions tomorrow.
 */
function isPinned(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  const segments = parsed.pathname.split('/').filter(segment => segment.length > 0)
  return segments.some(segment => /^[a-f0-9]{40}$|^[a-f0-9]{64}$/i.test(segment))
    || /^sha256[:-][a-f0-9]{64}$/i.test(parsed.hash.replace(/^#/, ''))
}

/**
 * Read the reachable surface of a skill body.
 *
 * Bounded and local: no request is made, nothing is resolved, and the body is
 * scanned once. Callers get the same answer offline as online, which is what
 * makes the result usable in CI.
 */
export function readSkillSurface(body: string, declaredTools: readonly string[] = []): SkillSurface {
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
    notAssessed: [
      'AST01 Malicious Skills: no verdict on intent; reading a file cannot establish it.',
      'AST08 Poor Scanning: this enumerates sources and declarations, and does not pattern-match for payloads.',
      'AST06 Weak Isolation: a property of how the agent runs, not of the file.',
    ],
  }
}
