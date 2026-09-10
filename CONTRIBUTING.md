# Contributing

Thanks for helping make skills portable.

## Setup

```sh
git clone https://github.com/noteflowai/dsh-skills-anywhere.git
cd dsh-skills-anywhere
pnpm install
pnpm run check     # typecheck, lint, tests, build
```

Node 22.19+ (or 24+), pnpm 12, and `git` on `PATH` are required; the test suite
creates real git repositories in temp directories.

## Adding an agent

Add one row to `AGENTS` in `src/agents.ts` with the agent's project-level and/or
user-level skills directory. Leave out `.agents/skills` and `.dsh/skills`: the
built-in dsh provider already scans them. Mention the source of the paths
(vendor docs, the `skills` CLI table) in the pull request.

## Pull requests

- Keep changes focused; one concern per PR.
- Add or update tests under `tests/`. Coverage should not drop.
- Run `pnpm run check` before pushing. CI runs the same command on Node 22 and 24.
- Update `README.md` and `README.zh.md` together when behaviour changes.
- Follow the existing code style; `oxlint` is the linter.

## Trying a change inside dsh

```sh
pnpm run build && pnpm pack
dsh plugin --profile <name> add ./dsh-skills-anywhere-*.tgz
npx dsh-skills-anywhere doctor
```

## Reporting bugs

Please include the output of `npx dsh-skills-anywhere doctor --json`, your dsh
version (`dsh --version`), and the relevant `SKILL.md` if a skill is skipped or
mis-parsed.
