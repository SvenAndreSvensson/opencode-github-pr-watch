import { answerShape, readAnswer, type AnswerSpec } from "./answer";

export interface Candidate {
  readonly number: number;
  readonly title: string;
  readonly headRefName: string;
}

export function replacementPrompt(closed: { title: string; branch: string }, comments: readonly string[], open: readonly Candidate[]): string {
  return [
    "A PR opened by a bot was closed. Decide which PR, if any, replaced it: one named in its closing comments, or an open",
    "PR by the same bot making the same change (same dependency or group, same directory). Answer null if none clearly does.",
    `Answer with JSON only: ${answerShape(REPLACEMENT_ANSWER)}`,
    "",
    `Closed PR: ${closed.title} (branch ${closed.branch})`,
    "Closing comments:",
    ...(comments.length ? comments.map((c) => `- ${c}`) : ["(none)"]),
    "Open PRs by the same bot:",
    ...(open.length ? open.map((pr) => `- #${pr.number}: ${pr.title} (branch ${pr.headRefName})`) : ["(none)"]),
  ].join("\n");
}

// The model chooses; code only accepts PRs that actually exist in what it was shown.
export const REPLACEMENT_ANSWER = { replacement: { kind: "number", nullable: true } } as const satisfies AnswerSpec;

export function parseReplacement(text: string, open: readonly Candidate[], comments: readonly string[], onInvalid?: (problem: string) => void): number | undefined {
  const read = readAnswer(REPLACEMENT_ANSWER, text);
  if (!read.ok) {
    onInvalid?.(read.problem);
    return undefined;
  }
  for (const problem of read.problems) onInvalid?.(problem);
  const n = read.value.replacement as number | null;
  if (n === null) return undefined;
  const known = open.some((pr) => pr.number === n) || comments.some((c) => c.includes(`#${n}`));
  if (!known) onInvalid?.(`replacement: #${n} is not one of the PRs shown`);
  return known ? n : undefined;
}
