import { useNavigate } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  IssueSummary,
  ModelSelection,
  ServerProvider,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

import { findProjectForRepository } from "~/components/pullRequest/pullRequestList.logic";
import { buildIssuePrompt, issueBranchName } from "~/components/issues/issueDispatch.logic";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { newMessageId, newThreadId } from "~/lib/utils";
import {
  providerInstanceEntriesFor,
  resolveProjectDefaultProviderModelSelection,
} from "~/providerInstances";
import { useProjects } from "~/state/entities";
import { useEnvironmentProviders } from "~/state/environments";
import { issueEnvironment } from "~/state/issues";
import { threadEnvironment } from "~/state/threads";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "~/types";
import { buildThreadRouteParams } from "~/threadRoutes";
import { useEnvironmentSettings } from "./useSettings";

const NO_PROVIDERS: ReadonlyArray<ServerProvider> = [];

// T3 does not record a repository's default branch; this matches cockpit's `origin/main`.
const BASE_BRANCH = "main";

const errorMessage = (error: unknown) =>
  error instanceof Error && error.message.trim().length > 0 ? error.message : "An error occurred.";

function fail(title: string, description: string): false {
  toastManager.add(stackedThreadToast({ type: "error", title, description }));
  return false;
}

/**
 * Starts an agent on an issue: a thread in a new worktree on `fix/<number>-<slug>`, whose first
 * message runs `/complete-task`. That skill plans first and waits for approval before building.
 */
export function useDispatchIssue(environmentId: EnvironmentId) {
  const projects = useProjects();
  const settings = useEnvironmentSettings(environmentId);
  const providers = useEnvironmentProviders().get(environmentId) ?? NO_PROVIDERS;
  const readIssue = useAtomQueryRunner(issueEnvironment.get, {
    reportFailure: false,
    reportDefect: false,
  });
  const startThreadTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });
  const navigate = useNavigate();

  /** The added project whose clone is the issue's repository, if any. */
  const projectFor = (issue: Pick<IssueSummary, "repository" | "host">) =>
    findProjectForRepository(
      projects.filter((project) => project.environmentId === environmentId),
      { repository: issue.repository, host: issue.host },
    );

  /**
   * The model a new thread in the project starts with: the pick when its provider is enabled for
   * the project, else the project's default, else the server's.
   */
  const modelFor = (
    project: NonNullable<ReturnType<typeof projectFor>>,
    picked: ModelSelection | null = null,
  ): ModelSelection | null =>
    picked !== null &&
    providerInstanceEntriesFor(providers, settings, project.id).some(
      (entry) => entry.instanceId === picked.instanceId && entry.enabled,
    )
      ? picked
      : (resolveProjectSettings(settings, project.id, project).settings.defaultModelSelection ??
        resolveProjectDefaultProviderModelSelection(providers, settings, project.id));

  const dispatch = async (
    issue: IssueSummary,
    picked: ModelSelection | null = null,
  ): Promise<boolean> => {
    const project = projectFor(issue);
    if (project === undefined) {
      return fail("Cannot dispatch", `Add ${issue.repository} as a project first.`);
    }
    const modelSelection = modelFor(project, picked);
    if (modelSelection === null) return fail("Cannot dispatch", "No model is available.");

    try {
      const detail = await readIssue({
        environmentId,
        input: { host: issue.host, repository: issue.repository, number: issue.number },
      });
      if (detail._tag === "Failure") {
        if (!isAtomCommandInterrupted(detail)) {
          fail("Could not read the issue", errorMessage(squashAtomCommandFailure(detail)));
        }
        return false;
      }

      const branch = issueBranchName(issue);
      const title = `#${issue.number} ${issue.title}`;
      const threadId = newThreadId();
      const createdAt = new Date().toISOString();
      const started = await startThreadTurn({
        environmentId,
        input: {
          threadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: buildIssuePrompt(detail.value, branch),
            attachments: [],
          },
          modelSelection,
          titleSeed: title,
          runtimeMode: DEFAULT_RUNTIME_MODE,
          interactionMode: DEFAULT_INTERACTION_MODE,
          bootstrap: {
            createThread: {
              projectId: project.id,
              title,
              modelSelection,
              runtimeMode: DEFAULT_RUNTIME_MODE,
              interactionMode: DEFAULT_INTERACTION_MODE,
              branch: null,
              worktreePath: null,
              createdAt,
            },
            prepareWorktree: {
              projectCwd: project.workspaceRoot,
              baseBranch: BASE_BRANCH,
              branch,
              startFromOrigin: true,
            },
            runSetupScript: true,
          },
          createdAt,
        },
      });
      if (started._tag === "Failure") {
        if (!isAtomCommandInterrupted(started)) {
          fail("Could not start the agent", errorMessage(squashAtomCommandFailure(started)));
        }
        return false;
      }
      await navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
      });
      return true;
    } catch (error) {
      return fail("Could not dispatch the issue", errorMessage(error));
    }
  };

  return { projectFor, modelFor, dispatch };
}
