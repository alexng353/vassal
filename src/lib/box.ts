import { ansi, splitAtWidth, stripAnsi, wrapLine } from "./ansi.ts";

export type ChinTag = { label: string; style?: (s: string) => string };

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

  private configuredBoxLines: number;
  private drawn = false;

  /** Cached wrapped visual lines for committed content. */
  private wrappedCache: Array<string> = [];
  /** The column width the cache was built at. */
  private cachedCols = 0;

  /** Index into `lines` where the last contiguous text block starts. */
  private lastTextStart = 0;
  /** Whether the most recent content was assistant text (vs tool/metadata). */
  private inText = false;

  constructor(boxLines: number) {
    this.configuredBoxLines = boxLines;
  }

  /** Effective content lines, clamped to fit the terminal. */
  private get boxLines(): number {
    const rows = process.stdout.rows || 0;
    if (rows === 0) return this.configuredBoxLines;
    // Reserve 3 for top border + bottom border + chin, plus 2 for shell context.
    const max = Math.max(1, rows - 5);
    return Math.min(this.configuredBoxLines, max);
  }

  /** Total lines this box occupies on screen (top + content + bottom + chin). */
  get totalHeight(): number {
    return this.boxLines + 3;
  }

  /** Commit `current` (if any), then push `text` as a committed line. */
  addLine(text: string): void {
    if (this.current !== null) this.commitCurrent();
    this.lines.push(text);
    this.appendToCache(text);
  }

  /** Replace the in-progress line wholesale. */
  updateCurrent(text: string): void {
    this.current = text;
  }

  /** Commit the in-progress line to the committed list. */
  finishCurrent(): void {
    if (this.current !== null) this.commitCurrent();
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
    let out = "";
    if (this.drawn) out += `\x1b[${this.totalHeight}A`;
    out += this.render(cols);
    process.stdout.write(out);
    this.drawn = true;
  }

  /** Erase the drawn box and print the last contiguous text block as plain text. */
  flush(cols: number): void {
    if (!this.drawn) return;
    process.stdout.write(`\x1b[${this.totalHeight}A\x1b[J`);
    this.ensureCache(cols);
    const inner = cols - 4;
    for (const line of this.lines.slice(this.lastTextStart)) {
      for (const visual of wrapLine(line, inner)) {
        process.stdout.write(`${visual}\n`);
      }
    }
    this.drawn = false;
  }

  /** Stateless render: rebuild visual lines from the model and return the box. */
  render(cols: number): string {
    const visualLines = this.getVisualLines(cols);
    const inner = cols - 4;
    let out = "";

    // Disable line wrapping — the box does its own.
    out += "\x1b[?7l";

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

    if (this.chinTags.length > 0) {
      const chin = this.renderChin();
      const chinVisible = stripAnsi(chin).length;
      out +=
        chinVisible < inner + 4
          ? `${chin}${" ".repeat(inner + 4 - chinVisible)}\n`
          : `${chin}\n`;
    }

    // Re-enable line wrapping.
    out += "\x1b[?7h";
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

  /** Move `current` into `lines` and append its wrapped output to the cache. */
  private commitCurrent(): void {
    if (this.current === null) return;
    const text = this.current;
    this.lines.push(text);
    this.current = null;
    this.appendToCache(text);
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
