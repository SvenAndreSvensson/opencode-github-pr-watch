const REVIEW: Record<string, string> = {
  APPROVED: "yes",
  REVIEW_REQUIRED: "no (review required)",
  CHANGES_REQUESTED: "no (changes requested)",
};

export function approvalLine(reviewDecision: string): string {
  return `approved: ${REVIEW[reviewDecision] ?? "not required"}`;
}

export interface BranchState {
  readonly state: string;
  readonly mergeStateStatus: string;
  readonly baseRefName: string;
}

export function upToDateLine(branch: BranchState): string {
  const base = branch.baseRefName;
  const label = `up to date with ${base}`;
  if (branch.state !== "OPEN") return `${label}: ${branch.state.toLowerCase()}`;
  switch (branch.mergeStateStatus) {
    case "BEHIND":
      return `${label}: no (behind, needs update from ${base})`;
    case "DIRTY":
      return `${label}: no (conflicts with ${base})`;
    case "UNKNOWN":
      return `${label}: unknown (GitHub is still checking)`;
    default:
      return `${label}: yes`;
  }
}
