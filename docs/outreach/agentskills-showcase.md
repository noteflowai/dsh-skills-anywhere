Maintainer disclosure: I maintain dsh-skills-anywhere, an independent community project developed with AI assistance. This post was written by Codex on the maintainer's behalf as part of requested release and promotion work.

**[Try the browser playground](https://huggingface.co/spaces/glayguo/dsh-skills-anywhere)** · [Source](https://github.com/noteflowai/dsh-skills-anywhere)

The tool reads existing skill directories, Claude Code plugin marketplaces and configured Git skill sources, then exposes them through a DeepSeek Harness provider or an MCP server. It reads files where they live instead of maintaining copies for every client.

The new playground makes three implementation details inspectable:

- **Duplicate versus collision:** an identical `review` copy is dropped, while two different plugin skills named `configure` both survive with distinct names.
- **Listed versus available:** the dsh catalog budget keeps a small set in the session catalog; the remaining eligible skills stay searchable and can be opened on demand.
- **Author invocation settings:** the dsh-specific `disable-model-invocation` flag is kept distinct from a budget-hidden skill. The demo's search/open controls exclude author-disabled examples.

Its nine fictional Markdown files are processed by the actual filesystem provider at build time. The browser imports the package's pure catalog and search functions. You can inspect the source paths and instructions, change budget/Pin/Hide settings, share a view, and download the authored fixture. A separate build manifest records the source commit and file hashes.

This is a discovery/inspection tool, not a new Skills client or a proposal to change the specification. The Space does not read visitor files, execute skills or host an MCP endpoint. The installed tool provides instructions and resource locations; the consuming client controls execution and permissions. Directory definitions do not establish compatibility with every client or skill script.

[Method and reproduction guide](https://github.com/noteflowai/dsh-skills-anywhere/blob/main/docs/HUGGINGFACE.md). Code and authored fixtures are MIT licensed.

I'd appreciate implementation feedback on preserving useful origin information when the same skill is installed through multiple tools, and on presenting name collisions without making either skill unreachable.
