import { describe, expect, test } from "bun:test";
import { approvalLine, upToDateLine } from "../core/pr-status";

describe("approvalLine", () => {
  test("approved", () => {
    expect(approvalLine("APPROVED")).toBe("approved: yes");
  });

  test("review required", () => {
    expect(approvalLine("REVIEW_REQUIRED")).toBe("approved: no (review required)");
  });

  test("changes requested", () => {
    expect(approvalLine("CHANGES_REQUESTED")).toBe("approved: no (changes requested)");
  });

  test("no review required", () => {
    expect(approvalLine("")).toBe("approved: not required");
  });
});

describe("upToDateLine", () => {
  test.each(["CLEAN", "BLOCKED", "UNSTABLE", "HAS_HOOKS"])("up to date when the merge state is %s", (mergeState) => {
    expect(upToDateLine({ state: "OPEN", mergeStateStatus: mergeState, baseRefName: "main" })).toBe("up to date with main: yes");
  });

  test("behind the base branch", () => {
    expect(upToDateLine({ state: "OPEN", mergeStateStatus: "BEHIND", baseRefName: "main" })).toBe(
      "up to date with main: no (behind, needs update from main)",
    );
  });
  test("conflicts with the base branch", () => {
    expect(upToDateLine({ state: "OPEN", mergeStateStatus: "DIRTY", baseRefName: "main" })).toBe(
      "up to date with main: no (conflicts with main)",
    );
  });

  test("unknown while GitHub is still computing", () => {
    expect(upToDateLine({ state: "OPEN", mergeStateStatus: "UNKNOWN", baseRefName: "main" })).toBe(
      "up to date with main: unknown (GitHub is still checking)",
    );
  });

  test("not relevant once merged", () => {
    expect(upToDateLine({ state: "MERGED", mergeStateStatus: "UNKNOWN", baseRefName: "main" })).toBe(
      "up to date with main: merged",
    );
  });
});
