import {
  type IssueDetail,
  type IssueGetInput,
  type IssueListInput,
  type IssueListResult,
  PullRequestOperationError,
  type ReviewRequestListResult,
} from "@t3tools/contracts";
import type { IssueProviderApi } from "@t3tools/source-control-core/server/IssueProvider";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SourceControlBuiltInDrivers from "../sourceControl/builtInDrivers.ts";

const DEFAULT_HOST = "github.com";

/** Issues of the forge the server is signed in to; GitHub only for now. */
export class IssueService extends Context.Service<
  IssueService,
  {
    readonly list: (
      input: IssueListInput,
    ) => Effect.Effect<IssueListResult, PullRequestOperationError>;
    readonly get: (input: IssueGetInput) => Effect.Effect<IssueDetail, PullRequestOperationError>;
    readonly reviewRequests: () => Effect.Effect<
      ReviewRequestListResult,
      PullRequestOperationError
    >;
  }
>()("t3/issue/IssueService") {}

const make = Effect.gen(function* () {
  const drivers = yield* SourceControlBuiltInDrivers.SourceControlDrivers;
  const github = drivers.find(({ driver }) => driver.kind === "github")?.instance.issues;

  const provider = (
    operation: string,
  ): Effect.Effect<IssueProviderApi, PullRequestOperationError> =>
    github === undefined
      ? Effect.fail(
          new PullRequestOperationError({ operation, detail: "This server cannot read issues." }),
        )
      : Effect.succeed(github);

  return IssueService.of({
    list: Effect.fn("IssueService.list")(function* (input) {
      return yield* (yield* provider("issues.list")).list({
        ...input,
        host: input.host ?? DEFAULT_HOST,
      });
    }),
    get: Effect.fn("IssueService.get")(function* (input) {
      return yield* (yield* provider("issues.get")).get({
        ...input,
        host: input.host ?? DEFAULT_HOST,
      });
    }),
    reviewRequests: Effect.fn("IssueService.reviewRequests")(function* () {
      return yield* (yield* provider("pullRequests.reviewRequests")).reviewRequests({
        host: DEFAULT_HOST,
      });
    }),
  });
});

export const layer = Layer.effect(IssueService, make);
