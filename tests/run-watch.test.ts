import { describe, expect, test } from "bun:test";
import { events, phaseOf } from "../core/policy";
import { summaryLine } from "../core/pr-facts";
import { parseRunReference, runFacts } from "../core/run-facts";
import { watchRows } from "../core/watch-rows";
import { aFacts, aJob, aRun, aWatch } from "./mothers";

const NOW = Date.parse("2026-11-16T19:00:00Z");
// web run 43933092192: MAIN - Deployment pipeline dispatched by hand on a branch, no PR.
const dispatched = (overrides: Parameters<typeof aRun>[0] = {}) =>
  aRun({
    databaseId: 43933092192, workflowName: "MAIN - Deployment pipeline", event: "workflow_dispatch", status: "in_progress", conclusion: "",
    createdAt: "2026-11-16T18:50:43Z", url: "https://github.com/acme/web/actions/runs/43933092192",
    jobs: [aJob({ name: "Build and test", status: "completed", conclusion: "success" }), aJob({ name: "UPLOAD - Upload container image", status: "in_progress", conclusion: "" })],
    ...overrides,
  });

describe("parseRunReference", () => {
  test("a run link, with or without a job or attempt", () => {
    expect(parseRunReference("https://github.com/acme/web/actions/runs/43933092192")).toEqual({ repo: "acme/web", run: 43933092192 });
    expect(parseRunReference("https://github.com/o/r/actions/runs/5/job/7")).toEqual({ repo: "o/r", run: 5 });
    expect(parseRunReference("https://github.com/o/r/actions/runs/5/attempts/2")).toEqual({ repo: "o/r", run: 5 });
  });

  test("not a PR reference", () => {
    expect(parseRunReference("o/r#12")).toBeUndefined();
    expect(parseRunReference("https://github.com/o/r/pull/12")).toBeUndefined();
  });
});

describe("runFacts: a standalone run", () => {
  test("running, with job progress and the run to open", () => {
    const facts = runFacts(dispatched());
    expect(facts.standaloneRun).toBe(true);
    expect(facts.deploy).toBe("RUNNING");
    expect(facts.deployProgress).toEqual({ done: 1, total: 2, current: "UPLOAD - Upload container image" });
    expect(summaryLine(facts, NOW)).toBe("summary: RUN · RUNNING · next: DEPLOYING");
    expect(facts.runUrl).toBe("https://github.com/acme/web/actions/runs/43933092192");
  });

  test("succeeded, failed with its attempt, waiting for approval", () => {
    expect(runFacts(dispatched({ status: "completed", conclusion: "success" })).deploy).toBe("SUCCEEDED");
    const failed = runFacts(dispatched({ status: "completed", conclusion: "failure", attempt: 2 }));
    expect(failed.deploy).toBe("FAILED");
    expect(failed.failureKey).toBe("https://github.com/acme/web/actions/runs/43933092192#2");
    expect(runFacts(dispatched({ status: "completed", conclusion: "failure", jobs: [aJob({ name: "DEPLOY - Dev", conclusion: "failure" })] })).failedRun?.jobs).toEqual(["DEPLOY - Dev"]);
    expect(runFacts(dispatched({ status: "completed", conclusion: "cancelled" })).deploy).toBe("FAILED");
    const waiting = runFacts(dispatched({ status: "waiting", jobs: [aJob({ name: "DEPLOY - Prod", status: "waiting", conclusion: "" })] }));
    expect(waiting.deploy).toBe("WAITING");
    expect(waiting.waitingJobs).toEqual(["DEPLOY - Prod"]);
  });

  test("skipped jobs don't count", () => {
    expect(runFacts(dispatched({ jobs: [aJob({ name: "a", status: "completed", conclusion: "skipped" }), aJob({ name: "b", status: "in_progress", conclusion: "" })] })).deployProgress).toEqual({ done: 0, total: 1, current: "b" });
  });
});

describe("a run watch speaks of the run, not a merge or deploy", () => {
  const run = (deploy: "RUNNING" | "SUCCEEDED" | "FAILED" | "WAITING") => aFacts({ state: "MERGED", mergedAt: NOW - 600_000, deploy, standaloneRun: true, ...(deploy === "WAITING" ? { waitingJobs: ["DEPLOY - Prod"] } : {}) });

  test("end states", () => {
    expect(phaseOf(run("SUCCEEDED"), NOW)).toEqual({ end: "the run succeeded" });
    expect(phaseOf(run("FAILED"), NOW)).toEqual({ end: "the run failed" });
    expect(phaseOf(run("RUNNING"), NOW)).toEqual({ phase: "deploy" });
  });

  test("events", () => {
    expect(events(run("RUNNING"), run("SUCCEEDED"), NOW)).toEqual(["the run succeeded"]);
    expect(events(run("RUNNING"), run("FAILED"), NOW)).toEqual(["the run failed"]);
    expect(events(run("RUNNING"), run("WAITING"), NOW)).toEqual(["run approval needed: DEPLOY - Prod"]);
  });

  test("the pill row links the run and says running", () => {
    const watch = aWatch({ id: "o/r run 5", repo: "o/r", pr: 0, run: 5, lastSnapshot: "Run: MAIN - Deployment pipeline on ci/x (https://github.com/o/r/actions/runs/5)", lastFacts: { ...run("RUNNING"), runUrl: "https://github.com/o/r/actions/runs/5", deployProgress: { done: 3, total: 8, current: "Build docker image" } } });
    const [row] = watchRows([watch], watch.sessionID, NOW);
    expect(row!.url).toBe("https://github.com/o/r/actions/runs/5");
    expect(row!.label).toBe("o/r run 5 MAIN - Deployment pipeline on ci/x");
    expect(row!.detail).toBe("running 3/8 · Build docker image");
    expect(watchRows([{ ...watch, lastFacts: run("SUCCEEDED") }], watch.sessionID, NOW)[0]!.detail).toBe("succeeded");
    expect(watchRows([{ ...watch, lastFacts: run("FAILED") }], watch.sessionID, NOW)[0]!.detail).toBe("failed");
  });
});
