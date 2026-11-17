import { PullRequestOperationError } from "@t3tools/contracts";
import type { ReviewRequestProviderApi } from "@t3tools/source-control-core/server/ReviewRequestProvider";
import * as Effect from "effect/Effect";

import * as GitHubPullRequestApi from "./GitHubPullRequestApi.ts";
import { fromGitHubApiError } from "./GitHubSourceControlProvider.ts";

/** Reads review requests as the account GitHub knows the server by. */
export const make = Effect.gen(function* () {
  const pullRequests = yield* GitHubPullRequestApi.GitHubPullRequestApi;

  const reviewRequests: ReviewRequestProviderApi["reviewRequests"] = Effect.fn(
    "GitHubReviewRequestProvider.reviewRequests",
  )(function* (input) {
    const batch = yield* pullRequests.searchReviewRequests({ host: input.host }).pipe(
      Effect.mapError(
        (cause) =>
          new PullRequestOperationError({
            operation: "reviewRequests",
            detail:
              cause._tag === "GitHubPullRequestReadError"
                ? "GitHub sent review requests in a shape this server cannot read."
                : fromGitHubApiError(cause, "GitHub could not search for review requests.").detail,
            cause,
          }),
      ),
    );
    return {
      entries: batch.items.map((item) => ({
        host: input.host,
        repository: item.repository,
        number: item.number,
        title: item.title,
        url: item.url,
        author: item.author,
        isDraft: item.isDraft,
        headBranch: item.headBranch,
        updatedAt: item.updatedAt,
        additions: item.additions,
        deletions: item.deletions,
      })),
      truncated: batch.truncated,
    };
  });

  return { reviewRequests } satisfies ReviewRequestProviderApi;
});
