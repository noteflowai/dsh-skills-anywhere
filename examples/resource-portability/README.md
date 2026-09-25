# Did the supporting files come along?

Three real public skill snapshots, pinned on 2026-09-25. Run the resource check on
the complete folder, then compare it with an explicitly constructed installation
containing only `SKILL.md`. No skill instructions or scripts are executed.

| Snapshot | Full folder: present / discovered links | SKILL.md-only control | Meaning |
| --- | --- | --- | --- |
| Cloudflare security-audit | 8 / 8 | 0 / 8 | Its linked guides need to travel with the skill. |
| Addy Osmani code-review-and-quality | 0 / 0 | 0 / 0 | No local Markdown links are assessed; this says nothing about prose dependencies. |
| Anthropic mcp-builder | 10 / 10 | 0 / 10 | The referenced guides are present in the full folder. |

These are selected workflow examples, not a representative benchmark or an audit
of the upstream projects. The incomplete installation is our control, not an
upstream defect. A present file is not an assessment of its content or safety.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
node scripts/replay-resource-examples.ts
node lib/cli.js check examples/resource-portability/snapshots/cloudflare-security-audit/SKILL.md --resources --json
```

The replay verifies each vendored byte against `sources.json`, recomputes both
reports, and requires an exact match with `results.json`. CI repeats it without
network or model credentials. Use `--write` only when intentionally replacing the
reviewed expected reports. Source files are unmodified, including original
licenses; `sources.json` records upstream paths, full commit IDs and SHA-256 hashes.

- Cloudflare: `cloudflare/security-audit-skill`, commit `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8`, MIT.
- Addy Osmani: `addyosmani/agent-skills`, commit `bcab6a1b8503100e8618c3b4e32cc78de43de769`, MIT.
- Anthropic: `anthropics/skills`, commit `33375500bcea98d610eb30ce10ac4e59b89c390d`, mcp-builder Apache-2.0.

[CLI, browser and CI tutorial](../../docs/RESOURCES.md).

## 中文

三个真实技能均固定到具体提交，保留原始字节和许可证。完整目录分别发现 8、0、10 个
本地 Markdown 链接；只保留 SKILL.md 的人为对照丢失了前后两个样例的所有目标。
第二个样例没有此类链接，不能解读为“所有依赖通过”。复现脚本校验源文件哈希并重算
报告；这些是资源可用性样例，不是上游漏洞、模型成绩或全面安全审核。
