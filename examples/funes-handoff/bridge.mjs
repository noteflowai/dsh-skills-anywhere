#!/usr/bin/env node
/**
 * A bounded client of the real Funes stdio MCP server.
 * Only the explicitly selected public session is available to the agent.
 */
import { createHash } from 'node:crypto'
import { lstat, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

const entry = fileURLToPath(import.meta.url)
const sha256 = data => createHash('sha256').update(data).digest('hex')
const hashPattern = /^[a-f0-9]{64}$/
const sessionPattern = /^evalarc-public-[a-f0-9]{24}$/
const maxResultBytes = 32 * 1024

async function inventory(root, directory = root) {
  const result = Object.create(null)
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name)
    if (item.isSymbolicLink()) throw new Error('selected source cannot contain symlinks')
    if (item.isDirectory()) Object.assign(result, await inventory(root, path))
    else if (item.isFile()) {
      if ((await lstat(path)).size > 2 * 1024 * 1024) throw new Error('source file exceeds 2 MiB')
      result[relative(root, path).replaceAll('\\', '/')] = sha256(await readFile(path))
    } else throw new Error('selected source must contain only regular files and directories')
  }
  return result
}

export async function verifySource(directory, expectedManifest) {
  const root = resolve(directory)
  if ((await lstat(root)).isSymbolicLink()) throw new Error('selected source cannot be a symlink')
  const bytes = await readFile(join(root, 'source.json'))
  const manifestHash = sha256(bytes)
  if (expectedManifest && manifestHash !== expectedManifest) throw new Error('source manifest changed')
  const source = JSON.parse(bytes)
  if (source.schema !== 'noteflow.public-handoff-source.v1'
      || source.split !== 'public-development'
      || !sessionPattern.test(source.session_id)
      || source.memory_directory !== 'memory'
      || source.funes?.version !== '1.3.0'
      || !hashPattern.test(source.funes?.sha256 ?? '')
      || !source.files || Array.isArray(source.files)) throw new Error('invalid public source manifest')
  const observed = await inventory(root)
  delete observed['source.json']
  const names = Object.keys(source.files).sort()
  if (JSON.stringify(names) !== JSON.stringify(Object.keys(observed).sort())) {
    throw new Error('selected source inventory changed')
  }
  for (const name of names) {
    if (isAbsolute(name) || name.split('/').some(part => part === '..' || part === '.')
        || !hashPattern.test(source.files[name]) || observed[name] !== source.files[name]) {
      throw new Error(`selected source file changed: ${name}`)
    }
  }
  const trial = JSON.parse(await readFile(join(root, 'prior/trial.json'), 'utf8'))
  const exported = JSON.parse(await readFile(join(root, 'prior-session.manifest.json'), 'utf8'))
  if (trial.split !== 'public-development' || trial.model?.model !== 'Qwen/Qwen3-8B'
      || trial.candidate_files?.['main.py'] !== observed['prior/main.py']
      || exported.source_sha256 !== observed['prior/trial.json']
      || exported.parquet_sha256 !== observed['prior-session.parquet']
      || exported.session_id !== source.session_id
      || !names.some(name => name.startsWith('memory/chunks.lance/'))) {
    throw new Error('prior program, exported session and selected source differ')
  }
  return { root, manifestHash, source }
}

export function nativeRequest(name, args, sessionId) {
  if (!args || Array.isArray(args) || typeof args !== 'object') throw new Error('arguments must be an object')
  if (name === 'recall_prior_session') {
    if (Object.keys(args).length !== 1 || typeof args.query !== 'string'
        || !args.query.trim() || Buffer.byteLength(args.query) > 1024) {
      throw new Error('recall accepts only a nonempty query of at most 1024 bytes')
    }
    return { name: 'recall', arguments: { query: args.query, k: 4, neighbors: 0, half_life: 0 } }
  }
  if (name === 'read_prior_turns') {
    if (Object.keys(args).sort().join(',') !== 'from,to'
        || !Number.isSafeInteger(args.from) || !Number.isSafeInteger(args.to)
        || args.from < 0 || args.to < args.from || args.to - args.from > 7 || args.to > 1_000_000) {
      throw new Error('read accepts only from/to integers spanning at most eight turns')
    }
    return { name: 'get', arguments: { session_id: sessionId, from: args.from, to: args.to } }
  }
  throw new Error('tool is outside the selected-session interface')
}

