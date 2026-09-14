# From a Microduck frame to an agent review

Use Skills Anywhere to load a real review skill, then run Robot Reel's
independent verifier before describing a recorded robot motion. The example
needs Node.js for MCP and Python 3 for verification; it runs no policy inference
or simulation and needs no GPU or model-service account.

[Try the guided skill workspace](https://huggingface.co/spaces/glayguo/dsh-skills-anywhere)
(select **04 Review robot evidence**) ·
[Explore the recorded walk](https://noteflowai.github.io/robot-reel/microduck-lab/) ·
[Read the skill](../examples/robot-reel-review/SKILL.md)

The browser playground exposes the real skill text through its existing
provider/search code. It does not connect to your agent, run Python or read your
local recordings. The following local workflow supplies that missing context.

## 1. Choose the recording and workspace

In Robot Reel's Microduck Motion Lab, choose a run, joint and frame, then select
**Frame JSON**. Use a trusted Robot Reel source checkout with the `--frame-json`
verifier (present from commit `c9e7f42c6fac758a08564418ee19c082aea69e5b`).
The current checkout also provides a [sample frame](https://github.com/noteflowai/robot-reel/blob/main/examples/microduck-frame.json)
and [review walkthrough](https://github.com/noteflowai/robot-reel/blob/main/docs/agent-review.md).

Choose an absolute path for a separate review workspace and an existing saved
frame. For example, set these to your actual paths:

```bash
REVIEW_WORKSPACE=/absolute/path/review-workspace
ROBOT_REEL_ROOT=/absolute/path/robot-reel
FRAME_JSON=/absolute/path/microduck-right-frame-120.json
mkdir -p "$REVIEW_WORKSPACE"
```

## 2. Register the skill source for this workspace

```bash
npx -y dsh-skills-anywhere@0.6.0 add noteflowai/dsh-skills-anywhere \
  --path examples/robot-reel-review --ref c27696e3f8572238002cad94affe89329db11c03 --project --cwd "$REVIEW_WORKSPACE"
npx -y dsh-skills-anywhere@0.6.0 sources --json --cwd "$REVIEW_WORKSPACE"
```

`add` writes the workspace's `.dsh/skills-anywhere.json`, clones the skill
repository into the local cache and records its resolved commit. The example
pins the tested skill commit; its original bytes are identified in the check
record below. Existing source entries are retained.
The source cache is a Git checkout; installed agent directories are not copied
or rewritten. If the workspace sits inside another Git checkout, its nearest
Git root determines the project configuration location.

## 3. Load it through MCP

For a client that accepts `mcpServers` JSON, use this configuration with your
actual absolute workspace path:

```json
{
  "mcpServers": {
    "skills-anywhere": {
      "command": "npx",
      "args": ["-y", "dsh-skills-anywhere@0.6.0", "mcp", "--cwd", "/absolute/path/review-workspace"]
    }
  }
}
```

Other clients use their own configuration format; retain the same stdio command
and arguments. The protocol calls are:

```json
{"name":"find_skills","arguments":{"query":"Microduck recorded frame review"}}
{"name":"open_skill","arguments":{"name":"robot-reel-review"}}
```

Discovery returns the name, description and source; `open_skill` loads the
instructions and their base directory. A client may also read
`skill://robot-reel-review`. Loading the skill does not execute its commands.

Example request to your agent:

> Find the Microduck frame review skill. Review `/absolute/path/frame.json`
> against `/absolute/path/robot-reel`. Run its read-only verification, report
> the checked joint facts and keep interpretation separate from the recording.

The agent's execution tool runs the following under the client's existing
permissions, separately from the MCP skill server:

```bash
python3 "$ROBOT_REEL_ROOT/scripts/build_microduck_lab.py" --verify --frame-json "$FRAME_JSON"
```

## 4. Keep the review tied to its evidence

For the supplied example, the selected run is `right` (0.5 m/s **command**), frame
120 and joint `left_knee`. Video time is 4.0 s; simulation sample time is about
4.035 s; the preceding policy step is 201. Measured angle is about 0.249538 rad,
target 0.313140 rad and signed residual −0.063602 rad. Full precision and source
identity remain in the JSON. The residual alone does not establish failure,
contact, balance or achieved walking speed.

Change an angle in a copy and the verifier must reject it. The agent should
report that mismatch, not repair the evidence to obtain a passing result. A
successful check establishes agreement with the bundled source, not the
sender's identity or physical robot performance.

MCP discovery/loading and deterministic frame verification can be exercised
without an LLM. Those checks do not certify that every client or model will
follow the skill correctly. Microduck uses a PD-actuator fallback in simulation;
robot imagery retains the upstream noncommercial/share-alike media terms.

## Recorded verification

The public npm package **0.6.0** was exercised in a separate stdio process with
a temporary, explicitly configured skill root: discovery, `open_skill` and the
resource read all succeeded. The source verifier accepted the original frame
and rejected a copy whose measured angle was changed by 0.001 rad. Neither input
file was modified. [Machine-readable check record](physical-ai-workflow-check.json).

The documented `add` command was also run with the published CLI against that
Git commit in a temporary project. A second stdio process using the CLI `mcp`
command found the Git-origin skill, loaded it from the locked cache and matched
its full SHA-256. Repeating registration did not add another source entry.
