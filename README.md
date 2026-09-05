# vassal

Dispatch coding tasks from a Claude Code orchestrator to a GPT-6 Astra executor (via [opencode](https://opencode.ai)). Worktree-isolated, session-resumable.

The premise: Claude orchestrates, GPT-6 Astra executes. `vassal` is the bridge — it makes "delegate this to a different model" a one-liner from Claude Code's `Bash` tool.

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

# select a model-specific reasoning effort
vassal --effort xhigh "implement the concurrency rewrite"

# list known sessions
vassal list

# inspect one
vassal status ses_abc123

# clean up worktree + forget session
vassal cleanup ses_abc123
```

`--effort <level>` is validated against the selected model's variants reported by the local OpenCode daemon. The default is `openai/gpt-6-astra` at `xhigh`.

## Output contract

```
SESSION ses_abc123
WORKTREE /tmp/vassal-wt-abc123
MODEL Astra XH
COST $0.0421
EXIT 0
---
<final assistant text>
```

Parent agents parse the header by line prefix and the body by everything after `---`.

## Daemon

The CLI lazily starts `opencode serve` in the background on first use. Manage it with:

```bash
vassal server start        # explicit start
vassal server status       # show pid, url, uptime, plus any orphans
vassal server stop         # kill the recorded daemon
vassal server stop --all   # ...and reap unreferenced ones in 4096-4145
vassal server reap         # kill unreferenced daemons only
```

Startup is serialized by a lockfile in the state dir, so concurrent `vassal`
invocations start at most one daemon between them. A vassal that finds no
recorded daemon but does find a live `opencode serve` in the port range adopts
it rather than starting another. Adoption never kills anything — an
unreferenced daemon may still be serving someone else's in-flight session — so
reaping is explicit.

## Progress output

Dispatch only writes to stdout at the end, so `vassal` heartbeats on **stderr**
(session id as soon as it exists, then `still working — 2m30s elapsed` every 30
seconds). stdout stays exactly the output contract above. Silence it with
`--quiet` or `VASSAL_QUIET=1`.

## Background dispatch from Claude Code

```typescript
// in Claude Code's Bash tool, with run_in_background: true
vassal "<prompt>"
// Claude is notified when the process exits; reads stdout via BashOutput.
```

## Claude Code skill

A ready-to-install skill lives at [`skills/vassal/SKILL.md`](skills/vassal/SKILL.md). It teaches Claude when to dispatch to vassal, the output contract, and the calling patterns (foreground, background, resume, fan-out).

Install it into your Claude Code skills directory:

```bash
# symlink (recommended — pulls updates with `git pull`)
ln -s "$(pwd)/skills/vassal" ~/.claude/skills/vassal

# or copy
cp -r skills/vassal ~/.claude/skills/vassal
```

Then in any Claude Code session, ask Claude to "vassal it" / "delegate this to GPT-6 Astra" / etc. and the skill activates.

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
