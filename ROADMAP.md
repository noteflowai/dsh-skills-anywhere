# Skills Anywhere roadmap

Updated: 2026-09-29 · Owner: NoteFlowAI maintainer · Review: weekly; monthly compatibility review.

This is a proposed sequence of outcomes. Later items are conditional, not committed release dates.

## User and outcome

An agent-tool author maintains one skill package and can **discover, validate and load the intended skill plus its resources across supported clients**, with a verifiable explanation of what was actually loaded.

Physical AI is one application. General Agent Skills portability remains the product's contract.

## Current baseline

Reviewed `29917a9` / v0.16.0. Local/Git catalogs, package validation, dsh provider and stdio MCP delivery, pinned content hashes and load/selection receipts already exist. This roadmap focuses on interoperability and successful use rather than adding another orchestrator.

The open compatibility request is a way to collect demand; it is not evidence that every client integration is needed. External multi-client success and recurring usage are not yet measured in this review.

## External evidence and positioning — reviewed 2026-09-29

The [Agent Skills specification](https://agentskills.io/specification) defines package structure and progressive loading. [Vercel's skills CLI](https://github.com/vercel-labs/skills) already handles discovery, installation, updates and many clients. Client count, another registry or basic installation is not sufficient differentiation.

The existing dsh/MCP delivery and resource/load receipts are the candidate advantage for clients without equivalent native loading. Compare SA-01/SA-03 against a native or Vercel-installed path using the same package and resource-dependent task. Record actual loaded revision/resources, setup time and compatibility failures. Preserve the distinction between declared `allowed-tools` metadata and enforced runtime permissions.

Use the upstream [skills-ref](https://github.com/agentskills/agentskills/tree/main/skills-ref) validator as a pinned comparison fixture, alongside the normative specification; its README explicitly labels it demonstration-only, so it is not a production dependency recommendation. Within 30 days, seek two client combinations with a demonstrated recurring gap. If native clients cover the need, concentrate on compatibility fixes or upstream contributions rather than a larger catalog.

## Now

| ID | Outcome | Acceptance evidence |
| --- | --- | --- |
| SA-01 | “Supported” means an actual tested client/version | Maintain a compatibility matrix for the existing dsh and MCP paths. For each supported client, run discovery → load → resource access in a fresh process and record client/package versions. Distinguish native support, adapter support and untested claims. |
| SA-02 | An installed skill cannot silently become a different one | Verify pinned Git revision/content hash and loaded resource hashes, including upgrade/rollback and changed-source cases. Preserve receipts; unsupported resource paths fail clearly. |
| SA-03 | A new author gets one useful skill into two clients | Observe three first-use attempts with one small public package containing a resource. Document installation, validation, selection and load receipts; target a complete two-client path within 20 minutes. |

## Next

| ID | Outcome | Entry and exit gates |
| --- | --- | --- |
| SA-04 | Updates and naming conflicts are understandable | Use observed catalog conflicts or stale skill reports to choose the next change. Demonstrate deterministic precedence, dry-run changes and rollback without deleting user-owned skills. |
| SA-05 | Add a demanded ACP-client integration | Begin after a concrete request and access to that client. ACP transports agent conversations; it does not replace skill packaging. Reuse the existing resource contract and verify the actual load, not merely catalog listing. |

## Later

Additional registries and team catalogs require a demonstrated repeated workflow, a compatibility owner and migration tests. Avoid a marketplace, general task scheduler or robotics-only rebranding.

## Measures and decisions

- Baseline setup success, time to first resource load and cross-client failure reasons.
- Track supported combinations actually tested, resource-integrity failures and four-week repeat use.
- Treat download counts and catalog size as context, not successful skill execution.
- Remove or relabel an unsupported integration when its compatibility proof expires; review the matrix monthly and on upstream breaking changes.
- Do not expand the integration matrix faster than it can be maintained.

## Delivery policy

One active milestone with a stable ID, user evidence, a compatibility fixture and a follow-up date. Preserve the Node support range and current public interfaces. Run existing checks, package verification and client conformance before release. Fixes, onboarding improvements and justified no-change outcomes are preferable to unnecessary daily features.
