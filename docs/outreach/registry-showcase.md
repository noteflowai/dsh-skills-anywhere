### Pre-submission Checklist

- [x] This post follows the MCP community guidelines.

### What would you like to share?

Maintainer disclosure: I maintain Skills Anywhere, an independent MIT-licensed
community project. This post was prepared by Codex on the maintainer's behalf,
with AI assistance, as part of requested publication work.

**Skills Anywhere exposes existing local Agent Skills through MCP.** It is
published as `io.github.noteflowai/dsh-skills-anywhere` in the registry, with the
`dsh-skills-anywhere@0.6.0` npm package and local stdio transport.

The problem we are working on is discovery across installations: a skill can
arrive through an agent directory, a plugin marketplace or a configured Git
source. Repeated copies and different skills with the same name need different
treatment. The provider retains origins, removes identical copies and assigns
distinct names to collisions.

The MCP server exposes three tools:

| Tool | Behavior |
| --- | --- |
| `list_skills` | Paginated model-invocable skills with descriptions and origins. |
| `find_skills` | Keyword search across names, descriptions and origins. |
| `open_skill` | Load one skill's instructions and its resource-directory location. |

It also exposes `skill://` resources. A skill's
`disable-model-invocation: true` setting excludes it from model discovery and
opening. Being omitted from the separate DeepSeek Harness catalog budget is a
different condition: budget-hidden eligible skills remain searchable. We keep
those states separate in the implementation and demo.

For a local MCP client, launch the server in the project it should inspect:

```sh
npx -y dsh-skills-anywhere@0.6.0 mcp --cwd /absolute/path/to/project
```

Configured Git sources can synchronize in the background. The installed
provider reads configured local sources; a hosted service cannot automatically
read the client computer's directories. The consuming client remains responsible
for executing instructions and managing permissions. The server does not turn
every listed skill script into a validated cross-client integration.

One practical addition in 0.6.0 is a standalone parser gate that can run before
skills are shared. For example, save this as `skills/incident-summary/SKILL.md`:

```markdown
---
name: incident-summary
description: Summarize supplied incident evidence with source references.
---
Separate observed facts from hypotheses and cite the supplied evidence.
```

Then check that explicit file:

```sh
npx -y dsh-skills-anywhere@0.6.0 check skills/incident-summary/SKILL.md --fail-on-repair --json
```

This returns the package version, file SHA-256 and strict/lenient parser results.
Exit codes distinguish passing input (`0`), parser/gate failure (`1`) and input
errors (`2`). The same parser comparison is available in the browser demo,
using pasted text or an explicitly selected file. Neither checker executes the
instructions or rewrites the input.

This is a provider parser diagnostic, not a security audit, full specification
certification or a proposed MCP Skills extension. Reports omit the raw body but
may contain descriptions and diagnostic excerpts. The playground's normal
catalog is built from nine authored fixture files; it is not an MCP endpoint.

Implementation feedback would be useful on two points: how clients should
present colliding skill names while preserving origins, and how to distinguish
author-disabled invocation from skills hidden by a catalog budget.

### Relevant Links

- [Repository and MCP setup](https://github.com/noteflowai/dsh-skills-anywhere#use-as-an-mcp-server)
- [Browser playground](https://huggingface.co/spaces/glayguo/dsh-skills-anywhere)
- [CLI/CI recipe and parser scope](https://github.com/noteflowai/dsh-skills-anywhere/blob/main/docs/CHECKING.md)
- [Published registry record](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.noteflowai%2Fdsh-skills-anywhere/versions/latest)
