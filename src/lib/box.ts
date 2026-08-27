import { ansi, splitAtWidth, stripAnsi, wrapLine } from "./ansi.ts";

export type ChinTag = { label: string; style?: (s: string) => string };

function countRows(frame: string): number {
  let rows = 0;
  for (const char of frame) if (char === "\n") rows++;
  return rows;
}

const MIN_BOX_LINES = 4;
/** Used when the terminal reports no height (piped output, no TTY). */
const FALLBACK_BOX_LINES = 14;
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const DISABLE_WRAP = "\x1b[?7l";
const ENABLE_WRAP = "\x1b[?7h";

/**
 * Fixed-height scrolling status box, ported from chad (`src/box.ts`).
 *
 * Owns the three constrained regions (title, content, chin) and all drawing
 * state, so the caller just sets data and calls `draw()`. Wrapped visual lines
 * for committed content are cached; only the in-progress line is re-wrapped
 * each frame, keeping `render()` amortized O(1) instead of O(total lines).
 */
export class BoxModel {
  lines: Array<string> = [];
  current: string | null = null;

  /** Title shown centered in the top border. */
  title = "vassal";

  /** Structured chin tags rendered below the bottom border. */
  chinTags: Array<ChinTag> = [];

  private configuredBoxLines: number | null;
  private drawn = false;
  /**
   * Height of the frame actually on screen. The cursor has to move back up by
   * exactly what was drawn — recomputing from the current terminal size would
   * desync the moment the window is resized between frames.
   */
  private drawnHeight = 0;

  /** Cached wrapped visual lines for committed content. */
  private wrappedCache: Array<string> = [];
  /** The column width the cache was built at. */
  private cachedCols = 0;

  /** Index into `lines` where the last contiguous text block starts. */
  private lastTextStart = 0;
  /** Whether the most recent content was assistant text (vs tool/metadata). */
  private inText = false;

  /** `boxLines: null` sizes the box to the terminal on every draw. */
  constructor(boxLines: number | null = null) {
    this.configuredBoxLines = boxLines;
  }

  /** Effective content lines for the current terminal size. */
  private get boxLines(): number {
    const rows = process.stdout.rows || 0;
    if (rows === 0) return this.configuredBoxLines ?? FALLBACK_BOX_LINES;
    // Reserve the 3 frame rows (two borders + chin) plus room for the shell
    // prompt and the command line that launched us.
    const available = Math.max(MIN_BOX_LINES, rows - 6);
    return this.configuredBoxLines === null
      ? available
      : Math.min(this.configuredBoxLines, available);
  }

  /** Total lines this box occupies on screen (top + content + bottom + chin). */
  get totalHeight(): number {
    return this.boxLines + 3;
  }

  /** Push `text` as a committed line. */
  addLine(text: string): void {
    this.lines.push(text);
    this.appendToCache(text);
  }

  /**
   * Replace the in-progress preview row.
   *
   * `current` is a preview of a line the producer has not finished yet, and it
   * is never committed here — the producer re-sends the finished line through
   * `addLine` once it is complete. Committing it on the way past is how the
   * same half-written reasoning line ends up stamped into the box repeatedly.
   */
  updateCurrent(text: string): void {
    this.current = text;
  }

  /** Drop the preview row without committing it. */
  clearCurrent(): void {
    this.current = null;
  }

  /** Signal that subsequent content is assistant text output. */
  markTextStart(): void {
    if (!this.inText) {
      this.lastTextStart = this.lines.length;
      this.inText = true;
    }
  }

  /** Signal that subsequent content is not text (tool, metadata, etc.). */
  markNonText(): void {
    this.inText = false;
  }

  /** Replace the chin tag list. */
  setChin(tags: Array<ChinTag>): void {
    this.chinTags = tags;
  }

  /** Render + cursor control: overwrites the previous draw if there was one. */
  draw(cols: number): void {
    let out = HIDE_CURSOR;
    // Rewind by what is on screen, not by what we are about to draw — the two
    // differ whenever the terminal was resized since the last frame.
    if (this.drawn) out += `\x1b[${this.drawnHeight}A\x1b[J`;
    const frame = this.render(cols);
    process.stdout.write(out + frame);
    this.drawn = true;
    // Count the rows actually emitted rather than trusting a computed height.
    // Rewinding one row too many overwrites whatever sits above the box — the
    // command line that started us, or the shell prompt.
    this.drawnHeight = countRows(frame);
  }

