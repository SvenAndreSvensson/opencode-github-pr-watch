import { answerShape, readAnswer, type AnswerSpec } from "./answer";
import type { MyPr, MyPrSort } from "./my-prs";

export interface Topic {
  readonly name: string;
  /** PR ids, "owner/repo#number". */
  readonly prs: readonly string[];
}

export const prID = (pr: MyPr) => `${pr.repo}#${pr.number}`;

const OTHER = "Other";

/** Asks the light model to sort the PRs into a few topics by what they change. */
export function topicsPrompt(prs: readonly MyPr[]): string {
  return [
    "Group these pull requests into 3 to 8 topics by what they are about (for example a feature, an area of the system,",
    "security hardening, dependency updates, CI). Use short topic names (1 to 4 words). Put every PR in exactly one topic.",
    `Answer with JSON only: ${answerShape(TOPICS_ANSWER)}`,
    "",
    "Pull requests (id: title):",
    ...prs.map((pr) => `${prID(pr)}: ${pr.title}`),
  ].join("\n");
}

/**
 * The model's topics, checked against the PRs asked about: unknown ids are dropped, a PR in several topics stays in
 * the first, and PRs it left out go to "Other". Throws when the answer isn't the JSON asked for.
 */
export const TOPICS_ANSWER = {
  topics: { kind: "list", item: { name: { kind: "text", hint: "topic", max: 60 }, prs: { kind: "list", item: { kind: "text", hint: "owner/repo#number" } } } },
} as const satisfies AnswerSpec;

export function parseTopics(text: string, prs: readonly MyPr[], onInvalid?: (problem: string) => void): Topic[] {
  const read = readAnswer(TOPICS_ANSWER, text);
  if (!read.ok) {
    onInvalid?.(read.problem);
    throw new Error(`could not read the topics: ${read.problem}`);
  }
  for (const problem of read.problems) onInvalid?.(problem);
  const parsed = read.value as { topics: { name: string; prs: string[] }[] };
  const known = new Set(prs.map(prID));
  const placed = new Set<string>();
  const topics: Topic[] = [];
  for (const topic of parsed.topics) {
    if (typeof topic.name !== "string" || !Array.isArray(topic.prs)) continue;
    const members = topic.prs.filter((id): id is string => typeof id === "string" && known.has(id) && !placed.has(id));
    members.forEach((id) => placed.add(id));
    if (members.length > 0) topics.push({ name: topic.name.trim() || OTHER, prs: members });
  }
  const rest = prs.map(prID).filter((id) => !placed.has(id));
  return rest.length > 0 ? [...topics, { name: OTHER, prs: rest }] : topics;
}

const timeOf = (pr: MyPr) => Date.parse(pr.closedAt ?? pr.createdAt);
const newer = (a: MyPr, b: MyPr) => timeOf(b) - timeOf(a) || b.number - a.number;

/**
 * PRs grouped by topic, in the topics' order, PRs in the chosen order (by name keeps newest first), with the same
 * organisation and draft filters as by repo. PRs the topics don't know (opened since they were made) go to "Other".
 */
export function byTopic(prs: readonly MyPr[], topics: readonly Topic[], organisation?: string, sort: MyPrSort = "name", drafts = true): { name: string; prs: MyPr[] }[] {
  const topicOf = new Map(topics.flatMap((topic) => topic.prs.map((id) => [id, topic.name] as const)));
  const groups = new Map<string, MyPr[]>(topics.map((topic) => [topic.name, []]));
  for (const pr of prs) {
    if (organisation && !pr.repo.startsWith(`${organisation}/`)) continue;
    if (!drafts && pr.draft) continue;
    const name = topicOf.get(prID(pr)) ?? OTHER;
    groups.set(name, [...(groups.get(name) ?? []), pr]);
  }
  return [...groups]
    .filter(([, list]) => list.length > 0)
    .map(([name, list]) => ({ name, prs: [...list].sort((a, b) => (sort === "oldest" ? newer(b, a) : newer(a, b))) }));
}
