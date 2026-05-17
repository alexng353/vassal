import { ensureDaemon } from "../lib/daemon.ts";
import {
  createSession,
  makeClient,
  type PromptOutcome,
  sendPrompt,
} from "../lib/opencode.ts";
import { formatDispatchResult } from "../lib/output.ts";
import { getSession, writeSession } from "../lib/state.ts";
import type { DispatchOptions, DispatchResult } from "../lib/types.ts";
import {
  createWorktree,
  isInsideGitRepo,
  useExternalWorktree,
  type WorktreeHandle,
} from "../lib/worktree.ts";

export async function dispatch(opts: DispatchOptions): Promise<DispatchResult> {
  const baseCwd = opts.cwd ?? process.cwd();
  const useWorktree = opts.worktree ?? true;

  if (opts.worktreePath && opts.worktree === false) {
    throw new Error("--worktree <path> conflicts with --no-worktree");
  }

  let workCwd = baseCwd;
  let externalWorktreePath: string | null = null;
  let worktreeHandle: WorktreeHandle | null = null;
  let sessionId = opts.sessionId ?? null;

  if (sessionId) {
    const existing = await getSession(sessionId);
    if (existing) {
      workCwd = existing.worktree ?? existing.cwd;
    }
  }

  const { state: daemon } = await ensureDaemon();
  const client = makeClient(daemon);

  if (!sessionId) {
    if (opts.worktreePath) {
      externalWorktreePath = await useExternalWorktree(
        baseCwd,
        opts.worktreePath,
      );
      workCwd = externalWorktreePath;
    } else if (useWorktree) {
      if (!(await isInsideGitRepo(baseCwd))) {
        throw new Error(
          `not inside a git repo: ${baseCwd}. pass --no-worktree or run from a repo.`,
        );
      }
      const tempId = `pre-${Date.now().toString(36)}`;
      worktreeHandle = await createWorktree(baseCwd, tempId);
      workCwd = worktreeHandle.path;
    }

    const title = derivTitle(opts.prompt);
    sessionId = await createSession(client, title, workCwd);

    await writeSession({
      id: sessionId,
      title,
      cwd: baseCwd,
      worktree: worktreeHandle?.path ?? externalWorktreePath ?? null,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      cost: 0,
    });
  }

  let outcome: PromptOutcome | null = null;
  let exitCode = 1;
  let meta = await getSession(sessionId);
  try {
    outcome = await sendPrompt(client, {
      sessionId,
      prompt: opts.prompt,
      cwd: workCwd,
      model: opts.model,
    });
    exitCode = 0;
  } finally {
    meta = await getSession(sessionId);
    if (meta) {
      await writeSession({
        ...meta,
        lastActivityAt: Date.now(),
        cost: meta.cost + (outcome?.cost ?? 0),
        exitCode,
      });
    }
  }

  if (!outcome) {
    throw new Error("prompt failed without an error");
  }

  return {
    sessionId,
    worktree:
      worktreeHandle?.path ?? externalWorktreePath ?? meta?.worktree ?? null,
    finalText: outcome.finalText,
    cost: outcome.cost,
    exitCode: 0,
  };
}

function derivTitle(prompt: string): string {
  const firstLine = prompt.split("\n")[0]?.trim() ?? "";
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}

export async function runDispatch(opts: DispatchOptions): Promise<number> {
  const result = await dispatch(opts);
  console.log(formatDispatchResult(result));
  return result.exitCode;
}
