import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { forkDraftKey } from "@t3tools/client-runtime/state/threads";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { msg } from "gt-react";

import { useComposerDraftStore } from "../composerDraftStore";
import { newDraftId, newThreadId } from "../lib/utils";
import { waitForThreadShell } from "../state/entities";
import { buildDraftThreadRouteParams, buildThreadRouteParams } from "../threadRoutes";
import { m } from "../i18n/messages";

/** Opens a thread a fork just created, once its shell reaches this client; returns an error otherwise. */
export function useOpenForkedThread() {
  const navigate = useNavigate();
  return async (targetThreadRef: ScopedThreadRef): Promise<string | null> => {
    if (!(await waitForThreadShell(targetThreadRef))) {
      return m(
        msg(
          "The fork was created, but its thread data did not reach this client. Reconnect and try opening it from the sidebar.",
        ),
      );
    }
    await navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(targetThreadRef),
    });
    return null;
  };
}

/**
 * Opens the thread's fork as a draft of its own. Its first message creates the fork, in a new
 * worktree from the thread's branch, or in the same checkout when the thread has no worktree.
 */
export function useForkThread() {
  const navigate = useNavigate();
  return async (thread: EnvironmentThreadShell) => {
    const store = useComposerDraftStore.getState();
    const key = forkDraftKey(thread.id);
    const draftId = store.getDraftSessionByLogicalProjectKey(key)?.draftId ?? newDraftId();
    if (store.getDraftSession(draftId) === null) {
      store.setLogicalProjectDraftThreadId(
        key,
        scopeProjectRef(thread.environmentId, thread.projectId),
        draftId,
        {
          threadId: newThreadId(),
          createdAt: new Date().toISOString(),
          // Without a worktree the fork shares the checkout as it is; no branch to switch to.
          branch: thread.worktreePath === null ? null : thread.branch,
          worktreePath: null,
          envMode: thread.worktreePath === null ? "local" : "worktree",
          startFromOrigin: false,
          // The source lives on this machine; the draft must not be routed to another.
          environmentSelection: "manual",
          runtimeMode: thread.runtimeMode,
          interactionMode: thread.interactionMode,
        },
      );
      store.setModelSelection(draftId, thread.modelSelection, { replaceOptions: true });
    }
    await navigate({ to: "/draft/$draftId", params: buildDraftThreadRouteParams(draftId) });
  };
}
