import type { PrFacts, RunWithJobs } from "./pr-facts";

const FAILED = new Set(["failure", "cancelled", "timed_out", "action_required", "startup_failure"]);

export const runWatchID = (repo: string, run: number) => `${repo} run ${run}`;

/** A workflow run link: the run, a job in it, or one of its attempts. */
export function parseRunReference(ref: string): { repo: string; run: number } | undefined {
  const url = ref.match(/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)/);
  return url ? { repo: url[1]!, run: Number(url[2]) } : undefined;
}

/**
 * A run started on its own (a manual dispatch, a rerun of one) has no PR. It is followed like the deploy after a
 * merge, so the deploy states, time limits and failure diagnosis apply as they are; only the wording differs.
 */
export function runFacts(run: RunWithJobs): PrFacts {
  const counted = run.jobs.filter((job) => job.conclusion !== "skipped");
  const current = counted.find((job) => job.status === "in_progress")?.name;
  const waitingJobs = run.jobs.filter((job) => job.status === "waiting").map((job) => job.name);
  const failed = FAILED.has(run.conclusion.toLowerCase());
  const deploy =
    waitingJobs.length > 0 ? "WAITING"
    : run.status !== "completed" ? "RUNNING"
    : failed ? "FAILED"
    : "SUCCEEDED";
  return {
    standaloneRun: true,
    state: "MERGED", draft: false, baseRefName: "", review: "NOT_REQUIRED", branch: "OK", checks: "PASS",
    failingChecks: [], missingChecks: [], waitingChecks: [], deployingOnBase: [], unaffectedPipelines: [], autoMerge: false,
    mergedAt: Date.parse(run.createdAt),
    deploy, waitingJobs,
    unfinishedJobs: run.jobs.filter((job) => job.status !== "completed").map((job) => ({ name: job.name, since: Date.parse(job.startedAt) })),
    runUrl: run.url,
    ...(counted.length > 0 ? { deployProgress: { done: counted.filter((job) => job.status === "completed").length, total: counted.length, ...(current ? { current } : {}) } } : {}),
    ...(failed
      ? {
          failureKey: `${run.url}#${run.attempt ?? 1}`,
          failedRun: { workflow: run.workflowName, url: run.url, jobs: run.jobs.filter((job) => FAILED.has(job.conclusion.toLowerCase())).map((job) => job.name) },
        }
      : {}),
  };
}
