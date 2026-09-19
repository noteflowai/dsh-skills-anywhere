import { createHash } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { expect, it, vi } from 'vitest'
import { tempDir } from './helpers.ts'
import { checkedResult, createBoundCaller, nativeRequest, verifySource } from '../examples/funes-handoff/bridge.mjs'
import { createHandoffServer, sourceUri } from '../examples/funes-handoff/server.mjs'

const session = 'evalarc-public-2f665fd5734bb89435224913'
const digest = (text: string) => createHash('sha256').update(text).digest('hex')

it('exposes only scoped tools over MCP and rejects extra arguments before backend access', async () => {
  const call = vi.fn().mockResolvedValue({
    view: { status: 'not_found', text: 'no matching results' },
    receipt: { route: 'funes-mcp' },
  })
  const describe = vi.fn().mockResolvedValue({ session_id: session, manifest_sha256: 'b'.repeat(64) })
  const server = createHandoffServer({ call, describe })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'bounded-handoff-test', version: '1' })
  try {
    await client.connect(clientTransport)
    expect((await client.listTools()).tools.map(tool => tool.name).sort())
      .toEqual(['read_prior_turns', 'recall_prior_session'])
    const rejected = await client.callTool({
      name: 'recall_prior_session', arguments: { query: 'clock', memory: '/another-source' },
    })
    expect(rejected.isError).toBe(true)
    expect(call).not.toHaveBeenCalled()
    const reply = await client.callTool({ name: 'recall_prior_session', arguments: { query: 'clock' } })
    expect(reply.structuredContent).toMatchObject({ view: { status: 'not_found' } })
    expect(reply.isError).toBe(false)
    expect(call).toHaveBeenCalledWith('recall_prior_session', { query: 'clock' })
    const resources = await client.listResources()
    expect(resources.resources.map(resource => resource.uri)).toEqual([sourceUri])
    const source = await client.readResource({ uri: sourceUri })
    expect(JSON.stringify(source)).toContain(session)
    describe.mockRejectedValueOnce(new Error('selected source is missing'))
    await expect(client.readResource({ uri: sourceUri })).rejects.toThrow(/source is missing/)
    call.mockResolvedValueOnce({ view: { status: 'source_unavailable', error: 'selected source is missing' } })
    expect((await client.callTool({ name: 'read_prior_turns', arguments: { from: 0, to: 2 } })).isError).toBe(true)
  } finally {
    await client.close()
    await server.close()
  }
})

async function fixture() {
  const directory = await tempDir('funes-source')
  const program = 'print("public starter")\n'
  const parquet = 'test-only exported session'
  const trial = JSON.stringify({
    split: 'public-development', model: { model: 'Qwen/Qwen3-8B' },
    candidate_files: { 'main.py': digest(program) },
  })
  const files: Record<string, string> = {
    'prior/main.py': program,
    'prior/trial.json': trial,
    'prior-session.parquet': parquet,
    'prior-session.manifest.json': JSON.stringify({
      source_sha256: digest(trial), parquet_sha256: digest(parquet), session_id: session,
    }),
    'memory/chunks.lance/data/test.bin': 'test-only memory bytes',
  }
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(join(directory, name)), { recursive: true })
    await writeFile(join(directory, name), content)
  }
  await writeFile(join(directory, 'source.json'), JSON.stringify({
    schema: 'noteflow.public-handoff-source.v1', split: 'public-development',
    session_id: session, memory_directory: 'memory',
    funes: { version: '1.3.0', sha256: 'a'.repeat(64) },
    files: Object.fromEntries(Object.entries(files).map(([name, text]) => [name, digest(text)])),
  }))
  return { directory, binding: await verifySource(directory) }
}

it('maps only bounded requests to the selected session and disables recency weighting', () => {
  expect(nativeRequest('recall_prior_session', { query: 'clock conversion' }, session)).toEqual({
    name: 'recall', arguments: { query: 'clock conversion', k: 4, neighbors: 0, half_life: 0 },
  })
  expect(nativeRequest('read_prior_turns', { from: 2, to: 5 }, session)).toEqual({
    name: 'get', arguments: { session_id: session, from: 2, to: 5 },
  })
  for (const args of [
    { query: 'clock', memory: 'private/other-memory' }, { query: '' }, { query: 'a'.repeat(1025) },
  ]) expect(() => nativeRequest('recall_prior_session', args, session)).toThrow()
  expect(() => nativeRequest('read_prior_turns', { from: 0, to: 8 }, session)).toThrow()
  expect(() => nativeRequest('read_prior_turns', { from: 0, to: 2, session_id: 'other' }, session)).toThrow()
  expect(() => nativeRequest('status', {}, session)).toThrow()
})

