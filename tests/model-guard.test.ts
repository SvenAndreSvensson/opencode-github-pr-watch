import { describe, expect, test } from "bun:test";
import { pinProvider, resolveJudgeModel } from "../core/model-guard";
import { aModel, aSession, judgeInput } from "./mothers";

describe("pinProvider", () => {
  test("refuses when the session has no selected model", () => {
    const result = pinProvider({ directory: "/repo" }, "/repo");

    expect(result.ok).toBe(false);
  });

  test("pins the provider and directory of the session's selected model", () => {
    const result = pinProvider(aSession("github-copilot"), "/repo");

    expect(result).toEqual({ ok: true, pinned: { providerID: "github-copilot", directory: "/repo" } });
  });

  test("refuses when the session directory differs from the plugin location", () => {
    const result = pinProvider(aSession("github-copilot", "claude-opus", "/other"), "/repo");

    expect(result.ok).toBe(false);
  });

  test("accepts a session in a directory inside the plugin location, or around it (one workspace)", () => {
    expect(pinProvider(aSession("github-copilot", "claude-opus", "/repo/service"), "/repo").ok).toBe(true);
    expect(pinProvider(aSession("github-copilot", "claude-opus", "/repo"), "/repo/service").ok).toBe(true);
  });

  test("a directory that only starts with the same letters is not inside it", () => {
    expect(pinProvider(aSession("github-copilot", "claude-opus", "/repo-other"), "/repo").ok).toBe(false);
  });
});

describe("resolveJudgeModel", () => {
  test("picks the first preferred model from the pinned provider", () => {
    const input = judgeInput({ preferences: ["haiku"] });

    const result = resolveJudgeModel(input);

    expect(result).toEqual({ ok: true, model: { providerID: "github-copilot", id: "claude-haiku" } });
  });

  test("preference order wins over catalog order", () => {
    const catalog = [aModel("github-copilot", "gpt-5-mini"), aModel("github-copilot", "claude-haiku")];

    const result = resolveJudgeModel(judgeInput({ catalog, preferences: ["haiku", "mini"] }));

    expect(result).toEqual({ ok: true, model: { providerID: "github-copilot", id: "claude-haiku" } });
  });

  test("uses the next preference when the first has no match", () => {
    const catalog = [aModel("github-copilot", "claude-opus"), aModel("github-copilot", "gpt-5-mini")];

    const result = resolveJudgeModel(judgeInput({ catalog, preferences: ["haiku", "mini"] }));

    expect(result).toEqual({ ok: true, model: { providerID: "github-copilot", id: "gpt-5-mini" } });
  });

  test("ignores preferred models from other providers", () => {
    const catalog = [aModel("anthropic", "claude-haiku"), aModel("github-copilot", "gpt-5-mini")];

    const result = resolveJudgeModel(judgeInput({ catalog, preferences: ["haiku", "mini"] }));

    expect(result).toEqual({ ok: true, model: { providerID: "github-copilot", id: "gpt-5-mini" } });
  });

  test("ignores disabled models", () => {
    const catalog = [aModel("github-copilot", "claude-haiku", { enabled: false }), aModel("github-copilot", "gpt-5-mini")];

    const result = resolveJudgeModel(judgeInput({ catalog, preferences: ["haiku", "mini"] }));

    expect(result).toEqual({ ok: true, model: { providerID: "github-copilot", id: "gpt-5-mini" } });
  });

  test("falls back to the session's model when no preference matches", () => {
    const catalog = [aModel("github-copilot", "claude-opus")];

    const result = resolveJudgeModel(judgeInput({ catalog, preferences: ["haiku"] }));

    expect(result).toEqual({ ok: true, model: { providerID: "github-copilot", id: "claude-opus" } });
  });

  test("falls back to the session's model when the preference list is empty", () => {
    const result = resolveJudgeModel(judgeInput({ preferences: [] }));

    expect(result).toEqual({ ok: true, model: { providerID: "github-copilot", id: "claude-opus" } });
  });

  test("refuses when the session no longer has a selected model", () => {
    const result = resolveJudgeModel(judgeInput({ session: { directory: "/repo" } }));

    expect(result.ok).toBe(false);
  });

  test("refuses when the session switched to another provider", () => {
    const result = resolveJudgeModel(judgeInput({ session: aSession("anthropic", "claude-opus") }));

    expect(result.ok).toBe(false);
  });

  test("refuses an aliased provider ID (no alias mapping)", () => {
    const pinned = { providerID: "azure-cognitive-services", directory: "/repo" };

    const result = resolveJudgeModel(judgeInput({ pinned, session: aSession("azure", "gpt-5") }));

    expect(result.ok).toBe(false);
  });

  test("refuses when the session directory differs from the plugin location", () => {
    const result = resolveJudgeModel(judgeInput({ session: aSession("github-copilot", "claude-opus", "/other") }));

    expect(result.ok).toBe(false);
  });

  test("keeps judging when the session moves within the same workspace", () => {
    const pinned = { providerID: "github-copilot", directory: "/repo" };
    const session = aSession("github-copilot", "claude-opus", "/repo/service");

    expect(resolveJudgeModel(judgeInput({ pinned, session })).ok).toBe(true);
  });

  test("refuses when the session moved away from the pinned directory", () => {
    const session = aSession("github-copilot", "claude-opus", "/other");

    const result = resolveJudgeModel(judgeInput({ session, pluginDirectory: "/other" }));

    expect(result.ok).toBe(false);
  });
});
