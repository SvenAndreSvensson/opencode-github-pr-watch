import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { debugLine, fileDebugLog, tolerate } from "../core/debug-log";

describe("debug log", () => {
  test("one JSON object per line: time, event and its fields", () => {
    const line = debugLine("tick", { id: "o/r#1", step: "DEPLOYING" }, Date.parse("2026-11-17T10:00:00Z"));
    expect(JSON.parse(line)).toEqual({ at: "2026-11-17T10:00:00.000Z", event: "tick", id: "o/r#1", step: "DEPLOYING" });
    expect(line.endsWith("\n")).toBe(true);
  });

  test("errors are written as their message", () => {
    expect(JSON.parse(debugLine("judge", { error: new Error("ECONNRESET") }, 0)).error).toBe("ECONNRESET");
  });

  test("appends, and rotates to .1 past the size limit", () => {
    const dir = mkdtempSync(join(tmpdir(), "prw-"));
    const path = join(dir, "debug.jsonl");
    const log = fileDebugLog(path, 200);
    log("a", { n: 1 });
    log("b", { n: 2 });
    expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(2);
    writeFileSync(path, "x".repeat(300));
    log("c", { n: 3 });
    expect(existsSync(`${path}.1`)).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8")).event).toBe("c");
  });
});

describe("tolerate: a failure the run can do without", () => {
  test("returns the answer when the call works", async () => {
    expect(await tolerate(() => undefined, "x", Promise.resolve(5), 0)).toBe(5);
  });

  test("logs the error with what failed, and returns the fallback", async () => {
    const lines: { event: string; fields?: Record<string, unknown> }[] = [];
    const result = await tolerate((event, fields) => void lines.push({ event, ...(fields ? { fields } : {}) }), "plan summary", Promise.reject(new Error("timeout")), [], { id: "o/r#1" });
    expect(result).toEqual([]);
    expect(lines).toEqual([{ event: "tolerated-error", fields: { what: "plan summary", error: expect.any(Error), id: "o/r#1" } }]);
  });

  test("a missing call gives the fallback", async () => {
    expect(await tolerate(() => undefined, "x", undefined, 1)).toBe(1);
  });
});
