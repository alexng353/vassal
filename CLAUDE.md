# CLAUDE.md

Notes for Claude Code working on this repo.

## What this is

`vassal` is a thin CLI that dispatches a coding task to GPT-5.5 (via `opencode serve`) from a Claude Code orchestrator. Worktree-isolated by default, session-resumable.

The intended call shape from Claude Code is:

```bash
vassal "<prompt>"                      # foreground, blocks until done
vassal --session <id> "<follow-up>"    # resume same conversation
```

For long tasks, the orchestrator backgrounds the call via Bash `run_in_background: true` and reads stdout via BashOutput when notified.

## Architecture

```
vassal CLI                       opencode serve (daemon)
   │                                    │
   ├─ dispatch ───────────────────────► │  HTTP API (127.0.0.1:4096)
   │   1. ensure daemon                 │  - POST /session
   │   2. create worktree (default)     │  - POST /session/:id/prompt
   │   3. create or reuse session       │  - GET  /global/health
   │   4. send prompt, await response   │
   │   5. write session metadata        │
   │   6. print line-prefixed output    │
```

Session metadata (id, worktree path, cost, timestamps) lives at `$XDG_STATE_HOME/vassal/sessions.json`. Daemon state at `daemon.json`.

## Commands

- Run: `bun src/cli.ts <args>`
- Type check: `bun run check` (uses tsgo)
- Lint/format: `bun run lint`

## Stack

- Bun (runtime + package manager)
- TypeScript via `@typescript/native-preview` (tsgo) for type checking
- Biome for lint + format
- `@opencode-ai/sdk` for talking to the daemon
- `dedent` for multi-line string literals

## Code style

- `type X = { ... }` for object shapes; `interface` only for declaration merging
- Multi-line strings via `dedent` template literals — never `[...].join("\n")`
- Double quotes, trailing commas, 2-space indent (Biome enforces)
- After mass changes, run `bun run lint` and own the diff

## Output contract (load-bearing)

`vassal dispatch` prints a strict line-prefixed header followed by `---` then final text:

```
SESSION <id>
WORKTREE <path|->
COST $<amount|->
EXIT <code>
---
<final assistant text>
```

This contract is what makes vassal usable from a parent agent. Do not change line prefixes, separator, or ordering without updating the skill at `~/.claude/skills/vassal/SKILL.md`.

`peek` and `abort` (mid-flight commands) have their own free-form output and do **not** follow the dispatch contract. `peek` prints metadata + a snapshot of the latest assistant turn (text/reasoning/tool calls); `abort` prints a one-line acknowledgement. Both are documented in the skill.

## Worktree lifecycle

A new dispatch (no `--session`) creates a worktree at `$TMPDIR/vassal-wt-<short-id>` on a branch `vassal/<short-id>` off the current HEAD. The dispatched agent edits there. The parent orchestrator is responsible for:

- Reviewing the diff (`git -C <worktree> diff`)
- Merging or discarding (typically rebase-merge into the parent branch)
- Cleanup via `vassal cleanup <session-id>` (removes worktree + branch + forgets session)

`--no-worktree` runs in the parent's cwd; only use when the parent explicitly wants in-place edits.

`--worktree <path>` lets the caller pin the dispatch to a specific path (e.g. an existing worktree, or one your own tooling will create). If the path doesn't exist, vassal looks for a `[vassal] worktree_setup` command in `.alex.toml` at the repo root, substitutes `{path}`, and runs it via `bash -c`. If setup is configured but the path still doesn't exist after the command, vassal errors. Mutually exclusive with `--no-worktree`.

The `.alex.toml` is shared with other personal tooling (e.g. the `rebase-merge` skill reads a top-level `post-merge` key). Sectioned keys like `[vassal] worktree_setup` are namespaced and won't collide with flat top-level keys read by other tools.

## Daemon lifecycle

`opencode serve` is auto-started lazily on first dispatch and persists across calls. Picks port 4096 by default, scans up to 4145 if taken. PID + URL written to `$XDG_STATE_HOME/vassal/daemon.json`. The daemon is detached and survives the CLI process exit.

`vassal server stop` kills it. `vassal server status` reports.

## Things to watch

- **MCP duplication per session.** Every opencode session spawns its own MCP server processes. If you fan out 10 concurrent dispatches with MCP servers configured, memory usage multiplies. Configure `~/.config/opencode/opencode.json` minimally — read/write/edit/bash, no extra MCP unless needed.
- **No permission prompts.** The daemon should be configured to auto-approve tools (or use a strict allow-list). If a dispatched agent hits a permission prompt with no TTY, it hangs.
- **Cost accounting.** `outcome.cost` comes from the prompt response if opencode returns it; fall back to `null`. Don't enforce budgets in v1 — just surface the number.
