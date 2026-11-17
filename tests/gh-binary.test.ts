import { describe, expect, test } from "bun:test";
import { findGh, ghFailure, mergePaths, noWatchMessage, pathFromShell } from "../core/gh-binary";

describe("findGh", () => {
  const exists = (paths: string[]) => (p: string) => paths.includes(p);

  test("a configured path wins", () => {
    expect(findGh({ configured: "/x/gh", path: "/usr/bin" }, exists(["/x/gh", "/usr/bin/gh"]))).toBe("/x/gh");
  });

  test("then PATH", () => {
    expect(findGh({ path: "/a:/b" }, exists(["/b/gh"]))).toBe("/b/gh");
  });

  test("then the usual install locations, for a GUI app started without the shell's PATH", () => {
    expect(findGh({ path: "/usr/bin" }, exists(["/opt/homebrew/bin/gh"]))).toBe("/opt/homebrew/bin/gh");
    expect(findGh({ path: "/usr/bin" }, exists(["/usr/local/bin/gh"]))).toBe("/usr/local/bin/gh");
  });

  test("skips mise shims: they fail in folders without a mise version for gh", () => {
    expect(findGh({ path: "/Users/a/.local/share/mise/shims:/opt/homebrew/bin" }, exists(["/Users/a/.local/share/mise/shims/gh", "/opt/homebrew/bin/gh"])))
      .toBe("/opt/homebrew/bin/gh");
  });

  test("nothing found", () => {
    expect(findGh({ path: "/usr/bin" }, exists([]))).toBeUndefined();
  });
});

describe("ghFailure", () => {
  test("a missing gh says so and what to do, without the command line", () => {
    expect(ghFailure(Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }), ["pr", "view", "1", "--json", "a,b,c"], "")).toBe(
      "`gh` not found (looked in PATH, /opt/homebrew/bin, /usr/local/bin); set the pr-watch option ghPath",
    );
  });

  test("other failures give gh's own error first, without the --json field list", () => {
    expect(ghFailure(new Error("exit 1"), ["pr", "view", "736", "--repo", "o/r", "--json", "a,b,c"], "GraphQL: Could not resolve to a PullRequest")).toBe(
      "GraphQL: Could not resolve to a PullRequest (gh pr view 736 --repo o/r)",
    );
  });
});

describe("noWatchMessage", () => {
  test("cause first, then what it means for the user", () => {
    expect(noWatchMessage("merge", "o/r#736", "`gh` not found")).toBe(
      "No watch started for the merge of o/r#736: `gh` not found. Fix that, or start one with watch_pr.",
    );
  });
});

describe("pathFromShell", () => {
  test("reads the PATH between markers, ignoring whatever the shell's startup files print", () => {
    expect(pathFromShell("Welcome!\n__PRW__/opt/homebrew/bin:/usr/bin__PRW__\n")).toBe("/opt/homebrew/bin:/usr/bin");
  });

  test("nothing when the markers are missing", () => {
    expect(pathFromShell("oops")).toBeUndefined();
  });
});

describe("mergePaths", () => {
  test("the shell's PATH first, then anything only the app had, without duplicates", () => {
    expect(mergePaths("/opt/homebrew/bin:/usr/bin", "/usr/bin:/app/bin")).toBe("/opt/homebrew/bin:/usr/bin:/app/bin");
  });
});
