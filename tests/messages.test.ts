import { describe, expect, test } from "bun:test";
import { resumedMessage, watchStartedMessage } from "../core/messages";

describe("watchStartedMessage", () => {
  test("names the provider and the model that will judge changes", () => {
    const message = watchStartedMessage("acme/api#42", { providerID: "github-copilot", id: "claude-haiku-4.5" });

    expect(message).toContain("acme/api#42");
    expect(message).toContain("github-copilot/claude-haiku-4.5");
    expect(message).toContain("github-copilot only");
  });

  test("includes the PR's current state", () => {
    const message = watchStartedMessage("o/r#1", { providerID: "github-copilot", id: "claude-haiku" }, "summary: REVIEW_REQUIRED · checks PASS · branch OK · next: NEEDS_REVIEW");

    expect(message).toContain("summary: REVIEW_REQUIRED · checks PASS · branch OK · next: NEEDS_REVIEW");
  });
});

describe("resumedMessage", () => {
  test("names how many watches resumed, and which", () => {
    expect(resumedMessage(["o/a#1", "o/b#2"])).toBe("resumed 2 watches after restart: o/a#1, o/b#2");
    expect(resumedMessage(["o/a#1"])).toBe("resumed 1 watch after restart: o/a#1");
  });
});

describe("watchStartedMessage: what started it (plan 15)", () => {
  test("names the command that started an automatic watch", () => {
    const message = watchStartedMessage("o/r#42", { providerID: "github-copilot", id: "claude-haiku-4.5" }, undefined, "gh run rerun 38730000");
    expect(message.startsWith("Watching o/r#42 (started by gh run rerun 38730000).")).toBe(true);
  });
});