export function checkedResult(raw, nativeName, sessionId) {
  if (!Array.isArray(raw?.content) || raw.content.some(part => part.type !== 'text' || typeof part.text !== 'string')) {
    return { status: 'retrieval_error', error: 'Funes returned an unsupported response' }
  }
  const text = raw.content.map(part => part.text).join('\n')
  if (Buffer.byteLength(text) > maxResultBytes) {
    return { status: 'result_too_large', error: 'Use a narrower query or turn range; no content was delivered' }
  }
  // Funes 1.3.0 also returns some textual errors with isError=false.
  if (raw.isError || /^(?:get|recall) error:/i.test(text.trim())) {
    return { status: 'retrieval_error', error: text }
  }
  if (/^(?:no turns in that range|no (?:matching )?(?:results|hits)|nothing found)/i.test(text.trim())
      || !text.trim()) return { status: 'not_found', text }
  if (nativeName === 'recall') {
    const references = [...text.matchAll(/^\s*→ get (\S+) --from (\d+) --to (\d+)/gm)]
    if (!references.length || references.some(match => match[1] !== sessionId)) {
      return { status: 'provenance_error', error: 'Recall did not identify only the selected source; content withheld' }
    }
    return {
      status: 'retrieved', text,
      passages: references.map(match => ({ session_id: match[1], from: Number(match[2]), to: Number(match[3]) })),
    }
  }
  const turns = [...text.matchAll(/^\[[^\n]+\] \S+ seq(\d+) turn=(\S+)/gm)]
  if (!turns.length || turns.some(match => !match[2].startsWith(`${sessionId}-`))) {
    return { status: 'provenance_error', error: 'Read did not identify the selected source; content withheld' }
  }
  return { status: 'retrieved', text, turns: turns.map(match => Number(match[1])) }
}

export function createBoundCaller(client, binding, protocolEra, guard) {
  const source = {
    session_id: binding.source.session_id,
    manifest_sha256: binding.manifestHash,
    prior_trial_sha256: binding.source.files['prior/trial.json'],
    prior_program_sha256: binding.source.files['prior/main.py'],
    parquet_sha256: binding.source.files['prior-session.parquet'],
  }
  return async (name, args) => {
    const started = performance.now()
    let request
    try { request = nativeRequest(name, args, source.session_id) }
    catch (error) { return { view: { status: 'request_rejected', error: error.message, source } } }
    try { await guard() }
    catch (error) { return { view: { status: 'source_unavailable', error: error.message, source } } }
    let raw
    try { raw = await client.callTool(request) }
    catch (error) {
      return { view: { status: 'retrieval_error', error: String(error.message ?? error), source },
        receipt: { route: 'funes-mcp', request, protocol_era: protocolEra, elapsed_ms: performance.now() - started } }
    }
    try { await guard() }
    catch (error) { return { view: { status: 'source_unavailable', error: error.message, source } } }
    const view = checkedResult(raw, request.name, source.session_id)
    const retained = ['retrieved', 'not_found'].includes(view.status)
      ? { raw }
      : { raw_sha256: sha256(JSON.stringify(raw)), raw_bytes: Buffer.byteLength(JSON.stringify(raw)),
          raw_withheld: 'Response was not bounded, valid selected-source evidence' }
    return {
      view: { ...view, source },
      receipt: {
        route: 'funes-mcp', request, protocol_era: protocolEra,
        elapsed_ms: performance.now() - started, ...retained,
      },
    }
  }
}

