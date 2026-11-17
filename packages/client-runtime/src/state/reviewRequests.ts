import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import * as Persistence from "../platform/persistence.ts";
import { createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createReviewRequestEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | Persistence.EnvironmentCacheStore | R, E>,
) {
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:pull-requests:review-requests",
      tag: WS_METHODS.pullRequestsReviewRequests,
      staleTimeMs: 30_000,
    }),
  };
}
