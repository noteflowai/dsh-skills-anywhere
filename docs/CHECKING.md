# Check skills before sharing them

Starting with **0.6.0**, the command line and the
[browser playground](https://huggingface.co/spaces/glayguo/dsh-skills-anywhere)
use the same local parser comparison. Check explicitly named files without
starting an agent, configuring a provider or running any skill instructions:

```sh
npx -y dsh-skills-anywhere@0.14.0 check skills/incident-summary/SKILL.md
npx -y dsh-skills-anywhere@0.14.0 check skills/incident-summary/SKILL.md skills/review.md --json > skill-check.json
```

The default gate uses **strict provider parsing**. Both parsing results are in
the JSON report, so you can also see the changes that lenient mode would make:

```sh
# Accept recoverable frontmatter drift, without modifying the file.
npx -y dsh-skills-anywhere@0.14.0 check skills/incident-summary/SKILL.md --lenient
# Require acceptance with no reported repairs, including description truncation.
npx -y dsh-skills-anywhere@0.14.0 check skills/incident-summary/SKILL.md --fail-on-repair
```

Every report also enumerates what the skill reaches for, whether or not it
passes the parsing gate:

```sh
# Facts only: external sources and declared tools are reported, never judged.
npx -y dsh-skills-anywhere@0.14.0 check skills/incident-summary/SKILL.md
# Address gate: reject references without a recognized full-commit URL.
npx -y dsh-skills-anywhere@0.14.0 check skills/incident-summary/SKILL.md --require-pinned-sources
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

From **0.14.0** the repository is also a GitHub Action. It checks every
`SKILL.md` that Git tracks, annotates rejected files and repairs on the pull
request, writes a job summary and saves the JSON report:

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
      - uses: noteflowai/dsh-skills-anywhere@v0.14.0 # pin a full commit SHA for immutable CI
        with:
          fail-on-repair: true
```

| Input | Default | Meaning |
| --- | --- | --- |
| `files` | `**/SKILL.md` | Newline-separated Git pathspec globs. Tracked files and untracked files that are not ignored are selected, so `node_modules` and other ignored paths are skipped. Lines starting with `:` are passed as pathspecs, for example `:(exclude)vendor/**`. |
| `lenient` | `false` | Accept recoverable frontmatter drift (`--lenient`). |
| `fail-on-repair` | `false` | Fail a file that needs any reported repair (`--fail-on-repair`). |
| `require-pinned-sources` | `false` | Fail unpinned external references (`--require-pinned-sources`). |
| `allow-empty` | `false` | Pass when nothing matches. By default an empty selection fails with exit code `2`, so a mistyped pattern cannot pass silently. |
| `report` | `skill-check.json` | Where the JSON report is written. |
| `version` | the tagged release | npm version of the checker to install. |
| `node-version` | `24` | Passed to `actions/setup-node`; set `''` to use the runner's Node.js 22.19+ or 24+. |

Outputs are `report`, `passed`, `failed`, `input-errors` and `exit-code`; the
step exits with the same code as the CLI. Upload the report with
`actions/upload-artifact` if you want to keep it, including after a failure
(`if: always()`).

The action installs the pinned npm package with `--ignore-scripts` and runs it
with Node. It needs no model key, DeepSeek Harness or write permission. Text
taken from a skill (names, repair messages, tool declarations) is escaped before
it becomes an annotation or summary cell, so a file under review cannot issue
workflow commands or render links and images in the job summary.

Without the action, call the CLI directly:

```yaml
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 24
      - run: npx -y dsh-skills-anywhere@0.14.0 check skills/incident-summary/SKILL.md --fail-on-repair --json > skill-check.json
```

No model key or DeepSeek Harness installation is required. The first `npx`
invocation downloads the published package; checking after installation is
local. Pin the version for repeatable CI.

## External sources and declared tools

A skill can reference instructions that will be fetched separately at run time.
Reviewing the local file does not review those remote bytes. Every check lists
the HTTP(S) hosts and URLs found in the body, and whether each address matches a
supported GitHub or Hugging Face layout with a full 40-character commit ID in
the expected position. Other layouts remain unverified; a hash-shaped segment
on an arbitrary host or a digest fragment alone is insufficient.

Reaching a source is not a failure by default, because whether a given host is
acceptable is a policy this tool has no standing to decide.
`--require-pinned-sources` rejects references without a recognized commit-address
format. Hosts with at least one such reference are listed per file in
`unpinnedSources`. The checker does not fetch remote files, verify their bytes
against a trusted digest, follow redirects or inspect transitive dependencies.
Passing this address gate does not establish that reviewed bytes will arrive.

`allowed-tools` is reported as `declaredTools`. An empty list means the author
declared no narrowing, which is not a statement that the skill is narrow.

This is deliberately an enumeration and not a verdict. OWASP lists Poor Scanning
(AST08) as a risk of its own: Trail of Bits bypassed every public skill scanner
it tested in under an hour, and a tool that answers "clean" mostly produces
false confidence. Each report names the risks it does not speak to in
`notAssessed`, so a pass is not read as a clean bill of health.

## Hidden characters

Text a reviewer cannot see can still reach the model. Every check lists, for the
whole file including frontmatter, the invisible and direction-changing
characters it finds as `hiddenCharacters`, each with its code point, Unicode
name, kind, count and up to 20 line numbers:

- `bidi-control`: embeddings, overrides, isolates and marks that reorder how a
  line is displayed (Trojan Source, CVE-2021-42574).
- `zero-width`: zero-width spaces and joiners, word joiners and a byte order
  mark that is not at the start of the file.
- `tag`: the U+E0000..U+E007F tag block, which mirrors ASCII invisibly and has
  been used to smuggle instructions into agent skills.
- `variation-selector`: the U+E0100..U+E01EF supplement, which can carry
  encoded bytes after an ordinary character.
- `invisible-format`: soft hyphens, fillers and invisible math operators.

A leading byte order mark, the joiners inside emoji sequences and the tag
letters of subdivision flags are ordinary text and are not listed. The list is
reported even when the frontmatter cannot be parsed. As with sources, listing is
not a verdict: right-to-left marks are normal in Arabic or Hebrew prose.
`--fail-on-hidden-characters` turns the list into a gate:

```sh
npx -y dsh-skills-anywhere@0.14.0 check skills/incident-summary/SKILL.md --fail-on-hidden-characters
```

## Declared tools travel with the skill

When this project serves a skill installed for one agent to a different one, any
`allowed-tools` the author declared is included with the instructions, both in
`open_skill`'s structured payload as `declared_tools` and as a
`<skill_author_declared_tools>` block in the text.

This server reports the declaration; the receiving client must decide whether
and how to enforce it. Serving metadata over MCP does not itself apply a policy
to that client's other tools. Dropping it silently would hand the reader
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
