# From research ideas to inspectable evidence

Recorded on 2026-09-14. These are bounded public development pilots, not leaderboard submissions.

| Component | What actually runs | Evidence and limitation |
| --- | --- | --- |
| Robot recording review | Qwen3-8B writes code using a non-networked Docker workspace; Skills Anywhere serves a fixed skill through real MCP or a direct adapter; EvalArc independently grades it. | 27 trials across three engineering profiles. All failures retained. No skill accuracy gain; profiles change task context/discovery and cannot be pooled. |
| Skill composition | Four selected skill conditions × three seeds, with a synthetic private marker and exact public-output contract. | 3/12 correct outputs; no marker found in public files or plain model text. Eight explicit grader controls pass. Literal marker scanning is not a general leakage detector. |
| Session handoff | Funes 1.3.0 indexes one explicitly selected public Qwen3-8B session; Qwen3-4B continues its candidate with/without fixed retrieved context. | Separate local model sessions, not native Claude/Codex execution. No private history discovery, automatic publication or training. |
| Harbor | Native task export, oracle/NOP execution, independent import, ATIF 1.8 exports validated with Harbor 0.23.0. | Upstream reward and independently measured acceptance remain separate. Lightweight import is narrower than full upstream schema validation. |
| Scene creation | Real CC0 photogrammetry, Blender 4.5.13 OptiX on L40S, Spark 2.2.0 viewer and an OpenEnv 0.4.2 numeric action interface. | Surface Gaussians are mesh-derived, not trained 3DGS. Collision heightfield is separate and cannot represent overhangs. No RL or aesthetic-quality gain claimed. |
| LIBERO-Plus | Actual native camera and light changes, one paired initial state, pinned SmolVLA on L40S. | 77-action baseline success, 220-action camera step limit, 87-action light success. Not the full benchmark or real hardware. |
| Cosmos Policy | Pinned model/source checks, aligned action-chunk recorder and authenticated dependency-access preflight. | Required NVIDIA Video2World files return 403. No successful Cosmos inference or future-frame result. Model weights use NVIDIA's noncommercial research terms. |

## Inspect the experiments

- [Skill Impact Lab: all 27 trials](https://noteflowai.github.io/evalarc/skill-impact/)
- [Composition, handoff and Harbor records](https://noteflowai.github.io/evalarc/research/)
- [Captured scene and native edits](https://noteflowai.github.io/robot-reel/scene-lab/)
- [Official LIBERO-Plus subset](https://noteflowai.github.io/robot-reel/libero-plus/)
- [OpenEnv environment and recipe controls](https://github.com/noteflowai/robot-reel/tree/main/examples/openenv_scene)

## Research motivation and attribution

SkillsBench motivates measuring task outcomes instead of counting installed skills; skill-composition research motivates checking combined behavior and output side effects. Harbor/ATIF motivate portable traces. Cosmos Policy and LIBERO-Plus motivate distinguishing future predictions, native perturbations and measured outcomes. Real2Edit2Real motivates an editable captured-scene workflow. These are engineering applications of ideas, not reproductions of the papers' training results or claims of author endorsement.

Primary implementations and source licenses: [LIBERO-Plus](https://github.com/sylvestf/LIBERO-plus), [Cosmos Policy](https://github.com/NVlabs/cosmos-policy), [Harbor](https://github.com/laude-institute/harbor), [OpenEnv](https://github.com/meta-pytorch/OpenEnv), [Spark](https://github.com/sparkjsdev/spark), [Poly Haven](https://polyhaven.com/a/coast_rocks_02). Versions, source commits and file hashes accompany individual records.

A wheel-packaging issue found while installing LIBERO-Plus already had an upstream fix proposed. We supplied [additional isolated-wheel validation](https://github.com/sylvestf/LIBERO-plus/pull/54#issuecomment-5663316945), rather than filing a duplicate fix. That is a validation contribution; upstream merge/acceptance is pending.

## Versioned public data

[Noteflow Research Pilots on Hugging Face](https://huggingface.co/datasets/glayguo/noteflow-research-pilots/tree/v2026-09-14) publishes all 45 agent trials, native Blender downloads, OpenEnv controls and the three Plus recordings. Publication revision `d42ad1d0e1073029254e9e5c3980541a3b166c92`: all 184 file identities were checked through the anonymous Hub API.
