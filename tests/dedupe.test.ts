import { describe, expect, test } from "bun:test";
import { messageKey, shouldSend } from "../core/dedupe";

const NOW = Date.parse("2026-10-13T12:00:00Z");

describe("dedupe", () => {
  test("sends a message not seen before", () => {
    expect(shouldSend(undefined, NOW)).toBe(true);
  });

  test("drops an identical message sent in the last 30 minutes", () => {
    expect(shouldSend(NOW - 5 * 60_000, NOW)).toBe(false);
    expect(shouldSend(NOW - 31 * 60_000, NOW)).toBe(true);
  });

  test("the key is per session and message", () => {
    expect(messageKey("ses_a", "o/r#1: deployed")).not.toBe(messageKey("ses_b", "o/r#1: deployed"));
    expect(messageKey("ses_a", "o/r#1: deployed")).toBe(messageKey("ses_a", "o/r#1: deployed"));
  });
});
