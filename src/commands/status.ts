import { getSession } from "../lib/state.ts";

export async function runStatus(sessionId: string): Promise<number> {
  const meta = await getSession(sessionId);
  if (!meta) {
    console.error(`unknown session: ${sessionId}`);
    return 1;
  }
  console.log(`SESSION ${meta.id}`);
  console.log(`TITLE ${meta.title}`);
  console.log(`CWD ${meta.cwd}`);
  console.log(`WORKTREE ${meta.worktree ?? "-"}`);
  console.log(`CREATED ${new Date(meta.createdAt).toISOString()}`);
  console.log(`LAST ${new Date(meta.lastActivityAt).toISOString()}`);
  console.log(`COST $${meta.cost.toFixed(4)}`);
  return 0;
}
