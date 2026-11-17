import { createSignal, For, Index, onCleanup, onMount, Show, type JSX } from "solid-js";
import { createStore } from "solid-js/store";
import { ComposerPill, createKeyed, Panel, Plugin, Style, type ComposerPillTone, type IconName } from "@opencode/plugin/gui";
import { PRS_TAB } from "../core/panel-tab";
import { allPrs, byRepo, matchesSearch, organisationsOf, prList, prSessionPrompt, runWatches, watchedIn, withWatchedPrs, type MyPr, type MyPrSort } from "../core/my-prs";
import { byTopic, type Topic } from "../core/topics";
import { PrWatch } from "../rpc";

interface Row {
  readonly id: string;
  readonly label: string;
  readonly url: string;
  readonly detail: string;
  readonly tone: "pending" | "waiting" | "failed" | "done";
  readonly runUrl?: string;
  readonly waitingFor?: "code-review" | "run-approval";
  readonly runLinks?: readonly { readonly label: string; readonly url: string }[];
  readonly notify?: "major" | "all";
  /** The session watching it, in the panel's list. */
  readonly sessionID?: string;
  readonly sessionTitle?: string;
}

const LOOK: Record<Row["tone"], { icon: IconName; tone?: ComposerPillTone }> = {
  pending: { icon: "status-active" },
  waiting: { icon: "circle-exclamation", tone: "warning" },
  failed: { icon: "circle-x", tone: "danger" },
  done: { icon: "circle-check", tone: "success" },
};

const TITLE = "Watched pull requests";
const ORG_KEY = "pr-watch.my-prs.organisation";
const SORT_KEY = "pr-watch.my-prs.sort";
const DRAFTS_KEY = "pr-watch.my-prs.drafts";
const OTHERS_KEY = "pr-watch.my-prs.others";
const SESSION_ONLY_KEY = "pr-watch.my-prs.session-only";
const GROUPING_KEY = "pr-watch.my-prs.grouping";
type Grouping = "repo" | "topic" | "none";
const GROUPINGS: readonly Grouping[] = ["repo", "topic", "none"];
const SORTS: readonly { value: MyPrSort; label: string }[] = [
  { value: "name", label: "Sort by: Name" },
  { value: "newest", label: "Sort by: Newest PR" },
  { value: "oldest", label: "Sort by: Oldest PR" },
];
const SELECT_STYLE = { flex: "1", "min-width": "0", padding: "4px 6px", "border-radius": "6px", background: "transparent", color: "inherit", border: "1px solid rgba(127,127,127,0.4)" };

const age = (iso: string, now: number) => {
  const days = Math.floor((now - Date.parse(iso)) / 86_400_000);
  return days < 1 ? "today" : days === 1 ? "1 day" : `${days} days`;
};

