// gh run view --log-failed prefixes every line with "<job>\t<step>\t<timestamp> ".
const PREFIX = /^[^\t]*\t[^\t]*\t\S+ ?/;

export function logTail(log: string, lines: number): string[] {
  return log
    .split("\n")
    .map((line) => line.replace(PREFIX, "").trim())
    .filter((line) => line.length > 0)
    .slice(-lines);
}
