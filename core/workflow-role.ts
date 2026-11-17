import { answerShape, readAnswer, type AnswerSpec } from "./answer";

export type WorkflowRole = "deploy" | "other";

export interface WorkflowSummary {
  readonly name: string;
  readonly path: string;
  readonly jobs: readonly string[];
  readonly file: string;
}

export function rolePrompt(workflow: WorkflowSummary): string {
  return [
    "Classify this GitHub Actions workflow for someone waiting for a merged change to reach production.",
    "- deploy: it builds and ships the service itself to its environments (dev, test, prod).",
    "- other: anything else, even if a job is called deploy: documentation or GitHub Pages, code scanning, CodeQL,",
    "  dependency submission, linting, release notes, notifications.",
    `Answer with JSON only: ${answerShape(ROLE_ANSWER)}`,
    "",
    `Workflow: ${workflow.name} (${workflow.path})`,
    "Jobs:",
    ...workflow.jobs.map((job) => `- ${job}`),
    "Start of the workflow file:",
    workflow.file.slice(0, 3000),
  ].join("\n");
}

export const ROLE_ANSWER = { role: { kind: "choice", values: ["deploy", "other"] } } as const satisfies AnswerSpec;

export function parseRole(text: string, onInvalid?: (problem: string) => void): WorkflowRole | undefined {
  const read = readAnswer(ROLE_ANSWER, text);
  if (!read.ok) {
    onInvalid?.(read.problem);
    return undefined;
  }
  for (const problem of read.problems) onInvalid?.(problem);
  return read.value.role as WorkflowRole;
}

export function matchWorkflow(given: string, workflows: readonly { id: number; name: string; path: string }[]): number | undefined {
  const wanted = given.trim().toLowerCase();
  return workflows.find(
    (w) => w.name.toLowerCase() === wanted || w.path.toLowerCase() === wanted || w.path.toLowerCase().endsWith(`/${wanted}`),
  )?.id;
}
