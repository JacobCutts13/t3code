import type { PullRequestOperationError, ReviewRequestListResult } from "@t3tools/contracts";
import type * as Effect from "effect/Effect";

/** Pull requests across every repository that ask the signed-in account for a review. */
export interface ReviewRequestProviderApi {
  readonly reviewRequests: (input: {
    readonly host: string;
  }) => Effect.Effect<ReviewRequestListResult, PullRequestOperationError>;
}
