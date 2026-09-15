// Record one actual local stdio MCP delivery as an EvalArc trace input.
// The chosen output is created exclusively; no cloud or model service is used.
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

const output = process.argv[2]
if (!output) throw new Error('Usage: node scripts/record-load.mjs /new/output.json')
const root = fileURLToPath(new URL('../', import.meta.url))
const cwd = await mkdtemp(join(tmpdir(), 'skills-receipt-'))
const hash = value => createHash('sha256').update(value).digest('hex')
const markdown = '---\nname: evidence-review\ndescription: Review supplied recording evidence.\nallowed-tools: Read\n---\nInspect the provided record. Cite its identity. Report missing measurements as unknown.\n'
const wrapper = join(cwd, 'server.mjs')
const client = new Client({ name: 'receipt-recorder', version: '1.0.0' },
  { versionNegotiation: { mode: { pin: '2026-07-28' } } })
try {
  const directory = join(cwd, '.claude/skills/evidence-review')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'SKILL.md'), markdown)
  await writeFile(wrapper, [
    `import { runStdio } from ${JSON.stringify(pathToFileURL(join(root, 'lib/mcp.js')).href)};`,
    `await runStdio(${JSON.stringify({ cwd, config: { home: cwd, dshHome: join(cwd, '.dsh'), sync: false, sourcesFiles: false } })});`,
  ].join('\n'))
  const transport = new StdioClientTransport({ command: process.execPath, args: [wrapper], cwd })
  try {
    await client.connect(transport)
    assert.equal(client.getProtocolEra(), 'modern')
    const tools = await client.listTools()
    const traceId = randomUUID().replaceAll('-', '')
    const spanId = randomUUID().replaceAll('-', '').slice(0, 16)
    const sessionId = randomUUID()
    const started = String(BigInt(Date.now()) * 1_000_000n)
    const result = await client.callTool({
      name: 'open_skill', arguments: { name: 'evidence-review', include_bundle: true },
    })
    const ended = String(BigInt(Date.now()) * 1_000_000n)
    assert.ok(!result.isError)
    const opened = result.structuredContent
    assert.equal(opened.receipt.skill_sha256, hash(markdown))
    assert.equal(opened.receipt.content_sha256, hash(opened.content))
    assert.equal(opened.receipt.bundle_sha256, opened.bundle.sha256)
    const record = {
      schema_version: 'evalarc.trace-input.v1',
      run_id: 'mcp-delivery-' + sessionId,
      provenance: {
        kind: 'recorded',
        description: 'Actual local stdio MCP instruction delivery, collected by scripts/record-load.mjs using an authored skill. No model or AWS evaluation; evaluator results intentionally absent.',
      },
      dataset: { id: 'mcp-delivery-control', version: '1', cases: [
        { id: 'load-evidence-review', goal: 'Load the authored evidence-review skill through MCP.', expected_skills: ['evidence-review'] },
      ] },
      configuration: {
        model: 'none: local MCP client', model_parameters: {},
        prompt_sha256: hash(''), tools_sha256: hash(JSON.stringify(tools)),
        skills: { 'evidence-review': opened.bundle.sha256 },
      },
      evaluators: [
        { id: 'goal-review', revision: 'not-run', level: 'session',
          rating: { kind: 'numeric', min: 0, max: 1, pass_at_least: 1 } },
        { id: 'Builtin.SkillInstructionFollowing', revision: 'not-run', level: 'skill',
          rating: { kind: 'numeric', min: 0, max: 1, pass_at_least: 1 } },
      ],
      cases: [{
        case_id: 'load-evidence-review', session_id: sessionId, trace_ids: [traceId],
        skill_observation_complete: true,
        spans: [{
          traceId, spanId, name: 'open_skill', startTimeUnixNano: started, endTimeUnixNano: ended,
          attributes: { 'session.id': sessionId, 'gen_ai.tool.name': 'open_skill',
            'mcp.protocol.version': '2026-07-28' },
        }],
        skill_calls: [{ name: 'evidence-review', trace_id: traceId, span_id: spanId, receipt: opened.receipt }],
        evaluation_response: { evaluationResults: [] },
      }],
    }
    await writeFile(resolve(output), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
    console.log(JSON.stringify({ output: resolve(output), load_id: opened.receipt.load_id,
      provider_version: opened.receipt.provider_version, protocol: '2026-07-28',
      evaluator_results: 0 }))
  } finally { await client.close() }
} finally { await rm(cwd, { recursive: true, force: true }) }
