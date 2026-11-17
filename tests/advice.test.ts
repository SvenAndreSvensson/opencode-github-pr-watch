import { describe, expect, test } from "bun:test";
import { botAdvicePrompt, countRun, failureExpired, seenFailures, refreshHistory, diagnosisPrompt, parseBotAdvice, failureSignature, parseDiagnosis, suggestionFor } from "../core/advice";
import { aFacts } from "./mothers";

const NOW = Date.parse("2026-10-14T10:00:00Z");
const failing = aFacts({ checks: "FAIL", failingChecks: ["Build and test"] });
const deployFailed = aFacts({ state: "MERGED", mergedAt: NOW - 600_000, deploy: "FAILED" });

describe("parseDiagnosis", () => {
  test("reads kind and cause", () => {
    expect(parseDiagnosis('{"kind":"flaky","cause":"runner lost connection"}')).toEqual({ kind: "flaky", cause: "runner lost connection" });
  });

  test("anything unclear counts as real, never flaky", () => {
    expect(parseDiagnosis('{"kind":"maybe","cause":"x"}')).toEqual({ kind: "real", cause: "x" });
    expect(parseDiagnosis("no idea")).toEqual({ kind: "unknown", cause: "" });
  });
});

describe("diagnosisPrompt", () => {
  test("sets a high bar for flaky", () => {
    const prompt = diagnosisPrompt("error: boom");
    expect(prompt).toContain("error: boom");
    expect(prompt).toMatch(/When in doubt.*real/);
  });
});

describe("failureSignature", () => {
  test("is the failing checks, or the merge pipeline", () => {
    expect(failureSignature(aFacts({ checks: "FAIL", failingChecks: ["B", "A"] }), NOW)).toBe("checks:A,B");
    expect(failureSignature(deployFailed, NOW)).toBe("deploy");
    expect(failureSignature(aFacts(), NOW)).toBeUndefined();
  });
});

describe("suggestionFor", () => {
  test.each([
    [aFacts(), "merge it"],
    [aFacts({ branch: "BEHIND", author: "app/renovate", authorIsBot: true }), "bot PR (app/renovate); see its description for how to refresh it"],
    [aFacts({ branch: "BEHIND", author: "octocat" }), "gh pr update-branch"],
    [aFacts({ branch: "CONFLICT", author: "app/renovate", authorIsBot: true }), "bot PR (app/renovate); see its description"],
    [aFacts({ draft: true }), "mark it ready for review"],
  ])("%o: %s", (facts, text) => {
    expect(suggestionFor(facts, NOW)).toContain(text);
  });

  test("a flaky first failure gets one rerun", () => {
    expect(suggestionFor(failing, NOW, { kind: "flaky", cause: "runner lost" }, 0)).toContain("rerun the failed jobs once");
  });

  test("the same failure again is treated as real, whatever the model says", () => {
    const text = suggestionFor(failing, NOW, { kind: "flaky", cause: "runner lost" }, 1)!;
    expect(text).toContain("failed the same way before");
    expect(text).not.toContain("rerun the failed jobs once");
  });

  test("a real failure needs a fix", () => {
    expect(suggestionFor(deployFailed, NOW, { kind: "real", cause: "CVE-2026-1 in libexpat1" }, 0)).toContain("fix needed: CVE-2026-1 in libexpat1");
  });

  test("without a diagnosis, look at the failure", () => {
    expect(suggestionFor(failing, NOW)).toContain("look at the failing run");
  });

  test("nothing to suggest while still moving", () => {
    expect(suggestionFor(aFacts({ checks: "PENDING" }), NOW)).toBeUndefined();
  });
});

describe("botAdvicePrompt and parseBotAdvice", () => {
  test("the model reads the bot's own description to say how to refresh the PR", () => {
    const prompt = botAdvicePrompt("app/renovate", "behind main", "- [ ] <!-- rebase-check -->If you want to rebase/retry this PR, check this box");
    expect(prompt).toContain("app/renovate");
    expect(prompt).toContain("behind main");
    expect(prompt).toContain("rebase-check");
    expect(prompt).toContain("update-branch");
  });

  test("reads the advice, nothing when unreadable", () => {
    expect(parseBotAdvice('{"advice": "tick the rebase checkbox in the PR description"}')).toBe("tick the rebase checkbox in the PR description");
    expect(parseBotAdvice("??")).toBeUndefined();
  });
});

