# Changelog

## 0.15.0

- Check local Markdown resources with `check --resources`; use `--fail-on-resource-issues` for an explicit CLI/Action gate.
- Check browser-selected skill folders locally and download line-level reports.
- Publish three licensed, commit-pinned public skill snapshots with hash-verified, reproducible full-folder and SKILL.md-only controls.

## Unreleased

## 0.14.0 — 2026-09-25

- Add a GitHub Action: `uses: noteflowai/dsh-skills-anywhere@<tag>` checks every tracked `SKILL.md` (or the Git pathspecs in `files`) with the same strict gate as `check`, annotates rejected files, required repairs and unpinned sources, writes a job summary and a JSON report, and exposes counts and the exit code as outputs. Skill-derived text is escaped before it reaches workflow commands or the summary. An empty selection fails unless `allow-empty` is set.
- Keep the `npx` pins in both READMEs and `docs/CHECKING.md` in step with the release through `scripts/sync-version.mjs`; they had fallen behind at 0.12.0 and 0.11.0.
- Serve the shared `.agents/skills` and `~/.agents/skills` from the standalone MCP server, at dsh's own ranks for them (200 and 500). They are the default skill location for Codex, Amp, Goose, Zed and Letta Code, but were deliberately skipped because dsh's built-in provider reads them; over MCP nothing else did, so a Claude Code user never saw skills installed there. Inside dsh the plugin still leaves them to the built-in provider. New `sharedDirs` option; `excludeAgents: ['agents']` also turns them off. `agents` lists the row and whether it exists.
- Add documented skill directories: Cline project `.cline/skills` and `.clinerules/skills`, Droid (Factory) project `.factory/skills`, Kimi CLI `.kimi/skills` (project and user) and Letta Code `~/.letta/skills`.
- List invisible and direction-changing characters (bidi controls, zero-width characters, Unicode tag characters and supplementary variation selectors) in every `check` report as `hiddenCharacters`, with code point, name, count and lines. Add `--fail-on-hidden-characters` to reject files that contain them. Leading byte order marks, emoji joiners and subdivision-flag tags are not listed.
- The GitHub Action takes `fail-on-hidden-characters` and annotates each listed hidden character at its first line, as a warning or, with the input set, an error. Its `version` input also accepts an `npm pack` tarball path, which CI now uses so the action is tested against the checkout rather than the last npm release.

## 0.13.0 — 2026-09-25

- Scan the project-level skill directories that Cursor (`.cursor/skills`), Gemini CLI (`.gemini/skills`), GitHub Copilot (`.github/skills`) and OpenCode (`.opencode/skills`) document, in addition to their user directories. Skills there now appear as `anywhere-project` at rank 250; `excludeAgents` still skips them per agent.
- Verify each npm release by waiting for the public version and comparing its integrity and downloaded bytes with the GitHub release archive. Add a manual workflow that registers an already published version in the MCP registry without republishing it.
- Add an isolated Funes MCP handoff example for one selected public session, require reviewed skill pins when the skill-impact bridge opens a handoff session, and add behavior-lab fixtures with recorded runtime reviews.
- Rework both READMEs and the Hugging Face page to lead with skill workflows and separate directory coverage, tested client connections and measured outcomes. Keep Python caches out of the Space source identity.

## 0.12.1 — 2026-09-19

- Align package, MCP registry and plugin descriptions with configured-directory discovery and skill delivery.
- Distinguish directory coverage, tested client connections and instruction following in both READMEs and the playground.
- This release updates public descriptions and documentation; skill discovery and MCP behavior are unchanged.

## 0.12.0 — 2026-09-15

- Return a unique skills-anywhere-load-1 receipt with instruction/body digests, optional bundle identity, provider version and retained author tool declarations from successful MCP and direct loads.
- Omit source path fields and instruction text from the receipt; author declarations can themselves contain paths. Keep permission enforcement client-owned and rejected pins free of successful receipts.
- Add a real stdio recorder, installed-package checks for both protocol eras, documentation and Trace Workbench links.

## 0.11.1 — 2026-09-15

- Fix a browser comparison race: importing either manifest while an example is still hashing no longer leaves the other side permanently loading. Validate and settle each side independently, expose per-side busy state and let the same local file be selected again after an error.
- Exercise both overlap directions inside the embedded playground, alongside stale-file rejection and local-only file handling. CLI and MCP manifest semantics are unchanged.

## 0.11.0 — 2026-09-14

- Show source references and author-declared tools directly in the local browser checker, with separate parsing, source-address and client-enforcement boundaries. Clear unavailable results after invalid input.
- Fix false pin acceptance: arbitrary hex path segments and digest fragments no longer satisfy `--require-pinned-sources`. Only recognized HTTPS full-commit GitHub/Hugging Face layouts qualify; no remote bytes are fetched or verified.

