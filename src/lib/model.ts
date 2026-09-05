import type { SessionMeta } from "./types.ts";

export const DEFAULT_MODEL = "openai/gpt-6-astra";
export const DEFAULT_EFFORT = "xhigh";

const EFFORT_SHORTHAND: Record<string, string> = {
  none: "N",
  low: "L",
  medium: "M",
  high: "H",
  xhigh: "XH",
};

/** Split a `provider/model` spec, erroring the way the daemon call would. */
export function splitModel(model: string): {
  providerID: string;
  modelID: string;
} {
  const [providerID, ...rest] = model.split("/");
  const modelID = rest.join("/");
  if (!providerID || !modelID) {
    throw new Error(`invalid model "${model}" — expected "<provider>/<model>"`);
  }
  return { providerID, modelID };
}

/** The model and effort a dispatch will actually run with, defaults applied. */
export function resolveModelSpec(
  model?: string,
  effort?: string,
): { model: string; effort: string } {
  return { model: model ?? DEFAULT_MODEL, effort: effort ?? DEFAULT_EFFORT };
}

/**
 * A human-sized name for a model id: `openai/gpt-5.6-sol` → `Sol`.
 *
 * OpenAI's ids are the ones vassal dispatches to, so they get the shorthand a
 * person would say out loud — the variant name alone when there is one, the
 * family otherwise. Anything else keeps its id minus the provider, since
 * inventing abbreviations for models we don't know would just obscure them.
 */
export function shortModelName(model: string): string {
  const [provider, ...rest] = model.split("/");
  const id = rest.length > 0 ? rest.join("/") : (provider ?? model);
  if (provider === "openai" && rest.length > 0) {
    const match = /^gpt-(\d+(?:\.\d+)?)(?:-(.+))?$/.exec(id);
    if (match) {
      const [, family, variant] = match;
      return variant ? titleCase(variant) : `GPT-${family}`;
    }
  }
  return id;
}

/** `xhigh` → `XH`. Unknown levels are uppercased rather than dropped. */
export function shortEffort(effort: string): string {
  return EFFORT_SHORTHAND[effort] ?? effort.toUpperCase();
}

/** `Sol XH`, or `-` when the model is unknown (a session vassal didn't record). */
export function formatModelLabel(
  model?: string | null,
  effort?: string | null,
): string {
  if (!model) return "-";
  const name = shortModelName(model);
  return effort ? `${name} ${shortEffort(effort)}` : name;
}

/**
 * What to report for a session, given what vassal recorded and what the daemon
 * says actually ran.
 *
 * The observed model wins — a session created before vassal recorded models, or
 * one whose messages came from elsewhere, still shows the truth. Effort is only
 * ours to report, and only for the model we recorded it against: pairing a
 * recorded `xhigh` with some other model would be a claim we can't support.
 */
export function resolveSessionModel(
  meta: Pick<SessionMeta, "model" | "effort">,
  observed?: string | null,
): { model: string | null; effort: string | null } {
  const model = observed ?? meta.model ?? null;
  const effort = model && model === meta.model ? (meta.effort ?? null) : null;
  return { model, effort };
}

function titleCase(s: string): string {
  return s
    .split("-")
    .map((part) => (part ? part[0]?.toUpperCase() + part.slice(1) : part))
    .join("-");
}
