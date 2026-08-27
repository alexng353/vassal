import { formatModelLabel } from "./model.ts";
import type { DispatchResult } from "./types.ts";

/**
 * A dollar figure, or `-` when there is none to show.
 *
 * A zero cost means the turn was billed to a subscription rather than metered,
 * so printing `$0.0000` states something false about what it cost. Nothing
 * downstream distinguishes "free" from "unknown", and both are `-`.
 */
export function formatCost(
  cost: number | null | undefined,
  digits = 4,
): string {
  return cost ? `$${cost.toFixed(digits)}` : "-";
}

export function formatDispatchResult(r: DispatchResult): string {
  const lines = [
    `SESSION ${r.alias ?? r.sessionId}`,
    r.worktree ? `WORKTREE ${r.worktree}` : "WORKTREE -",
    `MODEL ${formatModelLabel(r.model, r.effort)}`,
    `COST ${formatCost(r.cost)}`,
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
