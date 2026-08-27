/** How long `mdr` gets before the raw text is printed instead. */
const RENDER_TIMEOUT_MS = 5_000;

/**
 * Render markdown for a human to read, via `mdr`.
 *
 * Only ever used below the `---` of a `-H` stream: the contract header stays
 * literal, and the machine-read paths never come through here. Every failure —
 * no `mdr` on PATH, a non-zero exit, a renderer that hangs — falls back to the
 * text exactly as the agent wrote it, because a summary that renders badly is
 * still worth more than no summary.
 *
 * `--color` is forced when stdout is a terminal: `mdr` writes to a pipe here,
 * so left to itself it would strip the styling that is the whole point.
 */
export async function renderMarkdown(
  text: string,
  command: Array<string> = [
    "mdr",
    process.stdout.isTTY ? "--color" : "--no-color",
  ],
): Promise<string> {
  if (!text.trim()) return text;

  const [bin, ...args] = command;
  if (!bin) return text;

  try {
    const proc = Bun.spawn([bin, ...args], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
    });
    proc.stdin.write(text);
    await proc.stdin.end();

    const timer = setTimeout(() => proc.kill(), RENDER_TIMEOUT_MS);
    try {
      const [rendered, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        proc.exited,
      ]);
      if (exitCode !== 0) return text;
      // mdr ends with blank lines; console.log adds the one we want.
      return rendered.replace(/\n+$/, "") || text;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return text;
  }
}
