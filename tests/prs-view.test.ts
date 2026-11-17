import { describe, expect, test } from "bun:test";
import { CHOICE_KEYS, prsView, readChoices, type PrsChoices } from "../core/prs-view";
import type { MyPr } from "../core/my-prs";

const pr = (repo: string, number: number, extra: Partial<MyPr> = {}): MyPr => ({
  repo, number, title: `PR ${number}`, url: `https://github.com/${repo}/pull/${number}`, draft: false, createdAt: "2026-11-10T10:00:00Z", ...extra,
});
const row = (id: string, sessionID: string, extra: Record<string, unknown> = {}) => ({ id, label: `${id} title of ${id}`, url: `u/${id}`, sessionID, ...extra });

const choices = (overrides: Partial<PrsChoices> = {}): PrsChoices => ({
  organisation: "", grouping: "repo", sort: "name", drafts: true, others: true, sessionOnly: false, search: "", ...overrides,
});
const data = {
  open: [pr("o/b", 1), pr("o/a", 2, { draft: true }), pr("x/c", 3)],
  merged: [pr("o/a", 9, { closedAt: "2026-11-15T10:00:00Z" })],
  watchedRows: [row("o/a#2", "s1"), row("bot/dep#7", "s2"), row("o/a run 5", "s1")],
};
const numbers = (groups: readonly { prs: readonly MyPr[] }[]) => groups.flatMap((g) => g.prs.map((p) => p.number));

describe("prsView: what the PRs tab shows", () => {
  test("by repo: my PRs and others' watched PRs, grouped by repo, runs apart", () => {
    const view = prsView(data, choices(), "s1");
    expect(view.open.map((g) => [g.kind, g.name])).toEqual([["repo", "bot/dep"], ["repo", "o/a"], ["repo", "o/b"], ["repo", "x/c"]]);
    expect(view.runs.map((r) => r.id)).toEqual(["o/a run 5"]);
    expect(view.repoOnLine).toBe(false);
  });

  test("filters: organisation, drafts, others, search", () => {
    expect(numbers(prsView(data, choices({ organisation: "o" }), "s1").open)).toEqual([2, 1]);
    expect(numbers(prsView(data, choices({ drafts: false, others: false }), "s1").open)).toEqual([1, 3]);
    expect(numbers(prsView(data, choices({ search: "#3" }), "s1").open)).toEqual([3]);
  });

  test("current session only: the PRs and runs this session watches, whoever opened them", () => {
    const view = prsView(data, choices({ sessionOnly: true }), "s2");
    expect(numbers(view.open)).toEqual([7]);
    expect(view.runs).toEqual([]);
    expect(prsView({ ...data, watchedRows: [] }, choices({ sessionOnly: true }), "s2").openEmpty).toBe("No PRs watched in this session.");
  });

  test("current session only, without others' PRs: only my PRs this session watches", () => {
    const view = prsView({ ...data, watchedRows: [...data.watchedRows, row("bot/dep#7", "s1")] }, choices({ sessionOnly: true, others: false }), "s1");
    expect(numbers(view.open)).toEqual([2]);
  });

  test("no grouping: one list, lines show their repo", () => {
    const view = prsView(data, choices({ grouping: "none" }), "s1");
    expect(view.open.map((g) => [g.kind, g.name])).toEqual([["all", "All PRs"]]);
    expect(view.repoOnLine).toBe(true);
  });

  test("by topic: the topics' groups once they are there, by repo until then; sorting by name falls back to newest", () => {
    const topics = [{ name: "Deps", prs: ["bot/dep#7"] }];
    const waiting = prsView(data, choices({ grouping: "topic" }), "s1");
    expect(waiting.open[0]!.kind).toBe("repo");
    expect(waiting.sortByNameDisabled).toBe(true);
    expect(waiting.effectiveSort).toBe("newest");
    const ready = prsView(data, choices({ grouping: "topic" }), "s1", topics);
    expect(ready.open.map((g) => g.name)).toEqual(["Deps", "Other"]);
    expect(ready.repoOnLine).toBe(true);
  });

  test("recently merged: grouped the same way, absent until loaded, empty text when nothing matches", () => {
    expect(numbers(prsView(data, choices(), "s1").merged!)).toEqual([9]);
    expect(prsView({ ...data, merged: undefined }, choices(), "s1").merged).toBeUndefined();
    expect(prsView(data, choices({ search: "nothing" }), "s1").mergedEmpty).toBe("None match.");
  });

  test("empty texts say why", () => {
    expect(prsView({ open: [], watchedRows: [] }, choices(), "s1").openEmpty).toBe("No open PRs.");
    expect(prsView(data, choices({ search: "zzz" }), "s1").openEmpty).toBe("No open PRs match.");
    expect(prsView(data, choices(), "s1").openEmpty).toBeUndefined();
  });

  test("organisations for the dropdown come from everything listed", () => {
    expect(prsView(data, choices(), "s1").organisations).toEqual(["bot", "o", "x"]);
  });

  test("a PR's watch row, if watched", () => {
    expect(prsView(data, choices(), "s1").watchOf(pr("o/a", 2))?.sessionID).toBe("s1");
    expect(prsView(data, choices(), "s1").watchOf(pr("o/b", 1))).toBeUndefined();
  });
});

describe("readChoices: the stored preferences, with defaults for anything missing or unknown", () => {
  test("defaults", () => {
    expect(readChoices(() => null)).toEqual(choices());
  });

  test("stored values, and unknown ones ignored", () => {
    const stored: Record<string, string> = {
      [CHOICE_KEYS.organisation]: "o", [CHOICE_KEYS.grouping]: "topic", [CHOICE_KEYS.sort]: "sideways",
      [CHOICE_KEYS.drafts]: "false", [CHOICE_KEYS.others]: "false", [CHOICE_KEYS.sessionOnly]: "true",
    };
    expect(readChoices((key) => stored[key] ?? null)).toEqual(choices({ organisation: "o", grouping: "topic", drafts: false, others: false, sessionOnly: true }));
  });
});
