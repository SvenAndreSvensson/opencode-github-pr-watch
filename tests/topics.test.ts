import { describe, expect, test } from "bun:test";
import { byTopic, parsePlacements, parseTopics, placePrompt, topicPlan, topicsPrompt } from "../core/topics";
import type { MyPr } from "../core/my-prs";

const pr = (repo: string, number: number, title: string, extra: Partial<MyPr> = {}): MyPr => ({
  repo, number, title, url: `https://github.com/${repo}/pull/${number}`, draft: false, createdAt: "2026-11-10T10:00:00Z", ...extra,
});
const prs = [
  pr("o/infra", 803, "Add delete locks to the storage buckets"),
  pr("o/infra", 811, "Alert on failing logins"),
  pr("o/app", 1877, "Deploy the pushed image by digest"),
  pr("o/docs", 7, "Link the Pages site in the README"),
];

describe("topicsPrompt", () => {
  test("lists each PR with its id, repo and title, and asks for JSON", () => {
    const prompt = topicsPrompt(prs);
    expect(prompt).toContain("o/infra#803: Add delete locks to the storage buckets");
    expect(prompt).toContain('{"topics": [{"name"');
  });
});

describe("parseTopics", () => {
  test("keeps known PRs, each in its first topic only; the rest go to Other", () => {
    const answer = JSON.stringify({
      topics: [
        { name: "Security", prs: ["o/infra#803", "o/infra#811", "o/nope#1"] },
        { name: "Deploys", prs: ["o/app#1877", "o/infra#803"] },
        { name: "Empty", prs: ["o/ghost#2"] },
      ],
    });
    expect(parseTopics(answer, prs)).toEqual([
      { name: "Security", prs: ["o/infra#803", "o/infra#811"] },
      { name: "Deploys", prs: ["o/app#1877"] },
      { name: "Other", prs: ["o/docs#7"] },
    ]);
  });

  test("an answer that isn't JSON throws, so the caller can fall back and log it", () => {
    expect(() => parseTopics("Sure! Here are your topics", prs)).toThrow();
  });
});

describe("byTopic", () => {
  test("groups in the topics' order, PRs in the chosen sort, filters apply", () => {
    const topics = [{ name: "Security", prs: ["o/infra#803", "o/infra#811"] }, { name: "Other", prs: ["o/app#1877", "o/docs#7"] }];
    const list = [...prs.slice(0, 1).map((p) => ({ ...p, createdAt: "2026-11-01T10:00:00Z" })), ...prs.slice(1)];
    expect(byTopic(list, topics, undefined, "newest").map((g) => [g.name, g.prs.map((p) => p.number)])).toEqual([
      ["Security", [811, 803]],
      ["Other", [1877, 7]], // same date: the higher number is the newer
    ]);
  });

  test("a PR the topics don't know yet (new since classifying) goes to Other", () => {
    expect(byTopic(prs, [{ name: "Security", prs: ["o/infra#803"] }]).map((g) => g.name)).toEqual(["Security", "Other"]);
  });
});

describe("new PRs join the existing topics instead of a whole new grouping", () => {
  const p = (n: number, title = `PR ${n}`): MyPr => ({ repo: "o/r", number: n, title, url: "u", draft: false, createdAt: "2026-11-10T10:00:00Z" });
  const topics = [{ name: "CI", prs: ["o/r#1", "o/r#2"] }, { name: "Docs", prs: ["o/r#3"] }];

  test("the same PRs: the topics as they are", () => {
    expect(topicPlan(topics, [p(1), p(2), p(3)])).toEqual({ kind: "same", topics });
  });

  test("PRs gone: dropped, and a topic left empty goes", () => {
    expect(topicPlan(topics, [p(1), p(2)])).toEqual({ kind: "same", topics: [{ name: "CI", prs: ["o/r#1", "o/r#2"] }] });
  });

  test("new PRs: only they are placed, into the kept topics", () => {
    expect(topicPlan(topics, [p(1), p(3), p(4)])).toEqual({ kind: "place", kept: [{ name: "CI", prs: ["o/r#1"] }, { name: "Docs", prs: ["o/r#3"] }], fresh: [p(4)] });
  });

  test("no topics yet, or most PRs new: a whole new grouping", () => {
    expect(topicPlan(undefined, [p(1)])).toEqual({ kind: "full" });
    expect(topicPlan(topics, [p(1), p(4), p(5), p(6)])).toEqual({ kind: "full" });
  });

  test("the model's placements: an existing topic, a new one, or Other when it says nothing usable", () => {
    const kept = [{ name: "CI", prs: ["o/r#1"] }, { name: "Other", prs: ["o/r#9"] }];
    const answer = JSON.stringify({ placements: [{ pr: "o/r#4", topic: "ci" }, { pr: "o/r#5", topic: "Security" }, { pr: "o/x#1", topic: "CI" }] });
    expect(parsePlacements(answer, kept, [p(4), p(5), p(6)])).toEqual([
      { name: "CI", prs: ["o/r#1", "o/r#4"] },
      { name: "Security", prs: ["o/r#5"] },
      { name: "Other", prs: ["o/r#9", "o/r#6"] },
    ]);
  });

  test("the prompt lists the topics and only the new PRs", () => {
    const prompt = placePrompt([{ name: "CI", prs: ["o/r#1"] }], [p(4, "Fix lint")]);
    expect(prompt).toContain("- CI");
    expect(prompt).toContain("o/r#4: Fix lint");
    expect(prompt).not.toContain("o/r#1:");
  });
});
