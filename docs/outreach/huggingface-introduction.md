**Try a shared Agent Skills workspace without installing anything.**

This is the Hugging Face playground for [dsh-skills-anywhere](https://github.com/noteflowai/dsh-skills-anywhere), an independent community project maintained by this account and developed with AI assistance.

![Skills Anywhere playground](https://huggingface.co/spaces/glayguo/dsh-skills-anywhere/resolve/main/thumbnail.png)

Three things to try:

1. **Follow the sources.** Nine fictional files are scanned by the real provider. One identical copy is dropped, invalid YAML is reported, and the source of every discovered skill stays visible.
2. **Untangle a name clash.** Two plugins both call a skill `configure`; inspect the distinct names that keep both reachable.
3. **Find a hidden skill.** Lower the catalog budget, search for `test`, and inspect `test-plan` even when it is not listed. Pin it into the catalog, or Hide it while keeping search available.

The browser reuses the project's catalog-selection and search code. Discovery is recorded at build time from authored fixtures. The sample can be shared by URL or downloaded as JSON, and the build manifest identifies its source commit and file hashes.

The Space does not scan your directories, execute a skill, host MCP or call a model. Install the package locally to use your own directories. Directory coverage is not a claim that every client or skill script was tested.

- [Install and read the source](https://github.com/noteflowai/dsh-skills-anywhere)
- [How this demo is built and checked](https://github.com/noteflowai/dsh-skills-anywhere/blob/main/docs/HUGGINGFACE.md)

What would make shared skill discovery easier to inspect: source precedence, name collisions, or catalog visibility? Concrete examples and reproduction reports are welcome.

中文：这是使用内置虚构文件的交互演示，可查看来源、去重与重名处理，调整目录预算并按需搜索技能。浏览器不读取你的电脑，也不执行技能或调用模型。实际使用自己的技能目录需安装本地工具。

**New: check your own SKILL.md locally.** Paste or select one Markdown file (up to 128 KiB), compare the real provider's strict and lenient modes, and download a report of repairs, invocation settings and metadata keys. The input stays in the page and is not added to URLs or browser storage. The report omits the raw body, but may contain descriptions and diagnostic excerpts; inspect it before sharing. This is provider parsing, not a security audit or a guarantee of client/specification compatibility.

[Open the local file checker](https://glayguo-dsh-skills-anywhere.static.hf.space/#check). This update was written with AI assistance on the maintainer's behalf.

**Use the same check in CI (0.6.0).** The published CLI now checks explicit local Markdown files using the same two parser modes. Run `npx -y dsh-skills-anywhere@0.6.0 check skills/example/SKILL.md --fail-on-repair --json` with your own file path. Reports include the package version and file SHA-256; exit codes distinguish parser failures from unreadable inputs. Files are not rewritten, discovered elsewhere or executed. [Copy the CI recipe and read the scope](https://github.com/noteflowai/dsh-skills-anywhere/blob/main/docs/CHECKING.md). Reports may contain descriptions and diagnostic excerpts.
