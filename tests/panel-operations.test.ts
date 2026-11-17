import { describe, expect, test } from "bun:test";
import { activities, keepMerged, panelOperations, type PanelPort } from "../core/panel-operations";
import type { MyPr } from "../core/my-prs";

const pr = (repo: string, number: number): MyPr => ({ repo, number, title: `Fix ${number}`, url: `https://github.com/${repo}/pull/${number}`, draft: false, createdAt: "2026-11-10T10:00:00Z" });

// A fake of what the operations need from the app: RPC, sessions, tabs and the clipboard. Records every call.
class FakePort implements PanelPort {
  readonly calls: string[] = [];
  failing?: string;
  private fail(what: string) {
    this.calls.push(what);
    if (this.failing === what.split(" ")[0]) throw new Error(`${this.failing} broke`);
  }
  async myPrs(merged: boolean) {
    this.fail(`myPrs merged=${merged}`);
    return { open: [pr("o/r", 1)], merged: merged ? [pr("o/r", 2)] : [], watchedRows: [] };
  }
  async myPrTopics(sessionID: string, merged: boolean) {
    this.fail(`myPrTopics ${sessionID} merged=${merged}`);
    return [{ name: "CI", prs: ["o/r#1"] }];
  }
  async watch(sessionID: string, pr: string) {
    this.fail(`watch ${sessionID} ${pr}`);
    return `Watching ${pr}. summary: x. More text`;
  }
  async unwatch(id: string) { this.fail(`unwatch ${id}`); }
  async setNotify(id: string, notify: "major" | "all") { this.fail(`setNotify ${id} ${notify}`); }
  async session(sessionID: string) {
    this.fail(`session ${sessionID}`);
    return { model: { providerID: "p", id: "m" }, agent: "build" };
  }
  async createSession(input: { title: string; directory: string; model: unknown; agent: string | undefined }) {
    this.fail(`createSession ${input.title} in ${input.directory} with ${JSON.stringify(input.model)} ${input.agent}`);
    return "ses_new";
  }
  async prompt(sessionID: string, text: string) { this.fail(`prompt ${sessionID} ${text}`); }
  openSession(server: string, sessionID: string) { this.calls.push(`open ${server} ${sessionID}`); }
  async copy(text: string) { this.fail(`copy ${text}`); }
}

const setup = () => {
  const port = new FakePort();
  const log: string[] = [];
  const ops = panelOperations(port, {
    track: (text, work) => {
      log.push(`… ${text}`);
      return work;
    },
    say: (text) => void log.push(text),
  });
  return { port, log, ops };
};
const from = { id: "ses_1", directory: "/work", server: { id: "local" } };

describe("panel operations", () => {
  test("watch: says it is starting, then the first sentence of the answer", async () => {
    const { port, log, ops } = setup();
    await ops.watch("ses_1", pr("o/r", 7));
    expect(port.calls).toEqual(["watch ses_1 o/r#7"]);
    expect(log).toEqual(["… Starting watching o/r#7…", "Watching o/r#7"]);
  });

  test("stop and notify say what they did", async () => {
    const { port, log, ops } = setup();
    await ops.stop("o/r#7");
    await ops.setNotify("o/r#7", "all");
    await ops.setNotify("o/r#7", "major");
    expect(port.calls).toEqual(["unwatch o/r#7", "setNotify o/r#7 all", "setNotify o/r#7 major"]);
    expect(log).toEqual([
      "… Stopping watching o/r#7…", "Stopped watching o/r#7.",
      "… Reporting all progress for o/r#7…", "o/r#7: all progress will be reported.",
      "… Reporting only changes of step for o/r#7…", "o/r#7: only changes of step will be reported.",
    ]);
  });

  test("a failed action says why and returns false; it doesn't throw", async () => {
    const { port, log, ops } = setup();
    port.failing = "watch";
    expect(await ops.watch("ses_1", pr("o/r", 7))).toBe(false);
    expect(log.at(-1)).toBe("Could not watch o/r#7: watch broke");
  });

  test("a session about a PR: the open session's model and agent, its folder, the summary request, then opened", async () => {
    const { port, ops } = setup();
    await ops.startSession(from, pr("o/r", 7));
    expect(port.calls).toEqual([
      "session ses_1",
      'createSession PR #7 on o/r in /work with {"providerID":"p","id":"m"} build',
      "prompt ses_new PR #7 on o/r: Fix 7 (https://github.com/o/r/pull/7). Summarize it.",
      "open local ses_new",
    ]);
  });

  test("copy: a - list of the group's PRs, and how many", async () => {
    const { port, log, ops } = setup();
    await ops.copy("o/r", [pr("o/r", 1), pr("o/r", 2)]);
    expect(port.calls).toEqual(["copy - Fix 1: https://github.com/o/r/pull/1\n- Fix 2: https://github.com/o/r/pull/2"]);
    expect(log).toEqual(["Copied 2 PRs from o/r."]);
  });

  test("loads report progress and throw on failure, so the list can show the error", async () => {
    const { port, log, ops } = setup();
    expect((await ops.loadPrs(true)).merged?.length).toBe(1);
    expect(await ops.loadTopics("ses_1", false, false)).toEqual([{ name: "CI", prs: ["o/r#1"] }]);
    await ops.loadTopics("ses_1", false, true);
    expect(log).toEqual(["… Loading your PRs…", "… Sorting your PRs into topics…", "… Updating the topics…"]);
    port.failing = "myPrs";
    await expect(ops.loadPrs(false)).rejects.toThrow("myPrs broke");
  });
});

describe("keepMerged: the merged list survives loads that didn't ask for it", () => {
  test("replaced when asked for, kept otherwise", () => {
    const before = { open: [], merged: [pr("o/r", 1)], watchedRows: [] };
    expect(keepMerged(before, { open: [], merged: [pr("o/r", 2)], watchedRows: [] }, true).merged?.map((p) => p.number)).toEqual([2]);
    expect(keepMerged(before, { open: [], merged: [], watchedRows: [] }, false).merged?.map((p) => p.number)).toEqual([1]);
    expect(keepMerged(undefined, { open: [], merged: [], watchedRows: [] }, false).merged).toBeUndefined();
  });
});

describe("activities: the work in progress the top line shows", () => {
  test("listed while running, gone when done or failed, in order", async () => {
    const seen: string[][] = [];
    const tracker = activities((now) => seen.push(now));
    let finish!: () => void;
    const slow = tracker.track("Loading", new Promise<void>((resolve) => (finish = resolve)));
    await tracker.track("Quick", Promise.resolve()).catch(() => undefined);
    await tracker.track("Broken", Promise.reject(new Error("x"))).catch(() => undefined);
    finish();
    await slow;
    expect(seen).toEqual([["Loading"], ["Loading", "Quick"], ["Loading"], ["Loading", "Broken"], ["Loading"], []]);
  });
});
