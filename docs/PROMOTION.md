# Publication and community submissions

Checked September 14, 2026. This file records public distribution, existing
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
| mcpservers.org | [Submission form](https://mcpservers.org/submit) | Free submission received September 14; awaiting review, not yet listed | [Exact fields and confirmation](outreach/mcpservers-submission.md) |

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
The sample catalog cannot scan visitor directories. The optional browser checker reads only pasted text or explicitly selected files; it executes no skills and hosts no MCP endpoint.

## Distribution already available

| Entry | Verified state |
| --- | --- |
| [npm](https://www.npmjs.com/package/dsh-skills-anywhere) | Public registry reports 0.6.0 and a provenance attestation. |
| [Official MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.noteflowai%2Fdsh-skills-anywhere/versions/latest) | `io.github.noteflowai/dsh-skills-anywhere`, 0.6.0, active/latest, npm package over stdio. |
| [DeepSeek — Show Your Plugins!](https://github.com/deepseek-ai/deepseek-harness/discussions/6193) | Existing bilingual community showcase, including the web UI card. Reuse this thread for relevant follow-up. |
| [Glama](https://glama.ai/mcp/servers/noteflowai/dsh-skills-anywhere) | Public entry and **maintenance rated A** badge verified. The fetched README still referenced 0.5.1 while npm is 0.6.0. The rating is a maintenance signal, not a security or client-compatibility certification. Refreshing the cached entry remains follow-up work. |

The published npm package was exercised directly with:

```sh
npm exec --yes --package=dsh-skills-anywhere@0.4.0 -- \
  dsh-skills-anywhere agents --json
```

It returned **68 agent directory definitions**. This does not mean 68 complete
agent integrations were tested. The current-source `pnpm run check` also
passed version checks, typechecking, lint, **129 tests**, and the build.
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

Nine applications were rechecked on September 14. **Awesome DeepSeek Harness
and Awesome Gemini CLI have merged their entries**; the other seven remain open.
These are community directory listings, not upstream product endorsements.

| Directory | Existing PR | Status on September 14 |
| --- | --- | --- |
| Awesome MCP Servers | [#14308](https://github.com/punkpeye/awesome-mcp-servers/pull/14308) | Open; awaiting review |
| Awesome DSH Plugin | [#5004](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/5004) | Open; awaiting review |
| Awesome DeepSeek Harness | [#466](https://github.com/Dominic789654/awesome-deepseek-harness/pull/466) | Merged September 13; listing accepted |
| Awesome Claude Code Plugins | [#481](https://github.com/ccplugins/awesome-claude-code-plugins/pull/481) | Open; awaiting review |
| Awesome Gemini CLI | [#126](https://github.com/Piebald-AI/awesome-gemini-cli/pull/126) | Merged September 13; listing accepted |
| Awesome Codex CLI | [#267](https://github.com/RoggeOhta/awesome-codex-cli/pull/267) | Open; awaiting review |
| Awesome Claude Skills | [#711](https://github.com/BehiSecc/awesome-claude-skills/pull/711) | Open; awaiting review |
| Awesome Cursor Skills | [#77](https://github.com/spencerpauly/awesome-cursor-skills/pull/77) | Open; awaiting review |
| Awesome OpenCode | [#709](https://github.com/awesome-opencode/awesome-opencode/pull/709) | Open; awaiting review |

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
| Glama | Maintenance badge now rates A and is linked from both READMEs. Refresh the cached 0.5.1 instructions; the entry is not evidence of cloud access to a visitor's local skills. |
| Anthropic community plugin marketplace | Owner-only web form at https://platform.claude.com/plugins/submit (Console login). `claude plugin validate .` passes. Approved plugins are pinned into anthropics/claude-plugins-community and shown on claude.com/plugins. |
| LobeHub MCP marketplace | The previously used submission documentation returned 404 on September 14. Revalidate current instructions before treating the earlier CLI sequence as supported. No submission is recorded. |
| cursor.directory | Owner-only web form https://cursor.directory/plugins/new (GitHub login); the repository now carries the Agent Plugins manifest it expects. |
| mcpservers.org | Free form submitted September 14 with explicit success confirmation. Await review; do not submit again. [Fields and receipt](outreach/mcpservers-submission.md). |
| PulseMCP | The public submission path returned 403 on September 14. Its current submission status could not be verified; this does not establish that submissions are closed. |
| agentskills.io | Published the implementation playground in *Show and tell* [#557](https://github.com/agentskills/agentskills/discussions/557), with explicit disclosure that Codex wrote the post on the maintainer's behalf. Reuse that discussion for feedback. The Client Showcase remains unsuitable because this tool does not execute skills. |
| Cursor forum | Showcase category https://forum.cursor.com/c/showcase/9. Current rules restrict fully AI-generated posts and automated bots; a participating maintainer should write from their own experience. |
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
v0.6.0 已发布到 npm 和官方 MCP Registry，提供来源检查、去重、
重名处理、目录预算及网页管理，并支持浏览器和 CI 检查明确指定的技能文件。
这是 MIT 许可的独立社区项目；实际技能执行仍取决于客户端能力与权限。


## Local parser comparison update

The Space now accepts explicitly selected or pasted Markdown for a local comparison
of the real provider's strict and lenient parsing. The maintained HF and Agent Skills
showcase text includes this workflow and its limits; the Chinese submission bodies
include the same feature. Reuse the existing threads and collection. This update adds
no compatibility certification, client endorsement or measured growth claim.

External releases 0.5.0 and 0.5.1 were reviewed during this update. Release 0.5.1
fixes the npm-version assertion; npm and the official MCP Registry both report
0.5.1. The historical 0.4.0 example above remains a record of the original check.


## Release 0.6.0 distribution follow-up

The published npm package and official MCP Registry both report 0.6.0. The CLI
adds explicit-file checks, strict/lenient gates, repair policy, file hashes,
package identity and automation exit codes. The release pipeline smoke-tests
the actual packed CLI outside the checkout before publishing it with provenance.
135 tests pass; the Windows run skips the POSIX-only FIFO check.

The maintained HF, Agent Skills and Chinese submission bodies now include the
[CI guide](CHECKING.md) and current install commands. Existing threads are reused;
editorial submissions remain pending review. The older version examples above
record the original publication checks.

## September 14: registry showcase and verified directory listings

- The [MCP Registry Show and tell category](https://github.com/modelcontextprotocol/registry/discussions/categories/show-and-tell), inherited discussion template, contribution guide and community communication rules were checked. No existing Skills Anywhere discussion was found.
- A [complete implementation post](outreach/registry-showcase.md) follows the template and discloses maintainer/AI involvement. Its example was run through the public `dsh-skills-anywhere@0.6.0` package from an unrelated directory: one file passed with no repairs or input errors.
- **No new registry discussion was published.** GitHub returned `FORBIDDEN`: `noteflowai does not have the correct permissions to execute CreateDiscussion`. Recent discussions were read back before the bounded retry to rule out a partially created duplicate. Posting requires suitable GitHub access; the draft is retained.
- The existing two Chinese editorial submissions remain open. The nine directory PRs were individually rechecked: two merged, seven open. The public Glama badge says **maintenance rated A**. Both READMEs link the maintenance badge and the two accepted community listings.

Primary evidence: [DeepSeek directory PR #466](https://github.com/Dominic789654/awesome-deepseek-harness/pull/466), [Gemini CLI directory PR #126](https://github.com/Piebald-AI/awesome-gemini-cli/pull/126), [Glama badge](https://glama.ai/mcp/servers/noteflowai/dsh-skills-anywhere/badges/score.svg), [registry contribution guide](https://github.com/modelcontextprotocol/registry/blob/main/CONTRIBUTING.md), [discussion template](https://github.com/modelcontextprotocol/.github/blob/main/.github/DISCUSSION_TEMPLATE/show-and-tell.yml), [community communication rules](https://modelcontextprotocol.io/community/communication).

## September 14: mcpservers.org free submission

The normal public form accepted **Skills Anywhere** at 00:52 UTC and displayed
“Submission Successful!” with the server name. The selected plan was free ($0),
category Development, with remote hosting disabled. The npm author contact
`admin@noteflowai.com` was used; no paid option or new account was created.

The confirmation says review within 12 hours, whereas the form advertised up to
two weeks. Neither is a guaranteed review time. This is a received submission,
not an accepted listing. The homepage and possible listing page showed a
security-verification page, so public search could not establish whether an
automated listing already existed. Our publication record contained no earlier
mcpservers.org submission. The normal submission form was accessible; no
challenge was bypassed. Submit was clicked once. No further submission is planned.
