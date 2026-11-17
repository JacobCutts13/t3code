import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as GitHubPullRequestApi from "./GitHubPullRequestApi.ts";
import * as GitHubRequestPolicy from "./GitHubRequestPolicy.ts";
import * as GitHubReviewRequestProvider from "./GitHubReviewRequestProvider.ts";

const provider = (pullRequests: Partial<GitHubPullRequestApi.GitHubPullRequestApi["Service"]>) => ({
  make: GitHubReviewRequestProvider.make.pipe(
    Effect.provide(Layer.mock(GitHubPullRequestApi.GitHubPullRequestApi)(pullRequests)),
  ),
});

it.effect("lists review requests from the search, and explains a refused credential", () =>
  Effect.gen(function* () {
    const author = { login: "ada", name: null, avatarUrl: null };
    const found = provider({
      searchReviewRequests: () =>
        Effect.succeed({
          items: [
            {
              number: 7,
              title: "Bump undici",
              url: "https://github.com/acme/api/pull/7",
              author,
              headBranch: "bump-undici",
              baseBranch: "main",
              state: "open",
              isDraft: true,
              mergeability: "mergeable",
              reviewDecision: null,
              additions: 12,
              deletions: 3,
              createdAt: "2026-01-01T00:00:00Z",
              updatedAt: "2026-01-02T00:00:00Z",
              reviewRequestLogins: [],
              hasTeamReviewRequest: true,
              labels: [],
              checksState: null,
              repository: "acme/api",
            },
          ],
          truncated: true,
        }),
    });
    const listed = yield* (yield* found.make).reviewRequests({ host: "github.com" });
    assert.deepStrictEqual(listed, {
      entries: [
        {
          host: "github.com",
          repository: "acme/api",
          number: 7,
          title: "Bump undici",
          url: "https://github.com/acme/api/pull/7",
          author,
          isDraft: true,
          headBranch: "bump-undici",
          updatedAt: "2026-01-02T00:00:00Z",
          additions: 12,
          deletions: 3,
        },
      ],
      truncated: true,
    });

    const refused = provider({
      searchReviewRequests: () =>
        Effect.fail(
          new GitHubRequestPolicy.GitHubApiAuthenticationError({
            host: "github.com",
            operation: "searchReviewRequests",
          }),
        ),
    });
    const failure = yield* Effect.flip(
      (yield* refused.make).reviewRequests({ host: "github.com" }),
    );
    assert.strictEqual(failure.operation, "reviewRequests");
    assert.include(failure.detail, "gh auth login");
  }),
);
