import { answerShape, readAnswer, type AnswerSpec } from "./answer";

const MIN = 60_000;
const MIN_SAMPLES = 5;
const FLOOR_MS = 5 * MIN;

export interface PhaseLimit {
  readonly limitMs: number;
  /** Why this limit, shown when the watch hands back. */
  readonly basis: string;
  /** Doubled once because the run was still progressing at the original limit. */
  readonly extended?: boolean;
}

// How long a pipeline may run before the watch hands back: 1.5x what it normally takes, learned from history.
export function limitFromDurations(durations: readonly number[], fallbackMs: number): PhaseLimit {
  if (durations.length < MIN_SAMPLES) {
    return { limitMs: fallbackMs, basis: `default ${Math.round(fallbackMs / MIN)} min (too little history)` };
  }
  const sorted = [...durations].sort((a, b) => a - b);
  const p90 = sorted[Math.ceil(0.9 * sorted.length) - 1]!;
  return {
    limitMs: Math.max(FLOOR_MS, Math.ceil((1.5 * p90) / MIN) * MIN),
    basis: `normally under ${Math.round(p90 / MIN)} min (p90 of last ${sorted.length} runs)`,
  };
}

export function stallPrompt(jobs: string, basis: string): string {
  return [
    "A CI pipeline has run longer than usual. From the job and step status below, judge whether it looks stuck or just slow.",
    `Answer with JSON only: ${answerShape(STALL_ANSWER)}`,
    "- stuck: a step has run far longer than steps like it normally do, or is waiting on something that won't come",
    "  (a lock, an approval nobody gives, a hung connection).",
    "- slow: the run is progressing through its steps, just later than usual.",
    "",
    `Usual duration: ${basis}`,
    "Jobs and steps:",
    jobs,
  ].join("\n");
}

export const PROGRESSING = "looks slow but progressing";

export const STALL_ANSWER = {
  verdict: { kind: "choice", values: ["stuck", "slow"] },
  reason: { kind: "text", hint: "one short line", optional: true },
} as const satisfies AnswerSpec;

export function parseStallVerdict(text: string, onInvalid?: (problem: string) => void): string | undefined {
  const read = readAnswer(STALL_ANSWER, text);
  if (!read.ok) {
    onInvalid?.(read.problem);
    return undefined;
  }
  for (const problem of read.problems) onInvalid?.(problem);
  const reason = read.value.reason ? `: ${read.value.reason as string}` : "";
  return read.value.verdict === "stuck" ? `looks stuck${reason}` : `${PROGRESSING}${reason}`;
}
