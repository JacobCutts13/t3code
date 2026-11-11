import { useAtomValue } from "@effect/atom-react";
import { LIVE_SHELL_STATUSES, type EnvironmentId } from "@t3tools/contracts";
import { RotateCwIcon } from "lucide-react";
import { useState } from "react";

import { usePrimaryEnvironmentId } from "../../state/environments";
import { useLiveRestartState } from "../../state/liveRestart";
import { environmentThreadShells } from "../../state/threads";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";

// Mounted only while the dialog is open, so the footer never subscribes to the thread list.
function InterruptedThreads({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const interrupted = useAtomValue(
    environmentThreadShells.environmentThreadsAtom(environmentId),
  ).filter((thread) => LIVE_SHELL_STATUSES.has(thread.status));
  if (interrupted.length === 0) {
    return <AlertDialogDescription>No threads are running.</AlertDialogDescription>;
  }
  return (
    <>
      <AlertDialogDescription>
        {interrupted.length === 1
          ? "This running thread will be interrupted. T3 tries to resume it after the restart."
          : `These ${interrupted.length} running threads will be interrupted. T3 tries to resume them after the restart.`}
      </AlertDialogDescription>
      <ul className="max-h-48 list-disc overflow-y-auto pl-4 text-sm">
        {interrupted.map((thread) => (
          <li key={thread.id} className="truncate">
            {thread.title}
          </li>
        ))}
      </ul>
    </>
  );
}

export function SidebarLiveRestartPill() {
  const state = useLiveRestartState();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const primaryEnvironmentId = usePrimaryEnvironmentId();

  if (state === null || state.changed.length === 0) return null;

  const restart = async () => {
    setRestarting(true);
    try {
      await window.desktopBridge?.restartForLiveCode?.();
    } catch {
      setRestarting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="flex min-h-7 w-full shrink-0 cursor-pointer items-center gap-2 rounded-lg bg-sidebar-control-surface px-2 py-1.5 text-left text-2xs leading-4 font-medium text-sidebar-foreground outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={() => setConfirmOpen(true)}
      >
        <RotateCwIcon className="size-3.5 shrink-0" />
        <span className="min-w-0 wrap-break-word">New code pulled · Restart</span>
      </button>
      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!restarting) setConfirmOpen(open);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Restart T3 to apply pulled code?</AlertDialogTitle>
            {confirmOpen && primaryEnvironmentId !== null ? (
              <InterruptedThreads environmentId={primaryEnvironmentId} />
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose disabled={restarting} render={<Button variant="outline" />}>
              Later
            </AlertDialogClose>
            <Button disabled={restarting} onClick={() => void restart()}>
              {restarting ? (
                <>
                  <Spinner size="sm" />
                  Restarting…
                </>
              ) : (
                "Restart now"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
