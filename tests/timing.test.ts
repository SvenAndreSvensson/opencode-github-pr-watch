import { describe, expect, test } from "bun:test";
import { limitFromDurations, parseStallVerdict, stallPrompt } from "../core/timing";

const MIN = 60_000;

describe("limitFromDurations", () => {
  test("too few samples: the default applies", () => {
    expect(limitFromDurations([MIN, 2 * MIN], 30 * MIN)).toEqual({ limitMs: 30 * MIN, basis: "default 30 min (too little history)" });
  });

  test("1.5 times the 90th percentile of normal runs", () => {
    const durations = [8, 9, 9, 10, 10, 10, 11, 11, 12, 20].map((m) => m * MIN);

    expect(limitFromDurations(durations, 30 * MIN)).toEqual({ limitMs: 18 * MIN, basis: "normally under 12 min (p90 of last 10 runs)" });
  });

  test("never below 5 minutes", () => {
    expect(limitFromDurations(Array(10).fill(MIN), 30 * MIN).limitMs).toBe(5 * MIN);
  });

  test("long pipelines get long limits", () => {
    expect(limitFromDurations(Array(10).fill(50 * MIN), 30 * MIN).limitMs).toBe(75 * MIN);
  });
});

describe("stall evaluation", () => {
  test("the prompt gives the job steps and asks stuck or slow", () => {
    const prompt = stallPrompt("DEPLOY - Prod: step 'terraform apply' running for 40 min", "normally under 12 min");
    expect(prompt).toContain("terraform apply");
    expect(prompt).toContain("normally under 12 min");
    expect(prompt).toContain('"stuck" | "slow"');
  });

  test("reads the verdict, and is honest when unsure", () => {
    expect(parseStallVerdict('{"verdict":"stuck","reason":"waiting for a lock"}')).toBe("looks stuck: waiting for a lock");
    expect(parseStallVerdict('{"verdict":"slow","reason":"apply still progressing"}')).toBe("looks slow but progressing: apply still progressing");
    expect(parseStallVerdict("??")).toBeUndefined();
  });
});
