import type { ModelRef } from "./model-guard";

export function watchStartedMessage(id: string, model: ModelRef, summary?: string, startedBy?: string, notify: "major" | "all" = "major"): string {
  return (
    `Watching ${id}${startedBy ? ` (started by ${startedBy})` : ""}.${summary ? ` ${summary}.` : ""} ` +
    "Every change of where the PR is is reported, including checks finishing (passed or failed), review, merge and deploy, " +
    "so no message means the PR is still where it was. " +
    (notify === "all"
      ? "With notify all, progress within a step (each check or job) is reported too. "
      : 'Progress within a step is not reported (start the watch with notify "all" for that). ') +
    `Other changes are judged by ${model.providerID}/${model.id} (re-checked before every call; ${model.providerID} only), which reports anything unexpected.`
  );
}

export const resumedMessage = (ids: readonly string[]) =>
  `resumed ${ids.length} watch${ids.length === 1 ? "" : "es"} after restart: ${ids.join(", ")}`;
