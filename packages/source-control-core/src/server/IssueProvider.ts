import type {
  IssueDetail,
  IssueGetInput,
  IssueListInput,
  IssueListResult,
  PullRequestOperationError,
} from "@t3tools/contracts";
import type * as Effect from "effect/Effect";

/** A forge's issues, read as the account the server is signed in as. */
export interface IssueProviderApi {
  readonly list: (
    input: IssueListInput & { readonly host: string },
  ) => Effect.Effect<IssueListResult, PullRequestOperationError>;
  readonly get: (
    input: IssueGetInput & { readonly host: string },
  ) => Effect.Effect<IssueDetail, PullRequestOperationError>;
}
