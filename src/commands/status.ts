import { displayId, resolveIdOrAlias } from "../lib/alias.ts";
import { formatModelLabel } from "../lib/model.ts";

export async function runStatus(input: string): Promise<number> {
  const meta = await resolveIdOrAlias(input);
  if (!meta) {
    console.error(`unknown session: ${input}`);
    return 1;
  }
  console.log(`SESSION ${displayId(meta)}`);
  if (meta.alias) console.log(`ID ${meta.id}`);
  console.log(`TITLE ${meta.title}`);
  // A metadata dump, so print the id vassal dispatched with as well as the
  // shorthand the other commands show.
  console.log(`MODEL ${formatModelLabel(meta.model, meta.effort)}`);
  console.log(`MODEL_ID ${meta.model ?? "-"}`);
  console.log(`EFFORT ${meta.effort ?? "-"}`);
  console.log(`CWD ${meta.cwd}`);
  console.log(`WORKTREE ${meta.worktree ?? "-"}`);
  console.log(`CREATED ${new Date(meta.createdAt).toISOString()}`);
  console.log(`LAST ${new Date(meta.lastActivityAt).toISOString()}`);
  console.log(`COST $${meta.cost.toFixed(4)}`);
  return 0;
}
