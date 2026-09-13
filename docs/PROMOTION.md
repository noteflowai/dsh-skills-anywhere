# Publication and community submissions

Checked September 13, 2026. This file records public distribution, existing
community submissions and the next suitable channels. A submission is not
acceptance, and a directory entry is not an upstream endorsement.

## New submissions

| Channel | Record | Status | Exact submitted text |
| --- | --- | --- | --- |
| 科技爱好者周刊 | [#11665](https://github.com/ruanyf/weekly/issues/11665) | Submitted; awaiting editorial selection | [Chinese introduction](outreach/weekly-submission.md) |
| HelloGitHub | [#3695](https://github.com/521xueweihan/HelloGitHub/issues/3695) | Submitted; awaiting review | [Project recommendation form](outreach/hellogithub-submission.md) |

Both identify the maintainer relationship, independent community status and
AI-assisted development. They describe version **0.4.0**, link its tagged
screenshots and distinguish directory discovery from end-to-end compatibility.
The four distinct submission links returned HTTP 200, and GitHub readback
matched the prepared bodies. Public HelloGitHub search returned no matching
entry in the anonymous view; GitHub issue search also found no prior submission.

## Distribution already available

| Entry | Verified state |
| --- | --- |
| [npm](https://www.npmjs.com/package/dsh-skills-anywhere) | Public registry reports 0.4.0 and a provenance attestation. |
| [Official MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.noteflowai%2Fdsh-skills-anywhere/versions/latest) | `io.github.noteflowai/dsh-skills-anywhere`, 0.4.0, active/latest, npm package over stdio. |
| [DeepSeek — Show Your Plugins!](https://github.com/deepseek-ai/deepseek-harness/discussions/6193) | Existing bilingual community showcase, including the web UI card. Reuse this thread for relevant follow-up. |
| [Glama](https://glama.ai/mcp/servers/noteflowai/dsh-skills-anywhere) | Public entry exists, but the fetched page still showed old 0.3.1 tarball instructions and “not on npm yet.” Current npm/main are newer. Directory refresh and quality evaluation remain follow-up work. |

The published npm package was exercised directly with:

```sh
npm exec --yes --package=dsh-skills-anywhere@0.4.0 -- \
  dsh-skills-anywhere agents --json
```

It returned **68 agent directory definitions**. This does not mean 68 complete
agent integrations were tested. The current-source `pnpm run check` also
passed version checks, typechecking, lint, **119 tests**, and the build.

## Existing directory applications

These applications existed before the two Chinese submissions above. All
were open when checked; none is described here as accepted.

| Directory | Existing PR |
| --- | --- |
| Awesome MCP Servers | [#14308](https://github.com/punkpeye/awesome-mcp-servers/pull/14308) |
| Awesome DSH Plugin | [#5004](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/5004) |
| Awesome DeepSeek Harness | [#466](https://github.com/Dominic789654/awesome-deepseek-harness/pull/466) |
| Awesome Claude Code Plugins | [#481](https://github.com/ccplugins/awesome-claude-code-plugins/pull/481) |
| Awesome Gemini CLI | [#126](https://github.com/Piebald-AI/awesome-gemini-cli/pull/126) |
| Awesome Codex CLI | [#267](https://github.com/RoggeOhta/awesome-codex-cli/pull/267) |
| Awesome Claude Skills | [#711](https://github.com/BehiSecc/awesome-claude-skills/pull/711) |
| Awesome Cursor Skills | [#77](https://github.com/spencerpauly/awesome-cursor-skills/pull/77) |
| Awesome OpenCode | [#709](https://github.com/awesome-opencode/awesome-opencode/pull/709) |

The MCP Servers submission's `check-submission` and the DSH Plugin submission's
`check` / `Submission gate` had passed. Those are submission checks, not curator
approval. The Claude Code Plugins PR had no checks or maintainer comments.
No duplicate PR or reminder comment was added.

## Next channels and rules

| Channel | Fit and next step |
| --- | --- |
| DEV Community | Write a complete tutorial using a small, public fixture skill across two clients. Explain precedence, author-disabled skills and the budget. Needs the author's login; disclose AI assistance. |
| 掘金 / 知乎 | Adapt the Chinese submission into a practical walkthrough with the web card and `doctor` output from a fixture. Account access and current site rules have not been checked. |
| Awesome Claude Code | Defer. Its current rules require 14 days since the first default-branch commit plus continued activity, **or** 100 stars. This project is too young and had one star. The recommendation must also be human-written and submitted through the web form; neither CLI submission nor a discussion workaround is allowed. |
| Show HN | The owner must write their own submission and comments and be available to discuss the implementation. Current HN rules prohibit generated/AI-edited comments. Use the factual README; do not generate a paste-ready first comment. |
| Glama | Check the existing entry for a refresh and quality evaluation after its maintainer metadata is processed. The read-only public page is not evidence that its cached README or deploy support is current. |

Check existing issues, PRs and discussions before submitting. Reply on the
original thread when maintainers request changes. Do not add “featured in”
badges until the corresponding listing is accepted, or confuse registry
publication with official endorsement.

### Sources checked

- [Weekly README](https://github.com/ruanyf/weekly): invites software, article
  and resource submissions through issues.
- [HelloGitHub form](https://github.com/521xueweihan/HelloGitHub/blob/master/.github/ISSUE_TEMPLATE/submit-cn.yaml)
  and [review criteria](https://github.com/521xueweihan/HelloGitHub/issues/271):
  self-submissions allowed; original 32–256-character description; documented,
  licensed projects.
- [DeepSeek contribution guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/CONTRIBUTING.md):
  encourages independent plugins and the `dsh-plugin` topic; currently does
  not accept external code PRs. The existing showcase is in its designated
  plugin category.
- [Awesome MCP Servers guide](https://github.com/punkpeye/awesome-mcp-servers/blob/main/CONTRIBUTING.md):
  public installable server repositories, categorized and submitted through PRs.
- [Awesome Claude Code guide](https://github.com/hesreallyhim/awesome-claude-code/blob/main/CONTRIBUTING.md):
  age/adoption gate and human web-form submission.
- [DEV terms](https://dev.to/terms) and [code of conduct](https://dev.to/code-of-conduct):
  substantive on-topic content, not link-only promotion; disclose AI assistance.
- [Show HN](https://news.ycombinator.com/showhn.html) and
  [HN guidelines](https://news.ycombinator.com/newsguidelines.html):
  personally built, usable work; no vote solicitation or AI-written comments.

## Short Chinese introduction

dsh-skills-anywhere 帮助开发者在多个编程助手之间复用现有 Agent Skills：
直接发现本地技能目录、Claude Code 插件市场及 Git 技能仓库，
通过 DeepSeek Harness 插件或 MCP 提供按需查找与加载。
v0.4.0 已发布到 npm 和官方 MCP Registry，提供来源检查、去重、
重名处理、目录预算及网页管理，减少跨工具维护技能副本的工作。
这是 MIT 许可的独立社区项目；实际技能执行仍取决于客户端能力与权限。
