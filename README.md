# dsh-skills-anywhere

**Your skills, anywhere.** A live [Agent Skills](https://agentskills.io) provider for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`).

English | [中文](README.zh.md)

[![CI](https://github.com/noteflowai/dsh-skills-anywhere/actions/workflows/ci.yml/badge.svg)](https://github.com/noteflowai/dsh-skills-anywhere/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-skills-anywhere?label=npm)](https://www.npmjs.com/package/dsh-skills-anywhere)
[![dsh plugin](https://img.shields.io/badge/dsh-plugin-blue)](https://github.com/topics/dsh-plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

You already have skills. They live in `~/.claude/skills`, `~/.codex/skills`, `~/.cursor/skills`, inside Claude Code plugin marketplaces, and in GitHub repositories like `anthropics/skills`. DeepSeek Harness only looks in `.dsh/skills` and `.agents/skills`.

`dsh-skills-anywhere` registers one extra provider on the built-in `ctx.skills` registry, so the model's normal `skill` tool and `/name` invocation simply see more skills:

- **Every other agent's skill directories.** 60+ agents out of the box: Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, Windsurf, Kiro, Goose, OpenCode, Roo, Cline, Qwen Code, Trae and more. Project-level and user-level.
- **Claude Code plugin marketplaces.** The skills nested inside `~/.claude/plugins/marketplaces/*/plugins/*/skills/*`, including the official Anthropic marketplace.
- **Any git repository full of skills.** Point at `anthropics/skills`, a sub-directory, a branch, a tag, or a commit. It is shallow-cloned into a local cache, refreshed in the background, and pinned in a lock file.
- **Zero copies, zero symlinks.** Files are read where they live and re-read on every load. Edit a skill in Cursor and dsh sees the change. Nothing to import, nothing to keep in sync.

Hundreds of skills would bloat every model request, so the provider keeps a **catalog budget**: at most 50 skills enter the model's session catalog by default, and the rest stay one `find_skills` call away through two small tools the plugin adds, with `/name` invocation untouched.

It also **deduplicates** symlinked and byte-identical installs (the `skills` CLI links one canonical copy into several agents), **repairs** common frontmatter drift instead of silently dropping a skill, and **renames** colliding names (`discord/configure` vs `telegram/configure`) so every skill stays reachable. A small CLI shows you exactly what dsh will see and why.

## Quick start

```sh
# 1. Install into the dsh profile you use (web is the default UI profile)
dsh plugin --profile web add dsh-skills-anywhere

# 2. See what the model will get, without booting dsh
npx dsh-skills-anywhere list

# 3. Add a whole repository of skills
npx dsh-skills-anywhere add anthropics/skills
```

Start dsh as usual. The skill catalog now includes everything above; load a skill with the `skill` tool or `/skill-name` exactly as before.

On a machine with only Claude Code installed, `list` already finds the 31 skills inside the official plugin marketplace, none of which dsh sees on its own:

```
$ npx dsh-skills-anywhere list
NAME                 FROM                                                    PATH
discord-access       claude plugin discord @ claude-plugins-official         ~/.claude/plugins/marketplaces/.../discord/skills/access/SKILL.md
frontend-design      claude plugin frontend-design @ claude-plugins-official ~/.claude/plugins/marketplaces/.../frontend-design/skills/frontend-design/SKILL.md
skill-creator        claude plugin skill-creator @ claude-plugins-official   ~/.claude/plugins/marketplaces/.../skill-creator/skills/skill-creator/SKILL.md
...
31 skills, 6 renamed — run `dsh-skills-anywhere doctor` for details
```

<details>
<summary>Install from GitHub instead of npm</summary>

```sh
dsh plugin --profile web add github:noteflowai/dsh-skills-anywhere
```

A git install ships sources, so pnpm has to run this package's `prepare` build. pnpm 10+ refuses until you allow it: the first `add` fails and prints the exact key to allow. Copy that key (it includes the commit) into the profile's `pnpm-workspace.yaml` and run the `add` again.

```yaml
# $DSH_HOME/profiles/web/pnpm-workspace.yaml
allowBuilds:
  'dsh-skills-anywhere@https://codeload.github.com/noteflowai/dsh-skills-anywhere/tar.gz/<sha>': true
```

Pin a commit (`github:noteflowai/dsh-skills-anywhere#<sha>`) if you want the install to be reproducible.

</details>

<details>
<summary>Requirements</summary>

- DeepSeek Harness `0.1.5-rc.1` or newer, any profile that mounts `@deepseek-ai/dsh-skill` (the shipped `web`, `acp`, `headless` and `sdk` profiles all do)
- Node.js 22.19+ or 24+
- `git` on `PATH` for git sources (everything else works without it)

</details>

## What gets discovered

| Where | Example | dsh source label | Default rank |
|---|---|---|---|
| Another agent's **project** skills | `<project>/.claude/skills/*` | `anywhere-project` | 250 |
| Another agent's **user** skills | `~/.codex/skills/*`, `~/.cursor/skills/*` | `anywhere-user` | 550 |
| **Claude Code plugin marketplaces** and the installed-plugin cache | `~/.claude/plugins/marketplaces/*/plugins/*/skills/*` | `anywhere-claude-plugins` | 580 |
| **Git sources** | `anthropics/skills`, `vercel-labs/agent-skills/skills` | `anywhere-source` | 700 |

Lower rank wins a duplicate name inside the dsh registry. The built-in dsh roots keep their ranks (`.dsh/skills` 100, `.agents/skills` 200, `~/.dsh/skills` 400, `~/.agents/skills` 500), so a skill you wrote for dsh always beats the same name found elsewhere. `.agents/skills` and `.dsh/skills` are deliberately not re-scanned here.

Run `npx dsh-skills-anywhere agents` for the full agent table and which directories exist on your machine.

### Skill format

Any directory with a `SKILL.md` following the [Agent Skills specification](https://agentskills.io/specification), plus dsh's flat `<name>.md` form. `name`, `description`, `license`, `compatibility`, `allowed-tools`, `metadata`, and dsh's `disable-model-invocation` / `user-invocable` are all understood. Unknown frontmatter (Claude Code's `argument-hint`, `context`, ...) is preserved under `metadata.frontmatter`. `scripts/`, `references/` and `assets/` are exposed through the skill's resource directory like any dsh skill.

In the default **lenient** mode a missing name falls back to the directory, an invalid name is normalised to kebab-case, and a missing description is derived from the first paragraph. Each repair is recorded and shown by `doctor`. Set `lenient: false` to match the strict behaviour of the built-in provider.

## Git sources

```sh
npx dsh-skills-anywhere add anthropics/skills                      # default branch
npx dsh-skills-anywhere add anthropics/skills@v1.0.0               # tag or branch
npx dsh-skills-anywhere add vercel-labs/agent-skills/skills        # sub-directory
npx dsh-skills-anywhere add https://github.com/o/r/tree/main/dir   # GitHub tree URL
npx dsh-skills-anywhere add git@gitlab.com:group/skills.git        # any git URL
npx dsh-skills-anywhere add ./local/skills-repo --project          # local repo, project-scoped
npx dsh-skills-anywhere add o/r --ref 3f2a9c1 --rank 300           # pin a commit, set precedence
```

Sources come from three places, merged in this order: the plugin `config.sources`, the user file `~/.dsh/skills-anywhere/sources.json`, and the project file `<project>/.dsh/skills-anywhere.json` (commit it to share skills with your team). The CLI edits the last two.

Each repository is shallow-cloned once into `~/.dsh/skills-anywhere/cache/<host>/<owner>/<repo>` and refreshed when dsh starts, every `syncIntervalMs` (6 hours by default), and whenever a sources file changes. The resolved commit of every source is written to `~/.dsh/skills-anywhere/lock.json`. Discovery only ever reads the cache, so a failed refresh means yesterday's skills, never an empty catalog. The catalog is invalidated as soon as a refresh brings changes; dsh never waits on the network.

## Catalog budget and the `find_skills` / `open_skill` tools

dsh publishes every model-invocable skill's name and description into the session, on every request. With marketplaces and a few git sources that is hundreds of lines of context. The provider therefore ranks its skills and marks only the first `catalog.limit` (default 50) as model-invocable; the remainder is published with model invocation off, which keeps it out of the catalog but still loadable by you with `/name`.

Two tools, registered by the `dsh-skills-anywhere/tools` row, make the hidden part reachable for the model:

- **`find_skills(query, limit?)`** searches every skill by keyword (name, description, `whenToUse`, origin), catalog or not, and says which matches are listed.
- **`open_skill(name)`** loads any skill by exact name, including ones the budget hid. Skills whose own frontmatter says `disable-model-invocation: true` are still refused, exactly as the built-in `skill` tool does.

```yaml
- id: skills-anywhere
  config:
    catalog:
      limit: 30                       # 0 = unlimited (old behaviour)
      pin: [frontend-design]          # always listed
      hide: [example-skill]           # never listed, still searchable and /name-invocable
- id: skills-anywhere-tools
  config:
    findLimit: 10
```

Author-disabled skills never count against the budget. Which skills stay listed follows the precedence order below, so project-level skills win over user-level, which win over marketplaces and git sources. The tools row needs the tool runtime (`ctx.tools`); in a profile without one it stays pending and the provider works alone.

## CLI

```
dsh-skills-anywhere list [--all] [--json]     Skills the provider publishes (--all shows hidden duplicates)
dsh-skills-anywhere agents [--json]           Supported agents and which directories exist here
dsh-skills-anywhere sources [--json]          Configured git sources and their synced commits
dsh-skills-anywhere add <source> [--ref] [--path] [--rank] [--project]
dsh-skills-anywhere remove <source> [--project]
dsh-skills-anywhere sync [--force] [--json]   Clone or refresh every source now
dsh-skills-anywhere doctor [--json]           Repaired, skipped, renamed and duplicate skills, with reasons
```

All commands accept `--cwd <dir>` to pick the project. The CLI uses the same code path as the plugin and never needs dsh running.

## Configuration

Override the row in your profile's `cordis.patch.yml`. A patch replaces the whole `config` block, so restate every key you care about:

```yaml
- id: skills-anywhere
  config:
    agents: true
    excludeAgents: [openclaw]
    claudePlugins: true
    sources:
      - anthropics/skills
      - { repo: vercel-labs/agent-skills, path: skills, ref: main, rank: 650 }
    excludeSkills: [example-skill]
```

| Field | Default | Meaning |
|---|---|---|
| `providerName` | `skills-anywhere` | Provider name on `ctx.skills` |
| `agents` | `true` | Scan other agents' skill directories |
| `excludeAgents` | `[]` | Agent ids to skip (see `agents` command) |
| `extraProjectDirs` | `[]` | Additional project-relative skill directories |
| `extraUserDirs` | `[]` | Additional absolute or `~/` skill directories |
| `claudePlugins` | `true` | Scan Claude Code plugin marketplaces and cache |
| `sources` | `[]` | Git sources: strings or `{ repo, ref?, path?, rank? }` |
| `sourcesFiles` | `true` | Also read the user and project `sources.json` files |
| `cacheDir` | `~/.dsh/skills-anywhere/cache` | Where sources are checked out |
| `sync` | `true` | Clone and refresh git sources at all |
| `syncOnStart` | `true` | Refresh when the plugin starts and on first use of a project |
| `syncIntervalMs` | `21600000` | Background refresh interval; `0` disables |
| `syncTimeoutMs` | `120000` | Per-git-command timeout |
| `maxDepth` | `5` | Directory depth walked inside sources and marketplaces |
| `dedupe` | `true` | Collapse symlinked and byte-identical duplicates |
| `lenient` | `true` | Repair recoverable frontmatter instead of skipping |
| `watch` | `true` | Watch local roots and refresh the catalog on change |
| `excludeSkills` | `[]` | Skill names to hide |
| `ranks` | `{ project: 250, user: 550, claudePlugins: 580, sources: 700 }` | Precedence per group |
| `catalog.limit` | `50` | Skills from this provider listed in the model catalog; `0` = unlimited |
| `catalog.pin` | `[]` | Names always listed |
| `catalog.hide` | `[]` | Names never listed (still `/name`-invocable and searchable) |
| `dshHome`, `home` | `$DSH_HOME` / `~` | Path roots, mainly for tests |

The `dsh-skills-anywhere/tools` row accepts `findLimit` (default 10), `findMaxLimit` (50), and `find` / `open` booleans to register only one tool.

## How precedence and duplicates work

1. Roots are scanned in rank order. Within one rank, the agent table order, then path.
2. Entries pointing at the **same file** (symlinks) collapse to the first. Entries with the **same name and byte-identical body** collapse to the first. Both appear in `doctor` as hidden duplicates.
3. Entries that still **share a name** but differ are all kept. If one of them is yours (an agent directory) it keeps the bare name and the others are prefixed with their plugin, repository, or agent (`telegram-configure`). If every member comes from a marketplace or a git source, all of them are prefixed, so you get `discord-access` and `telegram-access` rather than a meaningless bare `access`. `doctor` lists the renames.
4. The dsh registry then merges this provider's candidates with the built-in ones by rank.

## Security notes

- The plugin **reads** skill files. It never writes to your agent directories.
- Git sources run `git` on your machine at plugin start and on the refresh interval. Pin a commit for anything you do not fully trust, and review `lock.json`.
- A skill is instructions the model will follow. Adding a source is a trust decision, exactly like installing a plugin.
- Skills are read with Node's filesystem API, not through dsh's sandboxed `ctx.fs`; the built-in provider does the same for its bundled root.

## Development

```sh
pnpm install
pnpm run check        # typecheck + lint + tests + build
pnpm pack             # tarball for `dsh plugin --profile <name> add ./dsh-skills-anywhere-*.tgz`
```

Tests run against the real `@deepseek-ai/dsh-skill` registry and real git repositories in temp directories.

## Contributing

Issues and pull requests are welcome. Adding an agent is a one-line change in [`src/agents.ts`](src/agents.ts). See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Note Flow AI
