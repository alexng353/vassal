# CLAUDE.md

Notes for Claude Code working on this repo.

## Project classification

**Production tooling, not a recreational project.** Vassal is load-bearing infrastructure for autonomous shifts — when it misbehaves it costs real orchestrator time and can corrupt mid-flight work across many parallel sessions. Apply production rigor: block on known-bad approaches rather than letting them ride, prefer correctness over speed, and don't ship a feature that breaks the output contract or wedges the dispatch flow.

This overrides any default "personal-project, let the user try it" collaboration tone for this repo.

## What this is

`vassal` is a thin CLI that dispatches a coding task to GPT-5.6 Sol (via `opencode serve`) from a Claude Code orchestrator. Worktree-isolated by default, session-resumable.

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
MODEL <name effort|->
COST $<amount|->
EXIT <code>
---
<final assistant text>
```

`COST` reads `-` for a zero cost as well as a missing one: opencode reports `0` when the turn was billed to an OpenAI subscription rather than metered, and `$0.0000` would claim otherwise. Same rule everywhere a price is printed — `list`, `peek`, `status`, and the `-H` chin, which drops the tag entirely.

`MODEL` is the shorthand from `src/lib/model.ts` — `Sol XH` for `openai/gpt-5.6-sol` at `xhigh`, `-` when nothing recorded or observed says which model ran. Effort is only ever printed against the model vassal recorded it for; `attach`/`stream`/`peek` prefer the model the daemon reports on the newest assistant turn, so a session from before this was tracked still names its model but drops the effort it can't vouch for.

`<id>` is a generated alias (`ses_word-word-word-word-word`, five EFF-short words) for any session created by this version of vassal; older sessions still show their opaque opencode IDs. All commands (`peek`, `abort`, `cleanup`, `status`, `--session`) accept either form — internally, vassal resolves alias → canonical opencode ID via `src/lib/alias.ts`.

This contract is what makes vassal usable from a parent agent. Do not change line prefixes, separator, or ordering without updating the skill at `~/.claude/skills/vassal/SKILL.md`.

`peek` and `abort` (mid-flight commands) have their own free-form output and do **not** follow the dispatch contract. `peek` prints metadata + a snapshot of the latest assistant turn (text/reasoning/tool calls); `abort` prints a one-line acknowledgement. Both are documented in the skill.

`attach` and `stream` end with the dispatch contract. `stream` precedes it with line-prefixed activity (`[text]`/`[think]`/`[tool]`/`[ask]`/`[meta]`) — append-only and safe to pipe. `-H`/`--human` swaps that half for a status box on the **alternate screen**; it takes over the terminal, so it must stay opt-in and must never become the default. The box is always painted from the home position — never by rewinding the cursor over the previous frame. A rewind depends on the recorded frame height still describing what is on screen, which a resize invalidates (the terminal reflows it), and every variant of that scheme has failed here: eaten shell prompts, a stray `┌` surviving teardown, frames stacking after a workspace switch. Keep the box absolute, and keep every row clipped to the terminal width so nothing can wrap into an extra row.

## Questions are directory-scoped

The daemon keeps pending questions per project, resolved from a `directory` query param, and silently falls back to whatever directory it was started in when the param is missing. Every worktree dispatch runs somewhere other than the daemon's cwd, so omitting it makes the question invisible: `/question` returns `[]`, `answer` reports "no pending question", `deriveStatus` never yields `waiting`, and the session sits wedged on an `ask()` that nothing can reach. `listPendingQuestions`/`replyQuestion`/`rejectQuestion` all take a directory — pass `sessionDirectory(meta)`, never a bare daemon URL. `list` covers many sessions at once, so it queries each distinct directory and merges.

A pending question blocks `session.prompt` indefinitely; there is no timeout. That is the intended shape (the orchestrator answers via `vassal answer`), but it means anything that hides a question turns into a hung dispatch.

## Worktree lifecycle

A new dispatch (no `--session`) creates a worktree at `$XDG_CACHE_HOME/vassal/worktrees/vassal-wt-<short-id>` (defaulting to `~/.cache/vassal/worktrees/`) on a branch `vassal/<short-id>` off the current HEAD. The dispatched agent edits there. The parent orchestrator is responsible for:

- Reviewing the diff (`git -C <worktree> diff`)
- Merging or discarding (typically rebase-merge into the parent branch)
- Cleanup via `vassal cleanup <session-id>` (removes worktree + branch + forgets session)

`--no-worktree` runs in the parent's cwd; only use when the parent explicitly wants in-place edits.

`--worktree-root <path>` overrides the default root for fresh worktrees. `[vassal] worktree_root` in `.alex.toml` does the same for the project; relative paths resolve against the `.alex.toml` directory. Both are mutually exclusive with `--worktree` and `--no-worktree`.

`--worktree <path>` lets the caller pin the dispatch to a specific path (e.g. an existing worktree, or one your own tooling will create). If the path doesn't exist, vassal looks for a `[vassal] worktree_setup` command in `.alex.toml` at the repo root, substitutes `{path}`, and runs it via `bash -c`. If setup is configured but the path still doesn't exist after the command, vassal errors. Mutually exclusive with `--no-worktree`.

The `.alex.toml` is shared with other personal tooling (e.g. the `rebase-merge` skill reads a top-level `post-merge` key). Sectioned keys like `[vassal] worktree_setup` are namespaced and won't collide with flat top-level keys read by other tools.

## Daemon lifecycle

`opencode serve` is auto-started lazily on first dispatch and persists across calls. Picks port 4096 by default, scans up to 4145 if taken. PID + URL written to `$XDG_STATE_HOME/vassal/daemon.json`. The daemon is detached and survives the CLI process exit.

`vassal server stop` kills it (`--all` also reaps orphans), `vassal server reap` kills only orphans, `vassal server status` reports both.

**Startup is serialized and must stay that way.** `ensureDaemon` does its re-check, port pick, spawn, and state write inside an `O_EXCL` lockfile (`src/lib/lock.ts`, `daemon.lock` in the state dir). Without it, N parallel dispatches each see no daemon, each spawn one, each race for the same port, and the last `writeDaemonState` orphans every other daemon that came up — which is how the port drifted from 4096 to 4098 over a day of use. If you touch this path:

- Keep the whole read-check-spawn-write sequence under the lock; a lock around the write alone fixes nothing.
- After a spawned child reports healthy, re-check that *our* child is still alive. A health response only proves something answers on that port; if our child lost the bind race we would be recording a dead pid against someone else's server.
- `findAdoptableDaemon` adopts a live unreferenced daemon instead of spawning another. Adoption is non-destructive on purpose — **never auto-kill** a daemon vassal does not have recorded state for, because it may be mid-flight for another session. Reaping stays an explicit command.

## Things to watch

- **MCP duplication per session.** Every opencode session spawns its own MCP server processes. If you fan out 10 concurrent dispatches with MCP servers configured, memory usage multiplies. Configure `~/.config/opencode/opencode.json` minimally — read/write/edit/bash, no extra MCP unless needed.
- **No permission prompts.** The daemon should be configured to auto-approve tools (or use a strict allow-list). If a dispatched agent hits a permission prompt with no TTY, it hangs.
- **Cost accounting.** `outcome.cost` comes from the prompt response if opencode returns it; fall back to `null`. Don't enforce budgets in v1 — just surface the number.
