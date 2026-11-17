import { describe, expect, test } from "bun:test";
import { notificationCommand, notificationCommands } from "../core/desktop-notification";

describe("notificationCommand", () => {
  test("passes title and text as arguments instead of building them into the script", () => {
    const [cmd, args] = notificationCommand("acme/api#627", 'deployed "fine"');

    expect(cmd).toBe("osascript");
    expect(args.slice(-2)).toEqual(["acme/api#627", 'deployed "fine"']);
    expect(args.slice(0, -2).join(" ")).not.toContain("deployed");
  });

  test("uses only the first line of the text", () => {
    const [, args] = notificationCommand("pr", "no change for 45 minutes, watch stopped. Last state:\nPR: Title\nstate: OPEN");

    expect(args.at(-1)).toBe("no change for 45 minutes, watch stopped. Last state:");
  });

  test("shortens very long text", () => {
    const [, args] = notificationCommand("pr", "x".repeat(500));

    expect(args.at(-1)!.length).toBeLessThanOrEqual(200);
    expect(args.at(-1)!.endsWith("…")).toBe(true);
  });

  test("uses terminal-notifier when available, so a click brings OpenCode to the front", () => {
    const [cmd, args] = notificationCommand("acme/api#627", "deployed", "/opt/homebrew/bin/terminal-notifier");

    expect(cmd).toBe("/opt/homebrew/bin/terminal-notifier");
    expect(args).toEqual([
      "-title", "acme/api#627",
      "-message", "deployed",
      "-activate", "ai.opencode.desktop",
      "-group", "pr-watch:acme/api#627",
    ]);
  });

  test("shortens the text the same way with terminal-notifier", () => {
    const [, args] = notificationCommand("pr", `${"x".repeat(500)}\nsecond line`, "/opt/homebrew/bin/terminal-notifier");

    const message = args[args.indexOf("-message") + 1]!;
    expect(message.length).toBeLessThanOrEqual(200);
    expect(message).not.toContain("second line");
  });

  test("falls back to osascript after terminal-notifier", () => {
    const commands = notificationCommands("pr", "deployed", "/opt/homebrew/bin/terminal-notifier");

    expect(commands.map(([cmd]) => cmd)).toEqual(["/opt/homebrew/bin/terminal-notifier", "osascript"]);
  });

  test("uses only osascript when terminal-notifier is missing", () => {
    expect(notificationCommands("pr", "deployed").map(([cmd]) => cmd)).toEqual(["osascript"]);
  });
});
