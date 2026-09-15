# OWASP contribution: source-address checks and declared tools

**Submission exists:** [OWASP issue #83](https://github.com/OWASP/www-project-agentic-skills-top-10/issues/83).
The original [publication receipt](publication-2026-09-15.md) is retained.
The text below records the
reviewed contribution; submission does not establish acceptance or endorsement.

The upstream README now directs v1 document-review comments to its
[Google review document](https://docs.google.com/document/d/1A5d2OnT8h8oZo7MSde4TOT3sg3AkXJgTGQwVrAga1aE/edit?tab=t.0).
Correct the existing issue rather than open another issue or a parallel PR.
If maintainers request a move, use their review channel and retain the original
link as history. No comment in the Google document is claimed here.

## Reviewed contribution

Maintainer disclosure: I maintain `dsh-skills-anywhere`, an independent
MIT-licensed project developed with AI assistance. This note was prepared by an
assistant on my behalf. I am not affiliated with OWASP.

### AST05: distinguish address recognition from content verification

While implementing source reporting, we incorrectly treated arbitrary 40- or
64-character hexadecimal path segments, or a `#sha256` fragment, as evidence of
pinning. [PR #39](https://github.com/noteflowai/dsh-skills-anywhere/pull/39)
corrected that classifier.

Version 0.11.0 recognizes supported HTTPS GitHub and Hugging Face URL layouts
with a full 40-character commit ID in the expected position. It does this
offline. The `pinned` field means **recognized revision-address format** in
this report; it does not verify the referenced commit exists or authenticate
the bytes a server would return.

An arbitrary hash-shaped path is not evidence of content verification. A digest
fragment is not transmitted in an HTTP request; a separate client could
interpret and verify such a digest, but this checker does not.

Suggested mitigation wording:

> Record the revision and a trusted expected digest for reviewed external
> content. A full-commit source address helps identify the intended revision.
> Verify fetched bytes against the expected digest before use, and state the
> handling of redirects and transitive sources. Report URL-format recognition
> separately from content verification; a hash-looking URL alone proves neither
> byte integrity nor source trust.

This suggestion concerns external instruction references under AST05. It does
not equate that address check with AST07's package-integrity mitigation. The
upstream README already recommends verifying pinned content on every load;
this case study illustrates why a report must say which stage it actually ran.

Our `--require-pinned-sources` option enforces only the address-format gate. It
does not fetch content, verify digests, authenticate publishers, follow
redirects, or inspect transitive dependencies.

### AST10: preserve a declaration without implying enforcement

An author may declare `allowed-tools: Read Grep`. Whether the originating agent
enforces that declaration depends on that agent; this note does not establish
its behavior.

Our MCP adapter previously parsed that field but omitted it from its search and
load responses. The corrected adapter carries `declared_tools` in structured
output and a `<skill_author_declared_tools>` text block. It also explains that
this server does not apply tool restrictions to the receiving client.

The reusable mitigation is to preserve the declaration across a platform hop,
state whether enforcement was checked, and identify the component responsible
for applying it. Metadata transport alone is not permission enforcement.

### AST08: keep source inventory separate from a verdict

The checker lists referenced addresses and author-declared tools. It returns no
verdict on intent or malicious behavior. Unsupported address formats remain
unverified, rather than being classified as malicious or necessarily mutable.
An empty tool declaration is not evidence of restricted behavior.

## Reproduction

Install the versioned package first; `npx` may download it. The installed
checker then reads local files without fetching any referenced URL:

```sh
npx -y dsh-skills-anywhere@0.11.0 check path/to/SKILL.md --json
npx -y dsh-skills-anywhere@0.11.0 check path/to/SKILL.md --require-pinned-sources
```

For a syntactically valid skill containing these references:

| Reference shape | `pinned` field |
| --- | --- |
| `raw.githubusercontent.com/acme/t/<40-hex>/n.md` over HTTPS | `true`: recognized address format |
| `huggingface.co/datasets/acme/t/resolve/<40-hex>/n.md` over HTTPS | `true`: recognized address format |
| `evil.example.com/<same-40-hex>/n.md` | `false`: unsupported host/layout |
| `docs.example.com/t.md#sha256:<64-hex>` | `false`: fragment is insufficient |

The opt-in gate exits 1 on this fixture. None of these results establishes
whether a remote file exists or what bytes it would return.

See [CHECKING.md](../CHECKING.md) and the
[source enumerator](../../src/skill-surface.ts) for the exact scope.
