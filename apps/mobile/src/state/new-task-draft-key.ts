import { forkDraftKey, forkDraftSourceThreadId } from "@t3tools/client-runtime/state/threads";

const NEW_TASK_DRAFT_PREFIX = "new-task:";

/** A fork's draft, keyed by its source so Fork reopens it. */
export function forkNewTaskDraftKey(sourceThreadId: string): string {
  return newTaskDraftKey(forkDraftKey(sourceThreadId));
}

/** The thread a new-task draft forks, or null. */
export function newTaskDraftForkOf(draftKey: string): string | null {
  return isNewTaskDraftKey(draftKey)
    ? forkDraftSourceThreadId(draftKey.slice(NEW_TASK_DRAFT_PREFIX.length))
    : null;
}

export function newTaskDraftKey(draftId: string): string {
  return `${NEW_TASK_DRAFT_PREFIX}${draftId}`;
}

export function isNewTaskDraftKey(draftKey: string): boolean {
  return draftKey.startsWith(NEW_TASK_DRAFT_PREFIX);
}

export function restoredNewTaskDraftKey(messageId: string): string {
  return newTaskDraftKey(`restored-${messageId}`);
}

export function parseLegacyNewTaskDraftKey(
  draftKey: string,
): { readonly environmentId: string; readonly projectId: string } | null {
  if (!isNewTaskDraftKey(draftKey)) {
    return null;
  }
  const scope = draftKey.slice(NEW_TASK_DRAFT_PREFIX.length);
  const separator = scope.lastIndexOf(":");
  if (separator <= 0 || separator === scope.length - 1) {
    return null;
  }
  return { environmentId: scope.slice(0, separator), projectId: scope.slice(separator + 1) };
}
