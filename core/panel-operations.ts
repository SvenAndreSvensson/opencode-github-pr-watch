import { prList, prSessionPrompt, type MyPr } from "./my-prs";
import type { Topic } from "./topics";

/**
 * Everything the pill and the PRs tab do, apart from rendering: each operation calls the app through the port, reports
 * that it is in progress (`track`) and what came of it (`say`). Tested with a fake port; the GUI only wires it up.
 */
export interface PanelPort {
  myPrs(merged: boolean): Promise<LoadedPrs>;
  myPrTopics(sessionID: string, merged: boolean): Promise<readonly Topic[]>;
  watch(sessionID: string, pr: string): Promise<string>;
  unwatch(id: string): Promise<void>;
  /** False when the watches were asked less than 20 seconds ago, and so don't check again. */
  checkNow(): Promise<boolean>;
  setNotify(id: string, notify: "major" | "all"): Promise<void>;
  session(sessionID: string): Promise<{ readonly model: unknown; readonly agent: string | undefined }>;
  createSession(input: { readonly title: string; readonly directory: string; readonly model: unknown; readonly agent: string | undefined }): Promise<string>;
  prompt(sessionID: string, text: string): Promise<void>;
  openSession(server: string, sessionID: string): void;
  copy(text: string): Promise<void>;
}

export interface Feedback {
  /** Shows the text as work in progress until the work settles; returns the work. */
  track<T>(text: string, work: Promise<T>): Promise<T>;
  /** Shows a short result. */
  say(text: string): void;
}

export interface LoadedPrs<R = unknown> {
  readonly open: readonly MyPr[];
  readonly merged?: readonly MyPr[];
  readonly watchedRows: readonly R[];
}

export interface PanelSession {
  readonly id: string;
  readonly directory: string;
  readonly server: { readonly id: string };
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function panelOperations(port: PanelPort, feedback: Feedback) {
  const { track, say } = feedback;
  // An action reports its own failure and returns false, so a click never leaves an unhandled error behind.
  const act = async (work: () => Promise<void>, failure: string): Promise<boolean> => {
    try {
      await work();
      return true;
    } catch (err) {
      say(`${failure}: ${message(err)}`);
      return false;
    }
  };

  return {
    /** Loads throw: the list shows the error where it would have been. */
    loadPrs: (merged: boolean) => track("Loading your PRs…", port.myPrs(merged)),
    loadTopics: (sessionID: string, merged: boolean, hasTopics: boolean) =>
      track(hasTopics ? "Updating the topics…" : "Sorting your PRs into topics…", port.myPrTopics(sessionID, merged)),

    watch: (sessionID: string, pr: MyPr) => {
      const id = `${pr.repo}#${pr.number}`;
      return act(async () => say((await track(`Starting watching ${id}…`, port.watch(sessionID, id))).split(". ")[0]!), `Could not watch ${id}`);
    },
    checkNow: () =>
      act(async () => {
        const checking = await track("Asking every watch to check GitHub…", port.checkNow());
        say(checking ? "Every watch is checking GitHub now." : "The watches checked GitHub less than 20 seconds ago.");
      }, "Could not ask the watches to check"),
    stop: (id: string) =>
      act(async () => {
        await track(`Stopping watching ${id}…`, port.unwatch(id));
        say(`Stopped watching ${id}.`);
      }, `Could not stop watching ${id}`),
    setNotify: (id: string, notify: "major" | "all") =>
      act(async () => {
        await track(notify === "all" ? `Reporting all progress for ${id}…` : `Reporting only changes of step for ${id}…`, port.setNotify(id, notify));
        say(notify === "all" ? `${id}: all progress will be reported.` : `${id}: only changes of step will be reported.`);
      }, `Could not change what ${id} reports`),

    /** A new session about the PR in the open session's folder, with its model and agent, asked to summarise it. */
    startSession: (from: PanelSession, pr: Pick<MyPr, "repo" | "number" | "title" | "url">) =>
      act(
        () =>
          track(
            `Starting a session about ${pr.repo}#${pr.number}…`,
            (async () => {
              const current = await port.session(from.id);
              const id = await port.createSession({ title: `PR #${pr.number} on ${pr.repo}`, directory: from.directory, model: current.model, agent: current.agent });
              await port.prompt(id, prSessionPrompt({ ...pr, draft: false, createdAt: "" }));
              port.openSession(from.server.id, id);
            })(),
          ),
        "Could not start a session",
      ),

    copy: (name: string, prs: readonly MyPr[]) =>
      act(async () => {
        await port.copy(prList(prs));
        say(`Copied ${prs.length} PR${prs.length === 1 ? "" : "s"} from ${name}.`);
      }, "Could not copy"),
  };
}

export type PanelOperations = ReturnType<typeof panelOperations>;

/** A load that didn't ask for the merged list keeps the one shown before, for the next time it is expanded. */
export function keepMerged<R>(before: LoadedPrs<R> | undefined, loaded: LoadedPrs<R>, mergedRequested: boolean): LoadedPrs<R> {
  const merged = mergedRequested ? loaded.merged : before?.merged;
  return { open: loaded.open, watchedRows: loaded.watchedRows, ...(merged ? { merged } : {}) };
}

/** The work in progress, in the order it started; `onChange` gets the texts whenever one starts or settles. */
export function activities(onChange: (texts: string[]) => void) {
  let running: { id: number; text: string }[] = [];
  let next = 0;
  const changed = () => onChange(running.map((a) => a.text));
  return {
    track<T>(text: string, work: Promise<T>): Promise<T> {
      const id = ++next;
      running = [...running, { id, text }];
      changed();
      return work.finally(() => {
        running = running.filter((a) => a.id !== id);
        changed();
      });
    },
  };
}
