import { describe, expect, test } from "bun:test";
import { dispatchedRun, findWorkflowDispatches, runFromOutput } from "../core/dispatch";

describe("findWorkflowDispatches", () => {
  test("workflow, ref and repo, with -f fields skipped", () => {
    expect(findWorkflowDispatches("gh workflow run deploy.yml --ref ci/deploy-image-by-digest -f env=prod --repo acme/web")).toEqual([
      { workflow: "deploy.yml", ref: "ci/deploy-image-by-digest", repo: "acme/web" },
    ]);
    expect(findWorkflowDispatches('cd x && gh workflow run "MAIN - Deployment pipeline" -r main')).toEqual([{ workflow: "MAIN - Deployment pipeline", ref: "main" }]);
    expect(findWorkflowDispatches("gh workflow run 12345")).toEqual([{ workflow: "12345" }]);
  });

  test("not when gh isn't the command, or the workflow comes from a variable", () => {
    expect(findWorkflowDispatches('echo "gh workflow run x.yml"')).toEqual([]);
    expect(findWorkflowDispatches("gh workflow run $WF --ref main")).toEqual([]);
    expect(findWorkflowDispatches("gh workflow list")).toEqual([]);
  });
});

describe("runFromOutput: gh prints the run it created", () => {
  test("a run link or a gh run view hint", () => {
    expect(runFromOutput("✓ Created workflow_dispatch event for deploy.yml at main\nhttps://github.com/o/r/actions/runs/123\n")).toBe(123);
    expect(runFromOutput("To see the created workflow run, try: gh run view 456")).toBe(456);
    expect(runFromOutput("✓ Created workflow_dispatch event for deploy.yml at main")).toBeUndefined();
  });

  test("only a single run; several are ambiguous", () => {
    expect(runFromOutput("https://github.com/o/r/actions/runs/1 https://github.com/o/r/actions/runs/2")).toBeUndefined();
  });
});

describe("dispatchedRun: the run a dispatch created, when gh didn't say", () => {
  const at = Date.parse("2026-11-16T18:50:40Z");
  test("the newest manual dispatch created at or after the command (allowing for clock skew)", () => {
    const runs = [
      { databaseId: 2, event: "workflow_dispatch", createdAt: "2026-11-16T18:50:43Z" },
      { databaseId: 1, event: "workflow_dispatch", createdAt: "2026-11-16T17:00:00Z" },
      { databaseId: 3, event: "push", createdAt: "2026-11-16T18:51:00Z" },
    ];
    expect(dispatchedRun(runs, at)).toBe(2);
  });

  test("none yet", () => {
    expect(dispatchedRun([{ databaseId: 1, event: "workflow_dispatch", createdAt: "2026-11-16T17:00:00Z" }], at)).toBeUndefined();
  });
});
