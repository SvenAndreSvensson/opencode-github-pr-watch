export interface TerraformPlan {
  readonly job: string;
  readonly summary: string;
}

const ANSI = /\u001b\[[0-9;]*m/g;

/** Terraform's plan summary in one job's log (the last one wins), or undefined when the job ran no plan. */
export function planSummary(log: string): string | undefined {
  let summary: string | undefined;
  for (const raw of log.split("\n")) {
    const line = raw.replace(ANSI, "").replace(/^\uFEFF?\S+Z /, "").trim();
    const plan = line.match(/^Plan: (\d+ to add, \d+ to change, \d+ to destroy)\.$/);
    if (plan) summary = plan[1]!;
    else if (line.startsWith("No changes. Your infrastructure matches the configuration.")) summary = "no changes";
  }
  return summary;
}
