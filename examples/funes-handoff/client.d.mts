import type { HandoffBridge } from './bridge.mjs'

export function connectHandoffServer(
  directory: string, binary: string, modelCache: string,
): Promise<Omit<HandoffBridge, 'describe'>>
