import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import * as Persistence from "../platform/persistence.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

const ISSUE_STALE_TIME_MS = 30_000;

export function createIssueEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | Persistence.EnvironmentCacheStore | R, E>,
) {
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:issues:list",
      tag: WS_METHODS.issuesList,
      staleTimeMs: ISSUE_STALE_TIME_MS,
    }),
    get: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:issues:get",
      tag: WS_METHODS.issuesGet,
      staleTimeMs: ISSUE_STALE_TIME_MS,
    }),
    linearViewer: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:linear:viewer",
      tag: WS_METHODS.linearViewer,
      staleTimeMs: ISSUE_STALE_TIME_MS,
    }),
    linearList: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:linear:issues-list",
      tag: WS_METHODS.linearIssuesList,
      staleTimeMs: ISSUE_STALE_TIME_MS,
    }),
    linearGet: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:linear:issues-get",
      tag: WS_METHODS.linearIssuesGet,
      staleTimeMs: ISSUE_STALE_TIME_MS,
    }),
    linearStart: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:linear:issue-start",
      tag: WS_METHODS.linearIssueStart,
    }),
  };
}
