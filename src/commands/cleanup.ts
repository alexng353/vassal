import { deleteSession, getSession } from "../lib/state.ts";
import { removeWorktree } from "../lib/worktree.ts";

export async function runCleanup(
  sessionId: string,
  options: { force?: boolean } = {},
): Promise<number> {
  const meta = await getSession(sessionId);
  if (!meta) {
    console.error(`unknown session: ${sessionId}`);
    return 1;
  }
  if (meta.worktree) {
    try {
      await removeWorktree(
        meta.cwd,
        {
          path: meta.worktree,
          branch: `vassal/${sessionId.slice(0, 12)}`,
          baseRef: "HEAD",
        },
        { force: options.force },
      );
      console.log(`removed worktree ${meta.worktree}`);
    } catch (err) {
      console.error(
        `failed to remove worktree (use --force?): ${(err as Error).message}`,
      );
      return 1;
    }
  }
  await deleteSession(sessionId);
  console.log(`forgot session ${sessionId}`);
  return 0;
}
