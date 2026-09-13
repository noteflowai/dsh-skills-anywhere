# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

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
