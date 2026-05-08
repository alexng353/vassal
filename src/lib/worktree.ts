import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { readVassalConfig } from "./config.ts";

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

export async function useExternalWorktree(
  baseCwd: string,
  requestedPath: string,
): Promise<string> {
  if (existsSync(requestedPath)) return requestedPath;

  const config = await readVassalConfig(baseCwd);
  if (!config.worktreeSetup) {
    throw new Error(
      `worktree path does not exist: ${requestedPath}\n` +
        `configure [vassal] worktree_setup in .alex.toml to auto-create it.`,
    );
  }

  const command = config.worktreeSetup.replaceAll("{path}", requestedPath);
  const result = await $`bash -c ${command}`.cwd(baseCwd).nothrow();
  if (result.exitCode !== 0) {
    throw new Error(
      `worktree_setup command failed (exit ${result.exitCode}): ${command}\n` +
        `stderr: ${result.stderr.toString()}`,
    );
  }

  if (!existsSync(requestedPath)) {
    throw new Error(
      `worktree_setup ran but path still does not exist: ${requestedPath}\n` +
        `command: ${command}`,
    );
  }

  return requestedPath;
}
