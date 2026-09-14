# Measure task outcomes after skill loading

This bridge lets an external model harness compare direct file loading with
loading the same instructions through a real MCP stdio connection. Both routes
use the provider's discovery, keyword ranking, author opt-outs and bundle reader.
They return the same model-facing fields; raw transport results are retained
separately in receipts. “Direct” is this example's file adapter, not a measurement
of a named coding agent's native skill system.

From a checkout, run `pnpm install --frozen-lockfile && pnpm build`. Copy only the
reviewed skill folders into a dedicated pool, then run:

```sh
node examples/skill-impact/bridge.mjs mcp /absolute/path/to/pool
# Or replace mcp with direct.
```

The first JSON line contains the reviewed SKILL.md and bundle hashes. Subsequent
requests are JSON lines:

```json
{"id":1,"tool":"find_skills","arguments":{"query":"robot motion recording"}}
{"id":2,"tool":"open_skill","arguments":{"name":"robot-recording-review"}}
{"id":3,"tool":"list_skills","arguments":{}}
```

Every open requires the startup hashes, and both routes reject changed content.
The pool must contain instructions only: a referenced script needs a separate,
bounded resource protocol and is rejected here. Caller home directories,
marketplaces, remote source files and installed agent skills are excluded.

Use a fixed model revision, matched task seeds and equal execution budgets.
Provide the authoritative task contract before optional skill instructions. If
keyword search misses, browse the bounded catalog once and continue the task;
optional discovery should not consume the entire action budget. Descriptions
should include the input format and common domain terms that users actually use.
Record actual searches, returned instruction hashes, candidate actions, failures,
token usage and independent task checks. Include a no-skill condition; a
length-matched irrelevant skill can distinguish extra-context effects. An open
receipt proves which bytes were returned, not that the model used the advice.
Public-development examples and a small pilot do not establish general gains.
