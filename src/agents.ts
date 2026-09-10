/**
 * Where other coding agents keep their Agent Skills.
 *
 * The table follows the conventions catalogued by the `skills` CLI
 * (https://github.com/vercel-labs/skills) and each agent's own docs. Two rows
 * are deliberately absent because the shipped `@deepseek-ai/dsh-skill-filesystem`
 * provider already scans them: `.agents/skills` (project and `~/.agents/skills`)
 * and `.dsh/skills`. Re-scanning them here would only produce duplicates.
 *
 * `project` is relative to the project root (nearest ancestor with `.git`, else
 * the cwd). `user` is relative to the home directory. Either may be absent.
 *
 * @module
 */

export interface AgentSpec {
  /** Stable identifier, usable in `excludeAgents`. */
  readonly id: string
  /** Human-readable product name. */
  readonly label: string
  /** Project-level skills directory, relative to the project root. */
  readonly project?: string
  /** User-level skills directory, relative to the home directory. */
  readonly user?: string
}

export const AGENTS: readonly AgentSpec[] = [
  { id: 'claude-code', label: 'Claude Code', project: '.claude/skills', user: '.claude/skills' },
  { id: 'codex', label: 'OpenAI Codex', user: '.codex/skills' },
  { id: 'cursor', label: 'Cursor', user: '.cursor/skills' },
  { id: 'gemini-cli', label: 'Gemini CLI', user: '.gemini/skills' },
  { id: 'github-copilot', label: 'GitHub Copilot', user: '.copilot/skills' },
  { id: 'antigravity', label: 'Antigravity', user: '.gemini/antigravity/skills' },
  { id: 'antigravity-cli', label: 'Antigravity CLI', user: '.gemini/antigravity-cli/skills' },
  { id: 'opencode', label: 'OpenCode', user: '.config/opencode/skills' },
  { id: 'universal', label: 'Amp / Replit / Universal', user: '.config/agents/skills' },
  { id: 'windsurf', label: 'Windsurf', project: '.windsurf/skills', user: '.codeium/windsurf/skills' },
  { id: 'kiro-cli', label: 'Kiro CLI', project: '.kiro/skills', user: '.kiro/skills' },
  { id: 'goose', label: 'Goose', project: '.goose/skills', user: '.config/goose/skills' },
  { id: 'grok', label: 'Grok Build', project: '.grok/skills', user: '.grok/skills' },
  { id: 'hermes-agent', label: 'Hermes Agent', project: '.hermes/skills', user: '.hermes/skills' },
  { id: 'roo', label: 'Roo Code', project: '.roo/skills', user: '.roo/skills' },
  { id: 'cline', label: 'Cline', user: '.cline/skills' },
  { id: 'continue', label: 'Continue', project: '.continue/skills', user: '.continue/skills' },
  { id: 'junie', label: 'Junie', project: '.junie/skills', user: '.junie/skills' },
  { id: 'qwen-code', label: 'Qwen Code', project: '.qwen/skills', user: '.qwen/skills' },
  { id: 'trae', label: 'Trae', project: '.trae/skills', user: '.trae/skills' },
  { id: 'trae-cn', label: 'Trae CN', user: '.trae-cn/skills' },
  { id: 'augment', label: 'Augment', project: '.augment/skills', user: '.augment/skills' },
  { id: 'droid', label: 'Droid (Factory)', user: '.factory/skills' },
  { id: 'kilo', label: 'Kilo Code', user: '.kilo/skills' },
  { id: 'deepagents', label: 'Deep Agents', user: '.deepagents/agent/skills' },
  { id: 'devin', label: 'Devin for Terminal', project: '.devin/skills', user: '.config/devin/skills' },
  { id: 'crush', label: 'Crush', project: '.crush/skills', user: '.config/crush/skills' },
  { id: 'firebender', label: 'Firebender', user: '.firebender/skills' },
  { id: 'forgecode', label: 'ForgeCode', project: '.forge/skills', user: '.forge/skills' },
  { id: 'fx', label: 'fx', project: '.fx/skills', user: '.fx/skills' },
  { id: 'iflow-cli', label: 'iFlow CLI', project: '.iflow/skills', user: '.iflow/skills' },
  { id: 'inference-sh', label: 'inference.sh', project: '.inferencesh/skills', user: '.inferencesh/skills' },
  { id: 'jazz', label: 'Jazz', project: '.jazz/skills', user: '.jazz/skills' },
  { id: 'kimchi', label: 'Kimchi', project: '.kimchi/skills', user: '.config/kimchi/harness/skills' },
  { id: 'kode', label: 'Kode', project: '.kode/skills', user: '.kode/skills' },
  { id: 'lingma', label: 'Lingma', project: '.lingma/skills', user: '.lingma/skills' },
  { id: 'mcpjam', label: 'MCPJam', project: '.mcpjam/skills', user: '.mcpjam/skills' },
  { id: 'minimax-code', label: 'MiniMax Code', project: '.minimax/skills', user: '.minimax/skills' },
  { id: 'mistral-vibe', label: 'Mistral Vibe', project: '.vibe/skills', user: '.vibe/skills' },
  { id: 'moxby', label: 'Moxby', project: '.moxby/skills', user: '.moxby/skills' },
  { id: 'mux', label: 'Mux', project: '.mux/skills', user: '.mux/skills' },
  { id: 'neovate', label: 'Neovate', project: '.neovate/skills', user: '.neovate/skills' },
  { id: 'ona', label: 'Ona', project: '.ona/skills', user: '.ona/skills' },
  { id: 'openclaw', label: 'OpenClaw', user: '.openclaw/skills' },
  { id: 'openhands', label: 'OpenHands', project: '.openhands/skills', user: '.openhands/skills' },
  { id: 'pi', label: 'Pi', project: '.pi/skills', user: '.pi/agent/skills' },
  { id: 'pochi', label: 'Pochi', project: '.pochi/skills', user: '.pochi/skills' },
  { id: 'posit-assistant', label: 'Posit Assistant', project: '.posit/assistant/skills', user: '.posit/assistant/skills' },
  { id: 'qoder', label: 'Qoder', project: '.qoder/skills', user: '.qoder/skills' },
  { id: 'qoder-cn', label: 'Qoder CN', user: '.qoder-cn/skills' },
  { id: 'reasonix', label: 'Reasonix', project: '.reasonix/skills', user: '.reasonix/skills' },
  { id: 'rovodev', label: 'Rovo Dev', project: '.rovodev/skills', user: '.rovodev/skills' },
  { id: 'tabnine-cli', label: 'Tabnine CLI', project: '.tabnine/agent/skills', user: '.tabnine/agent/skills' },
  { id: 'terramind', label: 'Terramind', project: '.terramind/skills', user: '.terramind/skills' },
  { id: 'tinycloud', label: 'Tinycloud', project: '.tinycloud/skills', user: '.tinycloud/skills' },
  { id: 'zcode', label: 'ZCode', project: '.zcode/skills', user: '.zcode/skills' },
  { id: 'zencoder', label: 'Zencoder / Zenflow', project: '.zencoder/skills', user: '.zencoder/skills' },
  { id: 'adal', label: 'AdaL', project: '.adal/skills', user: '.adal/skills' },
  { id: 'aider-desk', label: 'AiderDesk', project: '.aider-desk/skills', user: '.aider-desk/skills' },
  { id: 'astrbot', label: 'AstrBot', user: '.astrbot/data/skills' },
  { id: 'autohand-code', label: 'Autohand Code CLI', project: '.autohand/skills', user: '.autohand/skills' },
  { id: 'bob', label: 'IBM Bob', project: '.bob/skills', user: '.bob/skills' },
  { id: 'codearts-agent', label: 'CodeArts Agent', project: '.codeartsdoer/skills', user: '.codeartsdoer/skills' },
  { id: 'codebuddy', label: 'CodeBuddy', project: '.codebuddy/skills', user: '.codebuddy/skills' },
  { id: 'codemaker', label: 'Codemaker', project: '.codemaker/skills', user: '.codemaker/skills' },
  { id: 'codestudio', label: 'Code Studio', project: '.codestudio/skills', user: '.codestudio/skills' },
  { id: 'command-code', label: 'Command Code', project: '.commandcode/skills', user: '.commandcode/skills' },
  { id: 'cortex', label: 'Cortex Code', project: '.cortex/skills', user: '.snowflake/cortex/skills' },
]

const AGENT_INDEX = new Map(AGENTS.map(agent => [agent.id, agent]))

/** Look up one agent by id. */
export function agentById(id: string): AgentSpec | undefined {
  return AGENT_INDEX.get(id)
}
