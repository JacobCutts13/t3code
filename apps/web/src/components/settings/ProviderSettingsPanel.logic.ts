import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import { normalizeGitRemoteUrl } from "@t3tools/shared/git";
import {
  AuthProvidersManageScope,
  type EnvironmentId,
  type ProjectId,
  type ProjectProviderInstanceOverride,
  type ProjectSettingsOverrides,
  type ProviderCloudEnvironment,
  type ProviderInstanceId,
  sessionGrantsScope,
  type ServerSettings,
  type SessionGrantInput,
} from "@t3tools/contracts";

export interface ProviderEnvironmentOptionLike {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

export function isProviderSettingsEnvironmentAvailable(input: {
  readonly connectionPhase: EnvironmentConnectionPhase;
  readonly hasServerConfig: boolean;
}): boolean {
  return input.connectionPhase === "connected" && input.hasServerConfig;
}

export function buildProviderEnvironmentOptions<T extends ProviderEnvironmentOptionLike>(
  environments: ReadonlyArray<T>,
  primaryEnvironmentId: EnvironmentId | null,
  environmentIds?: readonly EnvironmentId[],
): ReadonlyArray<T> {
  const allowed = environmentIds ? new Set(environmentIds) : null;
  return environments
    .filter((environment) => !allowed || allowed.has(environment.environmentId))
    .toSorted((left, right) => {
      const leftIsPrimary = left.environmentId === primaryEnvironmentId;
      const rightIsPrimary = right.environmentId === primaryEnvironmentId;
      if (leftIsPrimary !== rightIsPrimary) {
        return leftIsPrimary ? -1 : 1;
      }
      return (
        left.label.localeCompare(right.label) ||
        String(left.environmentId).localeCompare(String(right.environmentId))
      );
    });
}

export function resolveSelectedProviderEnvironmentId(
  environments: ReadonlyArray<ProviderEnvironmentOptionLike>,
  selectedEnvironmentId: EnvironmentId | null,
  primaryEnvironmentId: EnvironmentId | null,
): EnvironmentId | null {
  if (
    selectedEnvironmentId !== null &&
    environments.some((environment) => environment.environmentId === selectedEnvironmentId)
  ) {
    return selectedEnvironmentId;
  }
  if (
    primaryEnvironmentId !== null &&
    environments.some((environment) => environment.environmentId === primaryEnvironmentId)
  ) {
    return primaryEnvironmentId;
  }
  return environments[0]?.environmentId ?? null;
}

export type ProviderEnvironmentAccess =
  | { readonly kind: "editable" }
  | { readonly kind: "loading"; readonly reason: "config" | "permissions" }
  | { readonly kind: "read-only" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "error" };

export type ProviderOperateAccess = "granted" | "denied" | "pending";

export function resolveRemoteOperateAccess(input: {
  readonly session: SessionGrantInput | null;
  readonly isPending: boolean;
  readonly hasError: boolean;
}): ProviderOperateAccess {
  if (input.hasError) return "denied";
  if (input.session === null) return input.isPending ? "pending" : "denied";
  return sessionGrantsScope(input.session, AuthProvidersManageScope) ? "granted" : "denied";
}

/** Send providerInstances even when empty; omission preserves the stored map for older clients. */

/** One override field to write; `undefined` removes it so the project inherits again. */
export type ProviderInstanceOverrideUpdate =
  | { readonly enabled: boolean | undefined }
  | { readonly cloudEnvironment: ProviderCloudEnvironment | undefined };

export function buildProviderInstanceOverridePatch(
  settings: Pick<ServerSettings, "projectSettingsOverrides">,
  projectIds: readonly ProjectId[],
  instanceId: ProviderInstanceId,
  update: ProviderInstanceOverrideUpdate,
): Record<ProjectId, ProjectSettingsOverrides | null> {
  const patch: Record<ProjectId, ProjectSettingsOverrides | null> = {};
  for (const projectId of projectIds) {
    const current = settings.projectSettingsOverrides[projectId];
    const instances = { ...current?.providerInstances };
    const instance: {
      -readonly [
        Key in keyof ProjectProviderInstanceOverride
      ]: ProjectProviderInstanceOverride[Key];
    } = { ...instances[instanceId] };
    if ("enabled" in update) {
      if (update.enabled === undefined) delete instance.enabled;
      else instance.enabled = update.enabled;
    } else if (update.cloudEnvironment === undefined) delete instance.cloudEnvironment;
    else instance.cloudEnvironment = update.cloudEnvironment;
    if (Object.keys(instance).length > 0) instances[instanceId] = instance;
    else delete instances[instanceId];

    const { providerInstances: _omit, ...rest } = current ?? {};
    const nextEntry: ProjectSettingsOverrides = { ...rest, providerInstances: instances };
    patch[projectId] =
      Object.keys(rest).length === 0 && Object.keys(instances).length === 0 ? null : nextEntry;
  }
  return patch;
}

export function cloudEnvironmentLabel(
  environment: Pick<ProviderCloudEnvironment, "name" | "repos">,
): string | undefined {
  if (environment.name) return environment.name;
  const repos = environment.repos.map((repo) =>
    normalizeGitRemoteUrl(repo).replace(/^[^/]+\//, ""),
  );
  return repos.length > 0 ? repos.join(", ") : undefined;
}

/**
 * Environments with the project's repository come first, the closest match (fewest repos) on top.
 * Unnamed environments with the same repositories are one choice: an agent targets them by repo set.
 */
export function sortCloudEnvironmentsForProject(
  environments: ReadonlyArray<ProviderCloudEnvironment>,
  projectRepository: string | undefined,
): ReadonlyArray<ProviderCloudEnvironment> {
  const key =
    projectRepository === undefined ? undefined : normalizeGitRemoteUrl(projectRepository);
  const rank = (environment: ProviderCloudEnvironment) =>
    key !== undefined && environment.repos.some((repo) => normalizeGitRemoteUrl(repo) === key)
      ? environment.repos.length
      : Number.POSITIVE_INFINITY;
  const seen = new Set<string>();
  return environments
    .filter((environment) => {
      if (environment.repos.length === 0) return false;
      if (environment.name !== undefined) return true;
      const repoSet = environment.repos.map(normalizeGitRemoteUrl).toSorted().join("\n");
      if (seen.has(repoSet)) return false;
      seen.add(repoSet);
      return true;
    })
    .toSorted(
      (left, right) =>
        rank(left) - rank(right) ||
        (cloudEnvironmentLabel(left) ?? "").localeCompare(cloudEnvironmentLabel(right) ?? ""),
    );
}

export function classifyProviderEnvironmentAccess(input: {
  readonly connectionPhase: EnvironmentConnectionPhase;
  readonly hasServerConfig: boolean;
  readonly operateAccess: ProviderOperateAccess;
}): ProviderEnvironmentAccess {
  if (input.connectionPhase === "error") {
    return { kind: "error" };
  }
  if (input.connectionPhase !== "connected") {
    return { kind: "unavailable" };
  }
  if (!input.hasServerConfig) {
    return { kind: "loading", reason: "config" };
  }
  if (input.operateAccess === "pending") {
    return { kind: "loading", reason: "permissions" };
  }
  if (input.operateAccess === "denied") {
    return { kind: "read-only" };
  }
  return { kind: "editable" };
}
