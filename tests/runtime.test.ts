import { describe, expect, test } from "bun:test";
import { claimPolling, dropMessagesFor, newProcessState, ownsPolling, releasePolling, resumeChanged, shouldAnnounceResume } from "../core/runtime";

describe("resume announcements", () => {
  test("only the first setup for a directory in a process announces resumed watches", () => {
    const state = newProcessState();

    const answers = Array.from({ length: 6 }, () => shouldAnnounceResume(state, "/repo"));

    expect(answers).toEqual([true, false, false, false, false, false]);
  });

  test("each directory announces once", () => {
    const state = newProcessState();

    expect(shouldAnnounceResume(state, "/a")).toBe(true);
    expect(shouldAnnounceResume(state, "/b")).toBe(true);
  });

  test("an identical message to the last one sent is not repeated", () => {
    expect(resumeChanged("resumed 1 watch after restart: o/r#1", "resumed 1 watch after restart: o/r#1")).toBe(false);
    expect(resumeChanged("resumed 1 watch after restart: o/r#1", "resumed 2 watches after restart: o/r#1, o/r#2")).toBe(true);
    expect(resumeChanged(undefined, "resumed 1 watch after restart: o/r#1")).toBe(true);
  });
});

describe("poll loop ownership", () => {
  test("a new setup takes over the loop and cancels the previous instance's timers", () => {
    const state = newProcessState();
    const first = Symbol("first");
    const second = Symbol("second");
    let fired = false;
    claimPolling(state, "/repo", first).set("o/r#1", setTimeout(() => (fired = true), 5));

    const timers = claimPolling(state, "/repo", second);

    expect(timers.size).toBe(0);
    expect(ownsPolling(state, "/repo", first)).toBe(false);
    expect(ownsPolling(state, "/repo", second)).toBe(true);
    return new Promise<void>((done) => setTimeout(() => (expect(fired).toBe(false), done()), 20));
  });

  test("disposing a replaced instance leaves the new loop running", () => {
    const state = newProcessState();
    const first = Symbol("first");
    const second = Symbol("second");
    claimPolling(state, "/repo", first);
    const timers = claimPolling(state, "/repo", second);
    timers.set("o/r#1", setTimeout(() => undefined, 10_000));

    releasePolling(state, "/repo", first);

    expect(ownsPolling(state, "/repo", second)).toBe(true);
    expect(timers.size).toBe(1);
    releasePolling(state, "/repo", second);
    expect(timers.size).toBe(0);
  });
});

describe("dropMessagesFor", () => {
  test("drops queued messages about an unwatched PR, keeps the rest", () => {
    expect(dropMessagesFor(["o/r#1: approved", "o/r#12: merged", "o/r#1: deployed"], "o/r#1")).toEqual(["o/r#12: merged"]);
  });
});
