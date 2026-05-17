import { displayId, resolveIdOrAlias } from "../lib/alias.ts";
import { deleteSession } from "../lib/state.ts";
import { removeWorktree } from "../lib/worktree.ts";

export async function runCleanup(
  input: string,
  options: { force?: boolean } = {},
): Promise<number> {
  const meta = await resolveIdOrAlias(input);
  if (!meta) {
    console.error(`unknown session: ${input}`);
    return 1;
  }
  if (meta.worktree) {
    try {
      await removeWorktree(
        meta.cwd,
        {
          path: meta.worktree,
          branch: `vassal/${meta.id.slice(0, 12)}`,
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
  await deleteSession(meta.id);
  console.log(`forgot session ${displayId(meta)}`);
  return 0;
}
