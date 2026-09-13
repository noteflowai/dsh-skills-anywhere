### 项目地址

https://github.com/noteflowai/dsh-skills-anywhere

### 类别

人工智能

### 项目标题

让不同编程助手共享现有 Agent Skills

### 项目描述

这是一个共享 Agent Skills 的 TypeScript 工具，直接发现不同编程助手目录、Claude Code 插件市场和 Git 仓库中的 SKILL.md，通过 DeepSeek Harness 插件或 MCP 提供查找、加载能力，无需复制或软链接。支持去重、重名处理、目录预算和网页管理，适合多工具开发者及团队复用技能。采用 MIT 许可。

### 亮点

- 让已有技能保持原来的存放位置，通过工具查询来源；修改本地技能后，
  加载时读取最新内容。
- 内置 60 多种 Agent 的目录定义，同时支持项目级、用户级目录及 Git
  技能仓库。这里指目录识别能力，不声称所有客户端和技能执行都已验证。
- dsh 模型目录默认最多列出 50 个技能，其余可按需搜索，避免把整个技能库
  都塞进每次请求；技能作者禁用模型调用的设置仍有效。
- v0.4.0 的 dsh 网页卡片可按来源浏览技能，查看目录状态，设置 Pin、Hide、
  Exclude 和预算；CLI 的 `doctor` 可说明修复、跳过、去重及重命名原因。
- MCP 服务独立于 dsh 运行，提供技能查找、打开和资源读取。

维护者自荐：这是与 AI 结对开发的独立社区项目，仍处于早期阶段，
不代表 DeepSeek、Anthropic 或其他客户端官方。技能是模型将读取的指令，
引入外部仓库前需自行审阅；它不提供额外的脚本执行沙箱。

### 示例代码

要求 Node.js 22.19+ 或 24+。以下命令查看支持的目录，
无需启动 dsh 或配置模型 API：

```sh
npx -y dsh-skills-anywhere@0.4.0 agents
```

独立 MCP 服务启动命令，供 MCP 客户端按 README 配置：

```sh
npx -y dsh-skills-anywhere@0.4.0 mcp
```

### 截图或演示视频

[Hugging Face 交互演示](https://huggingface.co/spaces/glayguo/dsh-skills-anywhere)：
无需安装，可操作来源检查、去重与重名场景、目录预算和按需搜索。
演示采用虚构示例文件并复用项目逻辑，不读取访客电脑、不执行技能或调用模型。

![按来源浏览技能与调整目录预算](https://raw.githubusercontent.com/noteflowai/dsh-skills-anywhere/v0.4.0/docs/web-card.png)

CLI 演示：https://raw.githubusercontent.com/noteflowai/dsh-skills-anywhere/v0.4.0/docs/demo.gif

中文说明：https://github.com/noteflowai/dsh-skills-anywhere/blob/v0.4.0/README.zh.md
