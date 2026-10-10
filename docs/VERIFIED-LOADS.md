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
and review the resources the skill will use. MCP `open_skill` receipts record
that commit as `source_commit` ([details](LOAD-RECEIPTS.md#source-commit)). The browser checker's report is
for parser inspection; use the CLI's original-byte hash for this workflow.

## Include scripts and resources (0.9+)

Use `bundle /path/to/skill --json` for a directory inventory and pass its
`sha256` as MCP `expected_bundle_sha256`. This includes all regular files below
the skill root, including hidden files, and rejects nested links. Default loads
retain the single-file behavior. Directory inspection does not freeze later
resource reads. [Complete workflow, format and limits](BUNDLES.md).

## Require the reviewed source commit

For a skill from a Git source, an MCP `open_skill` receipt records
`source_commit`, the HEAD of its cache checkout. Pass that value back as
`expected_source_commit` to refuse delivery after the checkout moves:

```json
{
  "name": "open_skill",
  "arguments": {
    "name": "robot-reel-review",
    "expected_source_commit": "<receipt.source_commit from an earlier load>"
  }
}
```

Checks run in this order. Each failure is a tool error with no instructions,
rendered skill content or receipt:

1. Format: the value must be a full 40-character lowercase commit; short or
   uppercase SHAs are rejected by the input schema.
2. Origin: a skill from an agent directory, marketplace or local directory
   fails with `is not from a Git source`. Git does not run.
3. Digests: `expected_sha256` and `expected_bundle_sha256` are checked with
   their usual errors. A rejected digest still runs no Git command.
4. Provable commit: if the checkout HEAD cannot be proven (no own `.git`
   directory, work tree outside the cache, Git missing, failing or timing out),
   the call fails with `could not be proven`. The stderr warning gives the
   reason. There is no fallback to an unchecked load.
5. Match: a different HEAD fails with `Git source commit changed`, naming the
   expected and found commits.
6. Clean skill directory: below the skill directory, the checkout must have no
   tracked edits or deletions, no untracked files, no ignored files (for example
   `__pycache__`), and no files hidden by `assume-unchanged` or
   `skip-worktree`. Otherwise the call fails with `uncommitted change(s)` and
   a count. The message never names paths. Files elsewhere in the checkout do
   not count. Two read-only probes run (`git status` and `git ls-files -v`,
   with optional locks and fsmonitor disabled). Each is limited to 8 MiB of
   output and 15 s. If a probe fails, exceeds a limit or meets a corrupt index,
   the call fails with `could not be proven clean` and logs one
   `source checkout not proven clean` warning with the reason.
7. Delivery binding: the already-read `SKILL.md` hash must match the immutable
   blob in the requested commit. When a bundle is included, its file inventory,
   sizes and hashes must also match that commit's regular files. Git replacement
   objects are disabled. Blob verification has a 15 s budget and uses the
   existing skill and bundle byte limits; the checkout identity and HEAD are
   checked again afterward. A concurrent restore cannot turn previously read
   local edits into a pinned delivery.

Recovery: for `uncommitted change(s)`, inspect the edits with
`git status --ignored` and `git ls-files -v` in the cached checkout. Then
discard them (`git checkout -- <dir>`, `git clean -fdx <dir>`), clear the flags
(`git update-index --no-assume-unchanged` or `--no-skip-worktree`), or resync
the source. For `could not be proven clean`, read the warning. Repair a corrupt
index by resyncing. If the listing is too large, move bulk assets out of the
skill directory, or pin with `expected_bundle_sha256` and no commit pin.

To approve a new revision, review it, then replace the pin with the commit
named in the error or in a new receipt. Omitting the field keeps the previous
behavior. The pin binds delivered instructions (and an included bundle) to the
commit and checks a clean skill directory at load time. It does not freeze files
that are read later and does not authenticate
authors. `receipt.source_commit` still records HEAD, and unpinned loads skip the
clean check. Clients that cache tool schemas may need to reconnect to see the field.
