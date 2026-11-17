import { describe, expect, test } from "bun:test";
import { parseBotAdvice, parseDiagnosis } from "../core/advice";
import { parseReplacement } from "../core/replacement";
import { parseStallVerdict } from "../core/timing";
import { parseTopics } from "../core/topics";
import { parseVerdict } from "../core/verdict";
import { parseRole } from "../core/workflow-role";

// Typical ways a light model gets the format wrong. The answer still gives the same result as before; the problem is
// reported so it can be logged.
const reported = () => {
  const problems: string[] = [];
  return { problems, onInvalid: (problem: string) => void problems.push(problem) };
};

describe("bad answers are reported, and handled as before", () => {
  test("prose around the JSON is fine and reports nothing", () => {
    const r = reported();
    expect(parseVerdict('Looking at the change: {"verdict": "wait", "reason": "a check finished"} Hope that helps!', r.onInvalid)).toEqual({ kind: "wait", reason: "a check finished" });
    expect(r.problems).toEqual([]);
  });

  test("prose only: judging becomes notify, diagnosis unknown, the rest nothing", () => {
    const r = reported();
    expect(parseVerdict("I would tell the developer.", r.onInvalid).kind).toBe("notify");
    expect(parseDiagnosis("Looks like a flaky runner.", r.onInvalid)).toEqual({ kind: "unknown", cause: "" });
    expect(parseBotAdvice("Comment @dependabot rebase.", r.onInvalid)).toBeUndefined();
    expect(parseRole("This deploys the service.", r.onInvalid)).toBeUndefined();
    expect(parseStallVerdict("It's stuck.", r.onInvalid)).toBeUndefined();
    expect(r.problems).toEqual(Array(5).fill("no JSON object in the answer"));
  });

  test("a value outside the choices: the decision falls back, the model's own words are kept", () => {
    const r = reported();
    expect(parseVerdict('{"verdict": "alert", "reason": "rollback in the logs"}', r.onInvalid)).toEqual({ kind: "notify", reason: "rollback in the logs" });
    expect(parseDiagnosis('{"kind": "infra", "cause": "runner lost"}', r.onInvalid)).toEqual({ kind: "real", cause: "runner lost" });
    expect(parseRole('{"role": "release"}', r.onInvalid)).toBeUndefined();
    expect(r.problems).toEqual([
      'verdict: "alert" is not one of wait, notify, done, failed; used "notify"',
      'kind: "infra" is not one of flaky, real; used "real"',
      'role: "release" is not one of deploy, other',
    ]);
  });

  test("a missing or mistyped field", () => {
    const r = reported();
    expect(parseBotAdvice('{"suggestion": "comment @dependabot recreate"}', r.onInvalid)).toBeUndefined();
    expect(parseReplacement('{"replacement": "#51"}', [{ number: 51, title: "x", headRefName: "b" }], [], r.onInvalid)).toBeUndefined();
    expect(r.problems).toEqual(["advice: missing", "replacement: not a number"]);
  });

  test("a PR number that wasn't among those shown", () => {
    const r = reported();
    expect(parseReplacement('{"replacement": 99}', [{ number: 51, title: "x", headRefName: "b" }], [], r.onInvalid)).toBeUndefined();
    expect(r.problems).toEqual(["replacement: #99 is not one of the PRs shown"]);
  });

  test("topics in the wrong shape throw with the problem, which is also reported", () => {
    const r = reported();
    const prs = [{ repo: "o/r", number: 1, title: "x", url: "u", draft: false, createdAt: "2026-11-10T10:00:00Z" }];
    expect(() => parseTopics('{"topics": {"CI": ["o/r#1"]}}', prs, r.onInvalid)).toThrow("could not read the topics: topics: not a list");
    expect(r.problems).toEqual(["topics: not a list"]);
  });
});
