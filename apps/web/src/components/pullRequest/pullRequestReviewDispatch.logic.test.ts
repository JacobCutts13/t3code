import { describe, expect, it } from "vite-plus/test";

import { buildReviewPrompt } from "./pullRequestReviewDispatch.logic";

describe("buildReviewPrompt", () => {
  it("hands the pull request to the /post-pr-review skill", () => {
    expect(buildReviewPrompt({ repository: "team-plain/services", number: 12833 })).toBe(
      "/post-pr-review team-plain/services#12833",
    );
  });
});
