export type DispatchOptions = {
  prompt: string;
  sessionId?: string;
  model?: string;
  cwd?: string;
  worktree?: boolean;
  maxTurns?: number;
};

export type DispatchResult = {
  sessionId: string;
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
};
