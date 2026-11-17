/** Cockpit's read-only review session: team review, then auto-post the verified findings as a comment. */
export function buildReviewPrompt(pr: { readonly repository: string; readonly number: number }) {
  const { repository: repo, number } = pr;
  return (
    `This is a read-only code review session for PR #${number} in ${repo}.\n\n` +
    `Run /review-team to collect a full multi-persona code review of this branch.\n\n` +
    // oxlint-disable-next-line t3code/no-em-dash-copy -- cockpit's prompt verbatim; agent-facing, not product copy.
    `After the review completes, compose the GitHub comment body as an agent prompt — not a human summary. ` +
    `Structure it exactly as follows:\n\n` +
    // oxlint-disable-next-line t3code/no-em-dash-copy -- cockpit's prompt verbatim; agent-facing, not product copy.
    `1. A brief one-line intro: "Team review findings for #${number} — paste the block below into your Claude session to address them."\n\n` +
    `2. A fenced code block (triple backticks, no language tag) containing the agent prompt verbatim:\n` +
    `   - Opening instruction: "For each critical and major finding below, in severity order: ` +
    // oxlint-disable-next-line t3code/no-em-dash-copy -- cockpit's prompt verbatim; agent-facing, not product copy.
    `(1) verify it is present in the code at the cited file:line — if it is a false positive, drop it; ` +
    `(2) apply obvious mechanical fixes directly; ` +
    `(3) escalate non-obvious findings with file:line, the finding, why it is non-obvious, and 1–2 candidate approaches. ` +
    `Print an action report when done."\n` +
    `   - Every critical and major finding that survived /review-team's verification (its action report, not the pre-verification summary), each with: file:line, severity, issue, its Example: walkthrough, suggested fix.\n` +
    `   - The "What to verify" checklist, limited to those findings.\n\n` +
    `Print the full comment body labelled "REVIEW COMMENT:", then post it without waiting for confirmation: use the Write tool to write the body to /tmp/pr-review-comment.txt and submit with:\n` +
    `  gh pr review ${number} --repo ${repo} --comment --body-file /tmp/pr-review-comment.txt\n\n` +
    `If no critical or major finding survived verification, skip the comment: /review-team's approval already records the result.\n\n` +
    `IMPORTANT: Do NOT edit any source files. Do NOT commit or push anything. Read-only review only.`
  );
}
