**Same instructions. Different files.** Skills Anywhere 0.9.0 adds a directory manifest and a local bundle comparison. Try the authored example: SKILL.md is identical while `scripts/review.py` changes. Download both manifests or open your own to inspect changed, added and removed paths. The browser validates each manifest's digest and keeps input in page memory.

The installed CLI's `bundle` command records all regular files below a skill directory, including hidden/binary resources. Compare a reviewed manifest with `--against`; pass `expected_bundle_sha256` to MCP `open_skill` to reject changed resources before receiving instructions. Reads are bounded, nested links are rejected, and current author opt-outs still apply. Both legacy and MCP 2026-07-28 clients exercise this flow.

[Open the playground](https://huggingface.co/spaces/glayguo/dsh-skills-anywhere) · [Release 0.9.0](https://github.com/noteflowai/dsh-skills-anywhere/releases/tag/v0.9.0) · [Directory review, format and limits](https://github.com/noteflowai/dsh-skills-anywhere/blob/main/docs/BUNDLES.md)

The Space does not inspect your filesystem, execute a script or host an MCP endpoint. A matching digest identifies recorded paths and file contents; it does not authenticate an author, cover external dependencies or freeze later execution. Existing directory discovery and single-file loads remain available, including the Microduck frame-review walkthrough.

Maintainer update to the existing introduction, developed with AI assistance. Independent community project; no upstream or Hugging Face endorsement is implied.
