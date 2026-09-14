# Load the reviewed SKILL.md

For a team handoff, record the exact file that was reviewed, then require those
bytes when an MCP client opens it. This works in 0.7.0+ and does not execute the
skill or its referenced scripts.

1. Check the installed file: `npx dsh-skills-anywhere check /path/to/SKILL.md --json`.
2. Review the original file and the report. Retain that file's `sha256`.
3. Call MCP `open_skill` with the exact discovered name and that digest:

```json
{
  "name": "robot-reel-review",
  "expected_sha256": "<64 lowercase hexadecimal characters from the CLI report>"
}
```

A successful `structuredContent` includes `sha256` alongside `name`, `content`,
`directory`, `path` and `source`. The digest covers the original file bytes,
including frontmatter, whitespace and any BOM, rather than only the returned
Markdown body. A previous successful `open_skill` also supplies a usable digest.
`check` and `open_skill` must refer to the same file.

If the file changes, MCP returns an error without its new instruction body.
Review the change before adopting a new hash. Omitting `expected_sha256`
preserves the existing behavior of opening the current file. The digest option
belongs to the standalone MCP tool; it is not an option on the dsh plugin tool.

Both MCP tool/resource loads and the dsh provider recheck the author's current
invocation flags after reading the file. A newly disabled model setting applies
even when the discovered catalog is cached or a skill is hidden by the catalog
budget. Collision-renamed skills remain reachable by their published names.
The catalog itself can briefly show stale descriptions until its next refresh.

Loads require a regular UTF-8 file of at most 128 KiB, matching the CLI checker.
The reader bounds both the initial size and bytes read, and rejects named pipes.
Symlinked skill installations remain supported.

The digest identifies this file's bytes. It does not certify safe instructions,
authenticate an author, pin scripts/references beside the file, or prove model
compliance. For a complete dependency snapshot, also pin the Git source commit
and review the resources the skill will use. The browser checker's report is
for parser inspection; use the CLI's original-byte hash for this workflow.
