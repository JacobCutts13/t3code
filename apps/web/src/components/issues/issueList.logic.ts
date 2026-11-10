import type { IssueSummary } from "@t3tools/contracts";

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
