import { describe, expect, test } from "bun:test";
import { answerShape, readAnswer, type AnswerSpec } from "../core/answer";

const VERDICT = {
  verdict: { kind: "choice", values: ["notify", "wait"] },
  reason: { kind: "text", hint: "one short sentence", optional: true },
} as const satisfies AnswerSpec;

describe("answerShape: the JSON line the prompt shows", () => {
  test("choices, text hints, booleans, numbers and lists", () => {
    expect(answerShape(VERDICT)).toBe('{"verdict": "notify" | "wait", "reason": "<one short sentence>"}');
    expect(answerShape({ afterDeploy: { kind: "boolean" } })).toBe('{"afterDeploy": true | false}');
    expect(answerShape({ replacement: { kind: "number", nullable: true } })).toBe('{"replacement": <number> | null}');
    expect(answerShape({ topics: { kind: "list", item: { name: { kind: "text", hint: "topic" }, prs: { kind: "list", item: { kind: "text", hint: "owner/repo#number" } } } } })).toBe(
      '{"topics": [{"name": "<topic>", "prs": ["<owner/repo#number>", ...]}, ...]}',
    );
  });
});

describe("readAnswer", () => {
  test("finds the JSON among other text, and ignores fields it doesn't know", () => {
    expect(readAnswer(VERDICT, 'Sure. {"verdict": "wait", "reason": "progress", "confidence": 0.9} Done.')).toEqual({ ok: true, value: { verdict: "wait", reason: "progress" }, problems: [] });
  });

  test("free text is kept as written, cut at a length limit, and may be left out when optional", () => {
    expect(readAnswer(VERDICT, `{"verdict": "notify", "reason": "${"x".repeat(600)}"}`)).toMatchObject({ ok: true, value: { reason: `${"x".repeat(499)}…` } });
    expect(readAnswer(VERDICT, '{"verdict": "wait"}')).toEqual({ ok: true, value: { verdict: "wait" }, problems: [] });
  });

  test("names the problem: no JSON, a value outside the choices, a missing or wrong field", () => {
    expect(readAnswer(VERDICT, "I think we should wait.")).toEqual({ ok: false, problem: "no JSON object in the answer" });
    expect(readAnswer(VERDICT, '{"verdict": "maybe"}')).toEqual({ ok: false, problem: 'verdict: "maybe" is not one of notify, wait' });
    expect(readAnswer(VERDICT, '{"reason": "x"}')).toEqual({ ok: false, problem: "verdict: missing" });
    expect(readAnswer({ advice: { kind: "text" } }, '{"advice": "   "}')).toEqual({ ok: false, problem: "advice: empty" });
    expect(readAnswer({ n: { kind: "number" } }, '{"n": "12"}')).toEqual({ ok: false, problem: "n: not a number" });
  });

  test("lists of objects are read item by item", () => {
    const spec = { topics: { kind: "list", item: { name: { kind: "text" }, prs: { kind: "list", item: { kind: "text" } } } } } as const satisfies AnswerSpec;
    expect(readAnswer(spec, '{"topics": [{"name": "CI", "prs": ["o/r#1"]}]}')).toEqual({ ok: true, value: { topics: [{ name: "CI", prs: ["o/r#1"] }] }, problems: [] });
    expect(readAnswer(spec, '{"topics": [{"name": "CI", "prs": "o/r#1"}]}')).toEqual({ ok: false, problem: "topics[0].prs: not a list" });
  });
});

describe("a wrong value in a decision field with a fallback", () => {
  test("takes the fallback, keeps the free text, and reports the problem", () => {
    const spec = { verdict: { kind: "choice", values: ["notify", "wait"], fallback: "notify" }, reason: { kind: "text", optional: true } } as const satisfies AnswerSpec;
    expect(readAnswer(spec, '{"verdict": "maybe", "reason": "unsure"}')).toEqual({
      ok: true,
      value: { verdict: "notify", reason: "unsure" },
      problems: ['verdict: "maybe" is not one of notify, wait; used "notify"'],
    });
  });
});