describe("suggestionFor: deploy pipeline not identified", () => {
  test("asks the agent to name it, or say there is none", () => {
    const facts = aFacts({ state: "MERGED", mergedAt: NOW - 20 * 60_000, deploy: "UNIDENTIFIED", undeterminedWorkflows: ["Docs"] });
    expect(suggestionFor(facts, NOW)).toBe(
      'find the workflow that deploys this repo and call watch_pr again with deployWorkflow="<its name>", or deployWorkflow="none" if the repo doesn\'t deploy',
    );
  });
});

describe("diagnosis: a failure after the deploy", () => {
  test("the prompt asks whether everything that ships the service succeeded", () => {
    expect(diagnosisPrompt("x")).toContain('"afterDeploy": true | false');
  });

  test("reads afterDeploy, false unless clearly true", () => {
    expect(parseDiagnosis('{"kind":"real","cause":"the issue tracker step failed","afterDeploy":true}')).toEqual({ kind: "real", cause: "the issue tracker step failed", afterDeploy: true });
    expect(parseDiagnosis('{"kind":"real","cause":"apply failed","afterDeploy":"yes"}')).toEqual({ kind: "real", cause: "apply failed" });
  });
});


describe("countRun: the same failure counted per run, not per report (plan 4)", () => {
  test("a run seen before doesn't count again; a new run of the same failure does", () => {
    const first = countRun([], "https://github.com/o/r/actions/runs/1");
    expect(first).toEqual({ before: 0, seen: ["https://github.com/o/r/actions/runs/1"] });
    expect(countRun(first.seen, "https://github.com/o/r/actions/runs/1")).toEqual({ before: 0, seen: first.seen });
    expect(countRun(first.seen, "https://github.com/o/r/actions/runs/2").before).toBe(1);
  });

  test("without a run link each report counts, as before", () => {
    expect(countRun(["x"], undefined).before).toBe(1);
  });
});

describe("bot refresh history (plan 27)", () => {
  const NOW = Date.parse("2026-11-16T12:00:00Z");
  const min = (m: number) => new Date(NOW - m * 60_000).toISOString();

  test("commands to the bot, and whether a new commit came after each", () => {
    const comments = [
      { body: "@dependabot recreate", createdAt: min(120) },
      { body: "Looks good", createdAt: min(90) },
      { body: "@dependabot rebase", createdAt: min(15) },
    ];
    expect(refreshHistory(comments, [Date.parse(min(100))], NOW)).toEqual([
      "@dependabot recreate posted 120 min ago; a new commit came after it",
      "@dependabot rebase posted 15 min ago; no new commit since",
    ]);
  });

  test("a command followed by another before any commit was ignored", () => {
    const comments = [{ body: "@dependabot rebase", createdAt: min(60) }, { body: "@dependabot recreate", createdAt: min(30) }];
    expect(refreshHistory(comments, [Date.parse(min(20))], NOW)).toEqual([
      "@dependabot rebase posted 60 min ago; no new commit before the next command",
      "@dependabot recreate posted 30 min ago; a new commit came after it",
    ]);
  });

  test("the prompt says an ignored command means trying the other one", () => {
    const prompt = botAdvicePrompt("app/dependabot", "behind main", "desc", ["@dependabot rebase posted 15 min ago; no new commit since"]);
    expect(prompt).toContain("@dependabot rebase posted 15 min ago; no new commit since");
    expect(prompt).toContain("ignored");
  });
});

describe("diagnosis: a paired update still open (plan 28, platform#2521/#2522)", () => {
  test("the prompt lists the author's other open PRs and asks to name one the failure depends on", () => {
    const prompt = diagnosisPrompt("must use the same version", ["#2522 Bump github/codeql-action/upload-sarif from 3.29 to 3.30"]);
    expect(prompt).toContain("#2522 Bump github/codeql-action/upload-sarif");
    expect(prompt).toContain("name that PR in the cause");
  });

  test("without other PRs the section is left out", () => {
    expect(diagnosisPrompt("x")).not.toContain("Other open PRs");
  });
});

describe("failure counts expire (plan gap)", () => {
  const NOW = Date.parse("2026-11-17T10:00:00Z");
  test("kept for 7 days after the last failure; old formats without a time go", () => {
    expect(failureExpired({ seen: ["u"], at: NOW - 6 * 86_400_000 }, NOW)).toBe(false);
    expect(failureExpired({ seen: ["u"], at: NOW - 8 * 86_400_000 }, NOW)).toBe(true);
    expect(failureExpired(["u"], NOW)).toBe(true);
    expect(failureExpired(3, NOW)).toBe(true);
  });

  test("reads the seen list from either format", () => {
    expect(seenFailures({ seen: ["a"], at: 1 })).toEqual(["a"]);
    expect(seenFailures(["b"])).toEqual(["b"]);
    expect(seenFailures(undefined)).toEqual([]);
  });
});