- Carry an author-declared `allowed-tools` with the skill when serving it to a
  different agent, as `declared_tools` in `open_skill` and as a
  `<skill_author_declared_tools>` block in the text. It was parsed and then
  dropped at the MCP exit, so a skill its author had narrowed arrived looking
  unrestricted. Reported, not enforced: MCP gives a server no way to restrict a
  client's tools.
- Report what a skill reaches for in every `check`: the hosts its instructions
  reference, and whether each reference names an immutable revision or a name
  that can serve different content tomorrow. Add `--require-pinned-sources` to
  fail on the latter.
- Name the risks a check does not speak to, so a pass is not read as a clean
  bill of health. This enumerates sources and declarations; it returns no
  verdict on intent and does not pattern-match for payloads.

## 0.10.0 — 2026-09-14

- Export the same model-facing skill search used by MCP for controlled direct/MCP comparisons.
- Add an isolated real-MCP experiment bridge with skill and bundle receipts, bounded catalog discovery and mutation checks.
- Add a numerical robot-recording review skill, controlled composition fixtures, and public research links to all 27 independently graded model trials.
- Document cross-model handoff through an explicitly selected public Funes trace. Model quality gains and native commercial-agent interoperability are not implied.


## [0.9.0] - 2026-09-14

- Add `bundle <directory> --json` and `--against <manifest>` for bounded,
  deterministic inventories of all regular files, including hidden/binary
  resources. Report added, removed and changed paths with CI exit codes.
- Add optional MCP `include_bundle` and `expected_bundle_sha256`. Reject a
  changed directory before returning instructions; retain single-file callers
  and fresh author-policy checks.
- Compare manifests locally in the playground, with real reader-generated
  fixtures, digest validation, downloads and recovery from invalid/stale input.
- Document the canonical format, limits, unsupported links and the distinction
  between content identity, author authentication and later execution.


## [0.8.0] - 2026-09-14

- Migrate the production MCP server to the official split SDK 2.0.0 package.
- Accept legacy initialization and MCP 2026-07-28 through SDK stdio negotiation;
  retain tools, resources, exact-file loads and fresh author opt-outs.
- Close the transport and provider on stdin EOF or termination signals.
- Exercise four client configurations over real processes, plus legacy and
  current-protocol clients against the installed npm archive.
- Document the SDK 2 type/import migration for embedded server consumers.


All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.7.1] - 2026-09-14

### Showcase

- Move focus to inspected instructions and provide a return to the originating
  skill, with a search fallback when the row has been filtered out.
- Clear an empty search without resetting catalog choices. Distinguish custom
  and restored views from guided examples; expose correct pressed states.
- Add a skip link, larger controls and more readable instruction/report text.
- Show local file-read progress, reject invalid UTF-8 and recover from errors.
  Clearing or editing input cancels older pending reads.

The npm provider and MCP contracts are unchanged. This patch updates the browser
workflow and its installation documentation.

## [0.7.0] - 2026-09-14

### Added

- MCP `open_skill` returns SHA-256 of the original SKILL.md bytes and accepts
  optional `expected_sha256` from CLI `check --json` or a prior open. A mismatch
  returns an error without returning the changed instructions. Referenced files
  and author authenticity are outside this file identity check.
- Use bounded, regular-file, fatal UTF-8 reads for both MCP and dsh loads.

### Fixed

- Recheck the author's current invocation policy at load time in MCP tools,
  MCP resources, and the dsh provider, including skills hidden by catalog budget.
  Cached discovery can no longer override a newly disabled author setting.
- Preserve loadability of collision-renamed skills and existing unpinned clients.

## [0.6.0] - 2026-09-13

### Added

- Check explicit local Markdown files from the CLI and CI, using the same strict
  and lenient parser comparison as the browser. Include file hashes and all
  results in JSON, with distinct parser-failure and input-error exit codes.
- Bound file reads, reject invalid UTF-8 and non-files, escape terminal output,
  and keep discovery, synchronization and skill execution out of this command.
- Add a documented CI gate and smoke-test the checker from an installed tarball.

### Showcase

- Check a visitor-selected `SKILL.md` locally with the provider's real strict
  and lenient parser, including repairs, invocation settings and JSON reports.

## [0.5.1] - 2026-09-13

### Fixed

- The release workflow's npm version assertion read `process.versions.npm`,
  which does not exist, so the v0.5.0 npm publish never ran (the GitHub
  release did). It now reads `npm --version`. Package contents are otherwise
  identical to 0.5.0, which was not published to npm.

## [0.5.0] - 2026-09-13

### Showcase

- Add a static Hugging Face playground built from isolated, authored skill
  fixtures, with shared catalog/search logic, inspection, shareable views,
  workspace JSON export and tested artifact publication with anonymous readback.
