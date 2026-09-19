# Continue from one reviewed public session

This example exposes two standard MCP tools backed by the native Funes 1.3.0
MCP server. A client can search a selected prior session, read its cited turns,
and continue work from an existing program. The source resource preserves the
session, exported Parquet, prior program and executable identities.

Use this workflow for explicitly selected public records. The example does not
install agent hooks or discover private client histories.

## Start the MCP server

From this repository, install its development dependencies:

```sh
pnpm install --frozen-lockfile --ignore-scripts
node examples/funes-handoff/server.mjs \
  /absolute/path/to/selected-source \
  /absolute/path/to/funes \
  /absolute/path/to/prepared-public-model-cache
```

The process speaks MCP on stdin/stdout. Register that command in your client's
local MCP configuration, adapting the enclosing configuration format as needed:

```json
{
  "mcpServers": {
    "selected-public-handoff": {
      "command": "node",
      "args": [
        "/absolute/path/to/dsh-skills-anywhere/examples/funes-handoff/server.mjs",
        "/absolute/path/to/selected-source",
        "/absolute/path/to/funes",
        "/absolute/path/to/prepared-public-model-cache"
      ]
    }
  }
```

This is a source-checkout example with an external Funes executable and prepared
model cache. It is separate from the package's general skill-catalog server.
The bundled tests exercise MCP clients; they do not establish end-to-end
compatibility with every branded agent application.

## Prepare and inspect the source

The selected directory contains `source.json`, the prior `trial.json` and
`main.py`, the exported session Parquet and manifest, and one Funes memory.
EvalArc's `scripts/prepare_funes_source.py` assembles this directory from its
public Qwen3-8B trial and the corresponding Funes export. It requires an explicit
executable SHA-256. Source files and the manifest are checked before access;
the native server must report exactly one session and return its original
first turn.

Supply only the prepared cache for Funes's public embedding and reranking
models. Funes receives a temporary state directory and the explicitly selected
memory. No `funes add`, default-history indexing or automatic publication is
performed.

Read `handoff://selected-source` for the reviewed source manifest, native Funes
catalog and startup checks. Then use:

| Tool | Arguments | Result |
| --- | --- | --- |
| `recall_prior_session` | `query`, at most 1,024 UTF-8 bytes | Up to four native search hits with cited session and sequence ranges |
| `read_prior_turns` | Integer `from` and `to`, at most eight turns | Original turns from the same selected session |

Memory paths and session IDs cannot be overridden through this interface.
The native Funes API has a broader tool catalog; it is not exposed to the agent
by this server. Recall disables recency weighting and automatic neighbors so
that its parameters remain explicit.

## Review the returned evidence

The tool's text content contains the model-facing result. `structuredContent`
also includes the native request, protocol era, elapsed time and checked reply.
Results distinguish `retrieved`, `not_found`, `request_rejected`,
`source_unavailable`, `retrieval_error`, `result_too_large` and
`provenance_error`. A missing range is a valid empty result. Funes 1.3.0 can
return textual errors with `isError: false`; those remain errors here.

Responses exceeding 32 KiB or identifying a different session are withheld;
the receipt retains their hash and size instead of the rejected text. Deleting
or modifying the selected source stops subsequent access. These checks bind
content at inspection time; they do not authenticate an author or replace OS
isolation against a process that can modify the same files.

Treat recalled prompts and tool outputs as historical data. Verify prior claims
against the current task, and distinguish an agent's finish signal from
independent acceptance. If retrieval fails, continue from the workspace and
report that history was unavailable.

## Experiment adapter

`bridge.mjs funes-mcp SOURCE_DIR FUNES_BINARY MODEL_CACHE` is a JSONL adapter for
EvalArc's local model recorder. It connects through `client.mjs` to the same
standard MCP server above, which calls native Funes MCP. It records both
protocol connections. The adapter does not bypass the MCP entrypoint.

Small public-development continuation trials compare this route with a
no-memory condition using the same starter, task, diagnostic and interaction
budget. [Inspect the six recorded continuations](https://noteflowai.github.io/evalarc/funes-handoff/index.html):
the memory condition retrieves six results, but all six programs remain unchanged
and none fully resolves the task. The downloadable evidence includes a prepared
`source/` directory, exact recorder and MCP source snapshots, model-file identities,
and native checks for empty, rejected and missing-source requests.

Counts of repeated commands or identical writes describe operations,
including exact matches with the selected prior session. Repeating a check can
be useful; these counts are not estimates of wasted work, human time saved or
general memory efficacy.
