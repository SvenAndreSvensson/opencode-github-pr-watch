// OpenCode runs setup again for every plugin instance and reload in the same process (one per location, and again
// whenever the host rebuilds its plugin scope). Anything that must happen once per process, such as announcing resumed
// watches or owning the poll loop, is kept here, outside any one instance.
export interface ProcessState {
  /** Directories whose watches have already been resumed in this process. */
  readonly resumed: Set<string>;
  /** The instance that currently runs the poll loop for a directory. */
  readonly owners: Map<string, symbol>;
  /** The poll timers of each directory, shared so a new owner can cancel the previous owner's loop. */
  readonly timers: Map<string, Map<string, ReturnType<typeof setTimeout>>>;
}

export const newProcessState = (): ProcessState => ({ resumed: new Set(), owners: new Map(), timers: new Map() });

const KEY = Symbol.for("opencode-pr-watch/process");

// On globalThis, because the host may import the module afresh for each instance.
export const processState = (): ProcessState => {
  const global = globalThis as unknown as Record<symbol, ProcessState | undefined>;
  return (global[KEY] ??= newProcessState());
};

/** Makes `owner` the only poll loop for the directory and returns its (emptied) timer map. */
export function claimPolling(state: ProcessState, directory: string, owner: symbol): Map<string, ReturnType<typeof setTimeout>> {
  state.owners.set(directory, owner);
  const timers = state.timers.get(directory) ?? new Map<string, ReturnType<typeof setTimeout>>();
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  state.timers.set(directory, timers);
  return timers;
}

export const ownsPolling = (state: ProcessState, directory: string, owner: symbol) => state.owners.get(directory) === owner;

/** Stops the loop on dispose, unless a newer instance has already taken it over. */
export function releasePolling(state: ProcessState, directory: string, owner: symbol): void {
  if (!ownsPolling(state, directory, owner)) return;
  state.owners.delete(directory);
  for (const timer of state.timers.get(directory)?.values() ?? []) clearTimeout(timer);
  state.timers.get(directory)?.clear();
}

/**
 * Whether this setup should announce resumed watches: only the first setup per directory in a process does, and only
 * when the message differs from the last one sent to that session.
 */
export function shouldAnnounceResume(state: ProcessState, directory: string): boolean {
  if (state.resumed.has(directory)) return false;
  state.resumed.add(directory);
  return true;
}

export const resumeChanged = (lastSent: string | undefined, message: string) => lastSent !== message;

/** Queued messages are "<owner/repo#pr>: <text>"; drops those about a PR that is no longer watched. */
export const dropMessagesFor = (messages: readonly string[], id: string) => messages.filter((m) => !m.startsWith(`${id}: `));
