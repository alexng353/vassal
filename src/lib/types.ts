export type DispatchOptions = {
  prompt: string;
  sessionId?: string;
  model?: string;
  effort?: string;
  cwd?: string;
  worktree?: boolean;
  worktreePath?: string;
  worktreeRoot?: string;
  maxTurns?: number;
  quiet?: boolean;
};

export type DispatchResult = {
  sessionId: string;
  alias: string | null;
  worktree: string | null;
  finalText: string;
  cost: number | null;
  exitCode: number;
  /** `provider/model` that ran, or null when it can't be determined. */
  model: string | null;
  effort: string | null;
};

export type DaemonState = {
  pid: number;
  port: number;
  url: string;
  startedAt: number;
};

export type SessionMeta = {
  id: string;
  title: string;
  cwd: string;
  worktree: string | null;
  createdAt: number;
  lastActivityAt: number;
  cost: number;
  exitCode?: number;
  abortedAt?: number;
  alias?: string;
  /** `provider/model` of the most recent dispatch; absent on older records. */
  model?: string;
  effort?: string;
};

/** Where the dispatched agent actually runs — the worktree when there is one. */
export function sessionDirectory(meta: SessionMeta): string {
  return meta.worktree ?? meta.cwd;
}
