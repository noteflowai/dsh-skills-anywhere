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
  - physical-ai
  - microduck
thumbnail: https://huggingface.co/spaces/glayguo/dsh-skills-anywhere/resolve/main/thumbnail.png
---

# Skills Anywhere — discover, review and load agent skills

Collect skills from local directories and configured Git sources into one
catalog. Review instruction and resource changes, then load the reviewed version
through DeepSeek Harness or a local MCP server.

This Space lets you explore the catalog and check files in your browser.
Your local files stay on your device. No account or model API is needed.

## Start with a task

| Task | Try in this Space | Continue locally |
| --- | --- | --- |
| Find a skill across tools | Follow sources, resolve name clashes and search beyond the catalog budget | Discover your directories with the CLI; connect dsh or an MCP client |
| Check a SKILL.md before loading | Compare strict and lenient parsing; inspect external addresses and declared tools | Use the same parser in CI and require the reviewed file hash when loading |
| Review supporting-file changes | Compare two directory manifests, including scripts behind unchanged instructions | Generate a bundle manifest and require its hash with MCP `open_skill` |
| Review a robot recording | Select **04 Review robot evidence** and inspect the Microduck review skill | Follow the [local MCP walkthrough](https://github.com/noteflowai/dsh-skills-anywhere/blob/main/docs/PHYSICAL_AI.md) |

Download check reports and manifests for review. Workspace share links preserve
catalog settings and selection; local file contents are excluded from links and
browser storage.

## Use your own skills

With Node.js 22.19+ or 24+, inspect discovered skills:

```sh
npx dsh-skills-anywhere list
```

The CLI and MCP server work independently of dsh. Follow the
[installation guide](https://github.com/noteflowai/dsh-skills-anywhere#quick-start)
for your client and the
[compatibility matrix](https://github.com/noteflowai/dsh-skills-anywhere/blob/main/docs/MCP-COMPATIBILITY.md)
for tested protocol configurations. Git sources additionally require Git and
use a managed local checkout.

- [Check a file in CI](https://github.com/noteflowai/dsh-skills-anywhere/blob/main/docs/CHECKING.md)
- [Load the reviewed file version](https://github.com/noteflowai/dsh-skills-anywhere/blob/main/docs/VERIFIED-LOADS.md)
- [Review directory changes](https://github.com/noteflowai/dsh-skills-anywhere/blob/main/docs/BUNDLES.md)
- [Inspect delivery receipts](https://github.com/noteflowai/dsh-skills-anywhere/blob/main/docs/LOAD-RECEIPTS.md)

## How the demo works

The package's provider discovers and processes authored example files at build
time. Search and catalog controls reuse the package's code in the browser.
The prepared workspace includes fictional examples and a usable robot-review
skill; author-disabled skills stay unavailable through its model controls.

The Space provides local parsing and manifest comparison. Directory scanning,
MCP connections and skill execution take place in your installed tools.
Agent directory definitions describe discovery paths; client protocol support
is documented separately. See the
[build method](https://github.com/noteflowai/dsh-skills-anywhere/blob/main/docs/HUGGINGFACE.md).

Parser checks report recognized metadata and source-address forms. Content
hashes identify reviewed bytes. Author authenticity, referenced content,
script behavior and execution permissions require their own checks; the
client controls tool access and files may change after loading.

## Research examples

[Inspect 27 recorded Qwen3-8B attempts](https://noteflowai.github.io/evalarc/skill-impact/)
across no-skill, direct-delivery and MCP conditions, with independent grading
and all failures retained.
[Composition and public-session handoff records](https://noteflowai.github.io/evalarc/research/)
are separate small pilots. These public-development records document the
experiments; general skill or memory efficacy requires separate evaluation.

## 中文

Skills Anywhere 汇总本地目录与 Git 源中的技能，支持按需发现、变更复核与版本固定加载。
在此页面可体验示例目录，检查自己的 SKILL.md，或比较技能目录清单；本地文件仅在浏览器中处理。
实际目录发现、MCP 连接与技能执行通过本地安装的工具完成。
[中文说明与快速开始](https://github.com/noteflowai/dsh-skills-anywhere/blob/main/README.zh.md)。

Independent community project by Note Flow AI, developed with AI assistance.
Code and authored example skills are MIT licensed. Upstream projects are credited
as integration sources; no affiliation or endorsement is implied.

[Source](https://github.com/noteflowai/dsh-skills-anywhere) ·
[npm package](https://www.npmjs.com/package/dsh-skills-anywhere) ·
[Feedback](https://huggingface.co/spaces/glayguo/dsh-skills-anywhere/discussions)
