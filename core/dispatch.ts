export interface Dispatch {
  readonly workflow: string;
  readonly ref?: string;
  readonly repo?: string;
}

const VALUE_FLAGS = new Set(["-f", "--raw-field", "-F", "--field", "--json"]);
// A dispatched run's createdAt can be a few seconds before the command finished on this machine's clock.
const CLOCK_SKEW_MS = 60_000;

const unquote = (token: string) => token.replace(/^["']|["']$/g, "");

/** `gh workflow run <workflow>` where gh is the command being run; a workflow or repo from a shell variable is skipped. */
export function findWorkflowDispatches(command: string): Dispatch[] {
  command = command.replace(/\\\r?\n/g, " ");
  const pattern = /(?:^|[;&|(\n]|\bdo\b|\bthen\b)\s*gh workflow run\b([^;|&\n)]*)/g;
  const found: Dispatch[] = [];
  for (const match of command.matchAll(pattern)) {
    const tokens = (match[1]!.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).filter((t) => !/^\d*[<>]/.test(t)).map(unquote);
    let workflow: string | undefined;
    let ref: string | undefined;
    let repo: string | undefined;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (token === "--repo" || token === "-R") repo = tokens[++i];
      else if (token.startsWith("--repo=")) repo = token.slice("--repo=".length);
      else if (token === "--ref" || token === "-r") ref = tokens[++i];
      else if (token.startsWith("--ref=")) ref = token.slice("--ref=".length);
      else if (VALUE_FLAGS.has(token)) i++;
      else if (!token.startsWith("-") && workflow === undefined) workflow = token;
    }
    if (!workflow || [workflow, ref, repo].some((value) => value?.includes("$"))) continue;
    found.push({ workflow, ...(ref ? { ref } : {}), ...(repo ? { repo } : {}) });
  }
  return found;
}

/** Recent gh versions print the run a dispatch created, as a link or a `gh run view <id>` hint. */
export function runFromOutput(output: string): number | undefined {
  const ids = new Set([...output.matchAll(/\/actions\/runs\/(\d+)|gh run view (\d+)/g)].map((m) => Number(m[1] ?? m[2])));
  return ids.size === 1 ? [...ids][0] : undefined;
}

/** The newest manual dispatch created since the command ran, from that workflow's runs. */
export function dispatchedRun(runs: readonly { databaseId: number; event: string; createdAt: string }[], dispatchedAt: number): number | undefined {
  return runs
    .filter((run) => run.event === "workflow_dispatch" && Date.parse(run.createdAt) >= dispatchedAt - CLOCK_SKEW_MS)
    .sort((a, b) => b.databaseId - a.databaseId)[0]?.databaseId;
}
