import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

export type WorktreeHandle = {
  path: string;
  branch: string;
  baseRef: string;
};

export async function isInsideGitRepo(cwd: string): Promise<boolean> {
  try {
    const r = await $`git -C ${cwd} rev-parse --is-inside-work-tree`.quiet();
    return r.text().trim() === "true";
  } catch {
    return false;
  }
}

export async function createWorktree(
  baseCwd: string,
  sessionId: string,
): Promise<WorktreeHandle> {
  const head = (await $`git -C ${baseCwd} rev-parse --abbrev-ref HEAD`.quiet())
    .text()
    .trim();
  const baseRef = head === "HEAD" ? "HEAD" : head;

  const shortId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 12);
  const branch = `vassal/${shortId}`;
  const path = join(tmpdir(), `vassal-wt-${shortId}`);

  if (existsSync(path)) {
    throw new Error(`worktree path already exists: ${path}`);
  }

  await $`git -C ${baseCwd} worktree add -b ${branch} ${path} ${baseRef}`.quiet();
  return { path, branch, baseRef };
}

export async function removeWorktree(
  baseCwd: string,
  handle: WorktreeHandle,
  options: { force?: boolean } = {},
): Promise<void> {
  const flag = options.force ? "--force" : "";
  await $`git -C ${baseCwd} worktree remove ${flag} ${handle.path}`.quiet();
  try {
    await $`git -C ${baseCwd} branch -D ${handle.branch}`.quiet();
  } catch {
    // branch may have been merged or already gone
  }
}

export async function diffWorktree(handle: WorktreeHandle): Promise<string> {
  const r = await $`git -C ${handle.path} diff ${handle.baseRef}`.quiet();
  return r.text();
}
