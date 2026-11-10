import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import * as Persistence from "../platform/persistence.ts";
import { createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createIssueEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | Persistence.EnvironmentCacheStore | R, E>,
) {
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:issues:list",
      tag: WS_METHODS.issuesList,
      staleTimeMs: 30_000,
    }),
    get: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:issues:get",
      tag: WS_METHODS.issuesGet,
      staleTimeMs: 30_000,
    }),
  };
}
