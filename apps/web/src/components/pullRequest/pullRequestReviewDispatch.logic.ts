import { issueSlug } from "~/components/issues/issueDispatch.logic";

/** The review session's behaviour (review-only, verify, approve or comment) lives in the /post-pr-review skill. */
export function buildReviewPrompt(pr: { readonly repository: string; readonly number: number }) {
  return `/post-pr-review ${pr.repository}#${pr.number}`;
}

/** `review-<repo>-<number>-<slug>` (flat: some repos have a `review` branch, which blocks `review/…`): the review thread's worktree branch; the PR's head is checked out inside it. */
export function reviewBranchName(pr: {
  readonly repository: string;
  readonly number: number;
  readonly title: string;
}) {
  const name = pr.repository.slice(pr.repository.lastIndexOf("/") + 1).toLowerCase();
  return `review-${name}-${pr.number}-${issueSlug(pr.title)}`;
}