- Strengthen the unterminated-comment regression test with comment-only inputs.
- Recognize Hugging Face's exact default static starter page during first
  publication while rejecting customized pages and unrelated files.

### Added

- Agent Plugins manifest (`plugin.json` + `mcp.json` at the repository root,
  schema 1.0.0) so Cursor and other open-plugin clients can install the MCP
  server from the repository URL; `scripts/sync-version.mjs` keeps both in
  step with `package.json`.
- `glama.json` naming the maintainer for the Glama MCP directory listing.
- `dsh-skills-anywhere/client` ships a type declaration (`types/client.d.ts`)
  for its plugin face; `arethetypeswrong` is green for ESM and bundler
  resolution.
- OpenSSF Scorecard workflow (weekly and on push to main, results published)
  with the badge in both READMEs; CodeQL default setup enabled on the
  repository for JavaScript/TypeScript and Actions.
- Coverage floors in `vitest.config.ts` (statements 88, branches 78,
  functions 82, lines 90) so `pnpm run test:coverage` fails on regressions;
  tests for origin labels and the agents table.

### Fixed

- Two CodeQL findings: a source string with a very long run of `/` could make
  parsing quadratic (linear trimming now), and an unterminated `<!--` comment
  in a skill body could leak into a derived description (dropped to the end of
  the document).

### Documentation

- Record published distribution entries, community submissions and channel
  rules, with Chinese project introductions for the weekly newsletter and
  HelloGitHub; `docs/PROMOTION.md` also lists the owner-only channels.

## [0.4.0] - 2026-09-13

### Added

- **Web UI card (#3).** Settings → Plugins → *Plugin configuration* in the dsh
  web UI gains a *Skills Anywhere* card: every discovered skill grouped by
  where it lives (agent directories, Claude Code plugins, git sources), its
  catalog state (listed / not listed / author disabled), renames, and
  per-skill **Pin**, **Hide** and **Exclude** actions plus the catalog budget.
  Edits persist through dsh's settings document and apply to the model
  catalog immediately. The package now ships a browser half
  (`dsh-skills-anywhere/client`, `dsh.client` in `package.json`).
- The catalog budget, pins, hides and `excludeSkills` are a runtime settings
  namespace (`skills-anywhere`) layered over the composition config; the
  `POST /api/skills-anywhere/report` route serves the discovery report to the
  browser. Both attach only when the dsh services exist, so headless and sdk
  profiles are unchanged.

### Changed

- The CLI's FROM column labels git sources `git owner/repo` (was
  `source owner/repo`), matching the MCP server and the web card.

- Install instructions and the Claude Code plugin manifest use the npm package
  (`dsh-skills-anywhere`, published with provenance) instead of the release
  tarball URL; the MCP registry listing is documented.

## [0.3.2] - 2026-09-13

### Added

- `server.json` for the official MCP registry (`io.github.noteflowai/dsh-skills-anywhere`);
  the release workflow registers every version there after the npm publish.
- `docs/RELEASING.md`: one-time npm trusted-publishing setup and the per-release
  steps.
- `scripts/sync-version.mjs` keeps `.claude-plugin/*.json`, `server.json` and
  the tarball URLs in both READMEs in step with `package.json`; `pnpm version`
  runs it, and `pnpm run check` / CI fail on drift.

- `tests/server-json.test.ts` pins the MCP registry invariants (name equals
  `mcpName`, description within 100 characters, version equals `package.json`).
- Dependabot keeps the pinned GitHub Actions and the npm dev dependencies
  current (weekly, grouped); `.gitattributes` normalises checkouts to LF.

### Fixed

