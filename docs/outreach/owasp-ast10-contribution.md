# Draft contribution to OWASP Agentic Skills Top 10

**Status: not submitted.** Prepared for the maintainer to review and send. The project page
invites contributions of mitigation case studies and of tooling, and its v1 draft is in public
review, so this is written as a contribution to that draft rather than as a project
announcement. Nothing here claims acceptance, review or endorsement by OWASP.

Target: <https://github.com/OWASP/www-project-agentic-skills-top-10> (issues enabled, 16 open
at the time of writing). Relevant risks: AST05 Untrusted External Instructions, AST10
Cross-Platform Reuse, and the caution in AST08 Poor Scanning.

---

## Suggested title

Content pinning is easy to implement wrongly: a hash in a URL is not a constraint

## Suggested body

Maintainer disclosure: I maintain `dsh-skills-anywhere`, an independent MIT-licensed community
project developed with AI assistance, which reads Agent Skills installed for one agent and
serves them to others. This note was prepared by an assistant on the maintainer's behalf. I am
not affiliated with OWASP and claim no review or endorsement. I am raising three things that
came out of implementing your mitigations against a real tool, one of which is a mistake we
shipped and had to correct.

### 1. "Content pinning" needs a sharper definition to be checkable

AST05 and AST07 both list content pinning as a mitigation. Implementing it, we got it wrong in
the obvious way first: we treated any URL containing a 40 or 64 character hex path segment, or
a `#sha256:` fragment, as pinned. That is wrong, and the reason is worth stating in the
guidance itself: **a hash-shaped string in a URL does not constrain what the server returns.**
`https://example.com/1b8a1cf.../notes.md` is pinned only if that host resolves the path by
content, and most hosts do not.

Pinning is only checkable offline for host layouts that are content-addressed by construction,
such as `raw.githubusercontent.com/<owner>/<repo>/<full-commit>/…` or a Hugging Face
`resolve/<revision>/…` path. Everything else is unverified, and saying so is more useful than
a green tick. Our corrected implementation now reports exactly that distinction: recognised
content-addressed layouts count as pinned, and a hash-shaped path on an arbitrary host does
not.

Suggested wording for the mitigation, if useful: *pin external sources to an address the host
resolves by content, such as a full commit or revision. A digest embedded in a URL or fragment
is not a pin unless the host honours it.*

### 2. An AST10 case study, with the resolution

AST10 describes safety metadata being lost when a skill is ported across platforms, and the
project ships a metadata loss simulator for it. Here is a measured instance in shipping code,
including our own.

A skill author writes `allowed-tools: Read Grep` in a `SKILL.md`. The origin agent enforces
that restriction. Our tool reads that same file and serves it to a different agent over MCP.
It parsed `allowed-tools` into its metadata and then never read it again: the payload it
returned carried the name, provider, resource base and instructions, and not the restriction.
The receiving agent got a skill that looked unrestricted when its author had narrowed it. We
verified this against a real stdio session before changing anything: the declaration was
absent from both the search and the load responses.

The part worth generalising is the fix. MCP gives a server no way to restrict a client's
tools, so enforcement was not available. Reporting was. The declaration now travels with the
instructions, in the structured payload and as a text block that says in as many words that
the server cannot restrict the reader's tools. The point is that **the loss must be visible
even where it cannot be prevented**, because a reader who is never told has no way to know the
author asked for less.

If a "what to do when you cannot enforce" line would help AST10's mitigation section, that is
the shape we landed on: carry the declaration, state who enforces it, and do not imply
enforcement you do not perform.

### 3. A source enumerator that deliberately returns no verdict

AST08 says pattern-matching scanners mostly produce false confidence, and that every public
skill scanner Trail of Bits tested was bypassed in under an hour. We took that as a constraint
rather than a warning to ignore, so the checker in this project enumerates and does not
adjudicate: for a given `SKILL.md` it lists the hosts the instructions reference, whether each
reference is pinned in the sense above, and the tools the author declared. It returns no
opinion on intent and does no payload matching, and each report names the risks it does not
speak to, so a pass cannot be read as clean.

Reaching an external source is not treated as a failure by default, because whether a given
host is acceptable is a policy the tool has no standing to decide. An opt-in flag fails a
skill that reaches a source it does not pin, which is the part that is objective: what was
reviewed is what will arrive.

Scope, stated plainly: this is a parser and source enumerator, not a security audit, not a
malware scanner, and not a judgement about any skill's intent. It reads only files it is
pointed at, makes no network request, and executes nothing.

Sources and code: [checking guide][checking], [source enumerator][surface],
[repository][repo]. All MIT licensed, and reusable in the project's own tooling if any of it
is useful.

[checking]: https://github.com/noteflowai/dsh-skills-anywhere/blob/main/docs/CHECKING.md
[surface]: https://github.com/noteflowai/dsh-skills-anywhere/blob/main/src/skill-surface.ts
[repo]: https://github.com/noteflowai/dsh-skills-anywhere

---

## Verification behind the claims above

Each statement is reproducible from the published package rather than from this document.

| Claim | How it was checked |
| --- | --- |
| A hash-shaped path on an arbitrary host is not treated as pinned | `check` on a fixture referencing `evil.example.com/<40-hex>/n.md` reports it not pinned, while a `raw.githubusercontent.com` full-commit URL and a Hugging Face `resolve/<revision>` URL report pinned |
| A digest fragment alone is not a pin | The same fixture's `#sha256:…` URL reports not pinned |
| The opt-in gate fails on an unpinned source | `--require-pinned-sources` exits 1 on that fixture and lists the unpinned hosts |
| The tool-declaration loss was real before the fix | A real MCP stdio session against the server showed `allowed-tools` absent from both `find_skills` and `open_skill` |
| The declaration now travels | The same session shows `declared_tools` in the structured payload and a `<skill_author_declared_tools>` block in the text |
| No verdict is returned | Every report carries a `notAssessed` list naming AST01, AST06 and AST08 as out of scope |

## What this deliberately does not do

- It does not ask OWASP to list, link or endorse the project.
- It does not claim the tool detects malicious skills, and says the opposite.
- It opens one issue. If the maintainers would rather have this as a pull request against the
  AST05/AST10 pages or as a comment in the v1 review document, that is a better fit and this
  should be redirected there instead of duplicated.
