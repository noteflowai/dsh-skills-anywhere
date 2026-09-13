# Publication and community submissions

Checked September 13, 2026. This file records public distribution, existing
community submissions and the next suitable channels. A submission is not
acceptance, and a directory entry is not an upstream endorsement.

## New submissions

| Channel | Record | Status | Exact submitted text |
| --- | --- | --- | --- |
| Hugging Face Space | [Skills Anywhere](https://huggingface.co/spaces/glayguo/dsh-skills-anywhere), [pinned walkthrough](https://huggingface.co/spaces/glayguo/dsh-skills-anywhere/discussions/1) | Public and running; desktop/mobile and Hub embed checked | [Walkthrough](outreach/huggingface-introduction.md) |
| Hugging Face collection | [NoteFlow AI — Open-source playgrounds](https://huggingface.co/collections/glayguo/noteflow-ai-open-source-playgrounds-6aa693c382b0184786eb8856) | Public collection containing Skills Anywhere and Robot Reel; anonymous readback verified | Maintainer-curated collection, not an editorial selection |
| Agent Skills — Show and tell | [#557](https://github.com/agentskills/agentskills/discussions/557) | Public implementation showcase; not a client listing or endorsement | [Discussion body](outreach/agentskills-showcase.md) |
| 科技爱好者周刊 | [#11665](https://github.com/ruanyf/weekly/issues/11665) | Submitted; awaiting editorial selection | [Chinese introduction](outreach/weekly-submission.md) |
| HelloGitHub | [#3695](https://github.com/521xueweihan/HelloGitHub/issues/3695) | Submitted; awaiting review | [Project recommendation form](outreach/hellogithub-submission.md) |

The two Chinese submissions identify the maintainer relationship, independent community status and
AI-assisted development. They describe version **0.4.0**, link its tagged
screenshots and distinguish directory discovery from end-to-end compatibility.
The four distinct submission links returned HTTP 200, and GitHub readback
matched the prepared bodies. Public HelloGitHub search returned no matching
entry in the anonymous view; GitHub issue search also found no prior submission.
Their existing bodies now include the live Hugging Face playground; no duplicate
issues or reminder comments were added.

The Space uses nine authored Markdown files scanned by the actual provider at
build time, and shares the package's catalog and search logic in the browser.
Its first publication used the successful main CI artifact from run
[34756372479](https://github.com/noteflowai/dsh-skills-anywhere/actions/runs/34756372479)
(source `3c9f9f7aa7da5ce6080de6e2699dc1a2b5be54db`).
Anonymous verification matched ten Hub files and six publicly served resources.
Desktop (1440 px), mobile (390 px), downloads and the actual Hub iframe were
exercised. [Publication and reproduction details](HUGGINGFACE.md).
The automatic current-main deployment and anonymous readback subsequently passed
in run [34756607955](https://github.com/noteflowai/dsh-skills-anywhere/actions/runs/34756607955).
The Space cannot read visitors' files, execute skills or host an MCP endpoint.

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
passed version checks, typechecking, lint, **125 tests**, and the build.
The Space also has browser checks and seven publisher regression/guard tests.

## Repository-side work done on September 13, 2026

| Item | State |
| --- | --- |
| DeepSeek showcase [#6193](https://github.com/deepseek-ai/deepseek-harness/discussions/6193) | Title changed to the mandated `DSH \| name \| one-liner` form from the pinned [category guidelines](https://github.com/deepseek-ai/deepseek-harness/discussions/2004); npm install line, test count and the web-card screenshot updated. |
| DeepSeek Q&A replies | Short, disclosed ("unofficial, I am the author") replies on [#6032](https://github.com/deepseek-ai/deepseek-harness/discussions/6032) (no skills page in the UI) and [#3980](https://github.com/deepseek-ai/deepseek-harness/discussions/3980) (importing local skills). No other threads were posted to. |
| GitHub topics | 20 of 20 used, including `dsh-plugin`, `dsh-skill`, `dsh-bundle`, `deepseek-harness-plugin`, `mcp-server`, `claude-code-plugin`, `gemini-cli`. Several DSH catalogs crawl these topics daily (yzfly/awesome-dsh-skills and bruc3van/awesome-dsh-plugin already list the project). |
| `glama.json` | Names the maintainer so the Glama entry can be claimed and refreshed. Claiming needs the owner's GitHub login on the Glama page. |
| Agent Plugins manifest | `plugin.json` + `mcp.json` at the repository root (spec 1.0.0), the precondition for cursor.directory and other open-plugin clients. |

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
| Anthropic community plugin marketplace | Owner-only web form at https://platform.claude.com/plugins/submit (Console login). `claude plugin validate .` passes. Approved plugins are pinned into anthropics/claude-plugins-community and shown on claude.com/plugins. |
| LobeHub MCP marketplace | Owner-only, interactive: `npx -y @lobehub/market-cli` → `login` → `github connect` → `plugin init --stdio "npx -y dsh-skills-anywhere mcp"` → `plugin publish https://github.com/noteflowai/dsh-skills-anywhere`. |
| cursor.directory | Owner-only web form https://cursor.directory/plugins/new (GitHub login); the repository now carries the Agent Plugins manifest it expects. |
| mcpservers.org | Web form https://mcpservers.org/submit (contact e-mail required; free review takes about two weeks). |
| PulseMCP | Nothing to do: submissions are paused and it ingests the official registry when it resumes. |
| agentskills.io | Published the implementation playground in *Show and tell* [#557](https://github.com/agentskills/agentskills/discussions/557), with explicit disclosure that Codex wrote the post on the maintainer's behalf. Reuse that discussion for feedback. The Client Showcase remains unsuitable because this tool does not execute skills. |
| Cursor forum | Showcase category https://forum.cursor.com/c/showcase/9 (owner post). |
| Reddit | r/mcp (`showcase`/`server` flair), r/ClaudeCode (`Built with Claude`), r/ClaudeAI (needs 50 post karma; free-to-try statement). Confirm each sub's rules page before posting; owner-written text only. |
| Smithery, Docker MCP catalog | Only with extra artifacts (an `.mcpb` bundle, respectively a `Dockerfile`); not planned. |
| travisvn/awesome-claude-skills | Defer until the repository has 10 or more stars; the PR must be human-written. |

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
- [Agent Skills contribution guide](https://github.com/agentskills/agentskills/blob/main/CONTRIBUTING.md):
  use Discussions for implementation feedback and disclose the extent of AI
  assistance; client listings require discovery and execution.
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
