# Releasing

A release is one commit that bumps the version, and one tag. The
[Release workflow](../.github/workflows/release.yml) does the rest: it runs the
full check, attaches the tarball to a GitHub release, publishes to npm with
provenance, and registers the version in the official MCP registry.

## One-time setup

### npm

The package publishes through [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/),
so no long-lived token has to live in the repository.

1. Create the package on npm. Trusted publishers can only be configured on a
   package that already exists, so the very first version is published with a
   token:
   - On npmjs.com create a **granular access token** with *Read and write*
     on packages, scoped to `dsh-skills-anywhere`, with a short expiry.
   - In the GitHub repository create an environment named `npm`
     (*Settings → Environments*), restrict it to tags matching `v*`, and add
     the token there as the secret `NPM_TOKEN`.
   - Push the tag. Delete the token from npm and the secret from GitHub once
     the release is out.
2. On npmjs.com open *Package → Settings → Trusted publishing* and add a
   GitHub Actions publisher:
   - Organization or user: `noteflowai`
   - Repository: `dsh-skills-anywhere`
   - Workflow filename: `release.yml`
   - Environment name: `npm`
   - Allow `npm publish` (not only `npm stage publish`).
3. Optionally set *Publishing access* to *Require two-factor authentication
   and disallow tokens*. Trusted publishing keeps working.

From then on the `npm` job authenticates with the workflow's OIDC token and
npm generates the provenance attestation automatically.

### MCP registry

Nothing to configure. `server.json` names the server
`io.github.noteflowai/dsh-skills-anywhere`, `package.json` carries the matching
`mcpName`, and the `mcp-registry` job logs in with GitHub OIDC, which grants the
`io.github.noteflowai/*` namespace to workflows of this organisation. The
registry validates the version against the npm package, so this job runs after
the npm publish succeeds.

### Claude Code marketplace

Nothing to configure. `claude plugin marketplace add noteflowai/dsh-skills-anywhere`
reads `.claude-plugin/marketplace.json` straight from the default branch.

## Every release

```sh
git switch main && git pull
# 1. Move the *Unreleased* section of CHANGELOG.md under the new version and date.
git add CHANGELOG.md && git commit -m "changelog: v0.3.2"
# 2. Bump. `pnpm version` updates package.json, runs the `version` lifecycle
#    script (which rewrites .claude-plugin/*.json, server.json and the tarball
#    URLs in both READMEs and stages them), then commits and tags `v<version>`.
pnpm version patch --message "release: v%s"     # or minor / major / 0.4.0-rc.1
git push origin main --follow-tags
```

pnpm 12 creates the commit and the tag itself, so there is nothing left to
commit after the bump; `--follow-tags` pushes the tag that triggers the release.

`pnpm run check` (and CI) fails when any version file drifts from
`package.json`; `node scripts/sync-version.mjs` repairs it.

Watch the three jobs of the *Release* run. If the `npm` job fails, the GitHub
release and its tarball are already published, so the tag is still usable;
fix the npm side and re-run only the failed jobs from the Actions UI.

## Install instructions and the plugin manifest

`README.md`, `README.zh.md` and `.claude-plugin/plugin.json` install from npm.
The plugin manifest pins `dsh-skills-anywhere@<version>` so Claude Code users
get exactly the released build; `scripts/sync-version.mjs` bumps that pin (and
any remaining tarball URL) together with `package.json`.

## Compatibility with DeepSeek Harness

`package.json` → `dsh.compatibility.dshReleases` lists the dsh releases the test
suite has run against. When a new dsh pre-release or release appears:

```sh
# bump every @deepseek-ai/dsh-* entry in devDependencies and the matching
# minimumReleaseAgeExclude lines in pnpm-workspace.yaml, then
pnpm install && pnpm run check
```

Add the version to `dshReleases` when the suite passes, and mention the tested
range in the *Requirements* section of both READMEs if the minimum changes.
