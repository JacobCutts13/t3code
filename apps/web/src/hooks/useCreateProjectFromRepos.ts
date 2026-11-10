import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  findProjectByPath,
  inferProjectTitleFromPath,
} from "@t3tools/client-runtime/state/projects";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationOperateScope, AuthSettingsWriteScope } from "@t3tools/contracts";
import type { EnvironmentId } from "@t3tools/contracts";

import type { RepoCandidate } from "~/components/createProjectFromRepos.logic";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { newProjectId } from "~/lib/utils";
import { useProjects, waitForProject } from "~/state/entities";
import { projectEnvironment } from "~/state/projects";
import { serverEnvironment } from "~/state/server";
import { readEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { useNewThreadHandler } from "./useHandleNewThread";

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "An error occurred.";
}

function fail(title: string, description: string): false {
  toastManager.add(stackedThreadToast({ type: "error", title, description }));
  return false;
}

/**
 * Turns picked clones into a project: one repo opens (or adds) that folder as the project, several repos
 * create a host project and list the clones as its repositories, so every thread gets a worktree of each.
 */
export function useCreateProjectFromRepos() {
  const projects = useProjects();
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const createHostProject = useAtomCommand(projectEnvironment.createNew, { reportFailure: false });
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
  });
  const handleNewThread = useNewThreadHandler();

  const openProject = async (environmentId: EnvironmentId, projectId: string) => {
    const projectRef = scopeProjectRef(environmentId, projectId as never);
    // Wait for the stored project path; drafts use it as their key.
    await waitForProject(projectRef);
    await handleNewThread(projectRef);
  };

  return async (input: {
    readonly environmentId: EnvironmentId;
    readonly repos: ReadonlyArray<RepoCandidate>;
    readonly name: string;
  }): Promise<boolean> => {
    const { environmentId, repos } = input;
    if (repos.length === 0) return false;
    if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) {
      return fail("Cannot add project", "This connection cannot add projects.");
    }

    try {
      if (repos.length === 1) {
        const repo = repos[0]!;
        const existing = findProjectByPath(
          projects.filter((project) => project.environmentId === environmentId),
          repo.path,
        );
        if (existing) {
          await openProject(environmentId, existing.id);
          return true;
        }
        const projectId = newProjectId();
        const created = await createProject({
          environmentId,
          input: {
            projectId,
            title: inferProjectTitleFromPath(repo.path),
            workspaceRoot: repo.path,
            createWorkspaceRootIfMissing: false,
            defaultModelSelection: null,
          },
        });
        if (created._tag === "Failure") {
          if (!isAtomCommandInterrupted(created))
            fail("Failed to add project", errorMessage(squashAtomCommandFailure(created)));
          return false;
        }
        await openProject(environmentId, projectId);
        return true;
      }

      if (!readEnvironmentScope(environmentId, AuthSettingsWriteScope)) {
        return fail(
          "Cannot add project",
          "This connection cannot change settings, which a multi-repository project needs.",
        );
      }
      const host = await createHostProject({ environmentId, input: { name: input.name } });
      if (host._tag === "Failure") {
        if (!isAtomCommandInterrupted(host))
          fail("Could not create the project", errorMessage(squashAtomCommandFailure(host)));
        return false;
      }
      const { projectId, workspaceRoot } = host.value;
      const saved = await updateSettings({
        environmentId,
        input: {
          patch: {
            projectSettingsOverrides: {
              [projectId]: {
                nestedRepos: repos.map((repo) => ({ name: repo.name, path: repo.path })),
                // Repositories only join worktree threads, so make worktrees the default here.
                defaultThreadEnvMode: "worktree",
              },
            },
          },
        },
      });
      if (saved._tag === "Failure") {
        if (!isAtomCommandInterrupted(saved))
          fail(
            "Project created without its repositories",
            `${errorMessage(squashAtomCommandFailure(saved))} Add them in Settings → Projects → Repositories. The project is in ${workspaceRoot}.`,
          );
        return false;
      }
      await openProject(environmentId, projectId);
      return true;
    } catch (error) {
      return fail("Failed to open project", errorMessage(error));
    }
  };
}
