import { answerShape, readAnswer, type AnswerSpec } from "./answer";
import { nextStep, type PrFacts } from "./pr-facts";

export type FailureKind = "flaky" | "real" | "unknown";

export interface Diagnosis {
  readonly kind: FailureKind;
  readonly cause: string;
  /** Every step that ships the service succeeded; only a later step (release registration, notification) failed. */
  readonly afterDeploy?: true;
}

export function diagnosisPrompt(failure: string, openFromAuthor: readonly string[] = []): string {
  return [
    "A CI pipeline failed. Find the actual error in the end of the failed log below and classify the failure.",
    `Answer with JSON only: ${answerShape(DIAGNOSIS_ANSWER)}`,
    "- afterDeploy: true only when the job steps listed show that every step shipping the service (applying manifests,",
    "  rolling out, terraform apply) succeeded, and only a later step failed (registering a release, a notification).",
    "  Otherwise false.",
    "- flaky: only with clear evidence the failure is outside the code: the runner was lost or cancelled, a network timeout or",
    "  5xx from GitHub, a registry or a package mirror, or a rate limit.",
    "- real: everything else, including failing or timed-out tests, assertion errors, compile and lint errors, vulnerability",
    "  findings (CVEs) and deployment errors in our own configuration.",
    "Flakiness should rarely be tolerated. When in doubt, answer real.",
    ...(openFromAuthor.length > 0
      ? [
          "",
          "Other open PRs from the same author (a bot often splits one update into several PRs):",
          ...openFromAuthor,
          "If the failure comes from this PR having only part of an update that one of these completes (for example parts of one",
          "action that must use the same version), the failure is real: name that PR in the cause, as \"merge #<n> too\".",
        ]
      : []),
    "",
    "The failed run (steps of failed jobs, then the end of its log):",
    failure,
  ].join("\n");
}

export const DIAGNOSIS_ANSWER = {
  // Unclear counts as real, never flaky: a rerun is only suggested on clear evidence.
  kind: { kind: "choice", values: ["flaky", "real"], fallback: "real" },
  cause: { kind: "text", hint: "one short line naming the actual error", optional: true },
  afterDeploy: { kind: "boolean", fallback: false, optional: true },
} as const satisfies AnswerSpec;

export function parseDiagnosis(text: string, onInvalid?: (problem: string) => void): Diagnosis {
  const read = readAnswer(DIAGNOSIS_ANSWER, text);
  if (!read.ok) {
    onInvalid?.(read.problem);
    return { kind: "unknown", cause: "" };
  }
  for (const problem of read.problems) onInvalid?.(problem);
  const { kind, cause, afterDeploy } = read.value as { kind: "flaky" | "real"; cause?: string; afterDeploy?: boolean };
  return { kind, cause: cause ?? "", ...(afterDeploy === true ? { afterDeploy: true as const } : {}) };
}

/** Identifies "the same failure" across watches, so a rerun is suggested at most once for it. */
export function failureSignature(facts: PrFacts, now: number): string | undefined {
  const step = nextStep(facts, now);
  if (step === "FIX_CHECKS") return `checks:${[...facts.failingChecks].sort().join(",")}`;
  if (step === "DEPLOY_FAILED") return "deploy";
  return undefined;
}

// A suggestion only; the main agent decides what to do. Rule-based where the rule is clear, informed by the model's
// diagnosis for failures.
export function suggestionFor(facts: PrFacts, now: number, diagnosis?: Diagnosis, sameFailuresBefore = 0): string | undefined {
  const base = facts.baseRefName;
  switch (nextStep(facts, now)) {
    case "READY": return facts.autoMerge ? "merge it directly (gh pr merge)" : "merge it";
    case "UPDATE_BRANCH":
      return facts.authorIsBot ? botFallback(facts) : `update the branch from ${base} (gh pr update-branch)`;
    case "RESOLVE_CONFLICT": return facts.authorIsBot ? botFallback(facts) : `resolve the conflicts with ${base}`;
    case "ADDRESS_REVIEW": return "address the requested changes";
    case "DRAFT": return "mark it ready for review";
    case "DEPLOY_UNIDENTIFIED":
      return 'find the workflow that deploys this repo and call watch_pr again with deployWorkflow="<its name>", or deployWorkflow="none" if the repo doesn\'t deploy';
    case "FIX_CHECKS":
    case "DEPLOY_FAILED":
      return failureSuggestion(diagnosis, sameFailuresBefore);
    default: return undefined;
  }
}

