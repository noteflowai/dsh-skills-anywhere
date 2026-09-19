/** MCP client used by the experiment's JSONL adapter; real clients use server.mjs. */
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

export async function connectHandoffServer(directory, binary, modelCache) {
  const client = new Client({ name: 'evalarc-handoff-recorder', version: '1.0.0' },
    { versionNegotiation: { mode: 'auto' } })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('./server.mjs', import.meta.url)), directory, binary, modelCache],
    stderr: 'pipe',
  })
  let stderr = ''
  transport.stderr?.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-16384) })
  try {
    await client.connect(transport)
    const server = client.getServerVersion()
    const catalog = await client.listTools()
    const names = catalog.tools.map(tool => tool.name).sort()
    if (server?.name !== 'skills-anywhere-public-handoff' || server.version !== '1.0.0'
        || names.join(',') !== 'read_prior_turns,recall_prior_session') {
      throw new Error('bounded MCP server identity or tools differ')
    }
    const source = await client.readResource({ uri: 'handoff://selected-source' })
    if (source.contents.length !== 1 || typeof source.contents[0].text !== 'string') {
      throw new Error('selected-source resource is unavailable')
    }
    const ready = JSON.parse(source.contents[0].text)
    const boundary = { server, protocol_era: client.getProtocolEra(), catalog }
    return {
      ready: { ...ready, bounded_mcp: boundary },
      async call(name, args) {
        const response = await client.callTool({ name, arguments: args })
        const result = response.structuredContent
        if (!result?.view || typeof result.view.status !== 'string') {
          return {
            view: { status: 'request_rejected', error: 'Bounded MCP input validation rejected the call' },
            receipt: { route: 'funes-mcp', bounded_mcp: boundary,
              bounded_request: { name, arguments: args }, bounded_response: response },
          }
        }
        return {
          view: result.view,
          receipt: { ...result.receipt, bounded_mcp: boundary,
            bounded_request: { name, arguments: args }, bounded_is_error: response.isError === true },
        }
      },
      async close() {
        try { await client.close() }
        finally { await transport.close() }
        return { stderr_tail: stderr }
      },
    }
  } catch (error) {
    try { await client.close() }
    finally { await transport.close() }
    throw new Error(`${error.message}${stderr ? `; bounded server stderr: ${stderr}` : ''}`)
  }
}
