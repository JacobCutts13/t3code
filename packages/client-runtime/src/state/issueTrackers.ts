import {
  WS_METHODS,
  type IssueTrackerConnection,
  type IssueTrackerConnectionList,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom } from "effect/reactivity";

import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import * as Persistence from "../platform/persistence.ts";

/**
 * Standalone issue trackers (Linear, Jira) per environment: which are connected, as whom, which
 * scopes they reach, and which project is bound to which scope. One query carries all of it, and
 * every mutation refreshes that query, so the settings page never shows a stale status.
 */
export function createIssueTrackerEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | Persistence.EnvironmentCacheStore | R, E>,
) {
  const commandScheduler = createAtomCommandScheduler();
  const connections = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:issue-trackers:connections",
    tag: WS_METHODS.issueTrackersList,
  });
  const refresh = (environmentId: Parameters<typeof connections>[0]["environmentId"]) =>
    connections({ environmentId, input: {} });
  // Connect, disconnect and bind all edit one environment's tracker state; serialized so a
  // disconnect cannot race the bind of a project to the tracker being removed.
  const serialPerEnvironment = {
    mode: "serial" as const,
    key: ({ environmentId }: { readonly environmentId: string }) => environmentId,
  };
  return {
    connections,
    /** Saves a credential the tracker accepted, or removes the stored one with a null token. */
    connect: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:issue-trackers:connect",
      tag: WS_METHODS.issueTrackersConnect,
      scheduler: commandScheduler,
      concurrency: serialPerEnvironment,
      onSettled: (target, registry) =>
        Effect.sync(() => registry.refresh(refresh(target.environmentId))),
    }),
    bindProject: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:issue-trackers:bind-project",
      tag: WS_METHODS.issueTrackersBindProject,
      scheduler: commandScheduler,
      concurrency: serialPerEnvironment,
      onSettled: (target, registry) =>
        Effect.sync(() => registry.refresh(refresh(target.environmentId))),
    }),
  };
}

/** What an unbound project reads from a connected tracker: every one of its scopes. */
export function issueTrackerUnboundLabel(tracker: IssueTrackerConnection): string {
  return `All ${tracker.scopeNoun}s`;
}

/**
 * The line under a tracker's name. Every project lists all of a connected tracker's scopes
 * unless it is linked to one, so the line says how many are narrowed.
 */
export function issueTrackerSummary(
  tracker: IssueTrackerConnection,
  bindings: IssueTrackerConnectionList["bindings"],
): string {
  if (!tracker.connected)
    return `Not connected. Add a ${tracker.credential.label.toLowerCase()} to list its issues.`;
  if (tracker.account === null) return tracker.detail ?? "The saved credential was rejected.";
  const linked = Object.values(bindings).filter(
    (binding) => binding.tracker === tracker.tracker,
  ).length;
  const projects =
    linked === 0
      ? `every project lists all ${tracker.scopeNoun}s`
      : `${linked} ${linked === 1 ? "project" : "projects"} narrowed to one ${tracker.scopeNoun}`;
  return `Connected as ${tracker.account} · ${projects}`;
}