it('does not equate isError=false with a successful retrieval', () => {
  expect(checkedResult({ content: [{ type: 'text', text: 'get error: no session missing' }], isError: false },
    'get', session).status).toBe('retrieval_error')
  expect(checkedResult({ content: [{ type: 'text', text: `no turns in that range of session ${session} (it holds 14)\n` }] },
    'get', session).status).toBe('not_found')
})

it('withholds text when its displayed source does not match the selected session', () => {
  const reply = checkedResult({
    content: [{ type: 'text', text: '  → get other-session --from 1 --to 2\nUNAPPROVED CONTENT' }],
  }, 'recall', session)
  expect(reply.status).toBe('provenance_error')
  expect(reply).not.toHaveProperty('text')
})

it('does not retain unapproved response text in the audit receipt either', async () => {
  const { binding } = await fixture()
  const client = { callTool: vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: '  → get other-session --from 1 --to 2\nUNAPPROVED CONTENT' }],
  }) }
  const call = createBoundCaller(client, binding, 'legacy', async () => {})
  const response = await call('recall_prior_session', { query: 'clock' })
  expect(response.view.status).toBe('provenance_error')
  expect(JSON.stringify(response)).not.toContain('UNAPPROVED')
  expect(response.receipt?.raw_sha256).toMatch(/^[a-f0-9]{64}$/)
})

it('retains bounded passages and exact turn identifiers for source inspection', () => {
  const text = `  → get ${session} --from 1 --to 3 --memory /selected/memory\nSaved context`
  expect(checkedResult({ content: [{ type: 'text', text }] }, 'recall', session)).toMatchObject({
    status: 'retrieved', text, passages: [{ session_id: session, from: 1, to: 3 }],
  })
  const turn = `[2026-09-14] assistant seq2 turn=${session}-2\nSaved text`
  expect(checkedResult({ content: [{ type: 'text', text: turn }] }, 'get', session)).toMatchObject({
    status: 'retrieved', turns: [2],
  })
  expect(checkedResult({ content: [{ type: 'text', text: 'x'.repeat(32769) }] }, 'get', session)
    .status).toBe('result_too_large')
})

it('rejects a memory override before contacting the backend', async () => {
  const { binding } = await fixture()
  const client = { callTool: vi.fn() }
  const call = createBoundCaller(client, binding, 'legacy', async () => {})
  expect((await call('recall_prior_session', { query: 'clock', memory: 'local' })).view.status)
    .toBe('request_rejected')
  expect(client.callTool).not.toHaveBeenCalled()
})

it('reports a missing selected source before querying another memory', async () => {
  const { directory, binding } = await fixture()
  const client = { callTool: vi.fn() }
  const call = createBoundCaller(client, binding, 'legacy',
    () => verifySource(directory, binding.manifestHash))
  await rm(join(directory, 'prior-session.parquet'))
  expect((await call('recall_prior_session', { query: 'clock' })).view.status).toBe('source_unavailable')
  expect(client.callTool).not.toHaveBeenCalled()
})

it('rejects changed memory bytes and keeps transport failures visible', async () => {
  const { directory, binding } = await fixture()
  const client = { callTool: vi.fn().mockRejectedValue(new Error('backend disconnected')) }
  const call = createBoundCaller(client, binding, 'legacy',
    () => verifySource(directory, binding.manifestHash))
  expect((await call('read_prior_turns', { from: 0, to: 2 })).view).toMatchObject({
    status: 'retrieval_error', error: 'backend disconnected',
  })
  await writeFile(join(directory, 'memory/chunks.lance/data/test.bin'), 'replaced')
  expect((await call('read_prior_turns', { from: 0, to: 2 })).view.status).toBe('source_unavailable')
  expect(client.callTool).toHaveBeenCalledTimes(1)
})
