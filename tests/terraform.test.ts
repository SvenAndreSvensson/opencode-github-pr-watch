import { describe, expect, test } from "bun:test";
import { summaryLine } from "../core/pr-facts";
import { planSummary } from "../core/terraform";
import { aFacts } from "./mothers";

// One job's log from the API: "<timestamp> <line>", with Terraform's colour codes.
const prod = [
  "2026-11-12T14:07:07.6180680Z \u001b[1mPlan: 0 to add, 6 to change, 9 to destroy.\u001b[0m",
  '2026-11-12T14:07:11.2285510Z if [[ "$TF_PLAN" != *"No changes. Your infrastructure matches the configuration."* ]]; then',
].join("\n");

describe("planSummary (plan 29, infra#798)", () => {
  test("a job's plan summary, from Terraform's own lines only", () => {
    expect(planSummary(prod)).toBe("0 to add, 6 to change, 9 to destroy");
    expect(planSummary("2026-11-12T14:01:00.0000000Z No changes. Your infrastructure matches the configuration.")).toBe("no changes");
    expect(planSummary("2026-11-12T14:00:00.0000000Z ok")).toBeUndefined();
  });

  test("the summary line shows plans with changes, destroys first", () => {
    const facts = aFacts({ terraformPlans: [{ job: "PROD Terraform / Terraform Plan  - prod", summary: "0 to add, 6 to change, 9 to destroy" }, { job: "DEV", summary: "no changes" }] });
    expect(summaryLine(facts, 0)).toContain("terraform: PROD Terraform / Terraform Plan  - prod 0 to add, 6 to change, 9 to destroy (DESTROYS)");
    expect(summaryLine(facts, 0)).not.toContain("DEV");
  });
});
