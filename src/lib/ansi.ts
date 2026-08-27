/**
 * ANSI helpers, ported from chad (`src/ansi.ts`). Kept as a copy rather than a
 * dependency — vassal must stay installable on its own, and this is the stable
 * half of chad's renderer.
 */
export const ansi = {
  bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[22m`,
  italic: (s: string) => `\x1b[3m${s}\x1b[23m`,
  underline: (s: string) => `\x1b[4m${s}\x1b[24m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[39m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[39m`,
  green: (s: string) => `\x1b[32m${s}\x1b[39m`,
  red: (s: string) => `\x1b[31m${s}\x1b[39m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[39m`,
  reset: "\x1b[0m",
};

/** Strip ANSI escape codes for visible-length measurement. */
export function stripAnsi(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape matching requires control chars
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Split an ANSI string at a visible-character boundary. The remainder carries
 * the accumulated ANSI state so formatting survives the cut.
 */
export function splitAtWidth(s: string, maxWidth: number): [string, string] {
  let visible = 0;
  let i = 0;
  let state = "";
  while (i < s.length && visible < maxWidth) {
    if (s[i] === "\x1b") {
      const end = s.indexOf("m", i);
      if (end !== -1) {
        state += s.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    }
    visible++;
    i++;
  }
  return [s.slice(0, i) + ansi.reset, state + s.slice(i)];
}

/** Wrap an ANSI string into visual lines of at most `width` visible chars. */
export function wrapLine(text: string, width: number): Array<string> {
  if (width <= 0) return [text];
  const result: Array<string> = [];
  let remaining = text;
  while (stripAnsi(remaining).length > width) {
    const [line, rest] = splitAtWidth(remaining, width);
    result.push(line);
    remaining = rest;
  }
  result.push(remaining);
  return result;
}
