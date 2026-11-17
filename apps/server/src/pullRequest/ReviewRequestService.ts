import { PullRequestOperationError, type ReviewRequestListResult } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SourceControlBuiltInDrivers from "../sourceControl/builtInDrivers.ts";

const DEFAULT_HOST = "github.com";

/** Pull requests that ask the signed-in GitHub account for a review, from every repository. */
export class ReviewRequestService extends Context.Service<
  ReviewRequestService,
  {
    readonly list: () => Effect.Effect<ReviewRequestListResult, PullRequestOperationError>;
  }
>()("t3/pullRequest/ReviewRequestService") {}

const make = Effect.gen(function* () {
  const drivers = yield* SourceControlBuiltInDrivers.SourceControlDrivers;
  const github = drivers.find(({ driver }) => driver.kind === "github")?.instance.reviewRequests;

  return ReviewRequestService.of({
    list: Effect.fn("ReviewRequestService.list")(function* () {
      if (github === undefined) {
        return yield* new PullRequestOperationError({
          operation: "pullRequests.reviewRequests",
          detail: "This server cannot read review requests.",
        });
      }
      return yield* github.reviewRequests({ host: DEFAULT_HOST });
    }),
  });
});

export const layer = Layer.effect(ReviewRequestService, make);
