import { readSessions } from "./state.ts";
import type { SessionMeta } from "./types.ts";
import { WORDS } from "./words.ts";

const ALIAS_WORDS = 5;
const ALIAS_PREFIX = "ses_";
const MAX_ATTEMPTS = 16;

export async function generateAlias(): Promise<string> {
  const taken = new Set(
    Object.values(await readSessions())
      .map((s) => s.alias)
      .filter((a): a is string => typeof a === "string"),
  );

  for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
    const candidate = `${ALIAS_PREFIX}${pickWords(ALIAS_WORDS).join("-")}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(
    `failed to generate unique alias after ${MAX_ATTEMPTS} attempts`,
  );
}

export async function resolveIdOrAlias(
  input: string,
): Promise<SessionMeta | null> {
  const all = await readSessions();
  if (all[input]) return all[input];
  for (const meta of Object.values(all)) {
    if (meta.alias === input) return meta;
  }
  return null;
}

export function displayId(meta: Pick<SessionMeta, "id" | "alias">): string {
  return meta.alias ?? meta.id;
}

function pickWords(n: number): string[] {
  const out: string[] = [];
  const bytes = new Uint32Array(n);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < n; i += 1) {
    const idx = (bytes[i] ?? 0) % WORDS.length;
    const word = WORDS[idx];
    if (word) out.push(word);
  }
  return out;
}
