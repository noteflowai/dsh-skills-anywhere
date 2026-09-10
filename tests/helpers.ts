import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach } from 'vitest'

const execFileAsync = promisify(execFile)

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

export async function tempDir(name = 'skills-anywhere'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `${name}-`))
  tempDirs.push(dir)
  return dir
}

export interface SkillFileOptions {
  readonly body?: string
  readonly frontmatter?: Record<string, unknown> | string
  readonly omitName?: boolean
  readonly omitDescription?: boolean
}

export function skillMarkdown(name: string, description: string, options: SkillFileOptions = {}): string {
  const lines = ['---']
  if (!options.omitName) lines.push(`name: ${name}`)
  if (!options.omitDescription) lines.push(`description: ${description}`)
  if (typeof options.frontmatter === 'string') {
    lines.push(options.frontmatter)
  } else if (options.frontmatter !== undefined) {
    for (const [key, value] of Object.entries(options.frontmatter)) {
      lines.push(`${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    }
  }
  lines.push('---', '', options.body ?? `Instructions for ${name}.`, '')
  return lines.join('\n')
}

/** Write `<root>/<name>/SKILL.md`. */
export async function writeSkill(root: string, name: string, description = `${name} description`, options: SkillFileOptions = {}): Promise<string> {
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'SKILL.md')
  await writeFile(file, skillMarkdown(name, description, options))
  return file
}

/** Write a flat `<root>/<name>.md`. */
export async function writeFlatSkill(root: string, name: string, description = `${name} description`): Promise<string> {
  await mkdir(root, { recursive: true })
  const file = join(root, `${name}.md`)
  await writeFile(file, skillMarkdown(name, description))
  return file
}

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [
    '-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main',
    ...args,
  ], { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  return stdout.trim()
}

/** Create a committed git repository containing the given skills. */
export async function makeSkillRepo(skills: readonly { path: string; name: string; description?: string }[]): Promise<string> {
  const repo = await tempDir('skill-repo')
  await git(repo, 'init', '-q')
  for (const skill of skills) {
    const dir = join(repo, skill.path)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'SKILL.md'), skillMarkdown(skill.name, skill.description ?? `${skill.name} from repo`))
  }
  await writeFile(join(repo, 'README.md'), '# skills\n')
  await git(repo, 'add', '-A')
  await git(repo, 'commit', '-q', '-m', 'initial')
  return repo
}

export function quietLogger(): { info: (message: string) => void; warn: (message: string) => void; messages: string[] } {
  const messages: string[] = []
  return {
    messages,
    info: message => { messages.push(`info: ${message}`) },
    warn: message => { messages.push(`warn: ${message}`) },
  }
}

export async function waitFor<T>(read: () => Promise<T> | T, accept: (value: T) => boolean, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (true) {
    const value = await read()
    if (accept(value)) return value
    if (Date.now() >= deadline) throw new Error('timed out waiting for condition')
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}
