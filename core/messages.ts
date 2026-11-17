import type { ModelRef } from "./model-guard";

export function watchStartedMessage(id: string, model: ModelRef, summary?: string, startedBy?: string): string {
  return (
    `Watching ${id}${startedBy ? ` (started by ${startedBy})` : ""}.${summary ? ` ${summary}.` : ""} Approval, review changes, failing checks, merge, close and deploy events ` +
    `are always reported; other changes are judged by ${model.providerID}/${model.id} ` +
    `(re-checked before every call; ${model.providerID} only). ` +
    "You will get a message in this session when something needs attention."
  );
}

export const resumedMessage = (ids: readonly string[]) =>
  `resumed ${ids.length} watch${ids.length === 1 ? "" : "es"} after restart: ${ids.join(", ")}`;
