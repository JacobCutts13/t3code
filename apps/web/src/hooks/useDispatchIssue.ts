import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  AuthSourceControlWriteScope,
  type EnvironmentId,
  type IssueSummary,
  type LinearIssueSummary,
  type ModelSelection,
  type ReviewRequestSummary,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

import { offHeadPullRequestCheckoutToast } from "~/components/pullRequest/pullRequestCheckoutToast";
import { checkoutFailureDescription } from "~/components/pullRequest/pullRequestDetail.logic";
import { findProjectForRepository } from "~/components/pullRequest/pullRequestList.logic";
import { buildReviewPrompt } from "~/components/pullRequest/pullRequestReviewDispatch.logic";
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
import { gitEnvironment } from "~/state/git";
import { EMPTY_SERVER_PROVIDERS } from "~/state/server";
import { readEnvironmentScope } from "~/state/session";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { vcsEnvironment } from "~/state/vcs";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "~/types";
import { buildThreadRouteParams } from "~/threadRoutes";
import { usePullRequestLinking } from "./usePullRequestLinking";
import { useEnvironmentSettings } from "./useSettings";

const errorMessage = (error: unknown) =>
  error instanceof Error && error.message.trim().length > 0 ? error.message : "An error occurred.";

function fail(title: string, description: string): false {
  toastManager.add(stackedThreadToast({ type: "error", title, description }));
  return false;
}