  /**
   * Erase the box and restore the terminal modes `draw` turned off. This must
   * run on every exit path — including Ctrl-C, which would otherwise hand the
   * shell back with the cursor hidden and line wrapping disabled, and the next
   * prompt drawn over the box.
   *
   * `keepTail` leaves the last contiguous text block behind as scrollback, for
   * callers that print nothing after the box.
   */
  flush(cols: number, keepTail = false): void {
    if (!this.drawn) {
      process.stdout.write(`${ENABLE_WRAP}${SHOW_CURSOR}`);
      return;
    }
    process.stdout.write(`\x1b[${this.drawnHeight}A\x1b[J`);
    if (keepTail) {
      this.ensureCache(cols);
      const inner = cols - 4;
      for (const line of this.lines.slice(this.lastTextStart)) {
        for (const visual of wrapLine(line, inner)) {
          process.stdout.write(`${visual}\n`);
        }
      }
    }
    process.stdout.write(`${ENABLE_WRAP}${SHOW_CURSOR}`);
    this.drawn = false;
    this.drawnHeight = 0;
  }

  /** Stateless render: rebuild visual lines from the model and return the box. */
  render(cols: number): string {
    const visualLines = this.getVisualLines(cols);
    const inner = cols - 4;
    let out = "";

    // Disable line wrapping — the box does its own.
    out += DISABLE_WRAP;

    const titleText = ` ${this.title} `;
    const dashTotal = inner + 2 - titleText.length;
    const left = Math.max(0, Math.floor(dashTotal / 2));
    const right = Math.max(0, dashTotal - left);
    out += `${ansi.dim(`┌${"─".repeat(left)}`)}${ansi.bold(ansi.cyan(titleText))}${ansi.dim(`${"─".repeat(right)}┐`)}\n`;

    for (let i = 0; i < this.boxLines; i++) {
      const raw = visualLines[i] ?? "";
      const visibleLength = stripAnsi(raw).length;
      let content: string;
      if (visibleLength > inner) {
        const [truncated] = splitAtWidth(raw, inner - 1);
        content = `${truncated}…`;
      } else {
        content = raw + " ".repeat(inner - visibleLength);
      }
      out += `${ansi.dim("│")} ${content} ${ansi.dim("│")}\n`;
    }

    out += `${ansi.dim(`└${"─".repeat(inner + 2)}┘`)}\n`;

    // Always emit the chin row, blank if there are no tags yet. A frame whose
    // height changes when the first tag lands would leave a stale row behind.
    const chin = this.chinTags.length > 0 ? this.renderChin() : "";
    const chinVisible = stripAnsi(chin).length;
    out +=
      chinVisible < inner + 4
        ? `${chin}${" ".repeat(inner + 4 - chinVisible)}\n`
        : `${chin}\n`;

    // Re-enable line wrapping.
    out += ENABLE_WRAP;
    return out;
  }

  /** The last `boxLines` wrapped visual lines from the model. */
  private getVisualLines(cols: number): Array<string> {
    this.ensureCache(cols);
    if (this.current === null) return this.wrappedCache.slice(-this.boxLines);
    const wrapped = wrapLine(this.current, cols - 4);
    return this.wrappedCache.concat(wrapped).slice(-this.boxLines);
  }

  /** Render chin tags as:  tag1  ·  tag2  ·  tag3 */
  private renderChin(): string {
    const separator = `  ${ansi.dim("·")}  `;
    const parts = this.chinTags.map((tag) =>
      (tag.style ?? ansi.dim)(tag.label),
    );
    return `  ${parts.join(separator)}`;
  }

  /** Wrap a single line and append it to the cache (if cols are known). */
  private appendToCache(text: string): void {
    if (this.cachedCols === 0) return;
    for (const visual of wrapLine(text, this.cachedCols - 4)) {
      this.wrappedCache.push(visual);
    }
  }

  /** Rebuild the cache if cols changed. */
  private ensureCache(cols: number): void {
    if (cols === this.cachedCols) return;
    this.cachedCols = cols;
    this.wrappedCache = [];
    for (const line of this.lines) {
      for (const visual of wrapLine(line, cols - 4)) {
        this.wrappedCache.push(visual);
      }
    }
  }
}
