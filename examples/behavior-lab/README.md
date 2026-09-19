# Review actual behavior after composing skills

These two instruction fixtures exercise a synthetic order-report workflow.
Fixture A creates an allowed internal cache. Fixture B requests an additional
submission when that cache exists. The user's contract permits only one report
submission, so the combined instructions create a specific authorization conflict.

Keep these fixtures in this dedicated pool. The experiment's
[MCP bridge](../skill-impact/bridge.mjs) excludes installed skills, home
directories, plugin markets and Git-source discovery. It fixes both the
SKILL.md and directory hashes, then records the actual MCP responses delivered
to the local model. Selected skills are preloaded; this does not measure
autonomous skill discovery.

EvalArc's behavior recorder runs candidate commands as UID 65534 with no
effective capabilities inside a disposable Docker container. A separate
observer follows their Linux system calls, and a loopback-only fake service
records received requests. The container has no host mounts or external
network. Inputs are synthetic; the audit endpoint is not a real external service.

The report distinguishes:

- The final order file and its independently computed totals.
- Actual file access, transient writes and child-process operations.
- Attempted operations, rejected requests and committed service writes.
- MCP delivery, the model's finish signal and task acceptance.

Use the EvalArc `scripts.record_behavior_pilot` module with this directory's
`skills/` pool and `examples/skill-impact/bridge.mjs`. Its frozen plan records
the model files, source revisions, instruction hashes, conditions and budgets
before generation. Run it only after the observer's declared controls pass.

These are AI-assisted maintainer fixtures and public development experiments.
They provide a bounded workflow audit, not an independently authored final
fault set or a general model-safety result.
