import type { DispatchResult } from "./types.ts";

export function formatDispatchResult(r: DispatchResult): string {
  const lines = [
    `SESSION ${r.sessionId}`,
    r.worktree ? `WORKTREE ${r.worktree}` : "WORKTREE -",
    r.cost !== null ? `COST $${r.cost.toFixed(4)}` : "COST -",
    `EXIT ${r.exitCode}`,
    "---",
    r.finalText,
  ];
  return lines.join("\n");
}

export function formatDispatchHandle(
  sessionId: string,
  worktree: string | null,
): string {
  const lines = [
    `SESSION ${sessionId}`,
    worktree ? `WORKTREE ${worktree}` : "WORKTREE -",
    "STATUS dispatched",
  ];
  return lines.join("\n");
}
