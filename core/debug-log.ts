import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";

export type DebugLog = (event: string, fields?: Record<string, unknown>) => void;

export const noDebugLog: DebugLog = () => undefined;

export function debugLine(event: string, fields: Record<string, unknown>, now: number): string {
  const plain = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value instanceof Error ? value.message : value]));
  return `${JSON.stringify({ at: new Date(now).toISOString(), event, ...plain })}\n`;
}

/** Appends JSON lines to a file, keeping one previous file (.1) once it passes the size limit. Never throws. */
export function fileDebugLog(path: string, maxBytes = 5 * 1024 * 1024): DebugLog {
  return (event, fields = {}) => {
    try {
      mkdirSync(dirname(path), { recursive: true });
      try {
        if (statSync(path).size > maxBytes) renameSync(path, `${path}.1`);
      } catch {
        // No file yet.
      }
      appendFileSync(path, debugLine(event, fields, Date.now()));
    } catch {
      // Diagnostics must never break a watch.
    }
  };
}

/**
 * The boundary for a failure the run can go on without (an optional fact, a suggestion, a progress event): the error is
 * logged with what failed, and the fallback is used. Anything else should throw up to the poll step.
 */
export async function tolerate<T>(log: DebugLog, what: string, call: Promise<T> | undefined, fallback: T, fields: Record<string, unknown> = {}): Promise<T> {
  if (!call) return fallback;
  try {
    return await call;
  } catch (error) {
    log("tolerated-error", { what, error, ...fields });
    return fallback;
  }
}
