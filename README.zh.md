# dsh-skills-anywhere

**跨工具发现与加载技能。** 将本地目录和已配置 Git 源中的
[Agent Skills](https://agentskills.io) 汇入统一目录，通过
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）实时提供器
或本地 stdio MCP 服务器按需访问。

[English](README.md) | 中文

[![CI](https://github.com/noteflowai/dsh-skills-anywhere/actions/workflows/ci.yml/badge.svg)](https://github.com/noteflowai/dsh-skills-anywhere/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-skills-anywhere?label=npm)](https://www.npmjs.com/package/dsh-skills-anywhere)
[![dsh plugin](https://img.shields.io/badge/dsh-plugin-blue)](https://github.com/topics/dsh-plugin)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/noteflowai/dsh-skills-anywhere/badge)](https://scorecard.dev/viewer/?uri=github.com/noteflowai/dsh-skills-anywhere)
[![Glama maintenance rating](https://glama.ai/mcp/servers/noteflowai/dsh-skills-anywhere/badges/score.svg)](https://glama.ai/mcp/servers/noteflowai/dsh-skills-anywhere)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## 从你的工作流开始

| 需求 | 使用方式 |
| --- | --- |
| 在多个 Agent 工具中复用技能 | 汇总本地目录与 Git 源，通过 dsh 或本地 MCP 按需加载 |
| 审核技能变更后再加载 | 比较说明文件与目录清单，要求加载内容匹配已审核的哈希 |
| 核对 Agent 收到了哪些指令 | 保存 MCP 加载回执，关联工具调用和任务评测结果 |

## 快速开始

需要 Node.js 22.19+ 或 24+。CLI 和本地 MCP 服务器可独立使用；Git 源另需 Git。

先查看已发现的技能：

```sh
npx dsh-skills-anywhere list
```

接入 MCP 客户端时，使用[本地服务器配置](#作为-mcp-服务器使用)。使用 DeepSeek Harness 时，安装到所用 profile：

```sh
dsh plugin --profile web add dsh-skills-anywhere
```

启动 dsh 后通过 `skill` 工具或 `/技能名` 加载。需要添加 Git 源时运行
`npx dsh-skills-anywhere add anthropics/skills`。
[安装详情](#安装详情与目录示例)包括发布包、源码安装和 dsh 版本要求。

## 先在浏览器体验

**检查自己的 `SKILL.md`。** Hugging Face 演示可在浏览器中并排检查严格模式与宽容模式，
查看字段修复、调用设置并下载检查报告。文件不会上传；检查范围是本项目的解析行为，
报告列出识别到的外部来源地址、完整提交号形式与作者工具声明；
引用内容、脚本行为及客户端兼容性需要单独验证。

[![本地技能检查：解析结果、外部来源地址及作者工具声明。](docs/source-review.png)](https://huggingface.co/spaces/glayguo/dsh-skills-anywhere)

**[体验 Hugging Face 交互演示](https://huggingface.co/spaces/glayguo/dsh-skills-anywhere)**：在示例工作区中查看技能来源、处理重名、调整目录预算，并搜索未列出的技能。无需安装或模型 API。[演示原理](docs/HUGGINGFACE.md)。

查看技能指令、比较目录清单或分享目录视图。键盘导航保留选中行与目录设置，
用于本地复核的文件始终在浏览器中处理。

## 目录如何汇总

不同客户端使用的项目级、用户级和插件目录存在差异。Skills Anywhere 原地发现
已配置来源中的 `SKILL.md`，通过 dsh 或已连接本地服务器的 MCP 客户端提供统一目录。
目录定义描述发现路径；已测试的协议连接单独记录在[兼容矩阵](docs/MCP-COMPATIBILITY.md)中。

<p align="center"><img src="docs/demo.gif" alt="dsh-skills-anywhere list 找到来自 Claude Code、Codex、Cursor、Gemini CLI、Goose、Windsurf、Kiro 的技能，再从 GitHub 加入 anthropics/skills" width="880"></p>

在 dsh 里，它在内置的 `ctx.skills` 注册表上多注册一个提供器，模型原有的 `skill` 工具和 `/name` 调用方式不变，只是能看到更多技能：

- **预定义的 Agent 目录。** 包括 Claude Code、Codex、Cursor、Gemini CLI、GitHub Copilot、Windsurf、Kiro、Goose 等项目级和用户级路径，具体见[目录注册表](src/agents.ts)。
- **Claude Code 插件市场。** 嵌套在 `~/.claude/plugins/marketplaces/*/plugins/*/skills/*` 里的技能，包括 Anthropic 官方市场。
- **已配置的 Git 源。** 指定技能仓库、子目录、分支、标签或提交；提供器维护本地检出，并在 lock 文件中记录实际提交。
- **原地读取本地文件。** 每次加载重新读取已有技能，无需复制到各客户端目录。Git 源使用下文说明的托管缓存。

**目录预算**控制进入模型会话目录的技能摘要数量，默认最多 50 个。
其他允许调用的技能仍可通过 `find_skills` 搜索并按需加载，`/name` 调用方式不变。

这套技能池**在 dsh 之外也能用**：`dsh-skills-anywhere mcp` 通过工具和
`skill://` 资源供已配置的 [MCP](https://modelcontextprotocol.io) 客户端发现和加载。
具体工作流取决于客户端对工具调用、资源和技能指令的支持。

提供器会**去重**软链接和字节相同的条目，支持文档中列明的 frontmatter **修复**，
并对 `discord/configure`、`telegram/configure` 等**重名条目**添加前缀。
CLI 展示实际发布的目录、跳过的条目及每项变更的原因。

## 检查技能交付

成功的 MCP `open_skill` 调用返回加载回执，关联已交付的指令正文、原始 SKILL.md
与可选目录摘要。调用方可将回执关联到工具 span，再与任务结果一起检查。
回执记录交付事实；指令遵循与权限执行需要分别检查。
[数据契约](docs/LOAD-RECEIPTS.md) ·
[EvalArc 评估工作台](https://noteflowai.github.io/evalarc/trace-workbench/index.html)。

## 示例：复核机器人记录

通过 MCP 加载 Microduck 帧复盘技能，让 Agent 先调用 Robot Reel 校验原始
关节记录，再整理有依据的结论。
[交互技能示例](https://huggingface.co/spaces/glayguo/dsh-skills-anywhere)
（选择 **04 Review robot evidence**）· [本地操作说明](docs/PHYSICAL_AI.md) ·
[可复用技能](examples/robot-reel-review/SKILL.md)。
网页展示技能内容；只读校验由你所用 Agent 的执行工具完成，无需重新仿真或 GPU。

## 审核后加载同一份文件

MCP `open_skill` 返回原始文件的 SHA-256。传入 `check --json` 或之前一次
打开结果中的 `expected_sha256`，文件变化时会在返回指令前拒绝加载。
作者刚设置的禁用标志立即生效，不受目录缓存影响。
[固定文件版本的使用说明](docs/VERIFIED-LOADS.md)。

**MCP 协议支持：** 本地 stdio 命令支持旧版初始化与 2026-07-28 协议握手；
四种 SDK 配置和安装后的 npm 包均通过真实子进程验证。
[兼容范围与嵌入迁移说明](docs/MCP-COMPATIBILITY.md)。具体客户端工作流的验证范围见该矩阵。

**审核技能目录里的全部文件。** `bundle /path/to/skill --json` 生成目录清单，
可比较脚本／资源的新增、删除和内容变化，再通过 MCP `expected_bundle_sha256` 按审核指纹加载。
[首页对比区](https://huggingface.co/spaces/glayguo/dsh-skills-anywhere)展示“说明没变、脚本已变”，
也支持在本地浏览器比较自己的两份清单。[流程与边界](docs/BUNDLES.md)。
指纹覆盖该目录内记录的路径与文件内容。外部依赖和执行权限需要另行审核；
文件在加载后仍可能变化。

[![SKILL.md 未变、脚本已变：在本地比较技能目录清单。](docs/bundle-review.png)](https://huggingface.co/spaces/glayguo/dsh-skills-anywhere)

## 安装详情与目录示例

已发布到 [npm](https://www.npmjs.com/package/dsh-skills-anywhere)，附有构建来源（provenance）；
每个 [GitHub release](https://github.com/noteflowai/dsh-skills-anywhere/releases) 也提供相同的 tarball。

以下为目录发现的输出示例，路径与数量取决于本地安装和已配置来源：

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
<summary>不用 npm：从 git 检出或 release tarball 安装</summary>

每个 [GitHub release](https://github.com/noteflowai/dsh-skills-anywhere/releases) 都附带预构建的 tarball，`dsh plugin add` 和 `npx` 都可以直接使用它的 URL（`https://github.com/noteflowai/dsh-skills-anywhere/releases/download/v0.13.0/dsh-skills-anywhere-0.13.0.tgz`）。若需要尚未发布的提交：

```sh
dsh plugin --profile web add github:noteflowai/dsh-skills-anywhere
```

git 安装拿到的是源码，pnpm 需要运行本包的 `prepare` 构建脚本。pnpm 10+ 默认拒绝：第一次 `add` 会失败并打印出需要放行的精确键名（包含提交哈希）。把它原样复制到 profile 的 `pnpm-workspace.yaml` 后重新执行 `add`：

```yaml
# $DSH_HOME/profiles/web/pnpm-workspace.yaml
allowBuilds:
  'dsh-skills-anywhere@https://codeload.github.com/noteflowai/dsh-skills-anywhere/tar.gz/<sha>': true
```

需要可复现安装时请锁定提交：`github:noteflowai/dsh-skills-anywhere#<sha>`。

</details>

<details>
<summary>环境要求</summary>

- DeepSeek Harness `0.1.5-rc.1` 及以上（测试套件在 `0.1.5-rc.1` 和 `0.1.5-rc.2` 上通过），且 profile 挂载了 `@deepseek-ai/dsh-skill`（自带的 `web`、`acp`、`headless`、`sdk` profile 都满足）
- Node.js 22.19+ 或 24+
- git 源需要 `PATH` 中有 `git`（其余功能不依赖 git）

</details>

## 会发现哪些技能

| 位置 | 示例 | dsh source 标签 | 默认 rank |
|---|---|---|---|
| 其他 Agent 的**项目级**技能 | `<project>/.claude/skills/*`、`<project>/.cursor/skills/*` | `anywhere-project` | 250 |
| 其他 Agent 的**用户级**技能 | `~/.codex/skills/*`、`~/.cursor/skills/*` | `anywhere-user` | 550 |
| **Claude Code 插件市场**及已安装插件缓存 | `~/.claude/plugins/marketplaces/*/plugins/*/skills/*` | `anywhere-claude-plugins` | 580 |
| **git 源** | `anthropics/skills`、`vercel-labs/agent-skills/skills` | `anywhere-source` | 700 |

在 dsh 注册表里，同名技能按较小的 rank 优先。内置目录保留原值：
`.dsh/skills` 为 100、`.agents/skills` 为 200、`~/.dsh/skills` 为 400、
`~/.agents/skills` 为 500。不同来源按这些数值共同排序，例如 rank 250 的
Agent 项目级条目优先于 rank 400 的 dsh 用户级条目。
内置 `.agents/skills` 与 `.dsh/skills` 目录不会被重复扫描。

运行 `npx dsh-skills-anywhere agents` 查看完整 Agent 表以及本机存在哪些目录。

### 技能格式

提供器读取包含 `SKILL.md` 的目录及 dsh 的平铺 `<name>.md` 文件，
采用 [Agent Skills 格式](https://agentskills.io/specification)。
解析 `name`、`description`、`disable-model-invocation` 与 `user-invocable`，
并保留 `license`、`compatibility`、`allowed-tools` 和 `metadata`。

`compatibility` 与 `allowed-tools` 是作者声明，运行环境要求和工具权限由客户端管理。
`argument-hint`、`context` 等未知字段保留在 `metadata.frontmatter` 中；
保留字段不代表实现了原客户端的对应行为。`scripts/`、`references/`、`assets/`
通过技能资源目录提供给调用方使用。

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

每个仓库在 `~/.dsh/skills-anywhere/cache/<host>/<owner>/<repo>` 维护本地检出；
指定分支、标签或提交时使用 `<repo>@<ref>`。后台同步在启动时、
每隔 `syncIntervalMs`（默认 6 小时）以及来源配置变化时运行，
实际提交写入 `~/.dsh/skills-anywhere/lock.json`。
发现过程读取已有缓存。刷新失败时保留已有检出；从未同步成功的源没有可用缓存技能。
成功更新后使目录缓存失效，发现过程无需等待网络同步。

## 目录预算与 `find_skills` / `open_skill` 工具

dsh 会把每个模型可调用技能的名称和描述放进会话，每次请求都带上。加上插件市场和几个 git 源，这就是几百行上下文。因此提供器会对技能排序，只把前 `catalog.limit` 个（默认 50）标记为模型可调用；其余技能以关闭模型调用的方式发布，不进目录，但你仍可用 `/name` 加载。

由 `dsh-skills-anywhere/tools` 行注册的两个工具让模型也能触达被隐藏的部分：

- **`find_skills(query, limit?)`** 按关键词搜索全部技能（名称、描述、`whenToUse`、来源），无论是否在目录中，并标明哪些已列出。
- **`open_skill(name)`** 按精确名称加载任意技能，包括被预算隐藏的。frontmatter 里写了 `disable-model-invocation: true` 的技能仍会被拒绝，与内置 `skill` 工具行为一致。

```yaml
- id: skills-anywhere
  config:
    catalog:
      limit: 30                       # 0 = 不限制（旧行为）
      pin: [frontend-design]          # 始终列出
      hide: [example-skill]           # 从不列出，但仍可搜索、可 /name 调用
- id: skills-anywhere-tools
  config:
    findLimit: 10
```

作者禁用的技能不占预算。哪些技能保留在目录中遵循下文的优先级顺序：项目级优先于用户级，再优先于市场与 git 源。工具行依赖工具运行时（`ctx.tools`）；在没有它的 profile 中该行保持挂起，提供器独立工作。

## CLI

**提交前检查技能。** 运行 `npx -y dsh-skills-anywhere@0.12.0 check
skills/example/SKILL.md --fail-on-repair`，使用与在线体验相同的解析器，
批量检查明确指定的文件，输出带文件摘要的 JSON 报告和 CI 退出码。
默认严格解析，`--lenient` 接受提供者的修复，`--fail-on-repair` 要求没有修复。
不会扫描其他目录、同步仓库或执行技能。[命令、CI 示例与检查范围](docs/CHECKING.md)。

```
dsh-skills-anywhere list [--all] [--json]     提供器发布的技能（--all 显示被隐藏的重复项）
dsh-skills-anywhere agents [--json]           Agent 目录定义及本机存在的路径
dsh-skills-anywhere sources [--json]          已配置的 git 源及已同步的提交
dsh-skills-anywhere add <source> [--ref] [--path] [--rank] [--project]
dsh-skills-anywhere remove <source> [--project]
dsh-skills-anywhere sync [--force] [--json]   立即克隆或刷新全部源
dsh-skills-anywhere doctor [--json]           被修复、跳过、重命名、去重的技能及原因
dsh-skills-anywhere mcp                       通过 stdio MCP 向已配置客户端提供技能
```

所有命令支持 `--cwd <dir>` 指定项目。CLI 与插件走同一套代码，无需 dsh 运行。

## 作为 MCP 服务器使用

`dsh-skills-anywhere mcp` 启动本地 stdio
[Model Context Protocol](https://modelcontextprotocol.io) 服务器，
通过以下工具提供相同的已配置来源、去重与命名规则。
在兼容客户端的 MCP 配置中注册该服务器即可连接：

| 工具 | 作用 |
| --- | --- |
| `list_skills` | 浏览全部允许模型调用的技能及其描述、来源（支持 `limit`、`offset`） |
| `find_skills` | 按关键词搜索名称、描述与来源 |
| `open_skill` | 加载某个技能的完整指令，以及其脚本和参考文件所在目录 |

技能同时以 `skill://<名称>` 资源提供，并为支持资源引用的客户端提供自动补全。
MCP 工具与资源入口会排除 frontmatter 设置了 `disable-model-invocation: true`
的技能。服务器可独立于 dsh 运行。

下面提供客户端配置示例。自动连接检查覆盖[兼容矩阵](docs/MCP-COMPATIBILITY.md)
列出的四种 SDK 配置及安装后的发布包；具体应用行为取决于客户端版本及其对工具和资源的支持。

**Claude Code**（作为插件安装；本仓库同时也是一个插件市场）

```sh
claude plugin marketplace add noteflowai/dsh-skills-anywhere
claude plugin install dsh-skills-anywhere@noteflowai
```

也可以只注册裸服务器：`claude mcp add skills-anywhere -- npx -y dsh-skills-anywhere mcp`。两种方式都需要重启一次 Claude Code 才会连接。

**Cursor**（`.cursor/mcp.json` 或 `~/.cursor/mcp.json`）

```json
{ "mcpServers": { "skills-anywhere": { "command": "npx", "args": ["-y", "dsh-skills-anywhere", "mcp"] } } }
```

**Codex**（`~/.codex/config.toml`）

```toml
[mcp_servers.skills-anywhere]
command = "npx"
args = ["-y", "dsh-skills-anywhere", "mcp"]
```

[MCP 目录](https://registry.modelcontextprotocol.io)标识为
`io.github.noteflowai/dsh-skills-anywhere`。仓库也提供
[Agent Plugin](https://agent-plugins.org) 清单（`plugin.json` 与 `mcp.json`），
供支持该格式的客户端使用；请按所用客户端的流程安装。

如果客户端在项目目录之外启动服务器，加上 `--cwd <dir>`。已配置的 Git 源会在启动时后台同步。
嵌入自己的程序时，`import { createSkillsAnywhereServer } from 'dsh-skills-anywhere/mcp'`
返回 `McpServer` 和提供器，传输层接入方式见[嵌入与迁移指南](docs/MCP-COMPATIBILITY.md#embedding-the-server)。

## 在 dsh web 界面里浏览和开关技能

在 `dsh web` 中打开 **设置 → 插件 → 插件配置**，**Skills Anywhere** 卡片会列出提供器找到的全部技能，按所在位置分组（Agent 目录、Claude Code 插件、git 源），并标出目录状态——*已列出*给模型、*未列出*（被预算或你挡在目录外）或*作者禁用*——以及重名时被改成的名字。每一行提供 **置顶**（始终列出）、**隐藏**（不进模型目录，但 `/名称` 和 `find_skills` 仍可达）和 **排除**（从提供器中彻底去掉）；目录预算可以就地修改，筛选框按名称、描述和来源搜索。

<p align="center"><img src="docs/web-card.png" alt="dsh web 设置中的 Skills Anywhere 卡片：技能按来源分组，标出已列出 / 未列出 / 作者禁用状态与改名，并提供置顶、隐藏、排除操作" width="720"></p>

修改会作为 `skills-anywhere` 命名空间写入 profile 的 dsh 设置文档，叠加在 `cordis.patch.yml` 的 `catalog` 和 `excludeSkills` 之上，模型目录立即跟随变化：无需重启，无需手改文件。卡片只在挂载了 dsh 设置服务和 web 服务器的 profile 中出现（自带的 `web` profile 满足）；其他场合提供器的行为与组合配置完全一致。

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
| `excludeSkills` | `[]` | 要隐藏的技能名（原始 frontmatter 名或 `list` 显示的发布名均可）；可在 web 卡片中运行时修改 |
| `ranks` | `{ project: 250, user: 550, claudePlugins: 580, sources: 700 }` | 各组优先级 |
| `catalog.limit` | `50` | 本提供器进入模型目录的技能数；`0` = 不限制 |
| `catalog.pin` | `[]` | 始终列出的名称 |
| `catalog.hide` | `[]` | 从不列出的名称（仍可 `/name` 调用和搜索） |
| `dshHome`、`home` | `$DSH_HOME` / `~` | 路径根，主要用于测试 |

`dsh-skills-anywhere/tools` 行接受 `findLimit`（默认 10）、`findMaxLimit`（50），以及 `find` / `open` 布尔值以便只注册其中一个工具。

## 优先级与去重规则

1. 按 rank 顺序扫描根目录；同一 rank 内按 Agent 表顺序，再按路径。
2. 指向**同一文件**（软链接）的条目折叠为第一个；**同名且正文字节相同**的条目折叠为第一个。两者都在 `doctor` 中显示为隐藏的重复项。
3. 仍然**同名**但内容不同的条目全部保留。如果其中有你自己的（来自 Agent 目录），它保持原名，其余加上插件、仓库或 Agent 前缀（如 `telegram-configure`）；如果全部来自市场或 git 源，则全部加前缀，得到 `discord-access`、`telegram-access` 而不是一个没有意义的 `access`。`doctor` 会列出重命名。
4. 随后 dsh 注册表按 rank 把本提供器的候选与内置候选合并。

## 集成示例与实测结果

通过示例将交付回执与另行计算的任务检查关联起来。
报告保留技能指令、工具结果与每一份交付程序，便于复核完整过程。

| 工作流 | 示例与证据 | 实测结果 |
| --- | --- | --- |
| 对照技能交付方式 | [27 次 Qwen3-8B 尝试](https://noteflowai.github.io/evalarc/skill-impact/)，分三组工程配置比较无技能、直接交付与 MCP | 直接交付与 MCP 条件均无尝试完全完成任务；最后一组配置中，无技能条件有 2/3 次完全完成。 |
| 从指定会话继续工作 | [Funes MCP 源码示例](examples/funes-handoff/README.md)与[六次接续尝试](https://noteflowai.github.io/evalarc/funes-handoff/)，每种条件三次 | 六次检索调用全部成功；六份程序均未修改，两种条件各有 0/3 次完全完成任务。 |

[复核独立来源 SWE 任务](https://noteflowai.github.io/evalarc/independent-swe/index.html)：
另一组固定实验在 Astropy、pytest、SymPy 三个公开任务上保留四条件共 36 次尝试。
直接加载与 MCP 预加载交付相同指令，无关内容组也匹配初始提示长度。
没有尝试获得原生验收：31 次有可判读报告，5 次因上游基础设施标记而保留为不确定；
8 次产生非空补丁。[中文方法与离线记录](https://github.com/noteflowai/evalarc/blob/main/examples/independent-swe/README.zh-CN.md)
分别呈现工具失败、原始评分标签和不完整用量。

[携带前序会话的固定技能版本继续工作](https://noteflowai.github.io/evalarc/skill-handoff/)：
另一组独立保存的六次尝试均由工作流通过 MCP 预加载相同的历史技能。
六次加载均成功，记忆组合计成功检索六次；六份程序均未修改，完整任务验收为 0/6。
报告将原始版本指纹、交付回执、检索内容与任务检查逐项关联。

[运行期行为报告](https://noteflowai.github.io/evalarc/behavior-audit/index.html)与
[隔离技能组合示例](examples/behavior-lab/README.md)分别展示最终文件验收、服务提交和授权检查。
报告保留 32 个原生脚本对照及全部 12 次模型尝试；模型没有完成所需服务提交。
[中文方法](https://github.com/noteflowai/evalarc/blob/main/examples/behavior-audit/README.zh-CN.md)
提供复现步骤和结果的解释范围。

这些小规模公开任务研究用于评估特定工作流；普遍的技能或记忆效果收益需要另行验证。
[研究说明](docs/research-pilots.md)集中提供复现方法、技能组合对照与各批次记录。

## 安全说明

- 插件只**读取**技能文件，绝不写入你的 Agent 目录。
- git 源会在插件启动和刷新周期在本机运行 `git`。对不完全信任的源请锁定提交，并检查 `lock.json`。
- 加载技能会把指令加入 Agent 上下文。使用前应检查指令及引用脚本；执行权限由客户端控制，加载成功不保证模型遵循指令。
- 技能通过 Node 文件系统 API 读取，而非 dsh 沙箱化的 `ctx.fs`；内置提供器读取自带根目录时也是如此。

## 开发

```sh
pnpm install
pnpm run check        # 类型检查 + lint + 测试 + 构建
pnpm pack             # 生成 tarball，供 `dsh plugin --profile <name> add ./dsh-skills-anywhere-*.tgz`
```

测试直接跑在真实的 `@deepseek-ai/dsh-skill` 注册表和临时目录里的真实 git 仓库上。

## 参与贡献

欢迎 issue 与 PR。在 [`src/agents.ts`](src/agents.ts) 中添加发现路径时，
请注明来源并验证目录发现行为。客户端接入需要单独检查协议与工作流。
详见[贡献指南](CONTRIBUTING.md)。

社区收录：[Awesome DeepSeek Harness](https://github.com/Dominic789654/awesome-deepseek-harness) ·
[Awesome Gemini CLI](https://github.com/Piebald-AI/awesome-gemini-cli)。
[发布历史与核验记录](docs/PROMOTION.md)。

## 许可证

[MIT](LICENSE) © Note Flow AI
