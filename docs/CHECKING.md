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
