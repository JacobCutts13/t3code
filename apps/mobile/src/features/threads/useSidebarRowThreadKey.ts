import { useAtomValue } from "@effect/atom-react";
import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import { resolveThreadTreeRowRef } from "@t3tools/client-runtime/state/threads";
import { AsyncResult } from "effect/reactivity";

import { scopedThreadKey } from "../../lib/scopedEntities";
import { mobilePreferencesAtom } from "../../state/preferences";
import { environmentThreadShells } from "../../state/threads";

/**
 * An open side chat or provider subagent has no row, and a child under a collapsed row is hidden;
 * the nearest row on screen is selected instead.
 */
export function useSidebarRowThreadKey(openThreadKey: string | null): string | null {
  const threads = useAtomValue(environmentThreadShells.quietThreadShellsAtom);
  const preferences = useAtomValue(mobilePreferencesAtom);
  const collapsed = AsyncResult.isSuccess(preferences)
    ? preferences.value.collapsedThreadChildren
    : undefined;
  const openThreadRef = openThreadKey === null ? null : parseScopedThreadKey(openThreadKey);
  if (openThreadRef === null) return openThreadKey;
  const rowRef = resolveThreadTreeRowRef(
    openThreadRef,
    threads,
    (thread) => collapsed?.includes(scopedThreadKey(thread.environmentId, thread.id)) === true,
  );
  return scopedThreadKey(rowRef.environmentId, rowRef.threadId);
}
