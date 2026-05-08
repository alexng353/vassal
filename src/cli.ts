#!/usr/bin/env bun
import dedent from "dedent";
import { runCleanup } from "./commands/cleanup.ts";
import { runDispatch } from "./commands/dispatch.ts";
import { runList } from "./commands/list.ts";
import {
  runServerStart,
  runServerStatus,
  runServerStop,
} from "./commands/server.ts";
import { runStatus } from "./commands/status.ts";

const HELP = dedent`
  vassal — dispatch coding tasks to GPT-5.5 via opencode.

  USAGE
    vassal <prompt>                       dispatch a new task (worktree by default)
    vassal --session <id> <prompt>        resume an existing session
    vassal list                           list known sessions
    vassal status <session-id>            show metadata for a session
    vassal cleanup <session-id> [--force] remove worktree and forget session
    vassal server start|stop|status       manage the opencode daemon

  FLAGS
    --session <id>     resume a session by id
    --model <p/m>      provider/model (default: openai/gpt-5.5)
    --no-worktree      run in current cwd instead of a fresh worktree
    --cwd <path>       override base cwd (defaults to current directory)

  OUTPUT (dispatch)
    SESSION <id>
    WORKTREE <path|->
    COST $<amount|->
    EXIT <code>
    ---
    <final assistant text>
`;

type ParsedArgs = {
  command: string | null;
  positional: string[];
  flags: Record<string, string | true>;
};

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === undefined) break;
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[name] = next;
        i += 2;
      } else {
        flags[name] = true;
        i += 1;
      }
    } else {
      positional.push(arg);
      i += 1;
    }
  }
  const subcommands = new Set(["list", "status", "cleanup", "server"]);
  if (positional[0] && subcommands.has(positional[0])) {
    return {
      command: positional[0],
      positional: positional.slice(1),
      flags,
    };
  }
  return { command: null, positional, flags };
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    console.log(HELP);
    return 0;
  }

  const { command, positional, flags } = parseArgs(argv);

  switch (command) {
    case "list":
      return runList();
    case "status": {
      const id = positional[0];
      if (!id) {
        console.error("status requires a session id");
        return 2;
      }
      return runStatus(id);
    }
    case "cleanup": {
      const id = positional[0];
      if (!id) {
        console.error("cleanup requires a session id");
        return 2;
      }
      return runCleanup(id, { force: flags.force === true });
    }
    case "server": {
      const sub = positional[0];
      if (sub === "start") return runServerStart();
      if (sub === "stop") return runServerStop();
      if (sub === "status") return runServerStatus();
      console.error(`unknown server subcommand: ${sub ?? "(none)"}`);
      return 2;
    }
    default: {
      const prompt = positional.join(" ").trim();
      if (!prompt) {
        console.error("missing prompt. run `vassal --help` for usage.");
        return 2;
      }
      return runDispatch({
        prompt,
        sessionId:
          typeof flags.session === "string" ? flags.session : undefined,
        model: typeof flags.model === "string" ? flags.model : undefined,
        cwd: typeof flags.cwd === "string" ? flags.cwd : undefined,
        worktree: flags["no-worktree"] !== true,
      });
    }
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`vassal: ${(err as Error).message}`);
    process.exit(1);
  });
