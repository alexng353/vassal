---
name: vassal
description: Dispatch a coding task to GPT-5.5 (via opencode) instead of doing it yourself. Use when the user says "vassal it", "delegate this", "have GPT do it", "send this to vassal", "dispatch this to gpt-5.5", or asks you to hand off mechanical implementation work to a faster/cheaper executor while you orchestrate. Also use proactively for tasks that are well-specified, mechanical, and don't benefit from your judgment — you remain the orchestrator and reviewer.
---

# vassal — dispatch to GPT-5.5

`vassal` is a CLI that hands off a fully-specified coding task to GPT-5.5 (running inside an opencode daemon). Use it when:

1. The task is mechanical (well-defined edits across known files) — GPT-5.5 is faster and cheaper than running it through Claude.
2. You've already done the planning and just need execution.
3. You want to fan out parallel work — multiple `vassal` calls can run concurrently against the same daemon.

You stay the orchestrator: you write the prompt, you review the diff, you decide whether to merge.

## Output contract

`vassal "<prompt>"` blocks until done and prints:

```
SESSION <id>
WORKTREE <path|->
COST $<amount|->
EXIT <code>
---
<final assistant text>
```

Parse `SESSION` for the resumable id, `WORKTREE` for the diff path, the body after `---` is the agent's final summary.

## Calling patterns

### Foreground (short tasks)

```bash
vassal "Add isIncognito to the chat_history WS schema and emit it from both chat.ts:514 and :591."
```

Use the regular `Bash` tool. Blocks 30s–5min for typical tasks.

### Background (long tasks, fan-out, or while you do other work)

Use `Bash` with `run_in_background: true`. The harness notifies you when it exits; read output via `BashOutput`.

```bash
# fire and forget
vassal "implement the full chat-history rewrite per the plan in PLAN.md"
```

### Resume

```bash
vassal --session <id> "now add tests for the new field"
```

## Writing a good vassal prompt

GPT-5.5 is fast and literal. Brief it like a smart contractor — not a colleague:

- Name files and line numbers explicitly. Don't say "around the chat handler" — say `apps/api/src/routes/websockets/handlers/chat.ts:514`.
- State the contract: what it should look like *after*, not just what to change.
- Include any non-obvious constraints (style rules, conventions, etc.) — vassal's executor doesn't share your CLAUDE.md context unless you paste it.
- For multi-step work: enumerate. GPT-5.5 follows numbered lists religiously.

If you find yourself writing a paragraph of "make sure to..." caveats, the task is probably not mechanical enough — keep it yourself.

## Worktree isolation

Every dispatch creates a fresh git worktree off the current HEAD by default. The dispatched agent edits there; your working tree stays clean. After it finishes, you typically want to:

```bash
git -C <worktree-path> diff
# review, then either merge into your branch or discard
vassal cleanup <session-id>   # removes worktree + branch + forgets session
```

If you want in-place edits (rare), pass `--no-worktree`. To pin to a specific path you already manage, pass `--worktree <path>`.

## Daemon

Auto-starts on first use. To check / manage:

```bash
vassal server status
vassal server stop
```

## When NOT to use vassal

- Tasks requiring deep judgment, ambiguous specs, or design decisions — keep those.
- Tasks where you'd want to interleave thinking and editing — vassal is a one-shot per turn.
- Tiny edits (1–2 lines) — overhead isn't worth it; just do it.
- Anything where the user is watching you work and wants to redirect mid-flight — vassal is a closed loop until it returns.

## Common patterns

### Dispatch a well-specified ticket

You've already got a clear plan from the user. Write the prompt as a self-contained brief, dispatch, review the diff, ship.

### Parallel fan-out

```bash
# in three Bash calls with run_in_background: true
vassal "implement <task-A> per <brief>" &
vassal "implement <task-B> per <brief>" &
vassal "implement <task-C> per <brief>" &
```

Three worktrees, three sessions, all running in the same daemon. Reconcile after.

### Resume to fix issues

If the first dispatch's output reveals it got something wrong:

```bash
vassal --session <id> "the migration you wrote drops a column we still use; revise to add only the new column."
```

Continues in the same worktree, same context.
