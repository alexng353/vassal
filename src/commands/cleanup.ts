import { displayId, resolveIdOrAlias } from "../lib/alias.ts";
import { deleteSession, readSessions } from "../lib/state.ts";
import { worktreeMissing } from "../lib/status.ts";
import { removeWorktree } from "../lib/worktree.ts";

export async function runCleanup(
  input: string,
  options: { force?: boolean; orphans?: boolean } = {},
): Promise<number> {
  if (options.orphans) return cleanupOrphans();

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

async function cleanupOrphans(): Promise<number> {
  const sessions = Object.values(await readSessions());
  const orphans = sessions.filter(worktreeMissing);
  for (const meta of orphans) {
    await deleteSession(meta.id);
  }

  if (orphans.length === 0) {
    console.log("forgot 0 orphan sessions");
    return 0;
  }

  console.log(
    `forgot ${orphans.length} orphan sessions: ${orphans.map(displayId).join(", ")}`,
  );
  return 0;
}
