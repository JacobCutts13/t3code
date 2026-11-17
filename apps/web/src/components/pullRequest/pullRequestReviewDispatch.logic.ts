/** The review session's behaviour (review-only, verify, approve or comment) lives in the /post-pr-review skill. */
export function buildReviewPrompt(pr: { readonly repository: string; readonly number: number }) {
  return `/post-pr-review ${pr.repository}#${pr.number}`;
}
