const HEARTBEAT_INTERVAL_MS = 30_000;

export type Progress = {
  /** Emit a one-off line on stderr. */
  note: (message: string) => void;
  stop: () => void;
};

export const SILENT: Progress = {
  note: () => {},
  stop: () => {},
};

/**
 * stdout carries the dispatch contract and only flushes at the end, so a
 * working dispatch and a wedged one look identical for minutes. Heartbeat on
 * stderr so the caller can tell them apart.
 */
export function startProgress(
  opts: {
    quiet?: boolean;
    intervalMs?: number;
    write?: (line: string) => void;
  } = {},
): Progress {
  if (opts.quiet || process.env.VASSAL_QUIET) return SILENT;

  const startedAt = Date.now();
  const write = opts.write ?? ((line: string) => process.stderr.write(line));
  const emit = (message: string) => {
    write(`[vassal] ${message}\n`);
  };
  const timer = setInterval(() => {
    emit(`still working — ${formatElapsed(Date.now() - startedAt)} elapsed`);
  }, opts.intervalMs ?? HEARTBEAT_INTERVAL_MS);
  timer.unref?.();

  return { note: emit, stop: () => clearInterval(timer) };
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
}
