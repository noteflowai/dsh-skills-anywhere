# Publication receipt · 2026-09-15 outreach

## Scope correction after submission

The existing OWASP #83 body was corrected and read back on 2026-09-15.
`pinned` means a recognized revision-address format in this checker; it does not
verify remote bytes, commit existence, redirects or client permission enforcement.
The upstream README directs current v1 document review to its Google document;
no comment there is claimed. See the [reviewed contribution](owasp-ast10-contribution.md).

The publication account below records the earlier external submission. It is
retained as history, rather than evidence that every original interpretation was
correct. Its X thread is a separate external publication and was not edited by
this scope correction.

## Original publication record

Recorded for the maintainer. Every action below was carried out by an assistant on the
maintainer's explicit instruction, and every claim in the submitted text was reproduced before
being written down. No acceptance, review or endorsement by any third party is claimed.

## What was submitted

| Channel | Reference | State at submission |
| --- | --- | --- |
| OWASP Agentic Skills Top 10 | [issue #83](https://github.com/OWASP/www-project-agentic-skills-top-10/issues/83) | Open, no comments |
| X thread, `@glay_oneai` | [status 2099745359224578381](https://x.com/glay_oneai/status/2099745359224578381) | Lead post plus four replies, all read back |

The OWASP issue is a mitigation enhancement and research contribution, not a project
announcement. It asks for nothing to be listed or linked, and offers the implementation for
reuse. It cross-references existing issues #63 and #70 to show it is complementary rather than
duplicating them: those concern pinning the installed package and the signing scope of the
format's integrity fields, while this concerns the address an external instruction source is
fetched from at run time.

Draft kept at [`owasp-ast10-contribution.md`](owasp-ast10-contribution.md); the submitted text
follows the project's own contribution template.

## What it says, and what backs it

Three parts, the first of which is this project's own mistake.

1. **AST05/AST07 wording.** This project treated any URL containing a 40 or 64 character hex path
   segment, or a `#sha256:` fragment, as pinned. A hash-shaped string in a URL does not constrain
   what a server returns; only a host that resolves the address by content does. Corrected in
   [#39](https://github.com/noteflowai/dsh-skills-anywhere/pull/39), and proposed as sharper
   wording because the current guidance invites the same error.
2. **AST10 case study.** `allowed-tools` was parsed and then dropped at the MCP exit, so a skill
   its author had narrowed arrived looking unrestricted. MCP offers a server no way to enforce a
   tool restriction, so the loss had to be made visible rather than prevented.
3. **AST08 consequence.** The checker enumerates and returns no verdict, and every report names
   the risks it does not speak to.

Reproduced from the published npm package before submission, with no network access:

| Reference in the fixture | Reported |
| --- | --- |
| `raw.githubusercontent.com/acme/t/<40-hex>/n.md` | pinned |
| `huggingface.co/datasets/acme/t/resolve/<40-hex>/n.md` | pinned |
| `evil.example.com/<same 40-hex>/n.md` | not pinned |
| `docs.example.com/t.md#sha256:<64-hex>` | not pinned |

`--require-pinned-sources` exited 1 and named the two unpinned hosts. The tool-declaration test
passed. Every report's `notAssessed` list named AST01, AST06 and AST08.

## The X thread

Deliberately not another launch post: the account already carries one, and repeating it adds
nothing. The thread is finding-led, with one post per finding and the shared observation that
each project's own green number was hiding something.

Each post's length was checked against the limit before anything was sent, the composer contents
were verified against the intended text before each submission, and the published thread was read
back afterwards. Posting ran against a copy of the maintainer's Chrome profile so the live profile
was never locked or written to, and the copy was deleted afterwards.

Two of the four posts describe errors this project shipped, which is the honest shape of the
week and the reason the thread is worth reading at all.

## Not done

- No PyPI publication. The Python projects' own release records state that PyPI publishing is
  deliberately not enabled, and that is a maintainer decision, not something to reverse in
  passing.
- No reminder comments on the open 科技爱好者周刊 and HelloGitHub submissions. They are in an
  editorial queue; chasing would reduce the chance of being picked up.
- No duplicate issues. If the OWASP maintainers prefer a pull request or a comment in the v1
  review document, the issue says so and asks to be redirected rather than repeated.
