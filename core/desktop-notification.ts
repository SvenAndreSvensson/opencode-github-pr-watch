// osascript fallback: title and text go in as script arguments, never into the AppleScript source, so message
// content can't break or inject into the script. Clicking these opens Script Editor; terminal-notifier avoids that.
const SCRIPT = ["on run argv", "display notification (item 2 of argv) with title (item 1 of argv)", "end run"];

const MAX_TEXT = 200;
const OPENCODE_DESKTOP = "ai.opencode.desktop";

const shorten = (text: string) => {
  const firstLine = text.split("\n")[0]!;
  return firstLine.length > MAX_TEXT ? `${firstLine.slice(0, MAX_TEXT - 1)}…` : firstLine;
};

export function notificationCommand(title: string, text: string, terminalNotifier?: string): [string, string[]] {
  const message = shorten(text);
  if (terminalNotifier) {
    return [
      terminalNotifier,
      ["-title", title, "-message", message, "-activate", OPENCODE_DESKTOP, "-group", `pr-watch:${title}`],
    ];
  }
  return ["osascript", [...SCRIPT.flatMap((line) => ["-e", line]), title, message]];
}

export function notificationCommands(title: string, text: string, terminalNotifier?: string): [string, string[]][] {
  const fallback = notificationCommand(title, text);
  return terminalNotifier ? [notificationCommand(title, text, terminalNotifier), fallback] : [fallback];
}
