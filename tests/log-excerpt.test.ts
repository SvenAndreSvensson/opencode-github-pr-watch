import { describe, expect, test } from "bun:test";
import { logTail } from "../core/log-excerpt";

const prefix = "SCAN - Vulnerability scan container / Scan container for vulnerabilities\tUNKNOWN STEP\t2026-10-09T07:48:08.8646695Z ";

describe("logTail", () => {
  test("the last lines, without the job/step/timestamp prefix or blank lines; the model picks out the error", () => {
    const log = [`${prefix}one`, `${prefix}`, `${prefix}two`, `${prefix}##[error]Process completed with exit code 1.`].join("\n");

    expect(logTail(log, 2)).toEqual(["two", "##[error]Process completed with exit code 1."]);
  });

  test("lines without the prefix are kept as they are", () => {
    expect(logTail("plain line", 5)).toEqual(["plain line"]);
  });
});
