import { createHash } from "node:crypto";

const WINDOW_MS = 30 * 60_000;

export const messageKey = (sessionID: string, text: string) =>
  `sent/${createHash("sha256").update(`${sessionID}\n${text}`).digest("hex").slice(0, 32)}`;

// OpenCode can load the plugin more than once (one instance per location) and each may run the same watch, so the
// same message can be produced twice. Identical messages to a session within the window are sent once.
export const shouldSend = (lastSentAt: number | undefined, now: number) => lastSentAt === undefined || now - lastSentAt >= WINDOW_MS;