export async function connectFunesBridge(directory, binary, modelCache) {
  const binding = await verifySource(directory)
  if (!binary || !isAbsolute(binary) || sha256(await readFile(binary)) !== binding.source.funes.sha256) {
    throw new Error('explicit Funes binary must match the reviewed executable hash')
  }
  if (!modelCache || !isAbsolute(modelCache) || !(await lstat(modelCache)).isDirectory()) {
    throw new Error('provide an explicit directory with the prepared public model cache')
  }
  const state = await mkdtemp(join(tmpdir(), 'noteflow-funes-state-'))
  const client = new Client({ name: 'skills-anywhere-public-handoff', version: '1' },
    { versionNegotiation: { mode: 'auto' } })
  const transport = new StdioClientTransport({
    command: binary, args: ['mcp', join(binding.root, 'memory')], cwd: state, stderr: 'pipe',
    env: { FUNES_HOME: state, HF_HOME: modelCache, NO_COLOR: '1' },
  })
  let stderr = ''
  transport.stderr?.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-16384) })
  try {
    await client.connect(transport)
    const server = client.getServerVersion()
    const catalog = await client.listTools()
    if (server?.name !== 'funes' || server.version !== binding.source.funes.version
        || !['get', 'recall', 'status'].every(name => catalog.tools.some(tool => tool.name === name))) {
      throw new Error('native Funes identity or required tools differ')
    }
    const status = await client.callTool({ name: 'status', arguments: {} })
    const statusText = status.content?.filter(part => part.type === 'text').map(part => part.text).join('\n') ?? ''
    const firstTurn = await client.callTool({
      name: 'get', arguments: { session_id: binding.source.session_id, from: 0, to: 0 },
    })
    const checkedTurn = checkedResult(firstTurn, 'get', binding.source.session_id)
    const original = JSON.parse(await readFile(join(binding.root, 'prior/trial.json'), 'utf8'))
    if (status.isError || !/^sessions: 1$/m.test(statusText)
        || checkedTurn.status !== 'retrieved'
        || !checkedTurn.text.includes(original.messages?.[0]?.content ?? '\0')) {
      throw new Error('native memory does not identify only the selected original session')
    }
    const era = client.getProtocolEra()
    const ready = { ready: true, route: 'funes-mcp', source: binding.source,
      manifest_sha256: binding.manifestHash, executable_sha256: binding.source.funes.sha256,
      server, protocol_era: era, native_catalog: catalog,
      native_source_check: { status, first_turn: firstTurn } }
    return {
      ready,
      async describe() {
        await verifySource(binding.root, binding.manifestHash)
        return ready
      },
      call: createBoundCaller(client, binding, era, () => verifySource(binding.root, binding.manifestHash)),
      async close() {
        try { await client.close(); await transport.close() }
        finally { await rm(state, { recursive: true, force: true }) }
        return { stderr_tail: stderr }
      },
    }
  } catch (error) {
    await client.close()
    await transport.close()
    await rm(state, { recursive: true, force: true })
    throw error
  }
}

async function main() {
  const [route, directory, binary, modelCache] = process.argv.slice(2)
  if (route !== 'funes-mcp') throw new Error('use: bridge.mjs funes-mcp SOURCE_DIR FUNES_BINARY MODEL_CACHE')
  const { connectHandoffServer } = await import('./client.mjs')
  const bridge = await connectHandoffServer(directory, binary, modelCache)
  process.stdout.write(`${JSON.stringify(bridge.ready)}\n`)
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      let request
      try {
        if (Buffer.byteLength(line) > 8192) throw new Error('request exceeds 8192 bytes')
        request = JSON.parse(line)
        const result = await bridge.call(request.tool, request.arguments ?? {})
        process.stdout.write(`${JSON.stringify({ id: request.id, ...result })}\n`)
      } catch (error) {
        process.stdout.write(`${JSON.stringify({ id: request?.id, view: { status: 'request_rejected', error: String(error.message ?? error) } })}\n`)
      }
    }
  } finally { await bridge.close() }
}

if (process.argv[1] && resolve(process.argv[1]) === entry) await main()
