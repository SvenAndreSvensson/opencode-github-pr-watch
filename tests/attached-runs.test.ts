import { describe, expect, test } from "bun:test";
import { attachedRun, attachedRunEvents, keptRuns, unfinished } from "../core/attached-runs";
import { events } from "../core/policy";
import { watchRows } from "../core/watch-rows";
import { aFacts, aJob, aRun, aWatch } from "./mothers";

const run = (overrides: Parameters<typeof aRun>[0] = {}) =>
  aRun({
    databaseId: 9, workflowName: "MAIN - Deployment pipeline", event: "workflow_dispatch", status: "in_progress", conclusion: "", url: "https://github.com/o/r/actions/runs/9",
    jobs: [aJob({ name: "Build", status: "completed", conclusion: "success" }), aJob({ name: "Build docker image", status: "in_progress", conclusion: "" })],
    ...overrides,
  });

describe("a run attached to a PR watch", () => {
  test("its state, progress and link", () => {
    expect(attachedRun(run())).toEqual({
      run: 9, workflow: "MAIN - Deployment pipeline", url: "https://github.com/o/r/actions/runs/9", state: "RUNNING",
      progress: { done: 1, total: 2, current: "Build docker image" },
    });
    expect(attachedRun(run({ status: "completed", conclusion: "failure", jobs: [aJob({ name: "DEPLOY - Dev", conclusion: "failure" })] }))).toMatchObject({
      state: "FAILED", failedJobs: ["DEPLOY - Dev"],
    });
  });

  test("events when it ends or waits, none while it runs", () => {
    const running = attachedRun(run());
    expect(attachedRunEvents([running], [running])).toEqual([]);
    expect(attachedRunEvents([running], [attachedRun(run({ status: "completed", conclusion: "success" }))])).toEqual(["run MAIN - Deployment pipeline succeeded"]);
    expect(attachedRunEvents([running], [attachedRun(run({ status: "completed", conclusion: "failure", jobs: [aJob({ name: "DEPLOY - Dev", conclusion: "failure" })] }))])).toEqual([
      "run MAIN - Deployment pipeline failed (https://github.com/o/r/actions/runs/9): DEPLOY - Dev",
    ]);
    expect(attachedRunEvents([running], [attachedRun(run({ status: "waiting", jobs: [aJob({ name: "DEPLOY - Prod", status: "waiting", conclusion: "" })] }))])).toEqual([
      "run MAIN - Deployment pipeline needs run approval: DEPLOY - Prod",
    ]);
  });

  test("a run already finished when first seen is reported once", () => {
    expect(attachedRunEvents(undefined, [attachedRun(run({ status: "completed", conclusion: "success" }))])).toEqual(["run MAIN - Deployment pipeline succeeded"]);
  });

  test("finished runs leave the watch", () => {
    expect(unfinished([attachedRun(run()), attachedRun(run({ databaseId: 10, status: "completed", conclusion: "success" }))])).toEqual([9]);
  });
});

describe("in the PR watch", () => {
  test("its events join the PR's events", () => {
    const before = aFacts({ attachedRuns: [attachedRun(run())] });
    const after = aFacts({ attachedRuns: [attachedRun(run({ status: "completed", conclusion: "success" }))] });
    expect(events(before, after, 0)).toContain("run MAIN - Deployment pipeline succeeded");
  });

  test("the PR's row shows the run while it goes, and links it", () => {
    const watch = aWatch({ lastFacts: aFacts({ review: "REVIEW_REQUIRED", attachedRuns: [attachedRun(run())] }) });
    const [row] = watchRows([watch], watch.sessionID, 0);
    expect(row!.detail).toBe("waiting for code review · run MAIN - Deployment pipeline 1/2 · Build docker image");
    expect(row!.runUrl).toBe("https://github.com/o/r/actions/runs/9");
    expect(row!.tone).toBe("pending");
  });

  test("runs to keep: finished ones go, unread ones stay", () => {
    expect(keptRuns([9, 10, 11], [attachedRun(run()), attachedRun(run({ databaseId: 10, status: "completed", conclusion: "success" }))])).toEqual([9, 11]);
  });
});
