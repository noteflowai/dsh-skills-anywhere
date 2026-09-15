# Track what a skill load delivered

Successful MCP `open_skill` calls and the exported `openSkill()` function return
a `skills-anywhere-load-1` receipt. Record it alongside the caller's actual tool
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

The receipt contains no filesystem paths or instruction text. The surrounding
MCP response still contains both, so choose what to retain. A fresh read has a
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
