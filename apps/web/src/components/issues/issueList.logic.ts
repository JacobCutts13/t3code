import type { IssueSummary, LinearIssueSummary } from "@t3tools/contracts";

/**
 * Pages of one list as a single list, newest update first. A merged list (assigned and opened by
 * you) pages each relationship separately, so the same issue can arrive on two pages.
 */
export function mergeIssuePages(
  pages: ReadonlyArray<ReadonlyArray<IssueSummary>>,
): ReadonlyArray<IssueSummary> {
  const unique = new Map(pages.flat().map((issue) => [issue.url, issue] as const));
  return [...unique.values()].toSorted((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

export type IssueEntry =
  | { readonly source: "github"; readonly key: string; readonly issue: IssueSummary }
  | { readonly source: "linear"; readonly key: string; readonly issue: LinearIssueSummary };

/** GitHub and Linear issues as one list, newest update first. */
export function mergeIssueSources(
  github: ReadonlyArray<IssueSummary>,
  linear: ReadonlyArray<LinearIssueSummary>,
): ReadonlyArray<IssueEntry> {
  return [
    ...github.map((issue): IssueEntry => ({
      source: "github",
      key: `${issue.host}/${issue.repository}#${issue.number}`,
      issue,
    })),
    ...linear.map((issue): IssueEntry => ({ source: "linear", key: `linear:${issue.id}`, issue })),
  ].toSorted((left, right) => right.issue.updatedAt.localeCompare(left.issue.updatedAt));
}