function failureSuggestion(diagnosis: Diagnosis | undefined, sameFailuresBefore: number): string {
  const cause = diagnosis?.cause ? `: ${diagnosis.cause}` : "";
  if (sameFailuresBefore > 0) return `failed the same way before${cause}; treat it as a real failure and fix it rather than rerun`;
  if (diagnosis?.kind === "flaky") return `looks like an infrastructure failure${cause}; rerun the failed jobs once (gh run rerun <id> --failed)`;
  if (diagnosis?.kind === "real") return `fix needed${cause}`;
  return "look at the failing run";
}

// Each bot has its own way to refresh its PRs; the model reads it from the PR description.
export const needsBotAdvice = (facts: PrFacts, now: number) =>
  facts.authorIsBot === true && ["UPDATE_BRANCH", "RESOLVE_CONFLICT"].includes(nextStep(facts, now));

const botFallback = (facts: PrFacts) => `bot PR (${facts.author}); see its description for how to refresh it`;

export function botAdvicePrompt(author: string, situation: string, description: string, history: readonly string[] = []): string {
  return [
    `A pull request opened by the bot ${author} is ${situation}. From the PR description below, say in one short line how to`,
    "get the bot to refresh it (for example a comment command or a checkbox the bot documents there).",
    "Never suggest gh pr update-branch or pushing to the branch: the commit would then be yours, and you could no longer approve the PR.",
    "If the description says nothing about it, say to wait for the bot's next run or close the PR.",
    "A command posted 10 minutes or more ago with no new commit since was ignored by the bot: suggest a different command",
    "from the description (for example recreate instead of rebase, or the other way round), not the same one again.",
    `Answer with JSON only: ${answerShape(BOT_ADVICE_ANSWER)}`,
    "",
    ...(history.length > 0 ? ["Commands posted to the bot on this PR:", ...history, ""] : []),
    "PR description:",
    description.slice(0, 4000),
  ].join("\n");
}

export const BOT_ADVICE_ANSWER = { advice: { kind: "text", hint: "one short line" } } as const satisfies AnswerSpec;

export function parseBotAdvice(text: string, onInvalid?: (problem: string) => void): string | undefined {
  const read = readAnswer(BOT_ADVICE_ANSWER, text);
  if (!read.ok) {
    onInvalid?.(read.problem);
    return undefined;
  }
  for (const problem of read.problems) onInvalid?.(problem);
  return read.value.advice as string;
}

/**
 * Counts a failure once per failed run: a restart or a second watch reporting the same run doesn't make it "failed the
 * same way before". `before` is how many other runs failed this way. Without a run link every report counts.
 */
export function countRun(seen: readonly string[], runUrl: string | undefined): { before: number; seen: string[] } {
  if (runUrl === undefined) return { before: seen.length, seen: [...seen, `report-${seen.length}`] };
  if (seen.includes(runUrl)) return { before: seen.filter((s) => s !== runUrl).length, seen: [...seen] };
  return { before: seen.length, seen: [...seen, runUrl] };
}

/**
 * Comments that address a bot with a command ("@dependabot rebase"), and whether a commit arrived before the next
 * command (or since, for the last one): the bot acted on it, or ignored it.
 */
export function refreshHistory(comments: readonly { body: string; createdAt: string }[], commitTimes: readonly number[], now: number): string[] {
  const commands = comments.filter((comment) => /^@[\w-]+(\[bot\])? \w+/.test(comment.body.trim()));
  return commands.map((comment, i) => {
    const at = Date.parse(comment.createdAt);
    const until = i + 1 < commands.length ? Date.parse(commands[i + 1]!.createdAt) : now;
    const answered = commitTimes.some((time) => time > at && time <= until);
    const last = i + 1 === commands.length;
    const after = answered ? "a new commit came after it" : last ? "no new commit since" : "no new commit before the next command";
    return `${comment.body.trim().split("\n")[0]!} posted ${Math.round((now - at) / 60_000)} min ago; ${after}`;
  });
}

const FAILURE_COUNT_KEPT_MS = 7 * 86_400_000;

export interface StoredFailures {
  readonly seen: readonly string[];
  readonly at: number;
}

export const seenFailures = (stored: unknown): string[] =>
  Array.isArray(stored) ? (stored as string[]) : stored && typeof stored === "object" && Array.isArray((stored as StoredFailures).seen) ? [...(stored as StoredFailures).seen] : [];

/** Failure counts only matter while the same failure can recur; a week after the last one they go. */
export const failureExpired = (stored: unknown, now: number) =>
  !(stored && typeof stored === "object" && !Array.isArray(stored) && now - (stored as StoredFailures).at <= FAILURE_COUNT_KEPT_MS);
