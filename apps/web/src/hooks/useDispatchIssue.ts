import { useNavigate } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  IssueSummary,
  LinearIssueSummary,
  ModelSelection,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

import { findProjectForRepository } from "~/components/pullRequest/pullRequestList.logic";
import {
  buildIssuePrompt,
  buildLinearIssuePrompt,
  issueBranchName,
  linearBranchName,
  worktreeBase,
} from "~/components/issues/issueDispatch.logic";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { newMessageId, newThreadId } from "~/lib/utils";
import {
  providerInstanceEntriesFor,
  resolveProjectDefaultProviderModelSelection,
} from "~/providerInstances";
import { useProjects } from "~/state/entities";
import { useEnvironmentProviders } from "~/state/environments";
import { issueEnvironment } from "~/state/issues";
import { EMPTY_SERVER_PROVIDERS } from "~/state/server";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { vcsEnvironment } from "~/state/vcs";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "~/types";
import { buildThreadRouteParams } from "~/threadRoutes";
import { useEnvironmentSettings } from "./useSettings";

const errorMessage = (error: unknown) =>
  error instanceof Error && error.message.trim().length > 0 ? error.message : "An error occurred.";

function fail(title: string, description: string): false {
  toastManager.add(stackedThreadToast({ type: "error", title, description }));
  return false;
}

/**
 * Starts an agent on a GitHub or Linear issue: a thread in a new worktree whose first message
 * runs `/complete-task`. That skill plans first and waits for approval before building.
 */
export function useDispatchIssue(environmentId: EnvironmentId) {
  const projects = useProjects();
  const settings = useEnvironmentSettings(environmentId);
  const providers = useEnvironmentProviders().get(environmentId) ?? EMPTY_SERVER_PROVIDERS;
  const readIssue = useAtomQueryRunner(issueEnvironment.get, {
    reportFailure: false,
    reportDefect: false,
  });
  const readLinearIssue = useAtomQueryRunner(issueEnvironment.linearGet, {
    reportFailure: false,
    reportDefect: false,
  });
  const readRefs = useAtomCommand(vcsEnvironment.readRefs, {
    label: "read the project's branches",
    reportFailure: false,
  });
  const startLinearIssue = useAtomCommand(issueEnvironment.linearStart, {
    label: "move the Linear issue to started",
    reportFailure: false,
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
   * The model a new thread in the project starts with: the pick, else the project's default, each
   * only while its provider is enabled and available for the project, else the server's default.
   */
  const modelFor = (
    project: NonNullable<ReturnType<typeof projectFor>>,
    picked: ModelSelection | null = null,
  ): ModelSelection | null => {
    const entries = providerInstanceEntriesFor(providers, settings, project.id);
    const usable = (selection: ModelSelection | null | undefined) =>
      selection != null &&
      entries.some(
        (entry) => entry.instanceId === selection.instanceId && entry.enabled && entry.isAvailable,
      );
    const configured = resolveProjectSettings(settings, project.id, project).settings
      .defaultModelSelection;
    return (
      [picked, configured].find(usable) ??
      resolveProjectDefaultProviderModelSelection(providers, settings, project.id)
    );
  };

  /** Starts the thread in a new worktree on `branch` and opens it; false after a failure toast. */
  const launch = async (input: {
    readonly project: NonNullable<ReturnType<typeof projectFor>>;
    readonly modelSelection: ModelSelection;
    readonly title: string;
    readonly text: string;
    readonly baseBranch: string;
    readonly branch: string;
    readonly startFromOrigin: boolean;
  }): Promise<boolean> => {
    const { project, modelSelection, title, text, baseBranch, branch, startFromOrigin } = input;
    const threadId = newThreadId();
    const createdAt = new Date().toISOString();
    const started = await startThreadTurn({
      environmentId,
      input: {
        threadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text,
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
            baseBranch,
            branch,
            startFromOrigin,
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
  };

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
      // Branching from a guessed base could start the work on the wrong history.
      const baseBranch = detail.value.defaultBranch;
      if (baseBranch === null) {
        return fail(
          "Cannot dispatch",
          `GitHub did not report ${issue.repository}'s default branch.`,
        );
      }

      const branch = issueBranchName(issue);
      return await launch({
        project,
        modelSelection,
        title: `#${issue.number} ${issue.title}`,
        text: buildIssuePrompt(detail.value, branch),
        baseBranch,
        branch,
        startFromOrigin: true,
      });
    } catch (error) {
      return fail("Could not dispatch the issue", errorMessage(error));
    }
  };

  /**
   * Starts an agent on a Linear issue in `project`, a thread in a new worktree on
   * `<identifier>-<slug>`, then moves the issue to its team's first started state.
   */
  const dispatchLinear = async (
    issue: LinearIssueSummary,
    project: NonNullable<ReturnType<typeof projectFor>>,
    picked: ModelSelection | null = null,
  ): Promise<boolean> => {
    const modelSelection = modelFor(project, picked);
    if (modelSelection === null) return fail("Cannot dispatch", "No model is available.");
    try {
      const [detail, refs] = await Promise.all([
        readLinearIssue({ environmentId, input: { id: issue.id } }),
        readRefs({ environmentId, input: { cwd: project.workspaceRoot, limit: 100 } }),
      ]);
      if (detail._tag === "Failure") {
        if (!isAtomCommandInterrupted(detail)) {
          fail("Could not read the issue", errorMessage(squashAtomCommandFailure(detail)));
        }
        return false;
      }
      if (refs._tag === "Failure" || !refs.value.isRepo) {
        return fail("Cannot dispatch", `${project.title} is not a git repository.`);
      }
      const base = worktreeBase(refs.value.refs);
      // Branching from a guessed base could start the work on the wrong history.
      if (base === null) {
        return fail("Cannot dispatch", `${project.title} has no default, main or master branch.`);
      }
      const branch = linearBranchName(issue);
      const launched = await launch({
        project,
        modelSelection,
        title: `${issue.identifier} ${issue.title}`,
        text: buildLinearIssuePrompt(detail.value, branch),
        baseBranch: base.branch,
        branch,
        startFromOrigin: base.startFromOrigin,
      });
      if (!launched) return false;
      const moved = await startLinearIssue({ environmentId, input: { id: issue.id } });
      if (moved._tag === "Failure") {
        if (!isAtomCommandInterrupted(moved)) {
          toastManager.add(
            stackedThreadToast({
              type: "warning",
              title: `Could not move ${issue.identifier} in Linear`,
              description: errorMessage(squashAtomCommandFailure(moved)),
            }),
          );
        }
      } else if (moved.value.moved) {
        toastManager.add(
          stackedThreadToast({
            type: "success",
            title: `Moved ${issue.identifier} to ${moved.value.stateName}`,
          }),
        );
      }
      return true;
    } catch (error) {
      return fail("Could not dispatch the issue", errorMessage(error));
    }
  };

  return { projectFor, modelFor, dispatch, dispatchLinear };
}
