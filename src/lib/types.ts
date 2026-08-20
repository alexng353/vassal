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
};
