# Hugging Face playground

[Open Skills Anywhere](https://huggingface.co/spaces/glayguo/dsh-skills-anywhere).

This static Space demonstrates a sample workspace without a model service,
automatic local directory access or a running MCP endpoint. It complements the installed
provider; it does not replace installing the package.

## What is real in the demo

`huggingface/fixture.ts` creates nine authored Markdown files in an isolated
temporary home/project. The actual `SkillsAnywhereProvider` discovers and parses
them. Its report includes seven skills, an identical copy that is dropped,
two plugin names that are disambiguated, repaired frontmatter, an invalid YAML
file, and an author-disabled skill.

No real user skills, directories, environment credentials or Git sources are
discovered. The provider receives explicit temporary `home` / `dshHome`, with
watching, source-file lookup and synchronization disabled. Paths in the public
fixture are portable `~/...` and `project/...` examples. The temporary directory
is removed after the report is built.

The browser imports `src/catalog.ts` and `src/search.ts`, the same pure functions
used by the provider and tools. Discovery results are recorded at build time;
the browser does not reparse uploaded files or run instructions. Search excludes
author-disabled skills but includes skills hidden by the catalog budget or
Hide control. The budget counts skills, not tokens.

The slider uses small values to make the example visible. The installed
provider's default is still 50. Zero means unlimited. Source checkout changes
under Unreleased are not a claim that the npm release already contains them.

## Check your own file

Paste or open one Markdown file (128 KiB maximum) in **How will your skill be
read?** The browser imports the same `src/frontmatter.ts` parser used by the
installed provider, including its bundled YAML parser, and runs both strict
and lenient modes. The directory-name field supplies the fallback name.
Accepted fields, repairs, invocation settings and metadata keys are shown as
plain text. The JSON report includes these diagnostics and source commit,
but omits the raw Markdown body. Descriptions and repair messages may still
contain text from the input, so review the downloaded report before sharing.

The check is explicit and local. Input is not sent over the network, put in
the URL, or written to browser storage. Editing invalidates the previous
result; clearing removes both input and results. It does not scan directories,
resolve referenced files, execute instructions, or certify security or full
specification/client compatibility. In particular, provider strict mode still
accepts some coercions and truncates an overlong description with a warning.

## Reproduce and inspect

From a source checkout:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec playwright install chromium
pnpm run showcase:build
pnpm run showcase:check
```

Open `.dsh-showcase/site/index.html` directly, or serve that directory.
Classic scripts contain the fixture and shared browser logic; there are no
CDN fonts, external scripts, analytics, model calls or runtime data fetches.
The browser check covers desktop/mobile iframes, budget and search semantics,
disabled skills, hash restoration, denied clipboard, download, keyboard tabs,
and direct `file://` use. It captures the social thumbnail from the actual page.

**Download sample workspace** saves a JSON record containing the nine original
Markdown files and the current view. It is a fixture export, not a backup of
the visitor's computer or an installable skill pack.

`workspace.json` includes the provider report. `manifest.json` identifies the
source Git commit, whether the checkout was dirty, and SHA-256 plus byte size
for each managed file. This establishes consistency with a build, not
independent certification. Dirty checkouts can preview the demo but cannot
publish through the deployment helper.

## Publication

CI builds the Space, runs the browser checks and uploads a `huggingface-space`
artifact. After the complete current-main CI run succeeds, the separate
`Hugging Face Space` workflow downloads that exact artifact. It never publishes
a PR artifact and skips a main commit that has already been superseded.

The repository secret `HF_TOKEN` is used only in the publication step.
The publisher validates the static Space card, exact file allowlist, sizes,
hashes and source commit; uploads with a parent-commit guard; then verifies
all eleven Hub objects (including the bundled YAML library's license notice)
and six public app files anonymously. Unexpected files
already in the remote Space are preserved and reported.

On first publication, only an empty Space or the allowed starter files are
accepted. If `index.html` exists, its Git blob must match the exact known
Hugging Face static starter; a customized page or unrelated file is refused.
Later publications require the existing showcase manifest schema.

HF inserts a documented `window.huggingface.variables` script into HTML.
Readback permits only the specific creator-ID assignment; all other bytes
must match. The entry HTML uses ASCII entities because the static service has
previously corrupted a multibyte character at an HTML processing boundary.

To retry a failed publication, use the workflow's manual input with the
successful CI run ID for current main. Publishing does not create or modify
an npm release.

Official references:
[Static Spaces](https://huggingface.co/docs/hub/en/spaces-sdks-static) and
[Space configuration](https://huggingface.co/docs/hub/en/spaces-config-reference).
