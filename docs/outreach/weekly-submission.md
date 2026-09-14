维护者自荐：`dsh-skills-anywhere`，让不同编程助手访问同一批 Agent Skills。

例如在一个项目里使用 Cursor，另一个项目里使用 Claude Code 或 DeepSeek
Harness，各自的 `SKILL.md` 通常散落在不同目录。本工具直接读取这些目录，
通过 dsh 的技能注册表或 MCP 提供查找、加载能力，不需要复制或创建软链接。

![Skills Anywhere 的技能目录与管理界面](https://raw.githubusercontent.com/noteflowai/dsh-skills-anywhere/v0.4.0/docs/web-card.png)

[Hugging Face 在线试玩](https://huggingface.co/spaces/glayguo/dsh-skills-anywhere)：
无需安装即可查看示例技能的来源、去重和重名处理，调整目录预算并搜索未列出的技能。
样例由真实 provider 处理，浏览器复用项目的预算与搜索代码；页面不读取访客电脑，
不执行技能或调用模型。

主要功能：

- 内置 60 多种 Agent 的项目级、用户级技能目录定义，并发现 Claude Code
  插件市场里的技能；目录识别不代表所有客户端或技能脚本都经过兼容性验证。
- 可添加 Git 技能仓库、指定子目录及版本；支持去重、同名重命名，
  `doctor` 可以解释被跳过、修复或重命名的技能。
- dsh 默认只把前 50 个技能放入模型目录，其余通过搜索工具按需查找，
  同时遵守技能作者禁用模型调用的设置。
- v0.4.0 提供 dsh 网页管理卡片，可查看技能来源，调整目录预算，
  以及 Pin / Hide / Exclude。
- MCP 模式提供技能工具和资源，不需要安装 dsh；客户端仍按自身权限
  和工具能力执行技能中的具体操作。

使用 Node.js 22.19+ 或 24+，先查看支持的目录：

```sh
npx -y dsh-skills-anywhere@0.7.0 agents
```

接入已有的 dsh：

```sh
dsh plugin --profile web add dsh-skills-anywhere@0.7.0
```

也可以按 README 为 MCP 客户端配置
`npx -y dsh-skills-anywhere@0.7.0 mcp`。

仓库：https://github.com/noteflowai/dsh-skills-anywhere

项目采用 MIT 许可，npm 包和官方 MCP Registry 条目均已发布 v0.6.0。
这是独立维护的社区项目，与 AI 结对开发，不代表 DeepSeek 或其他客户端官方。
技能内容会作为模型指令使用；添加 Git 来源前应检查内容，按需固定提交版本。

交互功能更新：在线演示可粘贴或选择自己的 `SKILL.md`，在浏览器中比较严格／宽容解析结果并下载报告。输入不上传，不执行技能；检查范围是本项目解析器的行为。

0.6.0 发布更新：相同的本地解析检查现已提供 CLI 和 CI 用法，可批量检查明确指定的文件，输出工具版本、文件 SHA-256、完整诊断及退出码。支持严格／宽容模式与“有修复即失败”的提交门禁，不修改文件、不执行技能。npm 和官方 MCP Registry 均已发布。

CI 示例与检查范围：https://github.com/noteflowai/dsh-skills-anywhere/blob/main/docs/CHECKING.md

**0.7.0 交付更新**：MCP `open_skill` 返回原始 SKILL.md 的 SHA-256，可传入 `expected_sha256`，发现文件已变化时不返回新指令。MCP 工具、资源和 dsh 提供器都在加载时重新检查作者禁用标志，覆盖目录缓存与预算隐藏场景。已通过三种操作系统检查及实际 npm 包安装验证。文件哈希不覆盖旁边的脚本，也不构成安全认证。

使用说明：https://github.com/noteflowai/dsh-skills-anywhere/blob/main/docs/VERIFIED-LOADS.md
