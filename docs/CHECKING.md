# Check skills before sharing them

Starting with **0.6.0**, the command line and the
[browser playground](https://huggingface.co/spaces/glayguo/dsh-skills-anywhere)
use the same local parser comparison. Check explicitly named files without
starting an agent, configuring a provider or running any skill instructions:

```sh
npx -y dsh-skills-anywhere@0.6.0 check skills/incident-summary/SKILL.md
npx -y dsh-skills-anywhere@0.6.0 check skills/incident-summary/SKILL.md skills/review.md --json > skill-check.json
```

The default gate uses **strict provider parsing**. Both parsing results are in
the JSON report, so you can also see the changes that lenient mode would make:

```sh
# Accept recoverable frontmatter drift, without modifying the file.
npx -y dsh-skills-anywhere@0.6.0 check skills/incident-summary/SKILL.md --lenient
# Require acceptance with no reported repairs, including description truncation.
npx -y dsh-skills-anywhere@0.6.0 check skills/incident-summary/SKILL.md --fail-on-repair
```

Every report also enumerates what the skill reaches for, whether or not it
passes the parsing gate:

```sh
# Facts only: external sources and declared tools are reported, never judged.
npx -y dsh-skills-anywhere@0.6.0 check skills/incident-summary/SKILL.md
# Policy: fail a skill that reaches a source it does not pin.
npx -y dsh-skills-anywhere@0.6.0 check skills/incident-summary/SKILL.md --require-pinned-sources
```

| Exit | Meaning |
| --- | --- |
| `0` | Every named file passes the selected gate. |
| `1` | At least one file is rejected, or requires a repair forbidden by `--fail-on-repair`. |
| `2` | Missing arguments or at least one unreadable, oversized, non-file or invalid UTF-8 input. |

Every readable input is still checked if another file fails. Input errors take
precedence over parser failures. With `--json`, stdout contains a single report;
save it even when the command exits nonzero. Use `--` before filenames beginning
with a dash. `--cwd` resolves relative paths without discovering a project root.
The CLI does not expand directories or globs: list files explicitly, or let your
shell expand a pattern.

Files must be regular UTF-8 files of at most 128 KiB each. Explicit symlinks to
regular files are followed. For `SKILL.md`, the parent directory supplies the
lenient fallback name; for a flat `review.md`, the fallback is `review`. The
report includes the installed package version, each original input path and
SHA-256 of the bytes actually read.
It has no timestamp, so identical inputs and options produce a stable report.

## Use in GitHub Actions

Choose the skills maintained by your repository:

```yaml
name: Check skills
on: [push, pull_request]
permissions:
  contents: read
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 24
      - run: npx -y dsh-skills-anywhere@0.6.0 check skills/incident-summary/SKILL.md --fail-on-repair --json > skill-check.json
```

Replace the example path with your own. No model key or DeepSeek Harness
installation is required. The first `npx` invocation downloads the published
package; checking after installation is local. Pin the version for repeatable CI.

## External sources and declared tools

A skill that fetches its real instructions at run time is a skill whose reviewed
bytes are not the bytes that will act. Air Security found 17,822 of 142,836 live
skills resting on at least one such source. Every check therefore lists the
hosts the instructions reference, and whether each reference names an immutable
revision — a 40 or 64 character hex path segment — or a name that can serve
different content tomorrow.

Reaching a source is not a failure by default, because whether a given host is
acceptable is a policy this tool has no standing to decide.
`--require-pinned-sources` enforces the part that is objective: what was
reviewed is what will arrive. Unpinned hosts are then listed per file in
`unpinnedSources`.

`allowed-tools` is reported as `declaredTools`. An empty list means the author
declared no narrowing, which is not a statement that the skill is narrow.

This is deliberately an enumeration and not a verdict. OWASP lists Poor Scanning
(AST08) as a risk of its own: Trail of Bits bypassed every public skill scanner
it tested in under an hour, and a tool that answers "clean" mostly produces
false confidence. Each report names the risks it does not speak to in
`notAssessed`, so a pass is not read as a clean bill of health.

## Declared tools travel with the skill

When this project serves a skill installed for one agent to a different one, any
`allowed-tools` the author declared is included with the instructions, both in
`open_skill`'s structured payload as `declared_tools` and as a
`<skill_author_declared_tools>` block in the text.

It is reported, not applied: MCP gives a server no way to restrict a client's
tools. The reason to carry it is that dropping it silently would hand the reader
a skill that looks unrestricted when its author narrowed it — the metadata loss
that makes a skill riskier on its second platform than on its first.

## What the result establishes

This checks the provider's interpretation of frontmatter, invocation settings
and fallback repairs. It does **not** validate scripts, resource links, prompt
safety, complete Agent Skills specification compliance or every client's
behavior. Strict mode retains the provider's numeric/boolean coercions and
description truncation; `--fail-on-repair` rejects reported repairs, not every
coercion. Author-disabled invocation is valid and remains disabled.

The file is not rewritten or uploaded. Reports omit the raw body, but descriptions
can be derived from body paragraphs and YAML errors can quote input lines.
Inspect a report before publishing it. The browser report records the website
source commit; the CLI report wraps the same parser results with file identities
and the selected gate.

### Reviewing source addresses in the browser

The local file checker now shows every referenced HTTP(S) host and URL, plus the author's `allowed-tools` declaration. Strict/lenient parsing remains separate from this review. Nothing is fetched and no client permissions are enforced. Reports also contain the referenced URLs and declared tools; clearing the input removes the displayed results.

`--require-pinned-sources` recognizes HTTPS full-commit file/tree addresses on GitHub and Hugging Face. A hash in an arbitrary path or a `#sha256` fragment is not a verified pin. Queries, credentials, unsupported hosts and unfamiliar layouts remain unverified. An accepted address does not establish that remote bytes, redirects or transitive dependencies were checked.
