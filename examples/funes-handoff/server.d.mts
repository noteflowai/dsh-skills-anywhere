import type { McpServer } from '@modelcontextprotocol/server'
import type { HandoffBridge } from './bridge.mjs'

export const sourceUri: 'handoff://selected-source'
export function createHandoffServer(bridge: Pick<HandoffBridge, 'call' | 'describe'>): McpServer
export function runHandoffServer(directory: string, binary: string, modelCache: string): Promise<void>
