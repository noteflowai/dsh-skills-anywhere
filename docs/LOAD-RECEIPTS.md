# Track what a skill load delivered

Successful MCP `open_skill` calls and the exported `openSkill()` function return
a `skills-anywhere-load-1` receipt. The two receipts are identical apart from
`source_commit`, which only MCP `open_skill` adds (see below). Record it alongside the caller's actual tool
span to join instruction identity with later evaluation.

```json
{
  "name": "open_skill",
  "arguments": {"name": "evidence-review", "include_bundle": true}
}
```

Read `structuredContent.receipt` from the response:

| Field | Meaning |
| --- | --- |
| `load_id`, `loaded_at` | Unique delivery ID and provider timestamp |
| `provider`, `provider_version` | The serving package and its version |
| `name` | Discovered skill name |
| `skill_sha256` | Original `SKILL.md` bytes, including frontmatter |
| `content_sha256` | Exact UTF-8 instruction body returned in structured content |
| `bundle_sha256` | Directory manifest digest, or `null` when not inspected |
| `declared_tools` | Author's declaration, or `null` when absent |
| `permissions_enforced` | Always `false`; the client controls tool permissions |
| `source_commit` | MCP `open_skill` only: Git source checkout HEAD, or `null` |

The receipt omits source path fields and instruction text. Author-declared
tool strings are preserved and can themselves contain paths. The surrounding
MCP response also contains source paths and instructions, so choose what to retain. A fresh read has a
fresh load ID even if its bytes are unchanged. Rejected hash checks return an
error without a successful delivery receipt.

The caller owns session, trace and span IDs; this server does not invent them or
send telemetry. Attach the complete receipt to the actual invocation span in
your recorder. There is no automatic AWS integration or telemetry exporter.
Resource reads (`skill://...`) retain their original text-only result and do
not carry this receipt.

For a pre-reviewed bundle, pass `expected_bundle_sha256`. A matching digest
identifies the inspected bytes, not an author signature, safe execution,
instruction following or task success. Dependencies outside the skill directory
are excluded. Referenced files may still change before later execution.

EvalArc's [Trace Workbench](https://github.com/noteflowai/evalarc/blob/main/docs/trace-workbench.md)
can associate these receipts with explicitly annotated tool spans, reviewed
bundle hashes, expected skills and imported evaluator results.

## Source commit

For a skill from a Git source (`dsh-skills-anywhere add` plus `sync`),
`source_commit` is the 40-character HEAD SHA of that source's cache checkout
at the time of the load. Keep two receipts from before and after a sync and
they name the revision each load delivered, including when upstream rolls a
branch back.

The value is `null` when:

- the skill comes from an agent directory, a plugin marketplace or an extra
  local directory (no Git command runs);
- Git is missing, fails or exceeds 5 seconds;
- the checkout has no `.git` directory of its own, or Git's work tree is
  outside the source cache. An enclosing repository is never reported.

In the Git-source cases the load still succeeds with unchanged content, and
the server logs one `source commit unavailable for <name>` warning to stderr.
The lock file is never used as a fallback. The lookup runs only after
`expected_sha256` and `expected_bundle_sha256` pass, so rejected loads run no
Git command.

The field names a commit; it does not cover uncommitted edits in the cache,
which `skill_sha256` and `bundle_sha256` do. It does not verify signatures or
authenticate authors. The exported `openSkill()`, the dsh provider and its
tool, and `skill://` resources do not include it and do not run Git.
