import { describe, expect, test } from "bun:test";
import { PRS_TAB } from "../core/panel-tab";

describe("the PRs tab", () => {
  test("is always listed", () => {
    expect(PRS_TAB.pinned).toBe(true);
  });

  // Without it the host selects nothing when this is the only tab, and the open side region shows a blank pane.
  test("opts into fallback selection, so it shows when it is the only tab", () => {
    expect(PRS_TAB).toMatchObject({ fallback: true });
  });
});
