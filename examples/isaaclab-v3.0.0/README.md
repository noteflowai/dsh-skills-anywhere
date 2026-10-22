# IsaacLab v3.0.0: five user skills, pinned to one commit

An opt-in Git-source configuration for five user skills from
[isaac-sim/IsaacLab](https://github.com/isaac-sim/IsaacLab) at tag `v3.0.0`,
pinned to commit `e3f7d9ff1f5d7f8280de3ece9000b7117f66bcf4`. dsh-skills-anywhere
does not enable it by default; nothing changes until you copy the config.

| Folder (`skills/user/…`) | Published name | Upstream status |
| --- | --- | --- |
| `migrate-2x-to-3x` | `isaaclab-migrating-2x-to-3x` | experimental |
| `train-rl-agents` | `isaaclab-training-rl-agents` | experimental |
| `create-environments` | `isaaclab-building-environments` | experimental |
| `select-backends` | `isaaclab-selecting-backends` | experimental |
| `debug-rl-training` | `isaaclab-debugging-rl-training` | experimental |

The status column is upstream's frontmatter value, shown as is. dsh publishes
the frontmatter `name`, not the folder name.

- [`skills-anywhere.json`](skills-anywhere.json): five sources with the same
  `repo` and the full 40-character commit as `ref`; each `path` is one skill
  folder.
- [`catalog.json`](catalog.json) (`skills-anywhere-pinned-catalog-1`): the review
  record. It lists each skill's published name, folder, commit, the sha256 and
  size of every file in the folder, the license and its basis, the upstream
  status, the checkout-relative references, the excluded skills, and the
  allowlist bypasses. dsh does not read it at runtime.
  `tests/isaaclab-catalog.test.ts` checks it offline.

## Opt in

Copy `skills-anywhere.json` to `<project>/.dsh/skills-anywhere.json` (or merge
its `sources` into `~/.dsh/skills-anywhere/sources.json`). For the dsh plugin
config, use the same entries:

```yaml
sources:
  - { repo: isaac-sim/IsaacLab, ref: e3f7d9ff1f5d7f8280de3ece9000b7117f66bcf4, path: skills/user/migrate-2x-to-3x }
  - { repo: isaac-sim/IsaacLab, ref: e3f7d9ff1f5d7f8280de3ece9000b7117f66bcf4, path: skills/user/train-rl-agents }
  - { repo: isaac-sim/IsaacLab, ref: e3f7d9ff1f5d7f8280de3ece9000b7117f66bcf4, path: skills/user/create-environments }
  - { repo: isaac-sim/IsaacLab, ref: e3f7d9ff1f5d7f8280de3ece9000b7117f66bcf4, path: skills/user/select-backends }
  - { repo: isaac-sim/IsaacLab, ref: e3f7d9ff1f5d7f8280de3ece9000b7117f66bcf4, path: skills/user/debug-rl-training }
```

All five share one checkout,
`~/.dsh/skills-anywhere/cache/github.com/isaac-sim/IsaacLab@e3f7d9ff…`. dsh
fetches that commit by SHA and does not resolve the tag again. Keep the full
SHA: a tag such as `v3.0.0` or a short SHA is resolved again on sync, and a
`path` of `skills` or `skills/user` (or none) scans every upstream skill,
including the `.agents/skills` aliases.

## Untrusted content

Treat the skill text as untrusted prompt input. dsh does not execute it, but
the skills suggest commands (`uv run …`, the template generator, training
scripts) that your agent may run with your approval. dsh cannot restrict those.
`install-isaac-lab` is excluded because, after one confirmation, it "executes
the docs-prescribed commands unattended".

Never copy or symlink the cache checkout, or any skill folder from it, into an
agent's global skill directory (`~/.claude/skills`, `~/.codex/skills`, …).
Upstream asks for the same in
[`skills/README.md` line 44](https://github.com/isaac-sim/IsaacLab/blob/e3f7d9ff1f5d7f8280de3ece9000b7117f66bcf4/skills/README.md?plain=1#L44):

> This keeps one maintained copy of each skill and preserves repository-relative references. Do not flatten-copy skills into an agent's global skill directory.

## Checkout-relative references and no sparse checkout

The skills link out of their folder, mostly as `../../../docs/source/…` and
`../../../source/…`, and their text names repository-root paths such as
`scripts/reinforcement_learning/`. The managed checkout is a full working tree
of the pinned commit, so every recorded reference resolves next to the skill
(`references` in the catalog). A sparse checkout would remove only about 15% of
the files, because the references need `docs/source`, `source`, `scripts` and
`tools`. It would also break four links to other skills, so this example does
not use one. The large `docs/source/isaaclab/migrating.rst` (about 234 KiB)
is better read by section.

## Three ways around the allowlist

Path-scoped sources keep the other 19 upstream skills out of the catalog. They
do not stop these three cases:

1. **Working inside an IsaacLab checkout.** dsh scans that project's
   `.claude/skills` (rank 250), and its `.agents/skills` (rank 200) when
   `sharedDirs` is on, which the standalone MCP server enables. Upstream links
   both to all 24 skills. Set `excludeAgents: ["claude-code", "agents"]` for
   that project, or work elsewhere.
2. **Another IsaacLab source.** An `isaac-sim/IsaacLab` entry with no ref, a
   tag, a branch, a short or different SHA, or a path outside the five folders
   is scanned in addition to these five. Look in the plugin `config.sources`,
   `~/.dsh/skills-anywhere/sources.json` and `<project>/.dsh/skills-anywhere.json`.
3. **Non-allowlisted skills on disk.** They are not discovered, but their files
   are in the same full checkout. Four links lead there:
   create-environments → `convert-direct-to-manager` and `plan-manipulation-tasks`,
   select-backends → `prepare-assets-for-newton`, train-rl-agents → `train-multi-gpu`.
   An agent that follows them reads unreviewed skills. This example accepts that.

The verify script reports all three:

```sh
pnpm run build
node scripts/verify-pinned-catalog.ts --project <your project> [--config <plugin config with a sources list>]
```

## What is pinned, and where

- MCP `open_skill`: pass `expected_source_commit` (the catalog `commit`) and
  `expected_sha256` (the catalog `SKILL.md` sha256), and optionally
  `include_bundle` / `expected_bundle_sha256`. Delivery is then refused unless
  the checkout is at that commit, the skill folder is clean and the bytes match
  the commit ([details](../../docs/VERIFIED-LOADS.md)). These checks cover the
  skill folder only, not the referenced files outside it.
- The dsh `skill` tool (plugin provider) reads the working tree and enforces
  neither the commit nor the digest. Enforcing them there is planned
  separately; for now the pin is a source selection plus this review record.

## Bump the pin

Manual only; no CI or scheduled job uses the network for this.

1. Pick the new commit (`git ls-remote https://github.com/isaac-sim/IsaacLab.git refs/tags/<tag>`).
2. Review the upstream changes to the five folders, their references, the
   license and the skill list.
3. Update `ref` in `skills-anywhere.json` and `source`, `files`, `references`
   and `excluded` in `catalog.json`.
4. Run `pnpm run build && node scripts/verify-pinned-catalog.ts`. It syncs the
   config through dsh into a temporary directory, recomputes every catalogued
   sha256 from the commit and the checkout, and checks frontmatter, the LICENSE
   SPDX line, references and the skill inventory. It reports a moved tag
   without failing, and exits 1 on any content mismatch. It reads your
   `DSH_HOME` but writes only to its temporary directory.
5. Run `pnpm run check`.

## License

The five folders have no license file and no `license` frontmatter. The
catalog records BSD-3-Clause based on the repository root `LICENSE` (line 7,
`SPDX-License-Identifier: BSD-3-Clause`, sha256 `932e8d71…6c9df`) and gives
that basis in `license.basis`. This repository stores no upstream skill files.

## 中文

这是一个需要手动启用的示例：通过 Git 源从 `isaac-sim/IsaacLab` 的 `v3.0.0` 引入 5 个用户技能，
固定在提交 `e3f7d9ff1f5d7f8280de3ece9000b7117f66bcf4`。默认配置不包含它。

- 启用：把 `skills-anywhere.json` 复制为 `<project>/.dsh/skills-anywhere.json`，或把同样的
  `sources` 写进用户级 `sources.json` 或插件配置。`ref` 必须是完整的 40 位 SHA；tag、短 SHA、
  `skills` 或 `skills/user` 这样的路径都会扩大扫描范围，或在同步时重新解析。
- `catalog.json` 是审阅记录，dsh 运行时不读取。它记录发布名、目录、提交、每个文件的
  sha256、许可证及推断依据（仓库根 `LICENSE` 第 7 行，技能本身没有声明）、上游 status
  （原样展示，均为 experimental）、检出内引用、排除项和绕过白名单的情况。
- 技能内容一律视为不可信输入。不要把缓存检出复制或链接到任何 agent 的全局技能目录（上游
  `skills/README.md` 第 44 行同样要求）。`install-isaac-lab` 会在确认一次后无人值守地执行安装，
  因此排除。
- 不使用 sparse：技能引用 `docs/source`、`source`、`scripts`、`tools`，完整检出可以保证这些引用
  都能解析，并保留 4 条跨技能链接。
- 三种绕过白名单的情况：在 IsaacLab 仓库内工作（扫描 `.claude/skills`、`.agents/skills`）；
  另有一条未固定的 IsaacLab 源；非白名单技能仍在磁盘上。
  `node scripts/verify-pinned-catalog.ts --project <dir>` 会把这三种情况都报告出来。
- 固定校验：MCP `open_skill` 可以传 `expected_source_commit` 和 `expected_sha256`。dsh 自带的
  `skill` 工具目前不强制校验，后续单独处理。
- 升级版本只能手动进行：修改两个 JSON，运行校验脚本（需要联网、只读），再运行 `pnpm run check`。
  CI 不联网。
