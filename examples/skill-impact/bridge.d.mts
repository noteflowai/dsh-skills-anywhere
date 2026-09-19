export interface ImpactBridge {
  pins: Record<string, { sha256: string; bundle_sha256: string }>
  call(name: string, args: Record<string, unknown>): Promise<{
    view: Record<string, unknown>
    receipt: {
      route: string
      tool: string
      arguments: Record<string, unknown>
      elapsed_ms: number
      protocol_era: string | null
      raw: unknown
    }
  }>
  close(): Promise<void>
}
export function connectBridge(
  route: 'direct' | 'mcp',
  pool: string,
  expectedPins?: unknown,
): Promise<ImpactBridge>
