/** The review session's behaviour (review-only, verify, propose approve or request-changes, post on sign-off) lives in the /review-team-pr skill. */
export function buildReviewPrompt(pr: { readonly repository: string; readonly number: number }) {
  return `/review-team-pr ${pr.repository}#${pr.number}`;
}
