import { describe, expect, test } from "bun:test";
import { parseReplacement, replacementPrompt } from "../core/replacement";

const closed = { title: "Bump org.postgresql:postgresql from 42.7.14 to 42.7.15 in /core", branch: "dependabot/gradle/core/org.postgresql-postgresql-42.7.15" };
const open = [
  { number: 50, title: "Bump org.postgresql:postgresql from 42.7.14 to 42.7.16 in /core", headRefName: "dependabot/gradle/core/org.postgresql-postgresql-42.7.16" },
  { number: 51, title: "Bump io.ktor:ktor-server from 3.1.0 to 3.2.0 in /core", headRefName: "dependabot/gradle/core/io.ktor-ktor-server-3.2.0" },
];

describe("replacementPrompt", () => {
  test("gives the model the closed PR, its closing comments and the open candidates", () => {
    const prompt = replacementPrompt(closed, ["Looks like these dependencies are updatable in another way"], open);
    expect(prompt).toContain(closed.title);
    expect(prompt).toContain("updatable in another way");
    expect(prompt).toContain("#50");
    expect(prompt).toContain('{"replacement": <number> | null}');
  });
});

describe("parseReplacement", () => {
  test("a candidate the model picked", () => {
    expect(parseReplacement('{"replacement": 50}', open, [])).toBe(50);
  });

  test("a PR named in the closing comments counts too", () => {
    expect(parseReplacement('{"replacement": 41}', open, ["Superseded by #41."])).toBe(41);
  });

  test("never a number the model made up", () => {
    expect(parseReplacement('{"replacement": 99}', open, [])).toBeUndefined();
  });

  test("null or an unreadable answer means none", () => {
    expect(parseReplacement('{"replacement": null}', open, [])).toBeUndefined();
    expect(parseReplacement("hmm", open, [])).toBeUndefined();
  });
});
