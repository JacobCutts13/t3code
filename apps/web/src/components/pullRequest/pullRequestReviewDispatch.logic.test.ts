import { describe, expect, it } from "vite-plus/test";

import { buildReviewPrompt } from "./pullRequestReviewDispatch.logic";

describe("buildReviewPrompt", () => {
  it("names the pull request, posts only after confirmation, and forbids writes", () => {
    const prompt = buildReviewPrompt({ repository: "team-plain/services", number: 12833 });
    expect(prompt).toMatch(
      /^This is a read-only code review session for PR #12833 in team-plain\/services\./,
    );
    expect(prompt).toContain('wait for me to type "post"');
    expect(prompt).toContain(
      "gh pr review 12833 --repo team-plain/services --comment --body-file /tmp/pr-review-comment.txt",
    );
    expect(prompt).toMatch(
      /Do NOT edit any source files\. Do NOT commit or push anything\. Read-only review only\.$/,
    );
  });
});
