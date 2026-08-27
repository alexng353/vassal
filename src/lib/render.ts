import type { Part } from "@opencode-ai/sdk";

const TOOL_TITLE_CHARS = 160;

export type LineKind = "text" | "think" | "tool" | "ask" | "meta";

/**
 * One line of rendered session activity. Kept structured rather than
 * pre-formatted so the plain (machine-readable) and human sinks can present the
 * same stream differently.
 */
export type RenderedLine = {
  kind: LineKind;
  text: string;
  /** True for wrapped continuations of a multi-line block. */
  continuation?: boolean;
};

/**
 * Turns opencode parts into lines, emitting only what has not been shown yet.
 *
 * The daemon re-sends a whole part on every update, so a naive renderer would
 * reprint the entire assistant turn on each token. Track a high-water mark per
 * part id instead, and only ever emit complete lines — a partial trailing line
 * would be reprinted with more text appended the moment the next token lands.
 * `flush` releases those remainders once nothing more is coming.
 */
export class PartRenderer {
  private emittedChars = new Map<string, number>();
  private emittedTool = new Set<string>();
  private pendingByPart = new Map<string, { kind: LineKind; text: string }>();
  private lastPendingId: string | null = null;
  /** Text accumulated per part, so token deltas can be rendered as they land. */
  private textByPart = new Map<string, { kind: LineKind; text: string }>();

  /** Lines that are new since this part was last rendered. */
  render(part: Part): Array<RenderedLine> {
    if (part.type === "text") return this.prose("text", part.id, part.text);
    if (part.type === "reasoning") {
      return this.prose("think", part.id, part.text);
    }
    if (part.type === "tool") return this.tool(part);
    return [];
  }

  /**
   * Apply a `message.part.delta` — one token's worth of text for a part already
   * announced by a `message.part.updated`.
   *
   * This is where live output actually comes from. The daemon announces a text
   * or reasoning part empty, streams it as deltas, and only sends the filled-in
   * part once the whole thing is written, so a renderer fed on snapshots alone
   * shows an entire turn arriving in one lump at the end of it.
   *
   * A delta for a part we never saw announced is dropped: without its type
   * there is no way to know whether it is prose or a tool's input, and the
   * snapshot that eventually lands will carry the text anyway.
   */
  delta(partId: string, field: string, delta: string): Array<RenderedLine> {
    if (field !== "text" || !delta) return [];
    const held = this.textByPart.get(partId);
    if (!held) return [];
    held.text += delta;
    return this.prose(held.kind, partId, held.text);
  }

  /**
   * The line currently being typed, if any — complete enough to display live but
   * not yet terminated by a newline. Sinks that can redraw show this; the plain
   * sink waits for the newline.
   */
  pending(): RenderedLine | null {
    if (this.lastPendingId === null) return null;
    const held = this.pendingByPart.get(this.lastPendingId);
    if (!held) return null;
    const text = held.text.trim();
    return text ? { kind: held.kind, text } : null;
  }

  /** Trailing partial lines that no further update will complete. */
  flush(): Array<RenderedLine> {
    const lines: Array<RenderedLine> = [];
    for (const [id, held] of this.pendingByPart) {
      const trimmed = held.text.trim();
      if (trimmed) lines.push(...block(held.kind, trimmed));
      this.emittedChars.set(
        id,
        (this.emittedChars.get(id) ?? 0) + held.text.length,
      );
    }
    this.pendingByPart.clear();
    this.lastPendingId = null;
    return lines;
  }

  private prose(
    kind: LineKind,
    id: string,
    incoming: string,
  ): Array<RenderedLine> {
    // Snapshots and deltas race: a `message.part.updated` can arrive carrying
    // less than the deltas have already appended. Keep whichever is longer, so
    // a stale snapshot never rewinds the part or re-emits what it already has.
    const held = this.textByPart.get(id);
    const full =
      held && held.text.length > incoming.length ? held.text : incoming;
    this.textByPart.set(id, { kind, text: full });

    const already = this.emittedChars.get(id) ?? 0;
    if (full.length <= already) return [];

    const fresh = full.slice(already);
    const lastBreak = fresh.lastIndexOf("\n");
    if (lastBreak === -1) {
      this.hold(id, kind, fresh);
      return [];
    }

    const complete = fresh.slice(0, lastBreak);
    this.emittedChars.set(id, already + lastBreak + 1);
    const remainder = fresh.slice(lastBreak + 1);
    if (remainder) {
      this.hold(id, kind, remainder);
    } else {
      this.pendingByPart.delete(id);
      if (this.lastPendingId === id) this.lastPendingId = null;
    }

    const trimmed = complete.trim();
    return trimmed ? block(kind, trimmed) : [];
  }

  private hold(id: string, kind: LineKind, text: string): void {
    this.pendingByPart.set(id, { kind, text });
    this.lastPendingId = id;
  }

  private tool(part: Extract<Part, { type: "tool" }>): Array<RenderedLine> {
    const status = part.state.status;
    const key = `${part.id}:${status}`;
    if (this.emittedTool.has(key)) return [];
    this.emittedTool.add(key);
    return [
      { kind: "tool", text: `${part.tool} (${status})${toolTitle(part)}` },
    ];
  }
}

function block(kind: LineKind, text: string): Array<RenderedLine> {
  const [first, ...rest] = text.split("\n");
  return [
    { kind, text: first ?? "" },
    ...rest.map((line) => ({ kind, text: line, continuation: true })),
  ];
}

function toolTitle(part: Extract<Part, { type: "tool" }>): string {
  const title =
    "title" in part.state && part.state.title
      ? part.state.title
      : summarizeInput(
          "input" in part.state
            ? (part.state.input as Record<string, unknown>)
            : {},
        );
  return title ? ` — ${truncate(title, TOOL_TITLE_CHARS)}` : "";
}

function summarizeInput(input: Record<string, unknown>): string {
  if (Object.keys(input).length === 0) return "";
  const preferred = ["file_path", "path", "command", "pattern", "query"];
  for (const key of preferred) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  try {
    return JSON.stringify(input);
  } catch {
    return "";
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
