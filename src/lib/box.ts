import { ansi, splitAtWidth, stripAnsi, wrapLine } from "./ansi.ts";

export type ChinTag = { label: string; style?: (s: string) => string };

/** ` title `, clipped so it can never be wider than the border it sits in. */
function fitTitle(title: string, width: number): string {
  const padded = ` ${title} `;
  if (padded.length <= width) return padded;
  return width <= 2
    ? " ".repeat(Math.max(0, width))
    : ` ${title.slice(0, width - 3)}… `;
}

const MIN_BOX_LINES = 4;
/** Used when the terminal reports no height (piped output, no TTY). */
const FALLBACK_BOX_LINES = 14;
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const DISABLE_WRAP = "\x1b[?7l";
const ENABLE_WRAP = "\x1b[?7h";
const ENTER_ALT_SCREEN = "\x1b[?1049h";
const LEAVE_ALT_SCREEN = "\x1b[?1049l";
const CURSOR_HOME = "\x1b[H";
const CLEAR_BELOW = "\x1b[J";

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
  private entered = false;

  /** Cached wrapped visual lines for committed content. */
  private wrappedCache: Array<string> = [];
  /** The column width the cache was built at. */
  private cachedCols = 0;

  /** `boxLines: null` sizes the box to the terminal on every draw. */
  constructor(boxLines: number | null = null) {
    this.configuredBoxLines = boxLines;
  }

  /** Effective content lines for the current terminal size. */
  private get boxLines(): number {
    const rows = process.stdout.rows || 0;
    if (rows === 0) return this.configuredBoxLines ?? FALLBACK_BOX_LINES;
    // The box owns the alternate screen, so it can use the full height: the 3
    // frame rows (two borders + chin), plus one row of slack so the newline
    // ending the last row does not scroll the screen and shift the frame up.
    const available = Math.max(MIN_BOX_LINES, rows - 4);
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

  /** Replace the chin tag list. */
  setChin(tags: Array<ChinTag>): void {
    this.chinTags = tags;
  }

  /**
   * Paint a frame on the alternate screen.
   *
   * The box lives on the alternate screen rather than in the scrollback, so a
   * frame is always drawn from the home position and there is no cursor
   * arithmetic to get wrong. Rewinding by a recorded height cannot survive a
   * resize: the terminal reflows the frame already on screen, so the row count
   * recorded when it was drawn no longer describes it, the rewind lands
   * somewhere arbitrary, and frames stack instead of replacing each other.
   *
   * Leaving the alternate screen restores whatever the terminal was showing
   * before, which is also what makes teardown exact.
   */
  draw(cols: number): void {
    let out = "";
    if (!this.entered) {
      out += ENTER_ALT_SCREEN + HIDE_CURSOR;
      this.entered = true;
    }
    // Clear below the frame too, so a shrinking box leaves no stale rows.
    out += CURSOR_HOME + this.render(cols) + CLEAR_BELOW;
    process.stdout.write(out);
  }

  /**
   * Return the terminal to the state it was in before the box appeared. This
   * must run on every exit path — including Ctrl-C, which would otherwise hand
   * the shell back stuck on the alternate screen with the cursor hidden.
   */
  flush(): void {
    process.stdout.write(
      (this.entered ? LEAVE_ALT_SCREEN : "") + ENABLE_WRAP + SHOW_CURSOR,
    );
    this.entered = false;
  }

  /** Stateless render: rebuild visual lines from the model and return the box. */
  render(cols: number): string {
    const visualLines = this.getVisualLines(cols);
    const inner = cols - 4;
    let out = "";

    // Disable line wrapping — the box does its own.
    out += DISABLE_WRAP;

    // A title wider than the border would push the row past the terminal edge.
    const titleText = fitTitle(this.title, inner + 2);
    const dashTotal = Math.max(0, inner + 2 - titleText.length);
    const left = Math.floor(dashTotal / 2);
    const right = dashTotal - left;
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

    // Always emit the chin row, blank if there are no tags yet, and clip it to
    // the terminal width. Every row has to be exactly one row tall: an
    // over-long chin wraps onto a second physical row, which pushes the frame
    // past the screen and scrolls the top border out of view.
    const chin = this.chinTags.length > 0 ? this.renderChin() : "";
    const width = inner + 4;
    const chinVisible = stripAnsi(chin).length;
    if (chinVisible > width) {
      out += `${splitAtWidth(chin, width - 1)[0]}…\n`;
    } else {
      out += `${chin}${" ".repeat(width - chinVisible)}\n`;
    }

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
