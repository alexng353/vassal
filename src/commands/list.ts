import { readSessions } from "../lib/state.ts";

export async function runList(): Promise<number> {
  const sessions = await readSessions();
  const entries = Object.values(sessions).sort(
    (a, b) => b.lastActivityAt - a.lastActivityAt,
  );

  if (entries.length === 0) {
    console.log("(no sessions)");
    return 0;
  }

  for (const s of entries) {
    const age = humanAge(Date.now() - s.lastActivityAt);
    console.log(
      `${s.id}  ${age.padStart(6)} ago  $${s.cost.toFixed(4)}  ${s.title}`,
    );
  }
  return 0;
}

function humanAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
