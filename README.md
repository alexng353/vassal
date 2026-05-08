# vassal

Dispatch coding tasks from a Claude Code orchestrator to a GPT-5.5 executor (via [opencode](https://opencode.ai)). Worktree-isolated, session-resumable.

The premise: Opus 4.7 is a great orchestrator, GPT-5.5 is a great executor. `vassal` is the bridge — it makes "delegate this to a different model" a one-liner from Claude Code's `Bash` tool.

## Install

```bash
bun install
bun link
# now `vassal` is on PATH
```

You also need `opencode` installed and an OpenAI API key configured for it (`OPENAI_API_KEY` or via `opencode auth`).

## Usage

```bash
# dispatch a new task — creates a fresh worktree, runs to completion, prints result
vassal "fold incognito into chat_history WS, drop REST history call"

# resume a session
vassal --session ses_abc123 "now add tests for the new field"

# list known sessions
vassal list

# inspect one
vassal status ses_abc123

# clean up worktree + forget session
vassal cleanup ses_abc123
```

## Output contract

```
SESSION ses_abc123
WORKTREE /tmp/vassal-wt-abc123
COST $0.0421
EXIT 0
---
<final assistant text>
```

Parent agents parse the header by line prefix and the body by everything after `---`.

## Daemon

The CLI lazily starts `opencode serve` in the background on first use. Manage it with:

```bash
vassal server start    # explicit start
vassal server status   # show pid, url, uptime
vassal server stop     # kill
```

## Background dispatch from Claude Code

```typescript
// in Claude Code's Bash tool, with run_in_background: true
vassal "<prompt>"
// Claude is notified when the process exits; reads stdout via BashOutput.
```

## Why not just use opencode directly?

`opencode run` is great but:

1. Output is rendered for terminals (tool-call boxes, streaming spinners). `vassal` enforces a stable line-prefixed contract.
2. `opencode` doesn't manage worktrees. `vassal` does, by default.
3. `vassal` tracks session metadata (cost, worktree path, last activity) in a small local store so parent agents can resume without juggling files.

## Layout

```
src/
├── cli.ts                # entry, arg parsing, command dispatch
├── commands/
│   ├── dispatch.ts       # the main flow
│   ├── list.ts
│   ├── status.ts
│   ├── cleanup.ts
│   └── server.ts
└── lib/
    ├── daemon.ts         # opencode serve lifecycle
    ├── opencode.ts       # SDK client wrapper
    ├── output.ts         # line-prefixed contract
    ├── state.ts          # XDG state files
    ├── types.ts
    └── worktree.ts       # git worktree helpers
```
