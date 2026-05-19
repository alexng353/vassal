import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { $ } from "bun";

export type VassalConfig = {
  worktreeSetup: string | null;
  worktreeRoot: string | null;
};

export async function readVassalConfig(cwd: string): Promise<VassalConfig> {
  const configPath = await findAlexToml(cwd);
  if (!configPath) return { worktreeSetup: null, worktreeRoot: null };

  const text = await Bun.file(configPath).text();
  const parsed = Bun.TOML.parse(text) as Record<string, unknown>;
  const section = parsed.vassal;
  if (!section || typeof section !== "object") {
    return { worktreeSetup: null, worktreeRoot: null };
  }

  const setup = (section as Record<string, unknown>).worktree_setup;
  const root = (section as Record<string, unknown>).worktree_root;
  return {
    worktreeSetup: typeof setup === "string" ? setup : null,
    worktreeRoot:
      typeof root === "string" ? resolve(dirname(configPath), root) : null,
  };
}

async function findAlexToml(cwd: string): Promise<string | null> {
  try {
    const root = (await $`git -C ${cwd} rev-parse --show-toplevel`.quiet())
      .text()
      .trim();
    const candidate = join(root, ".alex.toml");
    return existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}
