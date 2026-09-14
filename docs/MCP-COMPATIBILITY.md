# MCP protocol compatibility

Version 0.8 uses the official TypeScript SDK 2.0.0 server package. The
`dsh-skills-anywhere mcp` command accepts legacy initialization and the
2026-07-28 protocol opening over stdio. Existing client configuration does
not need a new command or flag.

```sh
npx -y dsh-skills-anywhere@0.8.0 mcp
```

## Tested client configurations

| Independent client | Negotiation | Observed protocol era |
| --- | --- | --- |
| SDK 1.30.0 | Legacy initialize | Legacy |
| SDK 2.0.0 | `legacy` (SDK default) | Legacy |
| SDK 2.0.0 | `auto` (stdio probe) | Modern |
| SDK 2.0.0 | `{ pin: "2026-07-28" }` | Modern |

Every row drives a real child process. Tests discover all three tools, search,
list/read resources, load a file with its original SHA-256, reject changed
instructions, and honor a newly disabled author setting. A separate test
checks process exit on stdin EOF before initialization. The installed npm
archive is also exercised outside the checkout with SDK 1 and a pinned SDK 2
client; those checks use the archive's production server dependencies.

This matrix tests SDK protocol interoperability. It does not certify every
release of Claude Code, Cursor, Codex or another branded application. The
Hugging Face playground remains a static demonstration, without a hosted MCP
endpoint. The package exposes stdio; this release does not add HTTP transport,
authorization or remote hosting.

## Embedding the server

`runStdio(options)` now uses SDK 2's `serveStdio(factory)`, which selects the
appropriate protocol from the client's opening. It owns transport shutdown and
provider cleanup when stdin closes or the process receives SIGINT/SIGTERM.
Diagnostics go to stderr; stdout belongs to MCP.

The exported `createSkillsAnywhereServer(options).server` is now an SDK 2
`McpServer`. Library consumers that connect their own transports must migrate
imports to the split SDK 2 packages. Connecting a hand-built server directly
with `server.connect(transport)` follows the SDK's legacy path; use `runStdio`
for this package's tested negotiation behavior. Tools, resource URIs and
`expected_sha256` retain their existing contracts.

The hash covers `SKILL.md` only. It does not cover referenced scripts or other
files and does not establish author identity. See [verified loads](VERIFIED-LOADS.md).

Primary references, checked 2026-09-14:

- [Official protocol specification](https://modelcontextprotocol.io/specification/2026-07-28)
- [TypeScript SDK stdio guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md)
- [SDK v2 migration guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/upgrade-to-v2.md)
