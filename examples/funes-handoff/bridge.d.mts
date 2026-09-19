export interface SourceBinding {
  root: string
  manifestHash: string
  source: {
    session_id: string
    files: Record<string, string>
    funes: { version: string; sha256: string }
    [key: string]: unknown
  }
}
export interface HandoffReply {
  view: { status: string; [key: string]: unknown }
  receipt?: Record<string, unknown>
}
export interface HandoffBridge {
  ready: Record<string, unknown>
  describe(): Promise<Record<string, unknown>>
  call(name: string, args: Record<string, unknown>): Promise<HandoffReply>
  close(): Promise<{ stderr_tail: string }>
}
export interface NativeRequest {
  name: string
  arguments: Record<string, unknown>
}
export function verifySource(directory: string, expectedManifest?: string): Promise<SourceBinding>
export function nativeRequest(name: string, args: unknown, sessionId: string): NativeRequest
export function checkedResult(raw: unknown, nativeName: string, sessionId: string): HandoffReply['view']
export function createBoundCaller(
  client: { callTool(request: NativeRequest): Promise<unknown> },
  binding: SourceBinding,
  protocolEra: string | null,
  guard: () => Promise<unknown>,
): HandoffBridge['call']
export function connectFunesBridge(directory: string, binary: string, modelCache: string): Promise<HandoffBridge>
