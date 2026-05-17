const DURATIONS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

export function parseDuration(input: string): number {
  if (input === "0" || input === "all") return Number.POSITIVE_INFINITY;

  const match = /^(\d+)([smhd])$/.exec(input);
  if (!match) {
    throw new Error(`expected integer duration like 30s, 45m, 24h, or 7d`);
  }

  const [, amount, unit] = match;
  const multiplier = unit ? DURATIONS[unit] : undefined;
  if (!amount || multiplier === undefined) {
    throw new Error(`expected integer duration like 30s, 45m, 24h, or 7d`);
  }

  return Number.parseInt(amount, 10) * multiplier;
}
