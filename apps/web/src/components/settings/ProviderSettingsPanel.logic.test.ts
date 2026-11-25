import {
  AuthProvidersManageScope,
  ProjectId,
  ProviderInstanceId,
  type ServerSettings,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildProviderInstanceOverridePatch,
  cloudEnvironmentLabel,
  resolveRemoteOperateAccess,
  sortCloudEnvironmentsForProject,
} from "./ProviderSettingsPanel.logic";

describe("buildProviderInstanceOverridePatch", () => {
  const projectId = ProjectId.make("project-a");
  const instanceId = ProviderInstanceId.make("codex_work");

  it("writes the same choice to every checkout of the project", () => {
    const siblingId = ProjectId.make("project-a-worktree");
    const settings: Pick<ServerSettings, "projectSettingsOverrides"> = {
      projectSettingsOverrides: {
        [siblingId]: { newWorktreesStartFromOrigin: true },
      },
    };

    expect(
      buildProviderInstanceOverridePatch(settings, [projectId, siblingId], instanceId, {
        enabled: false,
      }),
    ).toEqual({
      [projectId]: { providerInstances: { [instanceId]: { enabled: false } } },
      [siblingId]: {
        newWorktreesStartFromOrigin: true,
        providerInstances: { [instanceId]: { enabled: false } },
      },
    });
  });

  it("resets the only override by clearing the whole project entry", () => {
    const settings: Pick<ServerSettings, "projectSettingsOverrides"> = {
      projectSettingsOverrides: {
        [projectId]: { providerInstances: { [instanceId]: { enabled: true } } },
      },
    };

    expect(
      buildProviderInstanceOverridePatch(settings, [projectId], instanceId, { enabled: undefined }),
    ).toEqual({ [projectId]: null });
  });

  it("sends providerInstances: {} explicitly when clearing the last instance override leaves other keys", () => {
    const settings: Pick<ServerSettings, "projectSettingsOverrides"> = {
      projectSettingsOverrides: {
        [projectId]: {
          newWorktreesStartFromOrigin: true,
          providerInstances: { [instanceId]: { enabled: true } },
        },
      },
    };

    expect(
      buildProviderInstanceOverridePatch(settings, [projectId], instanceId, { enabled: undefined }),
    ).toEqual({
      [projectId]: { newWorktreesStartFromOrigin: true, providerInstances: {} },
    });
  });
});

describe("project cloud environments", () => {
  const projectId = ProjectId.make("project-services");
  const instanceId = ProviderInstanceId.make("cursor");
  const services = { id: "env-services", repos: ["https://github.com/acme/services"] };

  it("sets and clears a project's environment without touching its enabled override", () => {
    const settings: Pick<ServerSettings, "projectSettingsOverrides"> = {
      projectSettingsOverrides: {
        [projectId]: { providerInstances: { [instanceId]: { enabled: true } } },
      },
    };
    const selected = buildProviderInstanceOverridePatch(settings, [projectId], instanceId, {
      cloudEnvironment: services,
    });
    expect(selected).toEqual({
      [projectId]: {
        providerInstances: { [instanceId]: { enabled: true, cloudEnvironment: services } },
      },
    });
    expect(
      buildProviderInstanceOverridePatch(
        { projectSettingsOverrides: { [projectId]: selected[projectId]! } },
        [projectId],
        instanceId,
        { cloudEnvironment: undefined },
      ),
    ).toEqual({ [projectId]: { providerInstances: { [instanceId]: { enabled: true } } } });
  });

  it("lists the project's own environments first, the closest match on top", () => {
    const environments = [
      { id: "env-docs", repos: ["https://github.com/acme/docs"] },
      {
        id: "env-pair",
        repos: ["https://github.com/acme/support-app", "https://github.com/acme/services"],
      },
      { id: "env-empty", repos: [] },
      { ...services, name: "Services" },
      // The same repositories in another order are the same unnamed choice.
      {
        id: "env-pair-again",
        repos: ["https://github.com/acme/services", "https://github.com/acme/support-app"],
      },
    ];
    const sorted = sortCloudEnvironmentsForProject(environments, "github.com/Acme/services");
    expect(sorted.map((environment) => environment.id)).toEqual([
      "env-services",
      "env-pair",
      "env-docs",
    ]);
    expect(sorted.map(cloudEnvironmentLabel)).toEqual([
      "Services",
      "acme/support-app, acme/services",
      "acme/docs",
    ]);
  });
});

describe("remote operate access", () => {
  it("does not treat the old orchestration grant as provider management", () => {
    expect(
      resolveRemoteOperateAccess({
        session: {
          authenticated: true,
          scopes: ["orchestration:operate"],
          auth: { serverUpdateScope: "environment:maintain" },
        },
        isPending: false,
        hasError: false,
      }),
    ).toBe("denied");
  });

  it("accepts the orchestration grant from a server that predates providers:manage", () => {
    expect(
      resolveRemoteOperateAccess({
        session: { authenticated: true, scopes: ["orchestration:operate"], auth: {} },
        isPending: false,
        hasError: false,
      }),
    ).toBe("granted");
  });
  it("derives access from the environment session's granted scopes", () => {
    expect(
      resolveRemoteOperateAccess({
        session: { authenticated: true, scopes: [AuthProvidersManageScope] },
        isPending: false,
        hasError: false,
      }),
    ).toBe("granted");
    expect(
      resolveRemoteOperateAccess({
        session: { authenticated: true, scopes: ["orchestration:read"] },
        isPending: false,
        hasError: false,
      }),
    ).toBe("denied");
    expect(
      resolveRemoteOperateAccess({
        session: { authenticated: false },
        isPending: false,
        hasError: false,
      }),
    ).toBe("denied");
  });
});
