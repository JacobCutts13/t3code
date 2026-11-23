import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

import { forkNewTaskDraftKey } from "../../state/new-task-draft-key";
import {
  createNewTaskDraft,
  getComposerDraftSnapshot,
  updateComposerDraftSettings,
  waitForComposerDraftsLoaded,
} from "../../state/use-composer-drafts";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";

/**
 * Opens the thread's fork as a draft of its own. Its first message creates the fork, in a new
 * worktree from the thread's branch, or in the same checkout when the thread has no worktree.
 */
export function useForkThread() {
  const selectDetail = useSelectWorkspaceDetail();
  return async (thread: EnvironmentThreadShell) => {
    await waitForComposerDraftsLoaded();
    const draftKey = forkNewTaskDraftKey(thread.environmentId, thread.id);
    if (getComposerDraftSnapshot(draftKey).project === undefined) {
      createNewTaskDraft(
        { environmentId: thread.environmentId, projectId: thread.projectId },
        draftKey,
      );
      updateComposerDraftSettings(draftKey, {
        modelSelection: thread.modelSelection,
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        workspaceSelection:
          thread.worktreePath === null
            ? { mode: "local", branch: null, worktreePath: null }
            : {
                mode: "worktree",
                branch: thread.branch,
                worktreePath: null,
                startFromOrigin: false,
              },
      });
    }
    selectDetail({
      name: "Thread",
      params: {
        draft: {
          environmentId: thread.environmentId,
          projectId: thread.projectId,
          draftId: draftKey,
        },
      },
    });
  };
}
