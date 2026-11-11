import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import { RotateCwIcon } from "lucide-react";
import { useState } from "react";

import { useThreadShells } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useLiveRestartState } from "../../state/liveRestart";
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

/** `vp run live` holds rebuilt code until a restart, so a pull never kills running agents. */
export function SidebarLiveRestartPill() {
  const state = useLiveRestartState();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const threads = useThreadShells(confirmOpen);

  if (state === null || state.changed.length === 0) return null;

  const interrupted = threads.filter(
    (thread) =>
      thread.environmentId === primaryEnvironmentId && threadRuntimeIsActive(thread.runtime),
  );

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
            <AlertDialogDescription>
              {interrupted.length === 0
                ? "No threads are running."
                : `${interrupted.length === 1 ? "This running thread" : `These ${interrupted.length} running threads`} will be interrupted. T3 tries to resume them after the restart.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {interrupted.length > 0 ? (
            <ul className="max-h-48 list-disc overflow-y-auto px-10 pb-4 text-sm">
              {interrupted.map((thread) => (
                <li key={thread.id} className="truncate">
                  {thread.title}
                </li>
              ))}
            </ul>
          ) : null}
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
