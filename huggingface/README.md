---
title: Skills Anywhere
emoji: 🧩
colorFrom: green
colorTo: blue
sdk: static
app_file: index.html
fullWidth: true
header: default
short_description: Check SKILL.md locally and explore shared agent skills.
license: mit
tags:
  - agent-skills
  - mcp
  - deepseek-harness
  - developer-tools
  - interactive-demo
  - skill-validation
thumbnail: https://huggingface.co/spaces/glayguo/dsh-skills-anywhere/resolve/main/thumbnail.png
---

# Your skills, anywhere

Try a sample workspace from **dsh-skills-anywhere**, an open-source Agent Skills
provider for DeepSeek Harness and an MCP server for coding clients.

**Three things to try**

1. Follow skills back to their project, user and plugin-marketplace directories.
2. Inspect two different `configure` skills after their names are disambiguated.
3. Reduce the catalog budget, search for a skill that is no longer listed,
   inspect its instructions, and pin it into the catalog.

**Bring your own SKILL.md.** Paste or open one file (up to 128 KiB) to compare
the provider's strict and lenient modes. Inspect repairs, author invocation
settings and metadata keys, then download a report. Input stays in this page
and is not added to share links or browser storage. This checks parsing only,
not script safety, resources or complete client/specification compatibility.

The fixture uses nine fictional Markdown files. The real filesystem provider
discovers, parses, deduplicates and renames them at build time. The browser
imports the same catalog-selection and search functions used by the package.
Author-disabled skills stay unavailable through the demo's model controls.

**This Space does not scan your computer, execute skills, host an MCP endpoint,
or call a model.** Install the package locally to work with your own directories.
It recognizes 68 agent directory definitions in the current source; that is
directory coverage, not a claim that every client and skill script was tested.

- [Source and installation](https://github.com/noteflowai/dsh-skills-anywhere)
- [Published npm package](https://www.npmjs.com/package/dsh-skills-anywhere)
- [Method and build instructions](https://github.com/noteflowai/dsh-skills-anywhere/blob/main/docs/HUGGINGFACE.md)
- [中文介绍](https://github.com/noteflowai/dsh-skills-anywhere/blob/main/README.zh.md)
- [Feedback](https://huggingface.co/spaces/glayguo/dsh-skills-anywhere/discussions)

## 中文

在示例工作区中体验 Agent Skills 的跨工具发现、去重、重名处理与按需加载。
调整目录预算、搜索未列出的技能，或查看原始文件与校验清单。
样例由真实 provider 在构建时处理；浏览器预算与搜索逻辑复用项目源码。
页面不会读取你的电脑、执行技能或调用模型。使用自己的技能目录需按仓库说明
安装本地工具。

Independent community project by Note Flow AI, developed with AI assistance.
Code and authored example skills are MIT licensed. No upstream affiliation or
endorsement is implied.

## Use the same parser in CI

The 0.6.0 command line checks explicitly named local files, supports strict and
lenient gates, and reports file hashes with exit codes for automation.
[Copy a working CI example](https://github.com/noteflowai/dsh-skills-anywhere/blob/main/docs/CHECKING.md).
The browser and CLI share the parser comparison; neither executes skill instructions.