export default Plugin.define({
  setup(ctx) {
    const [watches, setWatches] = createStore<Record<string, readonly Row[]>>({});

    const load = (sessionID: string) =>
      void ctx.client
        .rpc(PrWatch)
        .list({ sessionID })
        .then((result) => setWatches(sessionID, (result as { watches: Row[] }).watches))
        .catch(() => undefined);

    // Load the routed session's watches, and reload them whenever the server part reports a change in that session.
    createKeyed(
      () => ctx.sessions.current()?.id,
      (sessionID) => {
        load(sessionID);
        const stop = ctx.client.rpc(PrWatch).events.on("changed", (event) => {
          if ((event.data as { sessionID: string }).sessionID === sessionID) load(sessionID);
        });
        // The event can go quiet when the server part reloads, so the list is also refreshed now and then.
        const timer = setInterval(() => load(sessionID), 30_000);
        onCleanup(() => {
          stop();
          clearInterval(timer);
        });
      },
    );

    type PanelSession = { readonly id: string; readonly directory: string; readonly server: { readonly id: string } };
    type PrRef = { readonly repo: string; readonly number: number; readonly title: string; readonly url: string };

    // A new session about a PR, in the given session's folder and with its provider, model and agent, opened with the
    // request to summarise the PR. Throws so the caller can show why it failed.
    const startPrSession = async (from: PanelSession, pr: PrRef) => {
      const current = await ctx.client.session.get({ sessionID: from.id as never });
      const session = await ctx.client.session.create({
        title: `PR #${pr.number} on ${pr.repo}`,
        location: { directory: from.directory as never },
        model: current.model,
        agent: current.agent,
      });
      await ctx.client.session.prompt({ sessionID: session.id, text: prSessionPrompt({ ...pr, draft: false, createdAt: "" }) });
      ctx.tabs.open({ server: from.server.id, id: session.id }, { focus: true });
    };

    // The one line every list shows for a PR: its watch status icon (when watched), text, then the buttons. Those that
    // only sometimes show (the run or runs) come first, so the ones always there (watch or stop, new session, the PR on
    // GitHub) stay in the same columns down the list.
    const PrLineView = (line: {
      readonly text: JSX.Element;
      readonly detail: string;
      readonly url: string;
      readonly row?: Row;
      readonly onWatch?: () => void;
      readonly onStop?: () => void;
      readonly onNewSession?: () => void;
      /** Opens the session watching the PR. */
      readonly onOpenSession?: () => void;
    }): JSX.Element => {
      const runLinks = () => line.row?.runLinks ?? (line.row?.runUrl ? [{ label: "Open the run", url: line.row.runUrl }] : []);
      return (
        <div style={{ display: "flex", "align-items": "center", gap: "8px", "min-width": "0" }}>
          {/* Every line has an icon here so the titles line up: the watch's state, or a dimmed ? when not watched. */}
          <Show
            when={line.row}
            fallback={
              <span title="Not watched" style={{ display: "inline-flex", opacity: "0.4" }}>
                <ctx.ui.Icon name="help" size="small" />
              </span>
            }
          >
            {(row) => <ctx.ui.Icon name={LOOK[row().tone].icon} size="small" />}
          </Show>
          <div style={{ flex: "1", "min-width": "0" }}>
            <div style={{ "overflow-wrap": "anywhere" }}>{line.text}</div>
            <div style={{ opacity: "0.6", "font-size": "12px" }}>{line.detail}</div>
          </div>
          <Show when={line.onOpenSession}>
            {(open) => <ctx.ui.IconButton icon="speech-bubble" label={`Open the watching session: ${line.row?.sessionTitle ?? ""}`} size="small" onClick={() => open()()} />}
          </Show>
          <Show when={line.row}>
            {(row) => {
              const all = () => row().notify === "all";
              return (
                // The bell: full when every bit of progress is reported, dimmed when only changes of step are.
                <span style={{ display: "inline-flex", opacity: all() ? "1" : "0.45" }}>
                  <ctx.ui.IconButton
                    icon="notifications"
                    label={all() ? "Reporting all progress; click to report only changes of step" : "Reporting changes of step; click to report all progress"}
                    size="small"
                    onClick={() => setNotify(row().id, all() ? "major" : "all")}
                  />
                </span>
              );
            }}
          </Show>
          <For each={runLinks()}>
            {(link) => (
              // A gear for the build or deploy run; it turns while the run is still going.
              <span class={line.row?.tone === "pending" && !line.row.runLinks ? "pr-watch-spinning" : undefined} style={{ display: "inline-flex" }}>
                <ctx.ui.IconButton icon="settings-gear" label={link.label} size="small" onClick={() => ctx.system.openExternal(link.url)} />
              </span>
            )}
          </For>
          <Show when={line.onStop}>{(stop) => <ctx.ui.IconButton icon="outline-eye-slash" label="Stop watching" size="small" onClick={() => stop()()} />}</Show>
          <Show when={!line.onStop && line.onWatch}>{(watch) => <ctx.ui.IconButton icon="eye" label="Watch in this session" size="small" onClick={() => watch()()} />}</Show>
          <Show when={line.onNewSession}>
            {(start) => <ctx.ui.IconButton icon="new-session" label="New session about this PR" size="small" onClick={() => start()()} />}
          </Show>
          <ctx.ui.IconButton icon="github" label="Open the PR" size="small" onClick={() => ctx.system.openExternal(line.url)} />
        </div>
      );
    };

    // A watch in the pill and the PR watches tab. Run watches (no PR) get no new-session button.
    const prOfRow = (row: Row): PrRef | undefined => {
      const match = row.id.match(/^(.+)#(\d+)$/);
      return match ? { repo: match[1]!, number: Number(match[2]), title: row.label.slice(row.id.length + 1), url: row.url } : undefined;
    };
    const WatchLine = (props: { readonly row: Row; readonly session: PanelSession; readonly onError: (text: string) => void }): JSX.Element => {
      // Read live: rows are reused by position when the list reloads.
      const pr = () => prOfRow(props.row);
      return (
        <PrLineView
          text={props.row.label}
          detail={props.row.detail}
          url={props.row.url}
          row={props.row}
          onStop={() => stopWatching(props.row.id)}
          onNewSession={
            pr()
              ? () => void startPrSession(props.session, pr()!).catch((err: unknown) => props.onError(`Could not start a session: ${err instanceof Error ? err.message : String(err)}`))
              : undefined
          }
        />
      );
    };

    // Work in progress, shown together on the PRs tab's top line with one spinner, and the latest result after it.
    const [activities, setActivities] = createSignal<readonly { readonly id: number; readonly text: string }[]>([]);
    let activitySeq = 0;
    const track = <T,>(text: string, work: Promise<T>): Promise<T> => {
      const id = ++activitySeq;
      setActivities((now) => [...now, { id, text }]);
      return work.finally(() => setActivities((now) => now.filter((a) => a.id !== id)));
    };
    const [status, setStatus] = createSignal<string>();
    const say = (text: string) => {
      setStatus(text);
      setTimeout(() => setStatus((now) => (now === text ? undefined : now)), 6_000);
    };
    const failed = (what: string) => (err: unknown) => say(`${what}: ${err instanceof Error ? err.message : String(err)}`);

    const setNotify = (id: string, notify: "major" | "all") =>
      void track(notify === "all" ? `Reporting all progress for ${id}…` : `Reporting only changes of step for ${id}…`, ctx.client.rpc(PrWatch).setNotify({ id, notify }))
        .then(() => {
          say(notify === "all" ? `${id}: all progress will be reported.` : `${id}: only changes of step will be reported.`);
          const sessionID = ctx.sessions.current()?.id;
          if (sessionID) load(sessionID);
          loadMyPrs();
        })
        .catch(failed(`Could not change what ${id} reports`));

    const stopWatching = (id: string) =>
      void track(`Stopping watching ${id}…`, ctx.client.rpc(PrWatch).unwatch({ id }))
        .then(() => {
          say(`Stopped watching ${id}.`);
          const sessionID = ctx.sessions.current()?.id;
          if (sessionID) load(sessionID);
          loadMyPrs();
        })
        .catch((err: unknown) => setMyPrsError(err instanceof Error ? err.message : String(err)));

    // The loaded PR lists live here, not in the view, so switching tabs or sessions shows the last list at once and a
    // reload replaces it only when the new one has arrived.
    const [myPrs, setMyPrs] = createSignal<{ open: readonly MyPr[]; merged?: readonly MyPr[]; watched: readonly string[]; watchedRows: readonly Row[] }>();
    const [myPrsError, setMyPrsError] = createSignal<string>();
    const [myPrsLoading, setMyPrsLoading] = createSignal(0);
    const [showMerged, setShowMerged] = createSignal(false);
    const loadMyPrs = () => {
      const merged = showMerged();
      setMyPrsLoading((n) => n + 1);
      void track("Loading your PRs…", ctx.client.rpc(PrWatch).myPrs({ merged }))
        .then((result) => {
          const loaded = result as { open: MyPr[]; merged: MyPr[]; watched: string[]; watchedRows: Row[] };
          // Without the merged list requested, the one shown before is kept for the next time it's expanded.
          setMyPrs((before) => ({ open: loaded.open, watched: loaded.watched, watchedRows: loaded.watchedRows, ...(merged ? { merged: loaded.merged } : before?.merged ? { merged: before.merged } : {}) }));
          setMyPrsError(undefined);
        })
        .catch((err: unknown) => setMyPrsError(err instanceof Error ? err.message : String(err)))
        .finally(() => setMyPrsLoading((n) => n - 1));
    };

    // Topics come from a light model on the server, for the PRs listed; like the lists they stay while new ones load.
    // Kept across tab and session switches, but not stored: a search is for now.
    const [search, setSearch] = createSignal("");
    const [grouping, setGrouping] = createSignal<Grouping>(GROUPINGS.find((g) => g === localStorage.getItem(GROUPING_KEY)) ?? "repo");
    const [topics, setTopics] = createSignal<readonly Topic[]>();
    const [topicsError, setTopicsError] = createSignal<string>();
    const loadTopics = (sessionID: string) => {
      if (grouping() !== "topic") return;
      setMyPrsLoading((n) => n + 1);
      void track(topics() ? "Updating the topics…" : "Sorting your PRs into topics…", ctx.client.rpc(PrWatch).myPrTopics({ sessionID, merged: showMerged() }))
        .then((result) => {
          setTopics((result as { topics: Topic[] }).topics);
          setTopicsError(undefined);
        })
        .catch((err: unknown) => setTopicsError(err instanceof Error ? err.message : String(err)))
        .finally(() => setMyPrsLoading((n) => n - 1));
    };

    // The gh user's open PRs, grouped by repo or topic, for the organisation picked in the dropdown, and on request the
    // PRs merged in the last 7 days.
    const MyPrsView = (props: { readonly session: { readonly id: string; readonly directory: string; readonly server: { readonly id: string } } }): JSX.Element => {
      const data = myPrs;
      const error = myPrsError;
      const load = () => {
        loadMyPrs();
        loadTopics(props.session.id);
      };
      const pickGrouping = (value: Grouping) => {
        setGrouping(value);
        localStorage.setItem(GROUPING_KEY, value);
        loadTopics(props.session.id);
      };
      const [organisation, setOrganisation] = createSignal(localStorage.getItem(ORG_KEY) ?? "");
      const storedSort = localStorage.getItem(SORT_KEY);
      const [sort, setSort] = createSignal<MyPrSort>(SORTS.some((s) => s.value === storedSort) ? (storedSort as MyPrSort) : "name");
      onMount(() => {
        load();
        const stop = ctx.client.rpc(PrWatch).events.on("changed", () => load());
        const timer = setInterval(load, 3 * 60_000);
        onCleanup(() => {
          stop();
          clearInterval(timer);
        });
      });
      const pick = (value: string) => {
        setOrganisation(value);
        localStorage.setItem(ORG_KEY, value);
      };
      const watch = (pr: MyPr) => {
        const id = `${pr.repo}#${pr.number}`;
        void track(`Starting watching ${id}…`, ctx.client.rpc(PrWatch).watch({ sessionID: props.session.id, pr: id }))
          .then((result) => {
            say((result as { message: string }).message.split(". ")[0]!);
            load();
          })
          .catch(failed(`Could not watch ${id}`));
      };
      const organisations = () => organisationsOf([...openPrs(), ...(data()?.merged ?? [])]);
      const [drafts, setDrafts] = createSignal(localStorage.getItem(DRAFTS_KEY) !== "false");
      const [others, setOthers] = createSignal(localStorage.getItem(OTHERS_KEY) !== "false");
      const pickOthers = (value: boolean) => {
        setOthers(value);
        localStorage.setItem(OTHERS_KEY, String(value));
      };
      // My open PRs, plus the watched PRs I didn't open when those are shown.
      const [sessionOnly, setSessionOnly] = createSignal(localStorage.getItem(SESSION_ONLY_KEY) === "true");
      const pickSessionOnly = (value: boolean) => {
        setSessionOnly(value);
        localStorage.setItem(SESSION_ONLY_KEY, String(value));
      };
      const rows = () => data()?.watchedRows ?? [];
      // This session's watches only, whoever opened the PR; otherwise my PRs, plus others' watched ones when shown.
      const openPrs = () =>
        sessionOnly()
          ? watchedIn(withWatchedPrs(data()?.open ?? [], rows()), rows(), props.session.id)
          : others() ? withWatchedPrs(data()?.open ?? [], rows()) : (data()?.open ?? []);
      const mergedPrs = (merged: readonly MyPr[]) => (sessionOnly() ? watchedIn(merged, rows(), props.session.id) : merged);
      const runs = () => runWatches(rows()).filter((row) => !sessionOnly() || row.sessionID === props.session.id);
      const openSession = (row: Row) => () => ctx.tabs.open({ server: props.session.server.id, id: row.sessionID! }, { focus: true });
      const pickDrafts = (value: boolean) => {
        setDrafts(value);
        localStorage.setItem(DRAFTS_KEY, String(value));
      };
      const shown = (prs: readonly MyPr[]) => byRepo(prs, organisation() || undefined, sort(), drafts());
      const pickSort = (value: MyPrSort) => {
        setSort(value);
        localStorage.setItem(SORT_KEY, value);
      };

      const PrLine = (line: { readonly pr: MyPr; readonly merged: boolean }): JSX.Element => {
        // Read live: rows are reused by position when the list reloads, so a line can show another PR next time.
        const id = () => `${line.pr.repo}#${line.pr.number}`;
        // The watch's own row, from whichever session watches the PR: its status, icon and run links.
        const row = () => data()?.watchedRows?.find((r) => r.id === id());
        // Watched PRs that aren't mine come from the watch, without an opening date.
        const age_ = () =>
          line.merged && line.pr.closedAt
            ? `merged ${age(line.pr.closedAt, Date.now())} ago`
            : line.pr.createdAt ? `${line.pr.draft ? "draft · " : ""}open ${age(line.pr.createdAt, Date.now())}` : "";
        return (
          <PrLineView
            text={
              <>
                <Show when={repoOnLine()}>
                  <span style={{ opacity: "0.6" }}>{line.pr.repo.slice(line.pr.repo.indexOf("/") + 1)} </span>
                </Show>
                #{line.pr.number} {line.pr.title}
              </>
            }
            detail={[row()?.detail, age_()].filter(Boolean).join(" · ")}
            url={line.pr.url}
            row={row()}
            onStop={row() ? () => stopWatching(id()) : undefined}
            onWatch={!row() && !line.merged ? () => watch(line.pr) : undefined}
            onOpenSession={row()?.sessionID ? openSession(row()!) : undefined}
            onNewSession={() =>
              void track(`Starting a session about ${line.pr.repo}#${line.pr.number}…`, startPrSession(props.session, line.pr)).catch(failed("Could not start a session"))
            }
          />
        );
      };

      // Without topics yet (or when they failed), the list stays grouped by repo.
      const byTopicNow = () => grouping() === "topic" && topics() !== undefined;
      // Each line names its repo unless the list is grouped by repo.
      const repoOnLine = () => byTopicNow() || grouping() === "none";
      // Sorting repos by name means nothing for topics; there it falls back to newest first, without changing the choice.
      const effectiveSort = (): MyPrSort => (grouping() === "topic" && sort() === "name" ? "newest" : sort());
      const searched = (prs: readonly MyPr[]) => prs.filter((pr) => matchesSearch(pr, search()));
      const grouped = (prs: readonly MyPr[]) =>
        grouping() === "none"
          ? [{ name: "All PRs", prs: allPrs(prs, organisation() || undefined, sort(), drafts()), kind: "all" as const }].filter((g) => g.prs.length > 0)
          : byTopicNow()
            ? byTopic(prs, topics()!, organisation() || undefined, effectiveSort(), drafts()).map((g) => ({ ...g, kind: "topic" as const }))
            : shown(prs).map((g) => ({ name: g.repo, prs: g.prs, kind: "repo" as const }));
      const Groups = (groups: { readonly prs: readonly MyPr[]; readonly merged: boolean }): JSX.Element => (
        <Index each={grouped(searched(groups.prs))}>
          {(group, index) => {
            const slash = () => (group().kind === "repo" ? group().name.indexOf("/") : -1);
            return (
              <section
                style={{
                  display: "flex", "flex-direction": "column", gap: "6px",
                  ...(index > 0 ? { "border-top": "1px solid rgba(127,127,127,0.2)", "padding-top": "12px" } : {}),
                }}
              >
                <div style={{ display: "flex", "align-items": "center", gap: "6px", "min-width": "0" }}>
                  <ctx.ui.Icon name={group().kind === "repo" ? "folder" : group().kind === "topic" ? "bullet-list" : "checklist"} size="small" />
                  <div style={{ flex: "1", "min-width": "0", "overflow-wrap": "anywhere" }}>
                    <span style={{ opacity: "0.6" }}>{group().name.slice(0, slash() + 1)}</span>
                    <span style={{ "font-weight": "600" }}>{group().name.slice(slash() + 1)}</span>
                  </div>
                  <span style={{ opacity: "0.6", "font-size": "12px" }}>{group().prs.length}</span>
                  <ctx.ui.IconButton
                    icon="copy"
                    label={`Copy these ${group().prs.length} PRs as a list`}
                    size="small"
                    onClick={() =>
                      void ctx.system
                        .copy(prList(group().prs))
                        .then(() => say(`Copied ${group().prs.length} PR${group().prs.length === 1 ? "" : "s"} from ${group().name}.`))
                        .catch(failed("Could not copy"))
                    }
                  />
                </div>
                <div style={{ display: "flex", "flex-direction": "column", gap: "6px", "padding-left": "22px" }}>
                  <Index each={group().prs}>{(pr) => <PrLine pr={pr()} merged={groups.merged} />}</Index>
                </div>
              </section>
            );
          }}
        </Index>
      );

      return (
        <div style={{ display: "flex", "flex-direction": "column", gap: "16px", padding: "12px", height: "100%", "overflow-y": "auto", "box-sizing": "border-box", "justify-content": "flex-start", "align-content": "flex-start" }}>
          {/* The top line: everything in progress with one spinner, else the latest result. Fixed height, so the list doesn't jump. */}
          <div role="status" style={{ display: "flex", "align-items": "center", gap: "8px", "font-size": "12px", "min-height": "18px", opacity: "0.85" }}>
            <Show when={activities().length > 0} fallback={<span>{status() ?? ""}</span>}>
              <span class="pr-watch-spinning" style={{ display: "inline-flex" }}>
                <ctx.ui.Icon name="refresh" size="small" />
              </span>
              <span style={{ "min-width": "0", "overflow-wrap": "anywhere" }}>{activities().map((a) => a.text).join(" · ")}</span>
            </Show>
          </div>
          <input
            type="search"
            placeholder="Search title, repo or #number"
            aria-label="Search your PRs"
            value={search()}
            onInput={(event) => setSearch(event.currentTarget.value)}
            // A fixed height: the host's input styles otherwise let it fill the panel's height.
            style={{ ...SELECT_STYLE, flex: "0 0 auto", width: "100%", height: "32px", "min-height": "32px", "max-height": "32px", "box-sizing": "border-box", padding: "0 8px" }}
          />
          <div style={{ display: "flex", "align-items": "center", gap: "8px", "margin-top": "-8px" }}>
            <select
              aria-label="Organisation"
              value={organisation()}
              onChange={(event) => pick(event.currentTarget.value)}
              style={SELECT_STYLE}
            >
              <option value="">Org: All</option>
              <For each={organisations()}>{(org) => <option value={org}>Org: {org}</option>}</For>
            </select>
            <select aria-label="Group by" value={grouping()} onChange={(event) => pickGrouping(event.currentTarget.value as Grouping)} style={SELECT_STYLE}>
              <option value="repo">Group by: Repo</option>
              <option value="topic">Group by: Topic</option>
              <option value="none">Group by: None</option>
            </select>
            <select aria-label="Sort" value={effectiveSort()} onChange={(event) => pickSort(event.currentTarget.value as MyPrSort)} style={SELECT_STYLE}>
              <For each={SORTS}>
                {(option) => (
                  <option value={option.value} disabled={option.value === "name" && grouping() === "topic"}>
                    {option.label}
                  </option>
                )}
              </For>
            </select>
            <ctx.ui.IconButton
              icon="refresh"
              label="Reload"
              size="small"
              onClick={() => {
                if (myPrsLoading() === 0) load();
              }}
            />
          </div>
          <div style={{ display: "flex", "align-items": "center", gap: "16px", "flex-wrap": "wrap", "font-size": "12px", opacity: "0.85", "margin-top": "-8px" }}>
            <label style={{ display: "flex", "align-items": "center", gap: "6px", cursor: "pointer" }}>
              <input type="checkbox" checked={drafts()} onChange={(event) => pickDrafts(event.currentTarget.checked)} />
              Show drafts
            </label>
            <label style={{ display: "flex", "align-items": "center", gap: "6px", cursor: "pointer" }} title="Watched PRs opened by others, such as bots or colleagues">
              <input type="checkbox" checked={others()} onChange={(event) => pickOthers(event.currentTarget.checked)} />
              Show PRs that aren't mine
            </label>
            <label style={{ display: "flex", "align-items": "center", gap: "6px", cursor: "pointer" }} title="Only the PRs and runs this session watches">
              <input type="checkbox" checked={sessionOnly()} onChange={(event) => pickSessionOnly(event.currentTarget.checked)} />
              Current session only
            </label>
          </div>
          <Show when={error()}>{(text) => <div style={{ color: "var(--text-danger, #c33)" }}>Could not load your PRs: {text()}</div>}</Show>
          <Show when={grouping() === "topic" && topicsError()}>
            {(text) => <div style={{ opacity: "0.8", "font-size": "12px" }}>Grouped by repo: {text()}</div>}
          </Show>
          <Show when={data()} fallback={<div style={{ opacity: "0.6" }}>Loading…</div>}>
            {(loaded) => (
              <>
                <Show when={runs().length > 0}>
                  <section style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
                    <div style={{ display: "flex", "align-items": "center", gap: "6px" }}>
                      <ctx.ui.Icon name="settings-gear" size="small" />
                      <span style={{ "font-weight": "600", flex: "1" }}>Workflow runs</span>
                      <span style={{ opacity: "0.6", "font-size": "12px" }}>{runs().length}</span>
                    </div>
                    <div style={{ display: "flex", "flex-direction": "column", gap: "6px", "padding-left": "22px" }}>
                      <Index each={runs()}>
                        {(row) => (
                          <PrLineView
                            text={row().label}
                            detail={row().detail}
                            url={row().url}
                            row={row()}
                            onStop={() => stopWatching(row().id)}
                            onOpenSession={row().sessionID ? openSession(row()) : undefined}
                          />
                        )}
                      </Index>
                    </div>
                  </section>
                </Show>
                <Show
                  when={shown(searched(openPrs())).length > 0}
                  fallback={<div style={{ opacity: "0.6" }}>{search().trim() ? "No open PRs match." : sessionOnly() ? "No PRs watched in this session." : "No open PRs."}</div>}
                >
                  <Groups prs={openPrs()} merged={false} />
                </Show>
                <button
                  type="button"
                  onClick={() => {
                    setShowMerged(!showMerged());
                    load();
                  }}
                  style={{
                    all: "unset", cursor: "pointer", "font-weight": "600", "margin-top": "12px", "padding-top": "16px",
                    "border-top": "1px solid rgba(127,127,127,0.35)", "text-transform": "uppercase", "font-size": "11px",
                    "letter-spacing": "0.06em", opacity: "0.75",
                  }}
                >
                  {showMerged() ? "▾" : "▸"} Recently merged (7 days)
                </button>
                <Show when={showMerged()}>
                  <Show when={loaded().merged} fallback={<div style={{ opacity: "0.6" }}>Loading…</div>}>
                    {(merged) => (
                      <Show when={shown(searched(mergedPrs(merged()))).length > 0} fallback={<div style={{ opacity: "0.6" }}>{search().trim() ? "None match." : "None."}</div>}>
                        <Groups prs={mergedPrs(merged())} merged />
                      </Show>
                    )}
                  </Show>
                </Show>
              </>
            )}
          </Show>
        </div>
      );
    };

    ctx.add(Panel, {
      id: "watches",
      region: "side",
      list: () => [PRS_TAB],
      render: (props) => <MyPrsView session={props.session} />,
    });

    // The host gives plugin pill popovers a fixed 320px (w-80) and has no width option. This widens only ours, matched
    // by its heading; the selector is host markup, not API, so if it changes the popover just falls back to 320px.
    ctx.add(Style, `@keyframes pr-watch-spin { to { transform: rotate(360deg); } } .pr-watch-spinning svg { animation: pr-watch-spin 0.9s linear infinite; }`);
    ctx.add(Style, `[data-slot="session-plugin-pill-popover"][aria-label="${TITLE}"] { width: min(720px, calc(100vw - 56px)); }`);

    ctx.add(ComposerPill, {
      id: "watches",
      show: (input) => {
        const rows = watches[input.session.id] ?? [];
        if (rows.length === 0) return undefined;
        const worst = rows.some((r) => r.tone === "failed") ? "failed" : rows.some((r) => r.tone === "waiting") ? "waiting" : "pending";
        return {
          icon: "github",
          label: `${rows.length} PR${rows.length === 1 ? "" : "s"} watched`,
          ...(LOOK[worst].tone ? { tone: LOOK[worst].tone } : {}),
          title: TITLE,
        };
      },
      // One line per PR: where it is, with buttons that open the PR and the run it's waiting on in the browser.
      menu: (input) => (
        <div style={{ display: "flex", "flex-direction": "column", gap: "6px", padding: "4px 0", width: "100%", "box-sizing": "border-box", "max-height": "min(480px, 60vh)", "overflow-y": "auto", "padding-right": "4px" }}>
          <Index each={watches[input.session.id] ?? []}>{(row) => <WatchLine row={row()} session={input.session} onError={() => undefined} />}</Index>
        </div>
      ),
    });
  },
});
