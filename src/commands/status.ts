import { displayId, resolveIdOrAlias } from "../lib/alias.ts";

export async function runStatus(input: string): Promise<number> {
  const meta = await resolveIdOrAlias(input);
  if (!meta) {
    console.error(`unknown session: ${input}`);
    return 1;
  }
  console.log(`SESSION ${displayId(meta)}`);
  if (meta.alias) console.log(`ID ${meta.id}`);
  console.log(`TITLE ${meta.title}`);
  console.log(`CWD ${meta.cwd}`);
  console.log(`WORKTREE ${meta.worktree ?? "-"}`);
  console.log(`CREATED ${new Date(meta.createdAt).toISOString()}`);
  console.log(`LAST ${new Date(meta.lastActivityAt).toISOString()}`);
  console.log(`COST $${meta.cost.toFixed(4)}`);
  return 0;
}
