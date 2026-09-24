import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Both registry jobs hold a GitHub OIDC token for the io.github.noteflowai/*
// namespace, so the publisher binary they run is part of the release's trust.

const root = join(import.meta.dirname, '..')
const workflow = (name: string) => readFileSync(join(root, '.github', 'workflows', name), 'utf8')
const DOWNLOAD = /https:\/\/github\.com\/modelcontextprotocol\/registry\/releases\/download\/(v\d+\.\d+\.\d+)\/mcp-publisher_linux_amd64\.tar\.gz/g
const DIGEST = /'([a-f0-9]{64}) {2}mcp-publisher\.tar\.gz' \| sha256sum --check/g

function publisherPins(text: string) {
  return {
    versions: [...text.matchAll(DOWNLOAD)].map(match => match[1]),
    digests: [...text.matchAll(DIGEST)].map(match => match[1]),
  }
}

describe('MCP publisher', () => {
  it('is never fetched through a moving release alias', () => {
    for (const name of ['release.yml', 'registry-recovery.yml']) {
      expect(workflow(name)).not.toMatch(/releases\/latest/)
    }
  })

  it('is pinned to one checksummed version in the release and recovery workflows', () => {
    const release = publisherPins(workflow('release.yml'))
    const recovery = publisherPins(workflow('registry-recovery.yml'))
    expect(release.versions).toHaveLength(1)
    expect(release.digests).toHaveLength(1)
    expect(release).toEqual(recovery)
  })
})