/** Toasts a failed command unless it was interrupted. */
function reportFailure(
  result: AtomCommandResult<unknown, unknown> & { readonly _tag: "Failure" },
  title: string,
  type: "error" | "warning" = "error",
): false {
  if (!isAtomCommandInterrupted(result)) {
    toastManager.add(
      stackedThreadToast({
        type,
        title,
        description: errorMessage(squashAtomCommandFailure(result)),
      }),
    );
  }
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
  const preparePullRequestThread = useAtomCommand(gitEnvironment.preparePullRequestThread, {
    reportFailure: false,
  });
  const linking = usePullRequestLinking(environmentId);
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
    project: EnvironmentProject,
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

  /**
   * Starts the thread in a new worktree on `branch`, or in an existing checkout, and opens it;
   * false after a failure toast.
   */
  const launch = async (input: {
    readonly project: EnvironmentProject;
    readonly modelSelection: ModelSelection;
    readonly title: string;
    readonly text: string;
    readonly worktree:
      | { readonly baseBranch: string; readonly branch: string }
      | { readonly branch: string; readonly worktreePath: string | null };
  }): Promise<ScopedThreadRef | false> => {
    const { project, modelSelection, title, text, worktree } = input;
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
            ...("worktreePath" in worktree
              ? { branch: worktree.branch, worktreePath: worktree.worktreePath }
              : { branch: null, worktreePath: null }),
            createdAt,
          },
          ...("worktreePath" in worktree
            ? {}
            : {
                prepareWorktree: {
                  projectCwd: project.workspaceRoot,
                  baseBranch: worktree.baseBranch,
                  branch: worktree.branch,
                  // The server fetches the base's upstream, or origin, and uses it locally without one.
                  startFromOrigin: true,
                },
              }),
          runSetupScript: true,
        },
        createdAt,
      },
    });
    if (started._tag === "Failure") return reportFailure(started, "Could not start the agent");
    const threadRef = scopeThreadRef(environmentId, threadId);
    await navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(threadRef) });
    return threadRef;
  };

  /** The branch a worktree in `project` starts from, read from its refs; false after a failure toast. */
  const baseFromRefs = async (project: EnvironmentProject): Promise<string | false> => {
    // Without matching remote refs, a local default hides origin's and the worktree misses a fetch.
    const refs = await readRefs({
      environmentId,
      input: { cwd: project.workspaceRoot, limit: 100, includeMatchingRemoteRefs: true },
    });
    if (refs._tag === "Failure")
      return reportFailure(refs, "Could not read the project's branches");
    if (!refs.value.isRepo) {
      return fail("Cannot dispatch", `${project.title} is not a git repository.`);
    }
    // Branching from a guessed base could start the work on the wrong history.
    return (
      worktreeBase(refs.value.refs) ??
      fail("Cannot dispatch", `${project.title} has no default, main or master branch.`)
    );
  };

  /**
   * Starts an agent on a GitHub issue in `project`, the issue's repository's project unless the
   * user picked another; a picked project branches from its own default branch.
   */
  const dispatch = async (
    issue: IssueSummary,
    project: EnvironmentProject,
    picked: ModelSelection | null = null,
  ): Promise<boolean> => {
    const modelSelection = modelFor(project, picked);
    if (modelSelection === null) return fail("Cannot dispatch", "No model is available.");
    const isIssueRepository = projectFor(issue)?.id === project.id;

    try {
      const [detail, refsBase] = await Promise.all([
        readIssue({
          environmentId,
          input: { host: issue.host, repository: issue.repository, number: issue.number },
        }),
        isIssueRepository ? null : baseFromRefs(project),
      ]);
      if (detail._tag === "Failure") return reportFailure(detail, "Could not read the issue");
      const defaultBranch = detail.value.defaultBranch;
      const base =
        refsBase ??
        (defaultBranch === null
          ? fail("Cannot dispatch", `GitHub did not report ${issue.repository}'s default branch.`)
          : defaultBranch);
      if (base === false) return false;

      const branch = issueBranchName(issue);
      const launched = await launch({
        project,
        modelSelection,
        title: `#${issue.number} ${issue.title}`,
        text: buildIssuePrompt(detail.value, branch),
        worktree: { baseBranch: base, branch },
      });
      return launched !== false;
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
    project: EnvironmentProject,
    picked: ModelSelection | null = null,
  ): Promise<boolean> => {
    const modelSelection = modelFor(project, picked);
    if (modelSelection === null) return fail("Cannot dispatch", "No model is available.");
    try {
      const [detail, base] = await Promise.all([
        readLinearIssue({ environmentId, input: { id: issue.id } }),
        baseFromRefs(project),
      ]);
      if (detail._tag === "Failure") return reportFailure(detail, "Could not read the issue");
      if (base === false) return false;
      const branch = linearBranchName(issue);
      const launched = await launch({
        project,
        modelSelection,
        title: `${issue.identifier} ${issue.title}`,
        text: buildLinearIssuePrompt(issue, detail.value, branch),
        worktree: { baseBranch: base, branch },
      });
      if (launched === false) return false;
      const moved = await startLinearIssue({ environmentId, input: { id: issue.id } });
      if (moved._tag === "Failure") {
        reportFailure(moved, `Could not move ${issue.identifier} in Linear`, "warning");
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

  /** Why this connection cannot dispatch a review, or null when it can. */
  const reviewBlockedReason = () =>
    readEnvironmentScope(environmentId, AuthSourceControlWriteScope) &&
    readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)
      ? null
      : "This connection cannot check out pull requests or start threads.";

  /**
   * Starts a read-only review agent on a pull request: checks out its head in a worktree of
   * `project`, then starts a thread there with cockpit's review prompt and links the PR to it.
   */
  const dispatchReview = async (
    pr: ReviewRequestSummary,
    project: EnvironmentProject,
    picked: ModelSelection | null = null,
  ): Promise<boolean> => {
    const blocked = reviewBlockedReason();
    if (blocked !== null) return fail("Cannot start the review", blocked);
    const modelSelection = modelFor(project, picked);
    if (modelSelection === null) return fail("Cannot start the review", "No model is available.");
    try {
      const prepared = await preparePullRequestThread({
        environmentId,
        input: { cwd: project.workspaceRoot, reference: pr.url, mode: "worktree" },
      });
      if (prepared._tag === "Failure") {
        return fail(
          "Could not check out the pull request",
          checkoutFailureDescription(
            isAtomCommandInterrupted(prepared) ? undefined : squashAtomCommandFailure(prepared),
          ),
        );
      }
      const { branch, worktreePath, isOnPullRequestHead } = prepared.value;
      // Reviewing code that is not the PR's head would review the wrong change.
      if (!isOnPullRequestHead) {
        toastManager.add(
          stackedThreadToast(
            offHeadPullRequestCheckoutToast(sourceControlClients.get("github").changeRequest),
          ),
        );
        return false;
      }
      const threadRef = await launch({
        project,
        modelSelection,
        title: `Review #${pr.number} ${pr.title}`,
        text: buildReviewPrompt(pr),
        worktree: { branch, worktreePath },
      });
      if (threadRef === false) return false;
      await linking.changeLink(threadRef, pr.url, true).catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "warning",
            title: "The review started, but the pull request is not linked to it",
            description: errorMessage(error),
          }),
        );
      });
      return true;
    } catch (error) {
      return fail("Could not start the review", errorMessage(error));
    }
  };

  return {
    projectFor,
    modelFor,
    dispatch,
    dispatchLinear,
    dispatchReview,
    reviewBlockedReason,
  };
}