- **Security.** A source string such as `https://github.com/../..` or
  `github:../..` (for example in a project's `.dsh/skills-anywhere.json`) could
  resolve its cache directory *outside* the cache, and the sync step deletes a
  non-checkout directory before cloning. Path segments are now validated and
  the resolved directory must lie inside the cache; the sub-path check is
  separator-aware (`path: '../r-private'` no longer passes because the name
  shares a prefix).
- Project-level sources were often never cloned: a `list({ cwd })` that arrived
  while the start-up sync was running reused that run (which had no cwd), and
  the interval timer and sources-file poller never included project files.
  Such requests now queue a follow-up run, and every project seen so far stays
  in the sync set.
- Two refs of one repository (`o/r@main`, `o/r@v1`) shared a checkout and lock
  entry and re-checked each other out on every sync. Each ref now has its own
  directory (`<repo>@<ref>`) and lock key.
- Collision renaming looped forever when `<prefix>-<name>` exceeded 64
  characters, because the numeric suffix was truncated away.
- The dsh `find_skills` tool listed skills whose author set
  `disable-model-invocation: true` and told the model to load them with
  `open_skill`, which refuses them. They are no longer returned.
- `excludeSkills` only matched the raw frontmatter name, so the renamed names
  shown by `list` (`telegram-access`) had no effect. Both names now match.
- A git source pointing straight at one skill directory
  (`add o/r/skills/pdf`) yielded no skills; the root itself is now a skill and
  the walk below it continues.
- The watcher cap of 32 counted project *directories* rather than projects, so
  roots after the first 32 agent directories were never watched.
- `add` appended a duplicate when the existing entry embedded the sub-path in
  the repo string (`o/r/skills` vs `--path skills`).
- `dispose()` now aborts in-flight git processes and waits for them, so no
  sync outlives the provider.

### Changed

- Discovery scans roots concurrently, reads `SKILL.md` files and stats
  directory entries with bounded concurrency, and only resolves real paths
  once a content hash repeats. Results are unchanged; a 700-skill catalog
  refresh takes about a third less time.
- Every GitHub Action in the workflows is pinned to a commit SHA.
- The release workflow is split into `release` (GitHub release + tarball), `npm`
  (trusted publishing with provenance, `NPM_TOKEN` only as a first-publish
  fallback) and `mcp-registry` jobs, each with least-privilege permissions.
- Tested against DeepSeek Harness `0.1.5-rc.2`; `dsh.compatibility.dshReleases`
  now lists both `0.1.5-rc.1` and `0.1.5-rc.2`.

## [0.3.1] - 2026-09-11

### Added

- **Claude Code plugin.** The repository now carries `.claude-plugin/plugin.json`
  and `marketplace.json`, so `claude plugin marketplace add noteflowai/dsh-skills-anywhere`
  followed by `claude plugin install dsh-skills-anywhere@noteflowai` wires the
  MCP server into Claude Code with no manual `claude mcp add`. The manifest pins
  the release tarball; bump it together with the README URLs on each release.
- Animated demo in the README (`docs/demo.gif`).

### Changed

- `list` shows skills that come from a git source with their path inside the
  repository (`skills/pdf/SKILL.md`) instead of the full cache path; the FROM
  column already names the repository.

## [0.3.0] - 2026-09-10

### Added

- **MCP server mode.** `dsh-skills-anywhere mcp` serves the same skill pool to
  any Model Context Protocol client over stdio: `list_skills`, `find_skills`
  and `open_skill` tools plus `skill://<name>` resources with completion.
  Author-disabled skills are never exposed. Works without dsh installed.
- `dsh-skills-anywhere/mcp` entry point exporting `createSkillsAnywhereServer`,
  `runStdio` and `renderSkill` for custom transports.

### Changed

- Keyword search moved to a dsh-free module shared by the dsh tools and the
  MCP server; ranking is unchanged.

## [0.2.1] - 2026-09-10

### Changed

- Name collisions where every member comes from a plugin marketplace or a git
  source now prefix all members (`discord-access`, `telegram-access`) instead of
  leaving one bare `access`. A skill from your own agent directory still keeps
  its bare name.
- `doctor` and `list` report renames separately from frontmatter repairs.
- CI runs on Linux, macOS, and Windows.

## [0.2.0] - 2026-09-10

### Added

- **Catalog budget.** `catalog.limit` (default 50), `catalog.pin`, and
  `catalog.hide` decide which skills enter the model's session catalog; the
  rest are published with model invocation off, so `/name` still works and
  context stays small.
- **`find_skills` and `open_skill` tools** (`dsh-skills-anywhere/tools` row):
  keyword search over every skill, listed or not, and loading of any skill the
  budget hid. Author-disabled skills remain refused.
- Candidate metadata now records `skillsAnywhere.catalog` and
  `skillsAnywhere.authorInvocation`.

### Changed

- Git sources declared in config or the user sources file now sync when the
  plugin starts, not on the first catalog request.

## [0.1.0] - 2026-09-10

### Added

- `ctx.skills` provider for DeepSeek Harness that discovers skills from the
  project and user skill directories of 60+ other coding agents.
- Discovery of skills nested inside Claude Code plugin marketplaces and the
  installed-plugin cache, with marketplace and plugin names attached.
- Git sources: `owner/repo`, sub-directories, branches, tags, commits, GitHub
  tree URLs, arbitrary git URLs and local paths. Shallow clone into a cache,
  background refresh, `lock.json` with resolved commits, user- and
  project-level `sources.json` files.
- Deduplication of symlinked and byte-identical skills; deterministic renaming
  of colliding names.
- Lenient Agent Skills frontmatter parsing with recorded repairs; strict mode
  matching the built-in provider.
- Filesystem watching of local roots and sources files with debounced catalog
  invalidation.
- `dsh-skills-anywhere` CLI: `list`, `agents`, `sources`, `add`, `remove`,
  `sync`, `doctor`.
- English and Chinese documentation.
