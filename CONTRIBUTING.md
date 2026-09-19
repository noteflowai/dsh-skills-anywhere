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

## Adding an agent directory

Add one row to `AGENTS` in `src/agents.ts` with the agent's project-level and/or
user-level skills directory. Leave out `.agents/skills` and `.dsh/skills`: the
built-in dsh provider already scans them. Mention the source of the paths
(vendor docs, the `skills` CLI table) in the pull request.
Test discovery using temporary directories. This registers a filesystem path;
claims about a client's MCP connection or skill execution need separate tests
and a corresponding entry in the compatibility documentation.

## Pull requests

- Keep changes focused; one concern per PR.
- Add or update tests under `tests/`. Coverage should not drop.
- Run `pnpm run check` before pushing. CI runs the same command on Node 22 and 24.
- Update `README.md` and `README.zh.md` together when behaviour changes.
- Follow the existing code style; `oxlint` is the linter.

## The web card

`src/client/` is the browser half (React, built to `lib/client.js`). It talks
to the host through the `skills-anywhere` settings namespace (dsh's settings
scope) and the exact route `POST /api/skills-anywhere/report` (`src/web.ts`).
Keep it free of Node imports and of any module the dsh shell does not provide
(see `PLATFORM_MODULES` in `tsdown.config.ts`); dictionaries live in
`src/client/locale.ts` and must stay complete in both languages
(`tests/client.test.tsx` checks).

## Package checks

`npx publint` and `npx @arethetypeswrong/cli --pack .` are worth running before
a release. One publint warning is expected: `lib/client.js` is the dsh browser
bundle (a classic script that registers on `window.__ModuleLoader__`), kept at
`.js` because that is the convention every dsh client plugin follows; it is not
meant to be imported by Node.

## Trying a change inside dsh

```sh
pnpm run build && pnpm pack
dsh plugin --profile <name> add ./dsh-skills-anywhere-*.tgz
npx dsh-skills-anywhere doctor
```

## Releasing

Maintainers: see [docs/RELEASING.md](docs/RELEASING.md). `pnpm version <bump>`
keeps every version file in step; pushing the tag does the rest.

## Reporting bugs

Please include the output of `npx dsh-skills-anywhere doctor --json`, your dsh
version (`dsh --version`), and the relevant `SKILL.md` if a skill is skipped or
mis-parsed.

## Sharing the project

See [publication and community submissions](docs/PROMOTION.md) for existing
threads, reviewed channel rules and version-specific introduction material.
Check that record before opening a new directory or newsletter submission.
