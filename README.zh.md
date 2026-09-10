# dsh-skills-anywhere

**你的技能，随处可用。** 面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的实时 [Agent Skills](https://agentskills.io) 提供器。

[English](README.md) | 中文

[![CI](https://github.com/noteflowai/dsh-skills-anywhere/actions/workflows/ci.yml/badge.svg)](https://github.com/noteflowai/dsh-skills-anywhere/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-skills-anywhere?label=npm)](https://www.npmjs.com/package/dsh-skills-anywhere)
[![dsh plugin](https://img.shields.io/badge/dsh-plugin-blue)](https://github.com/topics/dsh-plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

你手上已经有很多技能了：`~/.claude/skills`、`~/.codex/skills`、`~/.cursor/skills`、Claude Code 插件市场里的技能，以及 `anthropics/skills` 这样的 GitHub 仓库。而 DeepSeek Harness 只会扫描 `.dsh/skills` 和 `.agents/skills`。

`dsh-skills-anywhere` 在内置的 `ctx.skills` 注册表上多注册一个提供器，模型原有的 `skill` 工具和 `/name` 调用方式不变，只是能看到更多技能：

- **其他 Agent 的技能目录。** 开箱支持 60+ 个 Agent：Claude Code、Codex、Cursor、Gemini CLI、GitHub Copilot、Windsurf、Kiro、Goose、OpenCode、Roo、Cline、Qwen Code、Trae 等，项目级与用户级都覆盖。
- **Claude Code 插件市场。** 嵌套在 `~/.claude/plugins/marketplaces/*/plugins/*/skills/*` 里的技能，包括 Anthropic 官方市场。
- **任意装满技能的 git 仓库。** 指向 `anthropics/skills`、某个子目录、分支、标签或提交即可。浅克隆到本地缓存，后台刷新，并用 lock 文件锁定版本。
- **零拷贝、零软链接。** 文件在哪就从哪读取，每次加载都重新读。你在 Cursor 里改了技能，dsh 立刻看到。不需要导入，也不需要同步。

它还会**去重**软链接和字节级相同的副本（`skills` CLI 会把同一份技能链接到多个 Agent）、**修复**常见的 frontmatter 偏差而不是悄悄丢掉技能，并对**同名冲突**（`discord/configure` 与 `telegram/configure`）自动加前缀，保证每个技能都能被调用。附带一个小 CLI，让你清楚看到 dsh 会看到什么、为什么。

## 快速开始

```sh
# 1. 安装到你使用的 dsh profile（web 是默认的 UI profile）
dsh plugin --profile web add dsh-skills-anywhere

# 2. 不启动 dsh，直接查看模型将看到的技能
npx dsh-skills-anywhere list

# 3. 添加一整个技能仓库
npx dsh-skills-anywhere add anthropics/skills
```

照常启动 dsh。技能目录里现在包含了上面所有内容；用 `skill` 工具或 `/技能名` 加载，与之前完全一样。

<details>
<summary>从 GitHub 安装（不经 npm）</summary>

```sh
dsh plugin --profile web add github:noteflowai/dsh-skills-anywhere
```

git 安装拿到的是源码，pnpm 需要运行本包的 `prepare` 构建脚本。pnpm 10+ 默认拒绝，需要把它打印出来的包名加到 profile 的 `pnpm-workspace.yaml` 后重新执行 `add`：

```yaml
allowBuilds:
  dsh-skills-anywhere: true
```

需要可复现安装时请锁定提交：`github:noteflowai/dsh-skills-anywhere#<sha>`。

</details>

<details>
<summary>环境要求</summary>

- DeepSeek Harness `0.1.5-rc.1` 及以上，且 profile 挂载了 `@deepseek-ai/dsh-skill`（自带的 `web`、`acp`、`headless`、`sdk` profile 都满足）
- Node.js 22.19+ 或 24+
- git 源需要 `PATH` 中有 `git`（其余功能不依赖 git）

</details>

## 会发现哪些技能

| 位置 | 示例 | dsh source 标签 | 默认 rank |
|---|---|---|---|
| 其他 Agent 的**项目级**技能 | `<project>/.claude/skills/*` | `anywhere-project` | 250 |
| 其他 Agent 的**用户级**技能 | `~/.codex/skills/*`、`~/.cursor/skills/*` | `anywhere-user` | 550 |
| **Claude Code 插件市场**及已安装插件缓存 | `~/.claude/plugins/marketplaces/*/plugins/*/skills/*` | `anywhere-claude-plugins` | 580 |
| **git 源** | `anthropics/skills`、`vercel-labs/agent-skills/skills` | `anywhere-source` | 700 |

在 dsh 注册表里同名技能由 rank 小的胜出。内置根目录保留原有 rank（`.dsh/skills` 100、`.agents/skills` 200、`~/.dsh/skills` 400、`~/.agents/skills` 500），所以你专门为 dsh 写的技能永远优先于别处的同名技能。`.agents/skills` 与 `.dsh/skills` 不会被重复扫描。

运行 `npx dsh-skills-anywhere agents` 查看完整 Agent 表以及本机存在哪些目录。

### 技能格式

任何包含符合 [Agent Skills 规范](https://agentskills.io/specification) 的 `SKILL.md` 的目录，以及 dsh 的平铺 `<name>.md` 形式。支持 `name`、`description`、`license`、`compatibility`、`allowed-tools`、`metadata`，以及 dsh 的 `disable-model-invocation` / `user-invocable`。未知的 frontmatter 字段（如 Claude Code 的 `argument-hint`、`context`）保留在 `metadata.frontmatter` 下。`scripts/`、`references/`、`assets/` 与普通 dsh 技能一样通过资源目录暴露。

默认的**宽松模式**下：缺少 name 时回退到目录名，非法 name 归一化为 kebab-case，缺少 description 时取正文第一段。每次修复都会记录并由 `doctor` 展示。设置 `lenient: false` 可与内置提供器的严格行为保持一致。

## git 源

```sh
npx dsh-skills-anywhere add anthropics/skills                      # 默认分支
npx dsh-skills-anywhere add anthropics/skills@v1.0.0               # 标签或分支
npx dsh-skills-anywhere add vercel-labs/agent-skills/skills        # 子目录
npx dsh-skills-anywhere add https://github.com/o/r/tree/main/dir   # GitHub tree URL
npx dsh-skills-anywhere add git@gitlab.com:group/skills.git        # 任意 git URL
npx dsh-skills-anywhere add ./local/skills-repo --project          # 本地仓库，项目级
npx dsh-skills-anywhere add o/r --ref 3f2a9c1 --rank 300           # 锁定提交，设置优先级
```

源来自三个地方，按顺序合并：插件配置 `config.sources`、用户文件 `~/.dsh/skills-anywhere/sources.json`、项目文件 `<project>/.dsh/skills-anywhere.json`（提交到仓库即可与团队共享）。CLI 负责编辑后两者。

每个仓库只浅克隆一次到 `~/.dsh/skills-anywhere/cache/<host>/<owner>/<repo>`，在 dsh 启动时、每隔 `syncIntervalMs`（默认 6 小时）以及源文件变化时刷新。每个源解析出的提交写入 `~/.dsh/skills-anywhere/lock.json`。发现过程只读缓存，因此刷新失败意味着"昨天的技能"，而不是空目录。刷新带来变化时立即使目录失效；dsh 永远不等待网络。

## CLI

```
dsh-skills-anywhere list [--all] [--json]     提供器发布的技能（--all 显示被隐藏的重复项）
dsh-skills-anywhere agents [--json]           支持的 Agent 及本机存在的目录
dsh-skills-anywhere sources [--json]          已配置的 git 源及已同步的提交
dsh-skills-anywhere add <source> [--ref] [--path] [--rank] [--project]
dsh-skills-anywhere remove <source> [--project]
dsh-skills-anywhere sync [--force] [--json]   立即克隆或刷新全部源
dsh-skills-anywhere doctor [--json]           被修复、跳过、重命名、去重的技能及原因
```

所有命令支持 `--cwd <dir>` 指定项目。CLI 与插件走同一套代码，无需 dsh 运行。

## 配置

在 profile 的 `cordis.patch.yml` 中覆盖该行。patch 会替换整个 `config` 块，因此需要写全所有你关心的键：

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

| 字段 | 默认值 | 含义 |
|---|---|---|
| `providerName` | `skills-anywhere` | 在 `ctx.skills` 上的提供器名 |
| `agents` | `true` | 扫描其他 Agent 的技能目录 |
| `excludeAgents` | `[]` | 跳过的 Agent id（见 `agents` 命令） |
| `extraProjectDirs` | `[]` | 额外的项目相对技能目录 |
| `extraUserDirs` | `[]` | 额外的绝对路径或 `~/` 技能目录 |
| `claudePlugins` | `true` | 扫描 Claude Code 插件市场与缓存 |
| `sources` | `[]` | git 源：字符串或 `{ repo, ref?, path?, rank? }` |
| `sourcesFiles` | `true` | 同时读取用户级与项目级 `sources.json` |
| `cacheDir` | `~/.dsh/skills-anywhere/cache` | 源的检出位置 |
| `sync` | `true` | 是否克隆/刷新 git 源 |
| `syncOnStart` | `true` | 插件启动及项目首次使用时刷新 |
| `syncIntervalMs` | `21600000` | 后台刷新间隔；`0` 表示关闭 |
| `syncTimeoutMs` | `120000` | 单条 git 命令超时 |
| `maxDepth` | `5` | 源与市场内的目录遍历深度 |
| `dedupe` | `true` | 折叠软链接与字节相同的重复项 |
| `lenient` | `true` | 修复可恢复的 frontmatter 而不是跳过 |
| `watch` | `true` | 监视本地根目录，变化时刷新目录 |
| `excludeSkills` | `[]` | 要隐藏的技能名 |
| `ranks` | `{ project: 250, user: 550, claudePlugins: 580, sources: 700 }` | 各组优先级 |
| `dshHome`、`home` | `$DSH_HOME` / `~` | 路径根，主要用于测试 |

## 优先级与去重规则

1. 按 rank 顺序扫描根目录；同一 rank 内按 Agent 表顺序，再按路径。
2. 指向**同一文件**（软链接）的条目折叠为第一个；**同名且正文字节相同**的条目折叠为第一个。两者都在 `doctor` 中显示为隐藏的重复项。
3. 仍然**同名**但内容不同的条目全部保留：第一个保持原名，其余加上插件、仓库或 Agent 前缀（如 `telegram-configure`）。`doctor` 会列出重命名。
4. 随后 dsh 注册表按 rank 把本提供器的候选与内置候选合并。

## 安全说明

- 插件只**读取**技能文件，绝不写入你的 Agent 目录。
- git 源会在插件启动和刷新周期在本机运行 `git`。对不完全信任的源请锁定提交，并检查 `lock.json`。
- 技能是模型会遵循的指令。添加一个源就是一次信任决策，与安装插件无异。
- 技能通过 Node 文件系统 API 读取，而非 dsh 沙箱化的 `ctx.fs`；内置提供器读取自带根目录时也是如此。

## 开发

```sh
pnpm install
pnpm run check        # 类型检查 + lint + 测试 + 构建
pnpm pack             # 生成 tarball，供 `dsh plugin --profile <name> add ./dsh-skills-anywhere-*.tgz`
```

测试直接跑在真实的 `@deepseek-ai/dsh-skill` 注册表和临时目录里的真实 git 仓库上。

## 参与贡献

欢迎 issue 与 PR。新增一个 Agent 只需在 [`src/agents.ts`](src/agents.ts) 里加一行。详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE) © Note Flow AI
