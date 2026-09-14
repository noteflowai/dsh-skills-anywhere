# Review every file in a skill directory

Version 0.9 adds a bounded directory manifest alongside the existing single-file
check. An unchanged SKILL.md does not imply its scripts or reference files stayed
unchanged. The manifest records every regular file under the chosen directory:
relative path, byte length and SHA-256, including hidden and binary files.

## Local review and CI

```sh
# Keep both the review manifest and output logs outside the skill directory.
npx -y dsh-skills-anywhere@0.9.0 bundle /path/to/skill --json > reviewed-bundle.json
# Review the actual files, then retain the manifest in your review record.
npx -y dsh-skills-anywhere@0.9.0 bundle /path/to/skill \
  --against reviewed-bundle.json --json
```

A manifest-generation success exits **0**. Comparison exits **0** for matching
file paths and contents, **1** for differences, and **2** for invalid inputs,
unstable reads or unsupported directory entries. Comparison JSON includes
`added`, `removed`, `changed`, both digests and the current `manifest`.
A rename appears as one removed path and one added path. Human output escapes
input-derived paths. Neither command discovers other skill roots, runs Git,
synchronizes repositories or executes skill code.

A saved manifest must be outside the skill directory so it does not become its
own input. Shell redirection can create a file before the command starts; always
redirect to a separate review directory. Nothing is silently ignored: use the
skill's own directory, not an entire application checkout with caches or Git
metadata.

## Require that directory identity through MCP

```json
{
  "name": "your-discovered-skill-name",
  "expected_bundle_sha256": "<manifest.sha256 from your reviewed bundle>"
}
```

`open_skill` recomputes the directory inventory before returning instructions.
An added, removed or modified file causes a mismatch and returns an error
without the instruction body. The returned `bundle` contains the checked
manifest. Use `include_bundle: true` to inspect the current manifest without a
prior digest. An expected bundle digest implies that option.

`expected_sha256` continues to check SKILL.md alone; both digest arguments may
be used together. In bundle mode the returned instructions and their file hash
come from the same bytes used in the directory manifest. Current author opt-outs
still apply even when the requested digest matches. Default tool/resource loads
and the dsh provider retain their existing behavior; directory hashing is opt-in
on the standalone MCP `open_skill` tool.

## Compare received manifests in the browser

The [Hugging Face playground](https://huggingface.co/spaces/glayguo/dsh-skills-anywhere)
includes an authored example where only `scripts/review.py` changes. The
manifests are produced by the real filesystem reader during the site build.
Download either manifest, restore matching files, or open your own two JSON
manifests to inspect differences. The browser recomputes each manifest's digest
with the same canonicalization used by the CLI before comparing it.

Input stays in page memory and is not uploaded, stored or added to share links.
Invalid inputs clear the affected result; resetting to an example cancels older
pending file reads. This browser view compares recorded manifests. It cannot
check your filesystem or connect to your local MCP server.

## Format and limits

`skills-anywhere-bundle-1` has exactly four fields: `schema`, `sha256`,
`total_bytes` and `files`. File entries have exactly `path`, `bytes` and `sha256`.
Rows use ascending JavaScript string order on slash-separated relative paths;
paths are unique and cannot also be a parent file. No Unicode normalization or
locale-dependent sorting is applied.

The directory digest is SHA-256 of this UTF-8 JSON tuple, without whitespace:

```text
["skills-anywhere-bundle-1",[["relative/path",byte_length,"file_sha256"],...]]
```

An absolute directory, package version, timestamps and JSON formatting are not
part of this identity. Moving identical files to another directory preserves
it. SKILL.md must exist and be valid UTF-8, but manifest generation does not
validate frontmatter; use `check` for parser results. Other files may be binary.

Bounds: 512 files, 1,024 total directory entries, 12 path levels, 128 KiB for
SKILL.md, 16 MiB per other file, 32 MiB total, 1 MiB per received manifest and
1,024 UTF-8 bytes per relative path. Control characters, backslashes, colons,
traversal segments and Unicode replacement characters are rejected in paths.
A symlinked installation root is resolved once; symlinks beneath it and special
files such as pipes are rejected. File reads, directory enumeration and final
metadata checks detect changes during inspection.

## What a matching digest establishes

It identifies the recorded file paths and content bytes. It does not authenticate
an author, determine whether code is safe, or prove that a model followed the
instructions. Empty directories, permissions, ownership, external files,
installed packages, interpreter versions, remote URLs and dynamically loaded
content are outside the digest. Git revision is not inferred or authenticated;
retain a separately reviewed source revision when repository provenance matters.

Inspection does not freeze the directory for subsequent resource reads or
execution. Use a stable, controlled checkout and enforce your execution policy
at the point of use. The feature detects directory changes at load/inspection
time; it is not a sandbox or a defense benchmark.

The [Agent Skills specification](https://agentskills.io/specification), checked
2026-09-14, describes SKILL.md plus optional scripts, references and assets.
This manifest is a project-specific content-identity format, not an extension
claimed to be part of that specification.
