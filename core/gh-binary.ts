// OpenCode started from the Dock doesn't get the login shell's PATH, so Homebrew's bin directory is often missing.
const USUAL_LOCATIONS = ["/opt/homebrew/bin", "/usr/local/bin"];

export function findGh(where: { configured?: string; path?: string }, exists: (p: string) => boolean): string | undefined {
  if (where.configured && exists(where.configured)) return where.configured;
  // A mise shim only works in folders where mise has a gh version, and the plugin runs gh from many folders.
  const dirs = [...(where.path ?? "").split(":").filter((dir) => dir && !dir.includes("/mise/shims")), ...USUAL_LOCATIONS];
  return dirs.map((dir) => `${dir}/gh`).find(exists);
}

export const GH_MISSING = `\`gh\` not found (looked in PATH, ${USUAL_LOCATIONS.join(", ")}); set the pr-watch option ghPath`;

export function ghFailure(err: Error & { code?: unknown }, args: readonly string[], stderr: string): string {
  if (err.code === "ENOENT") return GH_MISSING;
  const json = args.indexOf("--json");
  const command = (json >= 0 ? [...args.slice(0, json), ...args.slice(json + 2)] : args).join(" ");
  return `${stderr.trim() || err.message} (gh ${command})`;
}

export const noWatchMessage = (what: string, pr: string, cause: string) =>
  `No watch started for the ${what} of ${pr}: ${cause}. Fix that, or start one with watch_pr.`;

export const PATH_MARKER = "__PRW__";

export function pathFromShell(output: string): string | undefined {
  const match = output.match(new RegExp(`${PATH_MARKER}(.*?)${PATH_MARKER}`));
  return match?.[1] || undefined;
}

export function mergePaths(shell: string, app: string): string {
  return [...new Set([...shell.split(":"), ...app.split(":")].filter(Boolean))].join(":");
}
