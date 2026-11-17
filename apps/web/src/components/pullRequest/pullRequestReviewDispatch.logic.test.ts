import { describe, expect, it } from "vite-plus/test";

import { buildReviewPrompt, reviewBranchName } from "./pullRequestReviewDispatch.logic";

describe("buildReviewPrompt", () => {
  it("hands the pull request to the /post-pr-review skill", () => {
    expect(buildReviewPrompt({ repository: "team-plain/services", number: 12833 })).toBe(
      "/post-pr-review team-plain/services#12833",
    );
  });

  it("names the review worktree branch after the repository, number and title", () => {
    expect(
      reviewBranchName({
        repository: "team-plain/support-app",
        number: 7422,
        title: "[ARI-2528] Customer Agent → Show resolutions on the Activity view",
      }),
    ).toBe("review-support-app-7422-ari-2528-customer-agent-show-resolutions");
  });
});
