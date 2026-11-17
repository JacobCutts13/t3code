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
  type IssueDetail,
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
  issueBranchName,
  issueStartState,
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
import { issueEnvironment, refreshIssueLists } from "~/state/issues";
import { gitEnvironment } from "~/state/git";
import { EMPTY_SERVER_PROVIDERS } from "~/state/server";
import { readEnvironmentScope } from "~/state/session";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
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
  const readRefs = useAtomCommand(vcsEnvironment.readRefs, {
    label: "read the project's branches",
    reportFailure: false,
  });
  const setIssueState = useAtomCommand(issueEnvironment.setState, { reportFailure: false });
  const linkIssue = useAtomCommand(threadEnvironment.linkIssue, { reportFailure: false });
  const startThreadTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });
  const preparePullRequestThread = useAtomCommand(gitEnvironment.preparePullRequestThread, {
    reportFailure: false,
  });
  const linking = usePullRequestLinking(environmentId);
  const navigate = useNavigate();

  /** The added project whose clone is the issue's repository, if any. */
  const projectFor = (pr: Pick<ReviewRequestSummary, "repository" | "host">) =>
    findProjectForRepository(
      projects.filter((project) => project.environmentId === environmentId),
      { repository: pr.repository, host: pr.host },
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
      | { readonly kind: "new"; readonly baseBranch: string; readonly branch: string }
      | {
          readonly kind: "existing";
          readonly branch: string;
          readonly worktreePath: string | null;
        };
  }): Promise<ScopedThreadRef | false> => {
    const { project, modelSelection, title, text, worktree } = input;
    const workspace =
      worktree.kind === "existing"
        ? { thread: { branch: worktree.branch, worktreePath: worktree.worktreePath } }
        : {
            thread: { branch: null, worktreePath: null },
            prepareWorktree: {
              projectCwd: project.workspaceRoot,
              baseBranch: worktree.baseBranch,
              branch: worktree.branch,
              // The server fetches the base's upstream, or origin, and uses it locally without one.
              startFromOrigin: true,
            },
          };
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
            ...workspace.thread,
            createdAt,
          },
          ...(workspace.prepareWorktree === undefined
            ? {}
            : { prepareWorktree: workspace.prepareWorktree }),
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
   * Starts an agent on an issue in `project`, a thread in a new worktree off the project's default
   * branch, links the issue to it, then moves the issue to its first started state, if any.
   */
  const dispatch = async (
    detail: IssueDetail,
    project: EnvironmentProject,
    picked: ModelSelection | null = null,
  ): Promise<boolean> => {
    const modelSelection = modelFor(project, picked);
    if (modelSelection === null) return fail("Cannot dispatch", "No model is available.");
    try {
      const base = await baseFromRefs(project);
      if (base === false) return false;
      const branch = issueBranchName(detail);
      const threadRef = await launch({
        project,
        modelSelection,
        title: `${detail.displayKey} ${detail.title}`,
        text: buildIssuePrompt(detail, branch),
        worktree: { kind: "new", baseBranch: base, branch },
      });
      if (threadRef === false) return false;
      const [linked, moved] = await Promise.all([
        linkIssue({
          environmentId,
          input: {
            threadId: threadRef.threadId,
            tracker: detail.tracker,
            host: detail.host,
            scope: detail.scope,
            key: detail.key,
            projectId: detail.projectId,
            url: detail.url,
            displayKey: detail.displayKey,
            title: detail.title,
            source: "manual",
          },
        }),
        moveToStarted(detail),
      ]);
      if (linked._tag === "Failure") {
        reportFailure(linked, "The agent started, but the issue is not linked to it", "warning");
      }
      if (moved) refreshIssueLists(environmentId);
      return true;
    } catch (error) {
      return fail("Could not dispatch the issue", errorMessage(error));
    }
  };

  /** Moves a writable issue to its first started state; true when it moved. */
  const moveToStarted = async (detail: IssueDetail): Promise<boolean> => {
    const target = issueStartState(detail);
    if (target === null || !detail.writable || !detail.viewerPermissions.setState) return false;
    const moved = await setIssueState({
      environmentId,
      input: {
        projectId: detail.projectId,
        tracker: detail.tracker,
        host: detail.host,
        scope: detail.scope,
        key: detail.key,
        state: target.name,
      },
    });
    if (moved._tag === "Failure") {
      reportFailure(moved, `Could not move ${detail.displayKey} to ${target.name}`, "warning");
      return false;
    }
    toastManager.add(
      stackedThreadToast({
        type: "success",
        title: `Moved ${detail.displayKey} to ${target.name}`,
      }),
    );
    return true;
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
        input: { cwd: project.workspaceRoot, reference: pr.url, mode: "review" },
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
        worktree: { kind: "existing", branch, worktreePath },
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
    dispatchReview,
    reviewBlockedReason,
  };
}
