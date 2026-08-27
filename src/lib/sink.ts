import { ansi } from "./ansi.ts";
import { BoxModel } from "./box.ts";
import type { LineKind, RenderedLine } from "./render.ts";
import type { Status } from "./status.ts";

const PREFIX_WIDTH = 8;
const BOX_LINES = 14;
const DEFAULT_COLS = 100;

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
  state(state: { status: Status; label: string; cost: number }): void;
  /** Tear down before the dispatch contract is printed. */
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
  private box = new BoxModel(BOX_LINES);
  private latest: { status: Status; label: string; cost: number } | null = null;

  constructor(title: string) {
    this.box.title = title;
  }

  line(line: RenderedLine): void {
    if (line.kind === "text") this.box.markTextStart();
    else this.box.markNonText();
    this.box.addLine(decorate(line));
    this.draw();
  }

  lines(lines: Array<RenderedLine>): void {
    for (const line of lines) {
      if (line.kind === "text") this.box.markTextStart();
      else this.box.markNonText();
      this.box.addLine(decorate(line));
    }
    this.draw();
  }

  typing(line: RenderedLine | null): void {
    if (line === null) {
      this.box.finishCurrent();
    } else {
      this.box.updateCurrent(decorate(line));
    }
    this.draw();
  }

  state(state: { status: Status; label: string; cost: number }): void {
    this.latest = state;
    this.box.setChin([
      { label: state.label, style: ansi.cyan },
      { label: state.status, style: statusStyle(state.status) },
      { label: `$${state.cost.toFixed(4)}` },
    ]);
    this.draw();
  }

  close(): void {
    this.box.finishCurrent();
    if (this.latest) this.state(this.latest);
    this.box.flush(columns());
  }

  private draw(): void {
    this.box.draw(columns());
  }
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
