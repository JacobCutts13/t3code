import { useAtomValue } from "@effect/atom-react";
import { LIVE_SHELL_STATUSES, type EnvironmentId } from "@t3tools/contracts";
import { msg, Plural, T, useGT, Var } from "gt-react";
import { RotateCwIcon } from "lucide-react";
import { useState } from "react";

import { m } from "../../i18n/messages";
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
import { SidebarMenuItem } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

// Mounted only while the dialog is open, so the footer never subscribes to the thread list.
function InterruptedThreads({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const interrupted = useAtomValue(
    environmentThreadShells.environmentThreadsAtom(environmentId),
  ).filter((thread) => LIVE_SHELL_STATUSES.has(thread.status));
  if (interrupted.length === 0) {
    return (
      <AlertDialogDescription>
        <T>No threads are running.</T>
      </AlertDialogDescription>
    );
  }
  return (
    <>
      <AlertDialogDescription>
        <T>
          <Plural
            n={interrupted.length}
            singular={
              <>
                This running thread will be interrupted. <Var>T3</Var> tries to resume it after the
                restart.
              </>
            }
            other={
              <>
                These <Var>{interrupted.length}</Var> running threads will be interrupted.{" "}
                <Var>T3</Var> tries to resume them after the restart.
              </>
            }
          />
        </T>
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
  const gt = useGT();
  const state = useLiveRestartState();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const primaryEnvironmentId = usePrimaryEnvironmentId();

  if (state === null || state.changed.length === 0) return null;

  const restart = async () => {
    setRestarting(true);
    try {
      await window.desktopBridge?.restartForLiveCode?.();
    } catch (error) {
      setRestarting(false);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: m(msg("Could not restart {product}", { product: "T3" })),
          description: error instanceof Error ? error.message : m(msg("Restart failed.")),
        }),
      );
    }
  };

  const label = gt("New code pulled · Restart");
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={label}
              className="inline-flex size-8 cursor-pointer items-center justify-center rounded-full bg-info/15 text-info outline-hidden ring-ring transition-colors hover:bg-info/25 focus-visible:ring-2 focus-visible:ring-inset"
              onClick={() => setConfirmOpen(true)}
            >
              <RotateCwIcon className="size-4" />
            </button>
          }
        />
        <TooltipPopup side="top">{label}</TooltipPopup>
      </Tooltip>
      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!restarting) setConfirmOpen(open);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <T>
                Restart <Var>T3</Var> to apply pulled code?
              </T>
            </AlertDialogTitle>
            {confirmOpen && primaryEnvironmentId !== null ? (
              <InterruptedThreads environmentId={primaryEnvironmentId} />
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose disabled={restarting} render={<Button variant="outline" />}>
              <T context="postpone restarting">Later</T>
            </AlertDialogClose>
            <Button disabled={restarting} onClick={() => void restart()}>
              {restarting ? (
                <>
                  <Spinner size="sm" />
                  <T>Restarting…</T>
                </>
              ) : (
                <T>Restart now</T>
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </SidebarMenuItem>
  );
}
