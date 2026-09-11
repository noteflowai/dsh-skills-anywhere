# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Claude Code plugin.** The repository now carries `.claude-plugin/plugin.json`
  and `marketplace.json`, so `claude plugin marketplace add noteflowai/dsh-skills-anywhere`
  followed by `claude plugin install dsh-skills-anywhere@noteflowai` wires the
  MCP server into Claude Code with no manual `claude mcp add`. The manifest pins
  the release tarball; bump it together with the README URLs on each release.

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
