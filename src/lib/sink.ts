import { ansi } from "./ansi.ts";
import { BoxModel } from "./box.ts";
import { formatElapsed } from "./progress.ts";
import type { LineKind, RenderedLine } from "./render.ts";
import type { Status } from "./status.ts";

const PREFIX_WIDTH = 8;
const DEFAULT_COLS = 100;
/** How often the box repaints on its own, so the runtime clock advances. */
const TICK_MS = 1_000;

export type SessionState = {
  status: Status;
  label: string;
  /** Short model name for the chin, e.g. `Sol XH`; null when unknown. */
  model: string | null;
  cost: number;
  tokens: { input: number; output: number } | null;
  /** When the current turn started, for the runtime clock. */
  startedAt: number;
};

/**
 * Where rendered session activity goes.
 *
 * `stream` has two audiences: a parent agent parsing stdout, and a human
 * watching a dispatch. They want opposite things — one needs every line to be
 * stable and greppable, the other wants a live box that redraws in place — so
 * the stream loop writes to a sink and lets the sink decide.
 */
export type StreamSink = {
  line(line: RenderedLine): void;
  lines(lines: Array<RenderedLine>): void;
  /** The line currently being typed, or null to clear it. Sinks may ignore it. */
  typing(line: RenderedLine | null): void;
  /** Session state for any status furniture the sink keeps. */
  state(state: SessionState): void;
  /** Tear down, restoring anything the sink changed about the terminal. */
  close(): void;
};

/**
 * Line-prefixed output on stdout, one line per event, never rewritten. This is
 * the default because the dispatch contract that follows is machine-read, and a
 * redrawing box would corrupt anything piping stdout.
 */
export class PlainSink implements StreamSink {
  line(line: RenderedLine): void {
    const tag = line.continuation ? "" : `[${line.kind}]`;
    console.log(`${tag.padEnd(PREFIX_WIDTH)} ${line.text}`);
  }

  lines(lines: Array<RenderedLine>): void {
    for (const line of lines) this.line(line);
  }

  typing(): void {
    // A partial line would be reprinted in full once it completes.
  }

  state(): void {}

  close(): void {}
}

/**
 * chad's scrolling status box: a fixed-height window over recent activity with
 * a chin showing session, status and cost. On close the box is erased and the
 * final assistant text is left behind as plain scrollback.
 */
export class BoxSink implements StreamSink {
  private box = new BoxModel();
  private latest: SessionState | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private onResize: (() => void) | null = null;

  constructor(title: string) {
    this.box.title = title;
    // A resize changes every row's width and the number of rows that fit, so
    // repaint rather than leaving a frame built for the old geometry.
    this.onResize = () => this.draw();
    process.stdout.on("resize", this.onResize);
  }

  line(line: RenderedLine): void {
    this.commit(line);
    this.draw();
  }

  lines(lines: Array<RenderedLine>): void {
    if (lines.length === 0) return;
    for (const line of lines) this.commit(line);
    this.draw();
  }

  typing(line: RenderedLine | null): void {
    if (line === null) this.box.clearCurrent();
    else this.box.updateCurrent(decorate(line));
    this.draw();
  }

  state(state: SessionState): void {
    this.latest = state;
    this.startTicking();
    this.paintChin();
    this.draw();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.onResize) process.stdout.off("resize", this.onResize);
    this.onResize = null;
    this.box.clearCurrent();
    this.box.flush();
  }

  private commit(line: RenderedLine): void {
    // The preview row is superseded by whatever the renderer just finalized.
    this.box.clearCurrent();
    this.box.addLine(decorate(line));
  }

  /**
   * Repaint on a timer so the runtime clock advances while the session is quiet.
   * Unref'd — a ticking box must never be the reason the process stays alive.
   */
  private startTicking(): void {
    if (this.timer || this.closed) return;
    this.timer = setInterval(() => {
      this.paintChin();
      this.draw();
    }, TICK_MS);
    this.timer.unref?.();
  }

  private paintChin(): void {
    const state = this.latest;
    if (!state) return;
    const tags = [
      { label: state.label, style: ansi.cyan },
      { label: state.status, style: statusStyle(state.status) },
      ...(state.model ? [{ label: state.model }] : []),
      { label: formatElapsed(Date.now() - state.startedAt) },
      { label: `$${state.cost.toFixed(4)}` },
    ];
    if (state.tokens) {
      tags.push({
        label: `${compactCount(state.tokens.input)}↑ ${compactCount(state.tokens.output)}↓`,
      });
    }
    this.box.setChin(tags);
  }

  private draw(): void {
    if (this.closed) return;
    this.box.draw(columns());
  }
}

function compactCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function decorate(line: RenderedLine): string {
  if (line.continuation) return `  ${style(line.kind)(line.text)}`;
  if (line.kind === "tool") return `${ansi.yellow("◆")} ${ansi.dim(line.text)}`;
  if (line.kind === "ask") return ansi.magenta(`? ${line.text}`);
  if (line.kind === "meta") return ansi.dim(line.text);
  if (line.kind === "think") return ansi.dim(ansi.italic(line.text));
  return line.text;
}

function style(kind: LineKind): (s: string) => string {
  if (kind === "think") return (s) => ansi.dim(ansi.italic(s));
  if (kind === "tool" || kind === "meta") return ansi.dim;
  if (kind === "ask") return ansi.magenta;
  return (s) => s;
}

function statusStyle(status: Status): (s: string) => string {
  if (status === "done") return ansi.green;
  if (status === "failed" || status === "aborted") return ansi.red;
  if (status === "waiting") return ansi.magenta;
  if (status === "stalled") return ansi.yellow;
  return ansi.cyan;
}

function columns(): number {
  return process.stdout.columns || DEFAULT_COLS;
}
