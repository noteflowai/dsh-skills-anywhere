/** Bounded reads shared by file checks and MCP instruction loading. */
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { MAX_SKILL_BYTES } from './skill-check.ts'

export async function readSkillBytes(path: string): Promise<Buffer> {
  // NONBLOCK lets us reject named pipes on POSIX without waiting for a writer.
  const handle = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0))
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error('Choose a regular Markdown file.')
    if (stat.size > MAX_SKILL_BYTES) throw new Error('Choose a SKILL.md of 128 KiB or less.')
    // Bound the read as well as stat: the file can grow while being checked.
    const buffer = Buffer.alloc(MAX_SKILL_BYTES + 1)
    let size = 0
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null)
      if (bytesRead === 0) break
      size += bytesRead
    }
    if (size > MAX_SKILL_BYTES) throw new Error('Choose a SKILL.md of 128 KiB or less.')
    return buffer.subarray(0, size)
  } finally {
    await handle.close()
  }
}

