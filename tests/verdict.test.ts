import { describe, expect, test } from "bun:test";
import { parseVerdict } from "../core/verdict";

describe("parseVerdict", () => {
  test("parses a wait verdict", () => {
    const verdict = parseVerdict('{"verdict":"wait","reason":"checks running"}');

    expect(verdict).toEqual({ kind: "wait", reason: "checks running" });
  });

  test.each(["notify", "done", "failed"] as const)("parses a %s verdict", (kind) => {
    const verdict = parseVerdict(`{"verdict":"${kind}","reason":"r"}`);

    expect(verdict).toEqual({ kind, reason: "r" });
  });

  test("finds the JSON inside surrounding text or a code fence", () => {
    const verdict = parseVerdict('Here you go:\n```json\n{"verdict":"done","reason":"deployed"}\n```');

    expect(verdict).toEqual({ kind: "done", reason: "deployed" });
  });

  test("treats an unknown verdict as notify", () => {
    const verdict = parseVerdict('{"verdict":"maybe","reason":"unsure"}');

    expect(verdict).toEqual({ kind: "notify", reason: "unsure" });
  });

  test("treats unparseable output as notify", () => {
    const verdict = parseVerdict("I think it is fine");

    expect(verdict.kind).toBe("notify");
  });

  test("treats a missing reason as an empty reason", () => {
    const verdict = parseVerdict('{"verdict":"wait"}');

    expect(verdict).toEqual({ kind: "wait", reason: "" });
  });
});
