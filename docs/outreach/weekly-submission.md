维护者自荐：**dsh-skills-anywhere**。Skills Anywhere 直接发现编程助手目录、插件市场和 Git 仓库中的 SKILL.md，通过 DeepSeek Harness 或 MCP 提供查找与按需加载，无需复制。支持去重、重名处理、目录预算、本地解析检查和按文件哈希加载。0.9.0 新增技能目录清单、脚本／资源变化比较和按目录指纹加载；浏览器演示支持键盘打开／返回详情、保留设置清空搜索、恢复分享视图及本地文件读取失败恢复，适合多工具开发者与团队复用技能。

在线体验：https://huggingface.co/spaces/glayguo/dsh-skills-anywhere

- **目录内容可复核**：CLI 记录 SKILL.md、脚本、引用资料、资源及隐藏文件的路径、字节数和 SHA-256；比较两次清单可定位新增、删除与内容变化。MCP expected_bundle_sha256 在资源变化时拒绝按旧指纹加载。
- **本地清单对比**：首页展示“说明没变、脚本已变”，也可打开自己的两份清单；浏览器先验证清单自身的哈希，再显示差异。清单不上传，不执行脚本。
- **兼容新版 MCP**：使用官方 SDK 2.0.0，同一个 stdio 入口支持旧版初始化与 2026-07-28 协议；四种 SDK 配置通过真实子进程验证，安装包另有新旧客户端检查。目录覆盖和 SDK 互通不等于所有品牌客户端认证。
- **真实的共享目录逻辑**：覆盖 68 种 Agent 目录定义，支持项目／用户目录、插件市场和 Git 来源，提供去重、重名解释、预算、Pin / Hide / Exclude。
- **浏览器体验**：打开技能后聚焦说明，可返回原行；清空搜索保留目录选择；分享链接恢复预算、Pin／Hide 与当前技能。手机按钮更易操作，长说明支持键盘滚动。
- **带入自己的 SKILL.md**：浏览器显示文件读取状态，比较严格／宽容解析并导出报告；拒绝无效 UTF-8，清空或编辑会丢弃旧读取结果。输入不上传、不加入分享链接。CLI/CI 提供相同解析检查和文件哈希。
- **按已审核内容加载**：MCP `open_skill` 支持 `expected_sha256`；文件变化时不返回新指令，并在加载时复查作者禁用标志。

```sh
npx -y dsh-skills-anywhere@0.9.0 bundle /path/to/skill --json > reviewed-bundle.json

# Keep the manifest outside the skill directory:
npx -y dsh-skills-anywhere@0.9.0 bundle /path/to/skill --against reviewed-bundle.json --json
```

要求 Node.js 22.19+ 或 24+；先审核原始文件，清单存放在技能目录外；这些检查无需 dsh、Git 或模型 API：

项目：https://github.com/noteflowai/dsh-skills-anywhere
版本：https://github.com/noteflowai/dsh-skills-anywhere/releases/tag/v0.9.0

![让不同编程助手共享现有 Agent Skills](https://huggingface.co/spaces/glayguo/dsh-skills-anywhere/resolve/main/thumbnail.png)

维护者自荐：独立社区项目，与 AI 结对开发，MIT 许可，不代表上游官方。目录覆盖不等于所有客户端或技能脚本通过兼容验证。浏览器使用示例工作区，不扫描访客电脑、不运行技能或模型；解析和文件身份检查不构成脚本安全认证，目录指纹也不锁定之后执行时的文件。外部依赖、权限与作者身份不在指纹范围内。
