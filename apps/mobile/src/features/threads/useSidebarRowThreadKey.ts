import { useAtomValue } from "@effect/atom-react";
import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  isSettledThreadListRow,
  resolveThreadTreeRowRef,
} from "@t3tools/client-runtime/state/threads";
import { AsyncResult, Atom } from "effect/reactivity";

import { scopedThreadKey } from "../../lib/scopedEntities";
import { mobilePreferencesAtom } from "../../state/preferences";
import { threadListEnvironmentsAtom } from "../../state/presentation";
import { environmentThreadShells } from "../../state/threads";
import { queuedThreadKeysAtom } from "../../state/use-thread-outbox";

const NULL_ROW_KEY_ATOM = Atom.make<string | null>(null);

// Deriving the resolved key inside an atom family avoids subscribing to the full shell list when
// no row is selected (phone portrait) and avoids re-rendering on shell frames that do not change
// the open thread's row.
const sidebarRowThreadKeyAtom = Atom.family((openThreadKey: string) =>
  Atom.make((get): string | null => {
    const openThreadRef = parseScopedThreadKey(openThreadKey);
    if (openThreadRef === null) return openThreadKey;
    const threads = get(environmentThreadShells.quietThreadShellsAtom);
    const { settlementEnvironmentIds } = get(threadListEnvironmentsAtom);
    const queuedThreadKeys = get(queuedThreadKeysAtom);
    const preferences = get(mobilePreferencesAtom);
    const collapsed = AsyncResult.isSuccess(preferences)
      ? preferences.value.collapsedThreadChildren
      : undefined;
    const rowRef = resolveThreadTreeRowRef(
      openThreadRef,
      threads,
      (thread) => collapsed?.includes(scopedThreadKey(thread.environmentId, thread.id)) === true,
      (thread) => isSettledThreadListRow(thread, settlementEnvironmentIds, queuedThreadKeys),
    );
    return scopedThreadKey(rowRef.environmentId, rowRef.threadId);
  }),
);

/**
 * An open side chat or provider subagent has no row, and a child under a collapsed row is hidden;
 * the nearest row on screen is selected instead.
 */
export function useSidebarRowThreadKey(openThreadKey: string | null): string | null {
  return useAtomValue(
    openThreadKey === null ? NULL_ROW_KEY_ATOM : sidebarRowThreadKeyAtom(openThreadKey),
  );
}
