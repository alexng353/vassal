/**
 * Exit once stdout has drained.
 *
 * `process.exit` discards anything still buffered on stdout. For a large write
 * — a rendered box frame, or a long final assistant text — the tail is simply
 * lost, and for the box that means the escape sequence erasing it never reaches
 * the terminal, leaving a half-drawn frame sitting under the shell prompt.
 *
 * Writes are ordered, so an empty write's callback fires only after everything
 * queued ahead of it has flushed.
 */
export function exitAfterFlush(code: number): void {
  process.exitCode = code;
  try {
    process.stdout.write("", () => process.exit(code));
  } catch {
    process.exit(code);
  }
}
