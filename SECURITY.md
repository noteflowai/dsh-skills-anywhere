# Security

## What this plugin does on your machine

- Reads `SKILL.md` files from the directories listed in the README. It never
  writes to those directories.
- Runs `git clone` / `git fetch` for configured git sources, at plugin start
  and on the refresh interval, into `~/.dsh/skills-anywhere/cache`.
- Writes `~/.dsh/skills-anywhere/lock.json` and, through the CLI, the
  `sources.json` files you ask it to edit.

## Trust model

A skill is a set of instructions the model will follow, and it may reference
scripts the model can run. Adding a git source or an agent directory is a trust
decision equivalent to installing a plugin. Pin sources to a commit
(`--ref <sha>`) when the upstream is not fully trusted, and review `lock.json`.

Git is invoked with `GIT_TERMINAL_PROMPT=0`, so a source that requires
credentials fails instead of prompting.

## Reporting a vulnerability

Email admin@noteflowai.com with a description and reproduction steps. Please do
not open a public issue for security reports. You will receive an
acknowledgement within 72 hours.
