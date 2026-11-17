import { allPrs, byRepo, matchesSearch, organisationsOf, runWatches, watchedIn, withWatchedPrs, type MyPr, type MyPrSort } from "./my-prs";
import { byTopic, type Topic } from "./topics";

/**
 * What the PRs tab shows, decided from the loaded data and the user's choices. Pure: the GUI only renders the result,
 * so every rule here is tested without the app.
 */
export type Grouping = "repo" | "topic" | "none";

export interface PrsChoices {
  readonly organisation: string;
  readonly grouping: Grouping;
  readonly sort: MyPrSort;
  readonly drafts: boolean;
  readonly others: boolean;
  readonly sessionOnly: boolean;
  readonly search: string;
}

export interface WatchRowLike {
  readonly id: string;
  readonly label: string;
  readonly url: string;
  readonly sessionID?: string;
}

export interface PrsData<R extends WatchRowLike> {
  readonly open: readonly MyPr[];
  /** Absent until the recently merged list has been loaded. */
  readonly merged?: readonly MyPr[];
  readonly watchedRows: readonly R[];
}

export interface PrGroup {
  readonly name: string;
  readonly kind: "repo" | "topic" | "all";
  readonly prs: readonly MyPr[];
}

export interface PrsView<R extends WatchRowLike> {
  readonly runs: readonly R[];
  readonly open: readonly PrGroup[];
  readonly openEmpty?: string;
  readonly merged?: readonly PrGroup[];
  readonly mergedEmpty?: string;
  readonly organisations: readonly string[];
  /** The sort in effect: by name means nothing for topics, which then go newest first. */
  readonly effectiveSort: MyPrSort;
  readonly sortByNameDisabled: boolean;
  /** Each line names its repo unless the list is grouped by repo. */
  readonly repoOnLine: boolean;
  readonly watchOf: (pr: MyPr) => R | undefined;
}

export function prsView<R extends WatchRowLike>(data: PrsData<R>, choices: PrsChoices, sessionID: string, topics?: readonly Topic[]): PrsView<R> {
  const rows = data.watchedRows;
  // This session's watches only, whoever opened the PR; otherwise my PRs, plus others' watched ones when shown.
  const open = choices.sessionOnly
    ? watchedIn(withWatchedPrs(data.open, rows), rows, sessionID)
    : choices.others ? withWatchedPrs(data.open, rows) : [...data.open];
  const merged = data.merged && (choices.sessionOnly ? watchedIn(data.merged, rows, sessionID) : data.merged);
  const byTopicNow = choices.grouping === "topic" && topics !== undefined;
  const effectiveSort: MyPrSort = choices.grouping === "topic" && choices.sort === "name" ? "newest" : choices.sort;
  const organisation = choices.organisation || undefined;

  const group = (prs: readonly MyPr[]): PrGroup[] => {
    const found = prs.filter((pr) => matchesSearch(pr, choices.search));
    if (choices.grouping === "none") {
      const all = allPrs(found, organisation, choices.sort, choices.drafts);
      return all.length > 0 ? [{ name: "All PRs", kind: "all", prs: all }] : [];
    }
    if (byTopicNow) return byTopic(found, topics!, organisation, effectiveSort, choices.drafts).map((g) => ({ ...g, kind: "topic" as const }));
    return byRepo(found, organisation, choices.sort, choices.drafts).map((g) => ({ name: g.repo, kind: "repo" as const, prs: g.prs }));
  };

  const searching = choices.search.trim() !== "";
  const openGroups = group(open);
  const mergedGroups = merged && group(merged);
  const watched = new Map(rows.map((row) => [row.id, row]));
  return {
    runs: runWatches(rows).filter((row) => !choices.sessionOnly || row.sessionID === sessionID),
    open: openGroups,
    ...(openGroups.length === 0
      ? { openEmpty: searching ? "No open PRs match." : choices.sessionOnly ? "No PRs watched in this session." : "No open PRs." }
      : {}),
    ...(mergedGroups ? { merged: mergedGroups } : {}),
    ...(mergedGroups && mergedGroups.length === 0 ? { mergedEmpty: searching ? "None match." : "None." } : {}),
    organisations: organisationsOf([...open, ...(merged ?? [])]),
    effectiveSort,
    sortByNameDisabled: choices.grouping === "topic",
    repoOnLine: byTopicNow || choices.grouping === "none",
    watchOf: (pr) => watched.get(`${pr.repo}#${pr.number}`),
  };
}

export const CHOICE_KEYS = {
  organisation: "pr-watch.my-prs.organisation",
  grouping: "pr-watch.my-prs.grouping",
  sort: "pr-watch.my-prs.sort",
  drafts: "pr-watch.my-prs.drafts",
  others: "pr-watch.my-prs.others",
  sessionOnly: "pr-watch.my-prs.session-only",
} as const;

const GROUPINGS: readonly Grouping[] = ["repo", "topic", "none"];
const SORTS: readonly MyPrSort[] = ["name", "newest", "oldest"];

/** The stored choices, with defaults for anything missing or unknown. The search is never stored. */
export function readChoices(stored: (key: string) => string | null): PrsChoices {
  const grouping = stored(CHOICE_KEYS.grouping);
  const sort = stored(CHOICE_KEYS.sort);
  return {
    organisation: stored(CHOICE_KEYS.organisation) ?? "",
    grouping: GROUPINGS.find((g) => g === grouping) ?? "repo",
    sort: SORTS.find((s) => s === sort) ?? "name",
    drafts: stored(CHOICE_KEYS.drafts) !== "false",
    others: stored(CHOICE_KEYS.others) !== "false",
    sessionOnly: stored(CHOICE_KEYS.sessionOnly) === "true",
    search: "",
  };
}
